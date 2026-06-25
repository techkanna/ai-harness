import type {
  ApiToolCall,
  ChatOptions,
  LlmResponse,
  LlmResponseChoice,
  LocalLlmClientOptions,
  StreamChatResult,
} from '../types/llm.js';
import {
  DEFAULT_LOCAL_LLM_BASE_URL,
  DEFAULT_LOCAL_LLM_MAX_TOKENS,
  DEFAULT_LOCAL_LLM_MODEL_NAME,
  DEFAULT_LOCAL_LLM_REQUEST_PATH,
} from '../config/env.js';
import {
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_P,
  DEFAULT_TOP_K,
  DEFAULT_PRESENCE_PENALTY,
  DEFAULT_FREQUENCY_PENALTY,
} from '../config/constants.js';
import { LlmRequestError, StreamError } from '../errors/errors.js';
import { readSSEStream } from './stream.js';

// ─── Request Builder ────────────────────────────────────────────────────────

/**
 * Builds the common request body shared between all chat methods.
 * Merges model defaults with per-request overrides.
 */
function buildRequestBody(
  model: string,
  messages: unknown[],
  options: ChatOptions,
  maxTokens: number,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: options.max_tokens ?? maxTokens,
    top_p: options.top_p ?? DEFAULT_TOP_P,
    top_k: options.top_k ?? DEFAULT_TOP_K,
    presence_penalty: options.presence_penalty ?? DEFAULT_PRESENCE_PENALTY,
    frequency_penalty: options.frequency_penalty ?? DEFAULT_FREQUENCY_PENALTY,
    stop: options.stop,
  };

  if (stream) {
    body.stream = true;
  }

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = options.tool_choice ?? 'auto';
  }

  return body;
}

// ─── Client Factory ─────────────────────────────────────────────────────────

/**
 * Creates a local LLM client that communicates with an OpenAI-compatible
 * endpoint over HTTP.
 *
 * The returned client provides methods for both regular and streaming
 * chat completions, with full tool-call support.
 *
 * @param options - Configuration for the LLM endpoint.
 * @returns An object with `chat`, `completion`, `streamChat`, and `streamChatWithTools` methods.
 */
export function createLocalLlmClient({
  baseUrl = DEFAULT_LOCAL_LLM_BASE_URL,
  model = DEFAULT_LOCAL_LLM_MODEL_NAME,
  requestPath = DEFAULT_LOCAL_LLM_REQUEST_PATH,
  maxTokens = DEFAULT_LOCAL_LLM_MAX_TOKENS,
}: LocalLlmClientOptions = {}) {
  const url = `${baseUrl.replace(/\/+$/, '')}${requestPath}`;

  /**
   * Sends a raw POST request to the LLM endpoint.
   *
   * @param body - The JSON-serializable request body.
   * @returns The parsed LLM response.
   * @throws {LlmRequestError} If the HTTP response is not OK.
   */
  async function request(body: unknown): Promise<LlmResponse> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new LlmRequestError(response.status, text);
    }

    return response.json();
  }

  /**
   * Sends a non-streaming chat completion request.
   *
   * @param messages - The conversation messages.
   * @param options - Additional chat options (temperature, tools, etc.).
   * @returns The parsed LLM response.
   */
  async function chat(messages: unknown[], options: ChatOptions = {}): Promise<LlmResponse> {
    return request(buildRequestBody(model, messages, options, maxTokens, false));
  }

  /**
   * Convenience method: sends a single user message as a chat completion.
   *
   * @param prompt - The user's prompt text.
   * @param options - Additional chat options.
   * @returns The parsed LLM response.
   */
  async function completion(prompt: string, options: ChatOptions = {}): Promise<LlmResponse> {
    const messages = [{ role: 'user', content: prompt }];
    return chat(messages, options);
  }

  /**
   * Sends a streaming chat completion request with text-only callbacks.
   *
   * @param messages - The conversation messages.
   * @param options - Additional chat options.
   * @param onDelta - Callback invoked for each text delta from the stream.
   */
  async function streamChat(
    messages: unknown[],
    options: ChatOptions = {},
    onDelta: (delta: string) => void,
  ): Promise<void> {
    const body = buildRequestBody(model, messages, options, maxTokens, true);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new LlmRequestError(response.status, text);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new StreamError();
    }

    await readSSEStream(reader, {
      onTextDelta: (delta) => onDelta(delta),
      onThinkingDelta: (delta) => onDelta(`<|reasoning|>${delta}`),
      onMessage: (choice: LlmResponseChoice) => {
        if (choice.message?.content != null) {
          onDelta(choice.message.content);
        }
        if (choice.message?.reasoning_content != null) {
          onDelta(`<|reasoning|>${choice.message.reasoning_content}`);
        }
      },
    });
  }

  /**
   * Streaming chat with full tool-call support.
   *
   * Streams text and thinking deltas via callbacks while accumulating
   * tool_call deltas from the SSE stream. Returns the complete result
   * including any tool calls the model wants to make.
   *
   * @param messages - The conversation messages.
   * @param options - Additional chat options.
   * @param onTextDelta - Optional callback for streamed text content.
   * @param onThinkingDelta - Optional callback for streamed reasoning content.
   * @returns The accumulated stream result with content and tool calls.
   */
  async function streamChatWithTools(
    messages: unknown[],
    options: ChatOptions = {},
    onTextDelta?: (delta: string) => void,
    onThinkingDelta?: (delta: string) => void,
  ): Promise<StreamChatResult> {
    const body = buildRequestBody(model, messages, options, maxTokens, true);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new LlmRequestError(response.status, text);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new StreamError();
    }

    let accumulatedContent = '';
    let finishReason = 'stop';
    const toolAccum = new Map<number, { id: string; name: string; arguments: string }>();

    await readSSEStream(reader, {
      onTextDelta: (delta) => {
        accumulatedContent += delta;
        onTextDelta?.(delta);
      },
      onThinkingDelta: (delta) => {
        onThinkingDelta?.(delta);
      },
      onToolCallDelta: (tc) => {
        const idx = tc.index;
        if (!toolAccum.has(idx)) {
          toolAccum.set(idx, { id: '', name: '', arguments: '' });
        }
        const acc = toolAccum.get(idx)!;
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        if (tc.function?.arguments != null) acc.arguments += tc.function.arguments;
      },
      onFinishReason: (reason) => {
        finishReason = reason;
      },
      onMessage: (choice: LlmResponseChoice) => {
        if (choice.message?.content != null) {
          accumulatedContent += choice.message.content;
          onTextDelta?.(choice.message.content);
        }
        if (choice.message?.reasoning_content != null) {
          onThinkingDelta?.(choice.message.reasoning_content);
        }
        if (choice.message?.tool_calls) {
          for (let i = 0; i < choice.message.tool_calls.length; i++) {
            const tc = choice.message.tool_calls[i];
            toolAccum.set(i, {
              id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            });
          }
        }
      },
    });

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

/** The inferred type of a client instance created by `createLocalLlmClient`. */
export type LocalLlmClient = ReturnType<typeof createLocalLlmClient>;
