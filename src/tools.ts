import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { Tool } from './types.js';

const execAsync = promisify(exec);
const WORKSPACE_ROOT = path.resolve(process.cwd());
const MAX_READ_BYTES = 50 * 1024;
const MAX_READ_LINES = 2000;
const MAX_BASH_OUTPUT_BYTES = 50 * 1024;
const MAX_BASH_OUTPUT_LINES = 2000;

// ─── Utilities ──────────────────────────────────────────────────────────────

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

// ─── Tool implementations ───────────────────────────────────────────────────

async function readTool(args: Record<string, unknown>): Promise<string> {
  const rawPath = requireString(args.path, 'path');
  const offset = Number(args.offset ?? 1);
  const limit = Number(args.limit ?? MAX_READ_LINES);

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

async function bashTool(args: Record<string, unknown>): Promise<string> {
  const command = requireString(args.command, 'command');
  const timeoutSeconds = Number(args.timeout ?? 30);

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

async function writeTool(args: Record<string, unknown>): Promise<string> {
  const rawPath = requireString(args.path, 'path');
  const content = args.content == null ? '' : String(args.content);
  const safePath = resolveSafePath(rawPath);
  await mkdir(path.dirname(safePath), { recursive: true });
  await writeFile(safePath, content, 'utf8');
  return `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${path.relative(WORKSPACE_ROOT, safePath)}`;
}

async function editTool(args: Record<string, unknown>): Promise<string> {
  const rawPath = requireString(args.path, 'path');

  // edits comes as a parsed array from JSON.parse — no custom parsing needed.
  const editItems = args.edits;
  if (!Array.isArray(editItems) || editItems.length === 0) {
    throw new Error('Missing required parameter: edits (must be a non-empty array).');
  }

  const safePath = resolveSafePath(rawPath);
  let content = await readFile(safePath, 'utf8');
  const results: string[] = [];

  for (const item of editItems) {
    const edit = item as Record<string, unknown>;
    const oldText = requireString(edit.oldText, 'oldText');
    const newText = requireString(edit.newText, 'newText');

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

// ─── Tool definitions with JSON schemas ─────────────────────────────────────

export const tools: Tool[] = [
  {
    name: 'read',
    description: 'Read the contents of a file. Output is truncated to 2000 lines or 50KB.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative or absolute file path to read.',
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (1-based). Default: 1.',
          default: 1,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to return. Default: 2000.',
          default: 2000,
        },
      },
      required: ['path'],
    },
    func: readTool,
  },
  {
    name: 'bash',
    description: 'Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to 2000 lines or 50KB.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute.',
        },
        timeout: {
          type: 'number',
          description: 'Maximum execution time in seconds. Default: 30.',
          default: 30,
        },
      },
      required: ['command'],
    },
    func: bashTool,
  },
  {
    name: 'write',
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative or absolute file path to write to.',
        },
        content: {
          type: 'string',
          description: 'The full text content to write to the file.',
        },
      },
      required: ['path', 'content'],
    },
    func: writeTool,
  },
  {
    name: 'edit',
    description: 'Edit a single file using exact text replacement. Each edit replaces one unique occurrence of oldText with newText.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative or absolute file path to edit. The file must already exist.',
        },
        edits: {
          type: 'array',
          description: 'Array of edit objects. Each object must have "oldText" (exact text to find) and "newText" (replacement text).',
        },
      },
      required: ['path', 'edits'],
    },
    func: editTool,
  },
];
