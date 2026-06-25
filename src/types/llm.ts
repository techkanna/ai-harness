import type { ToolParameters } from './tool.js';

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
    /** JSON string of the arguments. */
    arguments: string;
  };
}

// ─── Conversation Message ───────────────────────────────────────────────────

/** Valid roles for messages in the conversation history. */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * A message in the conversation history.
 * Supports all four roles: system, user, assistant, tool.
 */
export interface ConversationMessage {
  role: MessageRole;
  content: string | null;
  name?: string;
  /** Present on assistant messages that invoke tools. */
  tool_calls?: ApiToolCall[];
  /** Present on tool-result messages — links back to the tool_call id. */
  tool_call_id?: string;
}

// ─── Streaming result ───────────────────────────────────────────────────────

/** Accumulated result from a streaming chat call with tool support. */
export interface StreamChatResult {
  content: string;
  toolCalls: ApiToolCall[];
  finishReason: string;
}

// ─── LLM Client Types ──────────────────────────────────────────────────────

/** Configuration options for creating a local LLM client. */
export interface LocalLlmClientOptions {
  baseUrl?: string;
  model?: string;
  requestPath?: string;
  maxTokens?: number;
}

/** A single choice in the LLM's response. */
export interface LlmResponseChoice {
  finish_reason?: string;
  message?: {
    role?: string;
    content?: string | null;
    reasoning_content?: string;
    tool_calls?: ApiToolCall[];
  };
  text?: string;
  delta?: {
    content?: string;
    reasoning_content?: string;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
}

/** Top-level response from the LLM API. */
export interface LlmResponse {
  choices?: LlmResponseChoice[];
}

/** Options for a chat completion request. */
export interface ChatOptions {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  top_k?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  stop?: string[];
  /** OpenAI-compatible tool definitions. When provided, the model can return tool_calls. */
  tools?: ApiToolDefinition[];
  /** Controls how the model selects tools. Default: 'auto'. */
  tool_choice?: string | Record<string, unknown>;
  [key: string]: unknown;
}
