import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);
const WORKSPACE_ROOT = path.resolve(process.cwd());
const MAX_READ_BYTES = 50 * 1024;
const MAX_READ_LINES = 2000;
const MAX_BASH_OUTPUT_BYTES = 50 * 1024;
const MAX_BASH_OUTPUT_LINES = 2000;

export interface Tool {
  name: string;
  description: string;
  func: (args: string) => Promise<string>;
}

function normalizeValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d*\.\d+$/.test(trimmed)) return Number(trimmed);
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return value;
}

function parseToolArgs(args: string): Record<string, unknown> {
  const trimmed = args.trim();
  if (!trimmed) return {};

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // fall through to line-based parsing
    }
  }

  const parsed: Record<string, unknown> = {};
  const lines = trimmed.split(/\r?\n/);
  let currentKey: string | null = null;
  let currentValueLines: string[] = [];

  const flushCurrent = () => {
    if (!currentKey) return;
    const rawValue = currentValueLines.join('\n');
    const value = normalizeValue(rawValue);
    if (parsed[currentKey] === undefined) {
      parsed[currentKey] = value;
    } else if (Array.isArray(parsed[currentKey])) {
      (parsed[currentKey] as unknown[]).push(value);
    } else {
      parsed[currentKey] = [parsed[currentKey], value];
    }
    currentKey = null;
    currentValueLines = [];
  };

  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_\[\]]+):\s*(.*)$/);
    if (match) {
      flushCurrent();
      currentKey = match[1];
      const valueText = match[2];
      if (valueText === '|') {
        currentValueLines = [];
        continue;
      }
      currentValueLines = [valueText];
    } else if (currentKey) {
      currentValueLines.push(line);
    }
  }

  flushCurrent();
  if (Object.keys(parsed).length === 0 && trimmed) {
    return { raw: trimmed };
  }
  return parsed;
}

function truncateText(text: string, maxBytes: number, maxLines: number): string {
  const lines = text.split(/\r?\n/);
  let truncated = lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : text;
  if (Buffer.byteLength(truncated, 'utf8') > maxBytes) {
    truncated = Buffer.from(truncated, 'utf8').slice(0, maxBytes).toString('utf8');
  }
  if (truncated.length < text.length) {
    truncated += '\n...output truncated...';
  }
  return truncated;
}

function resolveSafePath(targetPath: string): string {
  const resolved = path.resolve(WORKSPACE_ROOT, targetPath);
  if (!resolved.startsWith(WORKSPACE_ROOT + path.sep) && resolved !== WORKSPACE_ROOT) {
    throw new Error('Path is outside of the workspace root.');
  }
  return resolved;
}

function requireString(value: unknown, name: string): string {
  if (typeof value === 'string') return value;
  if (value == null) throw new Error(`Missing required parameter: ${name}`);
  return String(value);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function parseEditItem(item: unknown): { oldText: string; newText: string } {
  if (typeof item === 'string') {
    try {
      const parsed = JSON.parse(item) as Record<string, unknown>;
      return {
        oldText: requireString(parsed.oldText, 'oldText'),
        newText: requireString(parsed.newText, 'newText')
      };
    } catch {
      throw new Error('Each edit item must be a JSON object or map with oldText and newText.');
    }
  }

  if (typeof item === 'object' && item !== null) {
    const parsed = item as Record<string, unknown>;
    return {
      oldText: requireString(parsed.oldText, 'oldText'),
      newText: requireString(parsed.newText, 'newText')
    };
  }

  throw new Error('Each edit item must be an object with oldText and newText.');
}

async function readTool(args: string): Promise<string> {
  const parsed = parseToolArgs(args);
  const rawPath = requireString(parsed.path ?? parsed.raw, 'path');
  const offset = Number(parsed.offset ?? 1);
  const limit = Number(parsed.limit ?? MAX_READ_LINES);
  if (Number.isNaN(offset) || offset < 1) {
    throw new Error('Invalid offset. Must be a positive integer starting at 1.');
  }
  if (Number.isNaN(limit) || limit < 1) {
    throw new Error('Invalid limit. Must be a positive integer.');
  }

  const safePath = resolveSafePath(rawPath);
  const content = await readFile(safePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const slice = lines.slice(offset - 1, offset - 1 + limit).join('\n');
  return truncateText(slice, MAX_READ_BYTES, MAX_READ_LINES);
}

async function bashTool(args: string): Promise<string> {
  const parsed = parseToolArgs(args);
  const command = requireString(parsed.command ?? parsed.raw, 'command');
  const timeoutSeconds = Number(parsed.timeout ?? 30);
  if (Number.isNaN(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error('Invalid timeout. Must be a positive number of seconds.');
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: Math.min(timeoutSeconds * 1000, 60_000),
      shell: '/bin/bash',
      maxBuffer: 5 * 1024 * 1024
    });
    return truncateText(`stdout:\n${stdout}\nstderr:\n${stderr}`.trim(), MAX_BASH_OUTPUT_BYTES, MAX_BASH_OUTPUT_LINES);
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const stdout = err.stdout ?? '';
    const stderr = err.stderr ?? '';
    const message = err.message ?? 'Command execution failed.';
    return truncateText(`error: ${message}\nstdout:\n${stdout}\nstderr:\n${stderr}`.trim(), MAX_BASH_OUTPUT_BYTES, MAX_BASH_OUTPUT_LINES);
  }
}

async function writeTool(args: string): Promise<string> {
  const parsed = parseToolArgs(args);
  const rawPath = requireString(parsed.path, 'path');
  const content = parsed.content == null ? '' : String(parsed.content);
  const safePath = resolveSafePath(rawPath);
  await mkdir(path.dirname(safePath), { recursive: true });
  await writeFile(safePath, content, 'utf8');
  return `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${path.relative(WORKSPACE_ROOT, safePath)}`;
}

async function editTool(args: string): Promise<string> {
  const parsed = parseToolArgs(args);
  const rawPath = requireString(parsed.path, 'path');
  const editItems = asArray(parsed['edits[]'] ?? parsed.edits);
  if (editItems.length === 0) {
    throw new Error('Missing required parameter: edits[]');
  }

  const safePath = resolveSafePath(rawPath);
  let content = await readFile(safePath, 'utf8');
  const results: string[] = [];

  for (const item of editItems) {
    const { oldText, newText } = parseEditItem(item);
    const firstIndex = content.indexOf(oldText);
    if (firstIndex === -1) {
      throw new Error('oldText not found in target file.');
    }
    const secondIndex = content.indexOf(oldText, firstIndex + 1);
    if (secondIndex !== -1) {
      throw new Error('oldText must match a unique occurrence in the file.');
    }
    content = `${content.slice(0, firstIndex)}${newText}${content.slice(firstIndex + oldText.length)}`;
    results.push(`Replaced one occurrence of oldText in ${path.relative(WORKSPACE_ROOT, safePath)}`);
  }

  await writeFile(safePath, content, 'utf8');
  return results.join('\n');
}

export const tools: Tool[] = [
  {
    name: 'read',
    description: 'Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. Output is truncated to 2000 lines or 50KB. Use offset/limit for large files.',
    func: readTool
  },
  {
    name: 'bash',
    description: 'Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB. Optionally provide a timeout in seconds.',
    func: bashTool
  },
  {
    name: 'write',
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    func: writeTool
  },
  {
    name: 'edit',
    description: 'Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits.',
    func: editTool
  }
];
