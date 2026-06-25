import type { AgentEvent } from '../types/agent.js';
import { truncateString } from '../utils/text.js';
import {
  CLI_ARG_TRUNCATE_LENGTH,
  CLI_RESULT_TRUNCATE_LENGTH,
  CLI_RESULT_PREVIEW_LINES,
} from '../config/constants.js';

// ─── ANSI Helpers ───────────────────────────────────────────────────────────

/** ANSI escape code map for terminal coloring. */
export const ansi = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  italic: '\x1b[3m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
} as const;

// ─── Event Renderer ─────────────────────────────────────────────────────────

/**
 * Creates a stateful event handler that renders agent events to the terminal.
 * Handles thinking/text deltas, tool call start/end, and completion events
 * with appropriate ANSI formatting.
 *
 * @returns A callback function to pass as `onEvent` to `AgentHarness.run()`.
 */
export function createEventHandler(): (event: AgentEvent) => void {
  let isThinking = false;
  let needsNewline = false;

  return (event: AgentEvent) => {
    switch (event.type) {
      case 'llm_start':
        // No visible output — just an internal signal
        break;

      case 'thinking_delta':
        if (!isThinking) {
          if (needsNewline) {
            process.stdout.write('\n');
            needsNewline = false;
          }
          process.stdout.write(`${ansi.dim}${ansi.italic}`);
          isThinking = true;
        }
        process.stdout.write(event.delta);
        needsNewline = !event.delta.endsWith('\n');
        break;

      case 'text_delta':
        if (isThinking) {
          if (needsNewline) process.stdout.write('\n');
          process.stdout.write(`${ansi.reset}`);
          isThinking = false;
          needsNewline = false;
        }
        process.stdout.write(event.delta);
        needsNewline = event.delta.length > 0 && !event.delta.endsWith('\n');
        break;

      case 'tool_call_start': {
        if (isThinking) {
          if (needsNewline) process.stdout.write('\n');
          process.stdout.write(`${ansi.reset}`);
          isThinking = false;
        }
        if (needsNewline) {
          process.stdout.write('\n');
          needsNewline = false;
        }
        const argsStr = Object.entries(event.args)
          .map(([k, v]) => {
            const val = typeof v === 'string' ? v : JSON.stringify(v);
            return `${k}: ${truncateString(val, CLI_ARG_TRUNCATE_LENGTH)}`;
          })
          .join(', ');
        process.stdout.write(`  ${ansi.yellow}\u27E1 ${event.name}${ansi.reset}${ansi.dim}(${argsStr})${ansi.reset}\n`);
        break;
      }

      case 'tool_call_end': {
        const preview = event.result.split('\n').slice(0, CLI_RESULT_PREVIEW_LINES).join(' ').trim();
        process.stdout.write(`  ${ansi.green}\u2713 ${event.name}${ansi.reset}${ansi.dim} \u2192 ${truncateString(preview, CLI_RESULT_TRUNCATE_LENGTH)}${ansi.reset}\n`);
        break;
      }

      case 'complete':
        if (isThinking) {
          process.stdout.write(`${ansi.reset}`);
          isThinking = false;
        }
        if (needsNewline) {
          process.stdout.write('\n');
          needsNewline = false;
        }
        break;
    }
  };
}
