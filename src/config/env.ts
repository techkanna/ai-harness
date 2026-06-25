import { createLogger } from '../utils/logger.js';

// ─── Environment Variable Defaults ──────────────────────────────────────────

/** Base URL for the local LLM server. */
export const DEFAULT_LOCAL_LLM_BASE_URL = process.env.MODEL_BASE_URL || 'http://127.0.0.1:1234';

/** Maximum response tokens for LLM requests. */
export const DEFAULT_LOCAL_LLM_MAX_TOKENS = Number(process.env.MODEL_MAX_TOKENS || 8192);

/** API request path for the LLM server. */
export const DEFAULT_LOCAL_LLM_REQUEST_PATH = process.env.MODEL_REQUEST_PATH || '/v1/chat/completions';

/** Model name identifier sent to the LLM server. */
export const DEFAULT_LOCAL_LLM_MODEL_NAME = process.env.MODEL_NAME || 'google/gemma-4-e4b';

/** Host for the browser automation server. */
export const DEFAULT_BROWSER_HOST = process.env.BROWSER_HOST || '127.0.0.1';

/** Port for the browser automation server. */
export const DEFAULT_BROWSER_PORT = Number(process.env.BROWSER_PORT || 3000);

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validates environment configuration at startup.
 * Logs warnings for missing environment variables (non-fatal since defaults exist).
 */
export function validateConfig(): void {
  const log = createLogger('info', '[Config]');

  const envVars: Array<{ name: string; description: string }> = [
    { name: 'MODEL_BASE_URL', description: 'LLM server base URL' },
    { name: 'MODEL_NAME', description: 'LLM model name' },
  ];

  for (const { name, description } of envVars) {
    if (!process.env[name]) {
      log.warn(`${name} not set — using default for ${description}.`);
    }
  }
}
