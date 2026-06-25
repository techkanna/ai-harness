// ─── Log Level Types ────────────────────────────────────────────────────────

import type { LogLevel } from '../types/agent.js';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

// ─── Logger ─────────────────────────────────────────────────────────────────

/**
 * Structured logger with configurable verbosity levels.
 * Wraps console methods and prepends a prefix to all output.
 */
export class Logger {
  private level: number;
  private prefix: string;

  constructor(level: LogLevel = 'info', prefix = '[AgentHarness]') {
    this.level = LOG_LEVEL_PRIORITY[level];
    this.prefix = prefix;
  }

  /** Log a debug-level message. Only visible when logLevel is 'debug'. */
  debug(...args: unknown[]): void {
    if (this.level <= LOG_LEVEL_PRIORITY.debug) {
      console.debug(this.prefix, ...args);
    }
  }

  /** Log an informational message. */
  info(...args: unknown[]): void {
    if (this.level <= LOG_LEVEL_PRIORITY.info) {
      console.info(this.prefix, ...args);
    }
  }

  /** Log a warning message. */
  warn(...args: unknown[]): void {
    if (this.level <= LOG_LEVEL_PRIORITY.warn) {
      console.warn(this.prefix, ...args);
    }
  }

  /** Log an error message. */
  error(...args: unknown[]): void {
    if (this.level <= LOG_LEVEL_PRIORITY.error) {
      console.error(this.prefix, ...args);
    }
  }
}

/**
 * Factory function to create a Logger instance.
 *
 * @param level - Logging verbosity level.
 * @param prefix - Prefix string prepended to all log messages.
 * @returns A configured Logger instance.
 */
export function createLogger(level: LogLevel = 'info', prefix = '[AgentHarness]'): Logger {
  return new Logger(level, prefix);
}
