import path from 'path';
import { PathSecurityError } from '../errors/errors.js';

/** The resolved workspace root directory. */
export const WORKSPACE_ROOT = path.resolve(process.cwd());

/**
 * Resolves a file path relative to the workspace root and validates
 * that it does not escape the workspace boundary.
 *
 * @param targetPath - The path to resolve (relative or absolute).
 * @returns The resolved absolute path.
 * @throws {PathSecurityError} If the resolved path is outside the workspace root.
 */
export function resolveSafePath(targetPath: string): string {
  const resolved = path.resolve(WORKSPACE_ROOT, targetPath);
  if (!resolved.startsWith(WORKSPACE_ROOT + path.sep) && resolved !== WORKSPACE_ROOT) {
    throw new PathSecurityError(targetPath, WORKSPACE_ROOT);
  }
  return resolved;
}
