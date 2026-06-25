import type { ConversationMessage } from '../types/llm.js';

// ─── System Prompts ─────────────────────────────────────────────────────────

/** Default system prompt for the coding assistant agent. */
export const SYSTEM_PROMPT = `
You are an expert coding assistant. You help users with coding tasks by reading files, executing commands, editing code, and writing new files.

Follow these guidelines:
- Use bash for file discovery like ls, grep, find, cat.
- Use read to examine file contents before editing.
- Use edit for precise, surgical changes to existing files.
- Use write only for creating new files or complete rewrites.
- Be concise in your responses.
`;

// ─── Summarization Prompts ──────────────────────────────────────────────────

/** System prompt for the conversation summarizer. */
export const SUMMARIZATION_SYSTEM_PROMPT =
  'You are a precise conversation summarizer. Your job is to produce a concise but thorough summary of a conversation segment from an AI agent loop. Preserve ALL important details.';

/**
 * Builds the user-role prompt for summarizing a batch of dropped conversation messages.
 *
 * @param messageCount - The number of messages being summarized.
 * @param serializedMessages - Pre-formatted string of the messages to summarize.
 * @returns The complete user prompt for the summarization call.
 */
export function buildSummarizationUserPrompt(
  messageCount: number,
  serializedMessages: string,
): string {
  return `Summarize the following conversation segment. Capture:
1. **Key decisions and reasoning** — why the agent chose certain actions.
2. **Tool calls and results** — which tools were called, with what arguments, and what they returned (condense large outputs but keep critical data).
3. **Important facts and data** — any values, names, paths, URLs, or numbers discovered.
4. **Current task state** — what has been accomplished and what remains.

Be concise but DO NOT omit any fact that could be needed to continue the task correctly.

---
CONVERSATION SEGMENT (${messageCount} messages):

${serializedMessages}
---

Provide the summary now:`;
}

/**
 * Serializes an array of conversation messages into a human-readable format
 * suitable for the summarization prompt.
 *
 * @param messages - The conversation messages to serialize.
 * @returns A formatted string representation of the messages.
 */
export function serializeMessagesForSummary(messages: ConversationMessage[]): string {
  return messages
    .map((msg) => {
      const role = msg.role.toUpperCase();
      if (msg.tool_calls) {
        const calls = msg.tool_calls
          .map((tc) => `  → ${tc.function.name}(${tc.function.arguments})`)
          .join('\n');
        return `[${role}]: ${msg.content ?? '(no text)'}\nTool calls:\n${calls}`;
      }
      if (msg.tool_call_id) {
        return `[TOOL RESULT (${msg.tool_call_id})]: ${msg.content}`;
      }
      return `[${role}]: ${msg.content}`;
    })
    .join('\n\n');
}
