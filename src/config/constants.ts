// ─── Application ────────────────────────────────────────────────────────────

/** Application display name. */
export const APP_NAME = 'AI Harness';

/** Application version string. */
export const APP_VERSION = '0.1.0';

// ─── LLM Defaults ───────────────────────────────────────────────────────────

/** Default temperature for LLM requests. */
export const DEFAULT_TEMPERATURE = 1.0;

/** Default top-p sampling value. */
export const DEFAULT_TOP_P = 0.95;

/** Default top-k sampling value. */
export const DEFAULT_TOP_K = 64;

/** Default presence penalty. */
export const DEFAULT_PRESENCE_PENALTY = 0;

/** Default frequency penalty. */
export const DEFAULT_FREQUENCY_PENALTY = 0;

// ─── Agent Defaults ─────────────────────────────────────────────────────────

/** Default maximum number of LLM round-trips before the agent forcibly stops. */
export const DEFAULT_MAX_ITERATIONS = 25;

/** Default maximum conversation messages (excluding system) before truncation. */
export const DEFAULT_MAX_CONTEXT_MESSAGES = 50;

/** Default maximum tokens for the context-summarization LLM call. */
export const DEFAULT_SUMMARY_MAX_TOKENS = 1024;

/** Default system prompt when none is provided. */
export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant agent.';

/** Default log level. */
export const DEFAULT_LOG_LEVEL = 'info' as const;

/** Maximum number of messages to keep for the final wrap-up call. */
export const MAX_FINAL_CALL_MESSAGES = 30;

// ─── Tool Limits ────────────────────────────────────────────────────────────

/** Maximum bytes returned when reading a file. */
export const MAX_READ_BYTES = 50 * 1024;

/** Maximum lines returned when reading a file. */
export const MAX_READ_LINES = 2000;

/** Maximum bytes returned from bash command output. */
export const MAX_BASH_OUTPUT_BYTES = 50 * 1024;

/** Maximum lines returned from bash command output. */
export const MAX_BASH_OUTPUT_LINES = 2000;

/** Maximum buffer size for child process stdout/stderr (5 MB). */
export const MAX_BASH_BUFFER_BYTES = 5 * 1024 * 1024;

/** Hard ceiling for bash command timeout in milliseconds. */
export const BASH_TIMEOUT_CEILING_MS = 60_000;

/** Default bash command timeout in seconds. */
export const DEFAULT_BASH_TIMEOUT_SECONDS = 30;

// ─── CLI ────────────────────────────────────────────────────────────────────

/** Maximum character length for truncated tool argument display in CLI. */
export const CLI_ARG_TRUNCATE_LENGTH = 60;

/** Maximum character length for truncated tool result preview in CLI. */
export const CLI_RESULT_TRUNCATE_LENGTH = 120;

/** Maximum preview lines for tool result in CLI. */
export const CLI_RESULT_PREVIEW_LINES = 3;
