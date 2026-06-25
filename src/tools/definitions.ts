import type { Tool } from '../types/tool.js';
import { readTool, bashTool, writeTool, editTool } from './implementations.js';

// ─── Tool Definitions with JSON Schemas ─────────────────────────────────────

/** The built-in set of tools available to the agent. */
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
