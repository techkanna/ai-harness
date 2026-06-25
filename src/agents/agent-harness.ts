import type { LocalLlmClient } from '../llm/client.js';
import type {
  Tool,
  ApiToolDefinition,
  ConversationMessage,
  AgentHarnessOptions,
  AgentStep,
  AgentResult,
  RunOptions,
} from '../types/index.js';
import { createLogger } from '../utils/logger.js';
import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_CONTEXT_MESSAGES,
  DEFAULT_SUMMARY_MAX_TOKENS,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_LOG_LEVEL,
  MAX_FINAL_CALL_MESSAGES,
} from '../config/constants.js';
import {
  SUMMARIZATION_SYSTEM_PROMPT,
  buildSummarizationUserPrompt,
  serializeMessagesForSummary,
} from '../prompts/system.js';

// Re-export types so consumers can import from either place
export type { Tool, AgentEvent } from '../types/index.js';

// ─── AgentHarness ───────────────────────────────────────────────────────────

/**
 * The core agent harness that orchestrates LLM interactions and tool execution.
 *
 * Implements an agentic loop: sends messages to the LLM, detects tool calls,
 * executes them, feeds results back, and repeats until the LLM responds
 * without tool calls or the iteration limit is reached.
 *
 * Supports conversation context management with LLM-based summarization
 * to handle long-running conversations within token limits.
 */
export class AgentHarness {
  private client: LocalLlmClient;
  private tools: Tool[];
  private memory: string[];
  private maxIterations: number;
  private maxContextMessages: number;
  private summaryMaxTokens: number;
  private log: ReturnType<typeof createLogger>;

  /** The API-ready tool definitions, built once from the Tool[] array. */
  private apiToolDefs: ApiToolDefinition[];

  public systemPrompt: string;

  constructor({
    client,
    tools = [],
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    maxContextMessages = DEFAULT_MAX_CONTEXT_MESSAGES,
    summaryMaxTokens = DEFAULT_SUMMARY_MAX_TOKENS,
    logLevel = DEFAULT_LOG_LEVEL,
  }: AgentHarnessOptions) {
    this.client = client;
    this.tools = tools;
    this.memory = [];
    this.systemPrompt = systemPrompt;
    this.maxIterations = maxIterations;
    this.maxContextMessages = maxContextMessages;
    this.summaryMaxTokens = summaryMaxTokens;
    this.log = createLogger(logLevel);

    // Convert tools to API format once at construction time.
    this.apiToolDefs = this.buildApiToolDefs();
  }

  /** Adds a persistent memory note to the agent's system context. */
  addMemory(note: string): void {
    this.memory.push(note);
  }

  /** Registers a new tool and rebuilds the API definitions. */
  addTool(tool: Tool): void {
    this.tools.push(tool);
    // Rebuild API definitions when tools change.
    this.apiToolDefs = this.buildApiToolDefs();
  }

  // ── Core agentic loop ─────────────────────────────────────────────────────

  /**
   * Runs the agent loop for a given user input.
   *
   * The loop sends messages to the LLM, detects tool calls, executes them,
   * and feeds results back until the LLM responds without tool calls or
   * the maximum iteration limit is reached.
   *
   * @param userInput - The user's prompt to process.
   * @param options - Optional abort signal and event callback.
   * @returns The complete agent result including text, steps, and iteration count.
   */
  async run(userInput: string, options: RunOptions = {}): Promise<AgentResult> {
    const { signal, onEvent } = options;
    const emit = onEvent ?? (() => {});
    const steps: AgentStep[] = [];

    // Build the initial conversation.
    // System messages are always kept outside the truncation window.
    const systemMessages: ConversationMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...this.memory.map((item) => ({ role: 'system' as const, content: item })),
    ];

    // Conversation messages: these grow and can be truncated.
    const conversation: ConversationMessage[] = [
      { role: 'user', content: userInput },
    ];

    this.log.info(`Starting agent loop. maxIterations=${this.maxIterations}, tools=${this.tools.length}`);

    for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
      // ── Check for external abort ──
      if (signal?.aborted) {
        this.log.warn(`Aborted at iteration ${iteration}.`);
        return {
          type: 'aborted',
          text: 'Agent loop was aborted by the caller.',
          steps,
          iterationCount: iteration - 1,
        };
      }

      // ── Truncate conversation if needed ──
      await this.truncateConversation(conversation);

      // ── Call the LLM (streaming) ──
      const messages = [...systemMessages, ...conversation];
      this.log.info(`Iteration ${iteration}: sending ${messages.length} messages to LLM.`);
      this.log.debug('Messages:', JSON.stringify(messages, null, 2));

      emit({ type: 'llm_start', iteration });

