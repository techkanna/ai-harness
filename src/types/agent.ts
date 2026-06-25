import type { LocalLlmClient } from '../llm/client.js';
import type { Tool } from './tool.js';

// ─── Log Level ──────────────────────────────────────────────────────────────

/** Supported logging verbosity levels. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

// ─── Agent Events ───────────────────────────────────────────────────────────

/** Events emitted by the agent loop for real-time rendering. */
export type AgentEvent =
  | { type: 'llm_start'; iteration: number }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_call_start'; iteration: number; name: string; args: Record<string, unknown> }
  | { type: 'tool_call_end'; iteration: number; name: string; result: string }
  | { type: 'complete' };

// ─── Agent Options ──────────────────────────────────────────────────────────

/** Configuration options for creating an AgentHarness instance. */
export interface AgentHarnessOptions {
  client: LocalLlmClient;
  tools?: Tool[];
  systemPrompt?: string;
  /** Maximum number of LLM round-trips before the agent forcibly stops. Default: 25 */
  maxIterations?: number;
  /** Maximum number of conversation messages (excluding system) before truncation kicks in. Default: 50 */
  maxContextMessages?: number;
  /** Maximum tokens for the context-summarization LLM call. Default: 1024 */
  summaryMaxTokens?: number;
  /** Logging verbosity. Default: 'info' */
  logLevel?: LogLevel;
}

// ─── Agent Step ─────────────────────────────────────────────────────────────

/** One step in the agent's execution trace. */
export interface AgentStep {
  iteration: number;
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult: string;
  llmResponse: string | null;
}

// ─── Agent Result ───────────────────────────────────────────────────────────

/** The outcome type of an agent run. */
export type AgentResultType = 'reply' | 'max_iterations' | 'aborted' | 'error';

/** The complete result returned from an agent run. */
export interface AgentResult {
  type: AgentResultType;
  text: string;
  /** Full trace of every tool-call iteration. Empty if the LLM answered directly. */
  steps: AgentStep[];
  /** How many LLM round-trips were made. */
  iterationCount: number;
}

// ─── Run Options ────────────────────────────────────────────────────────────

/** Options for a single agent run invocation. */
export interface RunOptions {
  /** An AbortSignal to cancel the agent loop externally. */
  signal?: AbortSignal;
  /** Callback for real-time agent events (streaming text, tool calls, etc.). */
  onEvent?: (event: AgentEvent) => void;
}
