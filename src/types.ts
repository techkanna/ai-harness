// ─── Tool Parameter Schema ─────────────────────────────────────────────────

export interface ToolParameterProperty {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required: string[];
}

// ─── Tool Definition ────────────────────────────────────────────────────────

/**
 * A tool that the agent can invoke.
 *
 * `parameters` declares the JSON Schema for the tool's arguments.
 * `func` receives the **parsed** arguments object (the harness handles
 * JSON.parse for you — no manual parsing needed inside tools).
 */
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  func: (args: Record<string, unknown>) => Promise<string>;
}

// ─── OpenAI-compatible API types ────────────────────────────────────────────

/** Tool definition sent in the API request body under `tools`. */
export interface ApiToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolParameters;
  };
}

/** A single tool call returned by the model in its response. */
export interface ApiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string of the arguments
  };
}

// ─── Conversation Message ───────────────────────────────────────────────────

/**
 * A message in the conversation history.
 * Supports all four roles: system, user, assistant, tool.
 */
export interface ConversationMessage {
  role: string;
  content: string | null;
  name?: string;
  /** Present on assistant messages that invoke tools. */
  tool_calls?: ApiToolCall[];
  /** Present on tool-result messages — links back to the tool_call id. */
  tool_call_id?: string;
}