      let streamResult;
      try {
        streamResult = await this.client.streamChatWithTools(
          messages,
          {
            tools: this.apiToolDefs.length > 0 ? this.apiToolDefs : undefined,
          },
          (delta) => emit({ type: 'text_delta', delta }),
          (delta) => emit({ type: 'thinking_delta', delta }),
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.log.error(`LLM request failed at iteration ${iteration}: ${errMsg}`);
        return {
          type: 'error',
          text: `LLM request failed: ${errMsg}`,
          steps,
          iterationCount: iteration,
        };
      }

      const assistantText = streamResult.content || null;
      const toolCalls = streamResult.toolCalls.length > 0 ? streamResult.toolCalls : undefined;

      this.log.debug(`LLM response (iteration ${iteration}):`, assistantText);

      // ── No tool calls → return the reply ──
      if (!toolCalls || toolCalls.length === 0) {
        this.log.info(`Iteration ${iteration}: LLM returned no tool calls.`);
        conversation.push({ role: 'assistant', content: assistantText });

        // If tools were used in earlier iterations, make a final summary call.
        if (steps.length > 0) {
          const finalText = await this.getWrapUpResponse(
            systemMessages,
            conversation,
            'All tool calls are complete. Please provide a clear, concise summary of what you did and the results. Do NOT call any more tools.',
            assistantText ?? '',
            (delta) => emit({ type: 'text_delta', delta }),
          );

          emit({ type: 'complete' });
          return {
            type: 'reply',
            text: finalText,
            steps,
            iterationCount: iteration,
          };
        }

        emit({ type: 'complete' });
        return {
          type: 'reply',
          text: assistantText ?? '',
          steps,
          iterationCount: iteration,
        };
      }

      // ── Execute each tool call ──
      this.log.info(
        `Iteration ${iteration}: ${toolCalls.length} tool call(s) detected: [${toolCalls.map((t) => t.function.name).join(', ')}]`,
      );

      // Append the full assistant message (including tool_calls) to conversation.
      conversation.push({
        role: 'assistant',
        content: assistantText,
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name;
        const toolCallId = toolCall.id;
        const tool = this.tools.find((t) => t.name === toolName);

        // Parse arguments from JSON string
        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          parsedArgs = {};
          this.log.warn(`Iteration ${iteration}: Failed to parse arguments for "${toolName}": ${toolCall.function.arguments}`);
        }

        if (!tool) {
          // Unknown tool — tell the LLM so it can correct itself.
          const errText = `[ERROR] Tool not found: "${toolName}". Available tools: ${this.tools.map((t) => t.name).join(', ')}`;
          this.log.warn(`Iteration ${iteration}: ${errText}`);
          emit({ type: 'tool_call_start', iteration, name: toolName, args: parsedArgs });
          emit({ type: 'tool_call_end', iteration, name: toolName, result: errText });
          conversation.push({ role: 'tool', tool_call_id: toolCallId, content: errText });

          steps.push({
            iteration,
            toolCallId,
            toolName,
            toolArgs: parsedArgs,
            toolResult: errText,
            llmResponse: assistantText,
          });
          continue;
        }

        emit({ type: 'tool_call_start', iteration, name: tool.name, args: parsedArgs });

        // Execute the tool with error handling.
        let toolResult: string;
        try {
          this.log.info(`Iteration ${iteration}: executing tool "${tool.name}".`);
          this.log.debug(`Tool args:`, parsedArgs);
          toolResult = await tool.func(parsedArgs);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          toolResult = `[ERROR] Tool "${tool.name}" failed: ${errMsg}`;
          this.log.warn(`Iteration ${iteration}: ${toolResult}`);
        }

        emit({ type: 'tool_call_end', iteration, name: tool.name, result: toolResult });

        this.log.debug(`Tool result (${tool.name}):`, toolResult);

        // Feed the tool result back with the matching tool_call_id.
        conversation.push({ role: 'tool', tool_call_id: toolCallId, content: toolResult });

        steps.push({
          iteration,
          toolCallId,
          toolName: tool.name,
          toolArgs: parsedArgs,
          toolResult,
          llmResponse: assistantText,
        });
      }
      // Loop continues — the LLM will see the tool results and decide what to do next.
    }

    // ── Max iterations reached ──
    this.log.warn(`Max iterations (${this.maxIterations}) reached. Stopping agent loop.`);

    const finalText = await this.getWrapUpResponse(
      systemMessages,
      conversation,
      'You have reached the maximum number of iterations. Please provide your best final answer now based on the work you have done so far. Do NOT call any more tools.',
      `Agent stopped: reached maximum of ${this.maxIterations} iterations without a final answer.`,
      (delta) => emit({ type: 'text_delta', delta }),
    );

