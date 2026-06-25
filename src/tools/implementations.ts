import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { truncateText } from '../utils/text.js';
import { WORKSPACE_ROOT, resolveSafePath } from '../utils/path.js';
import { requireString } from '../utils/validation.js';
import {
  MAX_READ_BYTES,
  MAX_READ_LINES,
  MAX_BASH_OUTPUT_BYTES,
  MAX_BASH_OUTPUT_LINES,
  MAX_BASH_BUFFER_BYTES,
  BASH_TIMEOUT_CEILING_MS,
  DEFAULT_BASH_TIMEOUT_SECONDS,
} from '../config/constants.js';

const execAsync = promisify(exec);

// ─── Tool Implementations ───────────────────────────────────────────────────

/**
 * Reads the contents of a file within the workspace.
 * Supports offset/limit for reading specific line ranges.
 * Output is truncated to configured byte and line limits.
 *
 * @param args - Tool arguments: `path` (required), `offset` (optional), `limit` (optional).
 * @returns The file contents within the requested range.
 */
export async function readTool(args: Record<string, unknown>): Promise<string> {
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

/**
 * Executes a bash command in the workspace directory.
 * Output is truncated to configured byte and line limits.
 *
 * @param args - Tool arguments: `command` (required), `timeout` (optional, seconds).
 * @returns Combined stdout and stderr from the command execution.
 */
export async function bashTool(args: Record<string, unknown>): Promise<string> {
  const command = requireString(args.command, 'command');
  const timeoutSeconds = Number(args.timeout ?? DEFAULT_BASH_TIMEOUT_SECONDS);

  if (Number.isNaN(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error('Invalid timeout. Must be a positive number of seconds.');
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: Math.min(timeoutSeconds * 1000, BASH_TIMEOUT_CEILING_MS),
      shell: '/bin/bash',
      maxBuffer: MAX_BASH_BUFFER_BYTES,
    });
    return truncateText(
      `stdout:\n${stdout}\nstderr:\n${stderr}`.trim(),
      MAX_BASH_OUTPUT_BYTES,
      MAX_BASH_OUTPUT_LINES,
    );
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const stdout = err.stdout ?? '';
    const stderr = err.stderr ?? '';
    const message = err.message ?? 'Command execution failed.';
    return truncateText(
      `error: ${message}\nstdout:\n${stdout}\nstderr:\n${stderr}`.trim(),
      MAX_BASH_OUTPUT_BYTES,
      MAX_BASH_OUTPUT_LINES,
    );
  }
}

/**
 * Writes content to a file within the workspace.
 * Creates parent directories automatically if they don't exist.
 *
 * @param args - Tool arguments: `path` (required), `content` (required).
 * @returns A confirmation message with the number of bytes written.
 */
export async function writeTool(args: Record<string, unknown>): Promise<string> {
  const rawPath = requireString(args.path, 'path');
  const content = args.content == null ? '' : String(args.content);
  const safePath = resolveSafePath(rawPath);
  await mkdir(path.dirname(safePath), { recursive: true });
  await writeFile(safePath, content, 'utf8');
  return `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${path.relative(WORKSPACE_ROOT, safePath)}`;
}

/**
 * Applies precise text replacements to an existing file.
 * Each edit replaces exactly one unique occurrence of `oldText` with `newText`.
 *
 * @param args - Tool arguments: `path` (required), `edits` (required array of {oldText, newText}).
 * @returns A summary of all replacements made.
 */
export async function editTool(args: Record<string, unknown>): Promise<string> {
  const rawPath = requireString(args.path, 'path');

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
