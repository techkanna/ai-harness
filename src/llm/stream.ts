import type { LlmResponse, LlmResponseChoice } from '../types/llm.js';

// ─── SSE Stream Callback Types ──────────────────────────────────────────────

/** Callbacks invoked during SSE stream processing. */
export interface StreamCallbacks {
  /** Called for each content text delta. */
  onTextDelta?: (delta: string) => void;
  /** Called for each reasoning/thinking text delta. */
  onThinkingDelta?: (delta: string) => void;
  /** Called for each tool call delta. */
  onToolCallDelta?: (delta: {
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }) => void;
  /** Called when a finish reason is received. */
  onFinishReason?: (reason: string) => void;
  /** Called with the full non-streaming message, if present. */
  onMessage?: (choice: LlmResponseChoice) => void;
}

// ─── SSE Parser ─────────────────────────────────────────────────────────────

/**
 * Parses a chunk of SSE data and dispatches events via callbacks.
 *
 * Handles both streaming deltas (`delta` field) and non-streaming fallbacks
 * (`message` field) in the response. Returns `true` if the `[DONE]` sentinel
 * was encountered.
 *
 * @param part - Raw SSE data string (may contain multiple events separated by double newlines).
 * @param callbacks - Callbacks to invoke for each event type.
 * @returns `true` if the stream is complete (`[DONE]` received), `false` otherwise.
 */
export function parseSSEChunk(part: string, callbacks: StreamCallbacks): boolean {
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

        // Finish reason
        if (choice.finish_reason) {
          callbacks.onFinishReason?.(choice.finish_reason);
        }

        // ── Streaming deltas ──
        const contentDelta = choice.delta?.content;
        if (contentDelta != null) {
          callbacks.onTextDelta?.(contentDelta);
        }

        const reasoningDelta = choice.delta?.reasoning_content;
        if (reasoningDelta != null) {
          callbacks.onThinkingDelta?.(reasoningDelta);
        }

        const tcDeltas = choice.delta?.tool_calls;
        if (tcDeltas) {
          for (const tc of tcDeltas) {
            callbacks.onToolCallDelta?.(tc);
          }
        }

        // ── Non-streaming fallbacks (message field) ──
        if (choice.message) {
          callbacks.onMessage?.(choice);
        }
      } catch {
        // Ignore parse failures for partial SSE fragments.
      }
    }
  }

  return false;
}

/**
 * Reads a streaming response body and processes each SSE chunk.
 *
 * Buffers partial data until a complete event boundary (double newline)
 * is found, then passes each complete chunk to `parseSSEChunk`.
 *
 * @param reader - A ReadableStream reader from the fetch response body.
 * @param callbacks - Callbacks to invoke for each event type.
 */
export async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: StreamCallbacks,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const boundary = buffer.lastIndexOf('\n\n');
    if (boundary === -1) continue;

    const chunk = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);

    if (parseSSEChunk(chunk, callbacks)) return;
  }

  // Process any remaining data in the buffer.
  if (buffer.trim()) {
    parseSSEChunk(buffer, callbacks);
  }
}