    emit({ type: 'complete' });
    return {
      type: 'max_iterations',
      text: finalText,
      steps,
      iterationCount: this.maxIterations,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Makes one final LLM call without tools to get a plain-text summary.
   * Used by both the normal-completion and max-iterations exit paths.
   * Streams output via the optional onTextDelta callback.
   *
   * @param systemMessages - The system-level messages (system prompt + memory).
   * @param conversation - The full conversation history (will be truncated for the call).
   * @param wrapUpPrompt - The user-role prompt appended to ask for a summary.
   * @param fallbackText - Returned if the LLM call fails.
   * @param onTextDelta - Optional callback for streaming the summary text.
   */
  private async getWrapUpResponse(
    systemMessages: ConversationMessage[],
    conversation: ConversationMessage[],
    wrapUpPrompt: string,
    fallbackText: string,
    onTextDelta?: (delta: string) => void,
  ): Promise<string> {
    const truncatedConversation = await this.truncateForFinalCall(conversation);
    const wrapUpMessages: ConversationMessage[] = [
      ...systemMessages,
      ...truncatedConversation,
      { role: 'user', content: wrapUpPrompt },
    ];

    try {
      // No tools on the final call — force a plain text response, streamed.
      const result = await this.client.streamChatWithTools(
        wrapUpMessages,
        {},
        onTextDelta,
      );
      if (result.content) return result.content;
    } catch {
      this.log.error('Failed to get wrap-up response from LLM.');
    }

    return fallbackText;
  }

  /**
   * Converts the Tool[] array into the OpenAI-compatible API format.
   * Called once at construction and whenever tools are added.
   */
  private buildApiToolDefs(): ApiToolDefinition[] {
    return this.tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Summarizes a segment of dropped conversation messages using the LLM.
   * Returns a structured summary string, or a simple fallback notice on failure.
   */
  private async summarizeDroppedMessages(
    droppedMessages: ConversationMessage[],
  ): Promise<string> {
    const serialized = serializeMessagesForSummary(droppedMessages);

    const summarizationPrompt: ConversationMessage[] = [
      {
        role: 'system',
        content: SUMMARIZATION_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: buildSummarizationUserPrompt(droppedMessages.length, serialized),
      },
    ];

    try {
      this.log.info(`Summarizing ${droppedMessages.length} dropped messages via LLM...`);
      const result = await this.client.streamChatWithTools(
        summarizationPrompt,
        { max_tokens: this.summaryMaxTokens },
      );
      if (result.content && result.content.trim().length > 0) {
        this.log.info(`Summary generated (${result.content.length} chars).`);
        return result.content.trim();
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log.warn(`Summarization LLM call failed: ${errMsg}. Falling back to naive truncation.`);
    }

    // Fallback: return a simple notice if summarization fails.
    return `[Summarization unavailable. ${droppedMessages.length} earlier messages were removed to fit the context window.]`;
  }

  /**
   * Sliding-window truncation of the conversation array (mutates in place).
   * Keeps the first message (original user query) and the most recent messages.
   * Uses the LLM to summarize the dropped middle segment so context is preserved.
   * Falls back to a simple truncation notice if summarization fails.
   */
  private async truncateConversation(conversation: ConversationMessage[]): Promise<void> {
    if (conversation.length <= this.maxContextMessages) return;

    const firstMessage = conversation[0]; // original user query
    const tailSize = this.maxContextMessages - 2; // -1 for first msg, -1 for summary message
    const tail = conversation.slice(-tailSize);
    const droppedMessages = conversation.slice(1, conversation.length - tailSize);

    this.log.info(`Truncating conversation: summarizing ${droppedMessages.length} messages from middle. Keeping first + last ${tailSize}.`);

    const summary = await this.summarizeDroppedMessages(droppedMessages);

    // Mutate in place: clear and rebuild.
    conversation.length = 0;
    conversation.push(firstMessage);
    conversation.push({
      role: 'system',
      content: `[Context Summary: The following is an LLM-generated summary of ${droppedMessages.length} earlier messages that were condensed to fit the context window.]\n\n${summary}`,
    });
    conversation.push(...tail);
  }

  /**
   * Builds a truncated copy of the conversation for the final wrap-up call.
   * Uses the LLM to summarize dropped messages so the final summary is comprehensive.
   */
  private async truncateForFinalCall(
    conversation: ConversationMessage[],
  ): Promise<ConversationMessage[]> {
    const maxForFinal = Math.min(this.maxContextMessages, MAX_FINAL_CALL_MESSAGES);
    if (conversation.length <= maxForFinal) return [...conversation];

    const firstMessage = conversation[0];
    const tailSize = maxForFinal - 2;
    const tail = conversation.slice(-tailSize);
    const droppedMessages = conversation.slice(1, conversation.length - tailSize);

    this.log.info(`Truncating for final call: summarizing ${droppedMessages.length} messages.`);

    const summary = await this.summarizeDroppedMessages(droppedMessages);

    return [
      firstMessage,
      {
        role: 'system',
        content: `[Context Summary for Final Response: The following is an LLM-generated summary of ${droppedMessages.length} earlier messages.]\n\n${summary}`,
      },
      ...tail,
    ];
  }
}
