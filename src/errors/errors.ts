// ─── Base Error ─────────────────────────────────────────────────────────────

/**
 * Base error class for all AI Harness errors.
 * Provides a consistent `code` property for programmatic error handling.
 */
export class HarnessError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

// ─── LLM Errors ─────────────────────────────────────────────────────────────

/** Thrown when an HTTP request to the LLM server fails. */
export class LlmRequestError extends HarnessError {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(statusCode: number, responseBody: string) {
    super(`LLM request failed ${statusCode}: ${responseBody}`, 'LLM_REQUEST_FAILED');
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

/** Thrown when the streaming response body is unavailable or corrupted. */
export class StreamError extends HarnessError {
  constructor(message = 'Streaming response body is unavailable.') {
    super(message, 'STREAM_ERROR');
  }
}

// ─── Tool Errors ────────────────────────────────────────────────────────────

/** Thrown when a tool function fails during execution. */
export class ToolExecutionError extends HarnessError {
  readonly toolName: string;

  constructor(toolName: string, cause: string) {
    super(`Tool "${toolName}" failed: ${cause}`, 'TOOL_EXECUTION_FAILED');
    this.toolName = toolName;
  }
}

/** Thrown when the agent tries to call a tool that doesn't exist. */
export class ToolNotFoundError extends HarnessError {
  readonly toolName: string;
  readonly availableTools: string[];

  constructor(toolName: string, availableTools: string[]) {
    super(
      `Tool not found: "${toolName}". Available tools: ${availableTools.join(', ')}`,
      'TOOL_NOT_FOUND',
    );
    this.toolName = toolName;
    this.availableTools = availableTools;
  }
}

// ─── Path Errors ────────────────────────────────────────────────────────────

/** Thrown when a file path resolves outside the workspace root. */
export class PathSecurityError extends HarnessError {
  readonly attemptedPath: string;
  readonly workspaceRoot: string;

  constructor(attemptedPath: string, workspaceRoot: string) {
    super('Path is outside of the workspace root.', 'PATH_SECURITY_VIOLATION');
    this.attemptedPath = attemptedPath;
    this.workspaceRoot = workspaceRoot;
  }
}

// ─── Validation Errors ──────────────────────────────────────────────────────

/** Thrown when a required parameter is missing or invalid. */
export class ValidationError extends HarnessError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
  }
}

// ─── Config Errors ──────────────────────────────────────────────────────────

/** Thrown when environment configuration is invalid or missing. */
export class ConfigError extends HarnessError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
  }
}
