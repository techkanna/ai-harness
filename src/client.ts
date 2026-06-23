import type { ApiToolCall, ApiToolDefinition, StreamChatResult } from './types.js';

export interface LocalLlmClientOptions {
  baseUrl?: string;
  model?: string;
  requestPath?: string;
  maxTokens?: number;
}

export interface LlmResponseChoice {
  finish_reason?: string; // 'stop', 'tool_calls', 'length', etc.
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

export interface LlmResponse {
  choices?: LlmResponseChoice[];
}

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

import { DEFAULT_LOCAL_LLM_BASE_URL, DEFAULT_LOCAL_LLM_MAX_TOKENS, DEFAULT_LOCAL_LLM_MODEL_NAME, DEFAULT_LOCAL_LLM_REQUEST_PATH } from './config.js';

export function createLocalLlmClient({
  baseUrl = DEFAULT_LOCAL_LLM_BASE_URL,
  model = DEFAULT_LOCAL_LLM_MODEL_NAME,
  requestPath = DEFAULT_LOCAL_LLM_REQUEST_PATH,
  maxTokens = DEFAULT_LOCAL_LLM_MAX_TOKENS
}: LocalLlmClientOptions = {}) {
  const url = `${baseUrl.replace(/\/+$/, '')}${requestPath}`;

  async function request(body: unknown): Promise<LlmResponse> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM request failed ${response.status}: ${text}`);
    }

    return response.json();
  }

  async function chat(messages: unknown[], options: ChatOptions = {}): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 1.0,
      max_tokens: options.max_tokens ?? maxTokens,
      top_p: options.top_p ?? 0.95,
      top_k: options.top_k ?? 64,
      presence_penalty: options.presence_penalty ?? 0,
      frequency_penalty: options.frequency_penalty ?? 0,
      stop: options.stop
    };

    // Only include tools in the request body when tools are provided.
    // This avoids sending an empty array which some servers reject.
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = options.tool_choice ?? 'auto';
    }

    return request(body);
  }

  async function completion(prompt: string, options: ChatOptions = {}): Promise<LlmResponse> {
    const messages = [{ role: 'user', content: prompt }];
    return chat(messages, options);
  }

  async function streamChat(
    messages: unknown[],
    options: ChatOptions = {},
    onDelta: (delta: string) => void
  ): Promise<void> {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 1.0,
      max_tokens: options.max_tokens ?? maxTokens,
      top_p: options.top_p ?? 0.95,
      top_k: options.top_k ?? 64,
      presence_penalty: options.presence_penalty ?? 0,
      frequency_penalty: options.frequency_penalty ?? 0,
      stop: options.stop,
      stream: true
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = options.tool_choice ?? 'auto';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM request failed ${response.status}: ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Streaming response body is unavailable.');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    function handleStreamPart(part: string): boolean {
      const events = part.split(/\r?\n\r?\n/).filter(Boolean);
      for (const event of events) {
        const lines = event.split(/\r?\n/);
        for (const line of lines) {
          const match = line.match(/^data:\s*(.*)$/);
          if (!match) continue;
          const raw = match[1].trim();
          if (raw === '[DONE]') return true;
          try {
            const parsed = JSON.parse(raw) as LlmResponse;
            const choice = parsed.choices?.[0];
            const contentDelta = choice?.delta?.content;
            const reasoningDelta = choice?.delta?.reasoning_content;
            const messageContent = choice?.message?.content;
            const messageReasoning = choice?.message?.reasoning_content;
            if (contentDelta != null) {
              onDelta(contentDelta);
            } else if (reasoningDelta != null) {
              onDelta(`<|reasoning|>${reasoningDelta}`);
            } else if (messageContent != null) {
              onDelta(messageContent);
            } else if (messageReasoning != null) {
              onDelta(`<|reasoning|>${messageReasoning}`);
            }
          } catch {
            // Ignore parse failures for partial fragments.
          }
        }
      }
      return false;
    }
  
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const boundary = buffer.lastIndexOf('\n\n');
      if (boundary === -1) continue;
      
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const completed = handleStreamPart(chunk);
      if (completed) return;
    }

    if (buffer.trim()) {
      handleStreamPart(buffer);
    }
  }

  /**
   * Streaming chat with full tool-call support.
   *
   * Streams text and thinking deltas via callbacks while accumulating
   * tool_call deltas from the SSE stream. Returns the complete result
   * including any tool calls the model wants to make.
   */
  async function streamChatWithTools(
    messages: unknown[],
    options: ChatOptions = {},
    onTextDelta?: (delta: string) => void,
    onThinkingDelta?: (delta: string) => void,
  ): Promise<StreamChatResult> {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 1.0,
      max_tokens: options.max_tokens ?? maxTokens,
      top_p: options.top_p ?? 0.95,
      top_k: options.top_k ?? 64,
      presence_penalty: options.presence_penalty ?? 0,
      frequency_penalty: options.frequency_penalty ?? 0,
      stop: options.stop,
      stream: true,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = options.tool_choice ?? 'auto';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM request failed ${response.status}: ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Streaming response body is unavailable.');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedContent = '';
    let finishReason = 'stop';

    // Accumulate tool calls by index — deltas arrive incrementally.
    const toolAccum = new Map<number, { id: string; name: string; arguments: string }>();

    function handlePart(part: string): boolean {
      const events = part.split(/\r?\n\r?\n/).filter(Boolean);
      for (const event of events) {
        const lines = event.split(/\r?\n/);
        for (const line of lines) {
          const match = line.match(/^data:\s*(.*)$/);
          if (!match) continue;
          const raw = match[1].trim();
          if (raw === '[DONE]') return true;
          try {
            const parsed = JSON.parse(raw) as LlmResponse;
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }

            // ── Content deltas ──
            const contentDelta = choice.delta?.content;
            if (contentDelta != null) {
              accumulatedContent += contentDelta;
              onTextDelta?.(contentDelta);
            }

            // ── Reasoning deltas ──
            const reasoningDelta = choice.delta?.reasoning_content;
            if (reasoningDelta != null) {
              onThinkingDelta?.(reasoningDelta);
            }

            // ── Tool call deltas ──
            const tcDeltas = choice.delta?.tool_calls;
            if (tcDeltas) {
              for (const tc of tcDeltas) {
                const idx = tc.index;
                if (!toolAccum.has(idx)) {
                  toolAccum.set(idx, { id: '', name: '', arguments: '' });
                }
                const acc = toolAccum.get(idx)!;
                if (tc.id) acc.id = tc.id;
                if (tc.function?.name) acc.name = tc.function.name;
                if (tc.function?.arguments != null) acc.arguments += tc.function.arguments;
              }
            }

            // ── Non-streaming fallbacks (message field) ──
            const msgContent = choice.message?.content;
            if (msgContent != null) {
              accumulatedContent += msgContent;
              onTextDelta?.(msgContent);
            }
            const msgReasoning = choice.message?.reasoning_content;
            if (msgReasoning != null) {
              onThinkingDelta?.(msgReasoning);
            }
            const msgToolCalls = choice.message?.tool_calls;
            if (msgToolCalls) {
              for (let i = 0; i < msgToolCalls.length; i++) {
                const tc = msgToolCalls[i];
                toolAccum.set(i, {
                  id: tc.id,
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                });
              }
            }
          } catch {
            // Ignore parse failures for partial fragments.
          }
        }
      }
      return false;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const boundary = buffer.lastIndexOf('\n\n');
      if (boundary === -1) continue;
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (handlePart(chunk)) break;
    }
    if (buffer.trim()) {
      handlePart(buffer);
    }

    // Build sorted tool calls array from accumulated deltas.
    const toolCalls: ApiToolCall[] = [...toolAccum.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, acc]) => ({
        id: acc.id,
        type: 'function' as const,
        function: { name: acc.name, arguments: acc.arguments },
      }));

    return { content: accumulatedContent, toolCalls, finishReason };
  }

  return { chat, completion, streamChat, streamChatWithTools, url };
}

export type LocalLlmClient = ReturnType<typeof createLocalLlmClient>;
