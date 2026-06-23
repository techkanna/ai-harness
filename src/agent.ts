import type { LocalLlmClient } from './client.js';
import type { Tool, ApiToolDefinition, ConversationMessage } from './types.js';

// Re-export Tool so consumers can import from either place
export type { Tool } from './types.js';

// ─── Logger ──────────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

class Logger {
  private level: number;
  private prefix: string;

  constructor(level: LogLevel = 'info', prefix = '[AgentHarness]') {
    this.level = LOG_LEVEL_PRIORITY[level];
    this.prefix = prefix;
  }

  debug(...args: unknown[]): void {
    if (this.level <= LOG_LEVEL_PRIORITY.debug) {
      console.debug(this.prefix, ...args);
    }
  }

  info(...args: unknown[]): void {
    if (this.level <= LOG_LEVEL_PRIORITY.info) {
      console.info(this.prefix, ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (this.level <= LOG_LEVEL_PRIORITY.warn) {
      console.warn(this.prefix, ...args);
    }
  }

  error(...args: unknown[]): void {
    if (this.level <= LOG_LEVEL_PRIORITY.error) {
      console.error(this.prefix, ...args);
    }
  }
}

// ─── Public interfaces ──────────────────────────────────────────────────────

export interface AgentHarnessOptions {
  client: LocalLlmClient;
  tools?: Tool[];
  systemPrompt?: string;
  /** Maximum number of LLM round-trips before the agent forcibly stops. Default: 25 */
  maxIterations?: number;
  /** Maximum number of conversation messages (excluding system) before truncation kicks in. Default: 50 */
  maxContextMessages?: number;
  /** Logging verbosity. Default: 'info' */
  logLevel?: LogLevel;
}

/** One step in the agent's execution trace. */
export interface AgentStep {
  iteration: number;
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult: string;
  llmResponse: string | null;
}

export interface AgentResult {
  type: 'reply' | 'max_iterations' | 'aborted' | 'error';
  text: string;
  /** Full trace of every tool-call iteration. Empty if the LLM answered directly. */
  steps: AgentStep[];
  /** How many LLM round-trips were made. */
  iterationCount: number;
}

export interface RunOptions {
  /** An AbortSignal to cancel the agent loop externally. */
  signal?: AbortSignal;
}

// ─── AgentHarness ───────────────────────────────────────────────────────────

export class AgentHarness {
  private client: LocalLlmClient;
  private tools: Tool[];
  private memory: string[];
  private maxIterations: number;
  private maxContextMessages: number;
  private log: Logger;

  /** The API-ready tool definitions, built once from the Tool[] array. */
  private apiToolDefs: ApiToolDefinition[];

  public systemPrompt: string;

  constructor({
    client,
    tools = [],
    systemPrompt = 'You are a helpful assistant agent.',
    maxIterations = 25,
    maxContextMessages = 50,
    logLevel = 'info',
  }: AgentHarnessOptions) {
    this.client = client;
    this.tools = tools;
    this.memory = [];
    this.systemPrompt = systemPrompt;
    this.maxIterations = maxIterations;
    this.maxContextMessages = maxContextMessages;
    this.log = new Logger(logLevel);

    // Convert tools to API format once at construction time.
    this.apiToolDefs = this.buildApiToolDefs();
  }

  addMemory(note: string): void {
    this.memory.push(note);
  }

  addTool(tool: Tool): void {
    this.tools.push(tool);
    // Rebuild API definitions when tools change.
    this.apiToolDefs = this.buildApiToolDefs();
  }

  // ── Core agentic loop ───────────────────────────────────────────────────

  async run(userInput: string, options: RunOptions = {}): Promise<AgentResult> {
    const { signal } = options;
    const steps: AgentStep[] = [];

    // Build the initial conversation.
    // System messages are always kept outside the truncation window.
    const systemMessages: ConversationMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...this.memory.map((item) => ({ role: 'system', content: item })),
    ];

    // Conversation messages: these grow and can be truncated.
    // The user message is JUST the user's question — no tool boilerplate.
    const conversation: ConversationMessage[] = [
      { role: 'user', content: userInput },
    ];

    this.log.info(`Starting agent loop. maxIterations=${this.maxIterations}, tools=${this.tools.length}`);

    for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
      // ── Check for external abort ──────────────────────────────────────
      if (signal?.aborted) {
        this.log.warn(`Aborted at iteration ${iteration}.`);
        return {
          type: 'aborted',
          text: 'Agent loop was aborted by the caller.',
          steps,
          iterationCount: iteration - 1,
        };
      }

      // ── Truncate conversation if needed ───────────────────────────────
      this.truncateConversation(conversation);

      // ── Call the LLM ──────────────────────────────────────────────────
      const messages = [...systemMessages, ...conversation];
      this.log.info(`Iteration ${iteration}: sending ${messages.length} messages to LLM.`);
      this.log.debug('Messages:', JSON.stringify(messages, null, 2));

      let response;
      try {
        response = await this.client.chat(messages, {
          tools: this.apiToolDefs.length > 0 ? this.apiToolDefs : undefined,
        });
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
      this.log.debug(`LLM full response (iteration ${iteration}):`, response);

      const choice = response?.choices?.[0];
      const assistantMessage = choice?.message;
      const assistantText = assistantMessage?.content ?? null;
      const toolCalls = assistantMessage?.tool_calls;

      this.log.debug(`LLM response (iteration ${iteration}):`, assistantText);

      // ── No tool calls → make a final summary call ──────────────────────
      if (!toolCalls || toolCalls.length === 0) {
        this.log.info(`Iteration ${iteration}: LLM returned no tool calls. Making final summary call.`);
        conversation.push({ role: 'assistant', content: assistantText });

        const finalText = await this.getWrapUpResponse(
          systemMessages,
          conversation,
          'All tool calls are complete. Please provide a clear, concise summary of what you did and the results. Do NOT call any more tools.',
          assistantText ?? '',
        );

        return {
          type: 'reply',
          text: finalText,
          steps,
          iterationCount: iteration,
        };
      }

      // ── Execute each tool call ────────────────────────────────────────
      this.log.info(
        `Iteration ${iteration}: ${toolCalls.length} tool call(s) detected: [${toolCalls.map((t) => t.function.name).join(', ')}]`
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

    // ── Max iterations reached ────────────────────────────────────────────
    this.log.warn(`Max iterations (${this.maxIterations}) reached. Stopping agent loop.`);

    const finalText = await this.getWrapUpResponse(
      systemMessages,
      conversation,
      'You have reached the maximum number of iterations. Please provide your best final answer now based on the work you have done so far. Do NOT call any more tools.',
      `Agent stopped: reached maximum of ${this.maxIterations} iterations without a final answer.`,
    );

    return {
      type: 'max_iterations',
      text: finalText,
      steps,
      iterationCount: this.maxIterations,
    };
  }

  // ── Streaming run ─────────────────────────────────────────────────────

  /**
   * Stream a single-turn response from the LLM.
   *
   * NOTE: Streaming with tool-call support requires parsing chunked
   * tool_calls deltas, which is significantly more complex. For now this
   * method supports simple non-tool streaming. For tool-calling workflows,
   * use the `run()` method instead.
   */
  async streamRun(
    userInput: string,
    onDelta: (delta: string) => void,
    options: Record<string, unknown> = {}
  ): Promise<AgentResult> {
    const messages: ConversationMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...this.memory.map((item) => ({ role: 'system', content: item })),
      { role: 'user', content: userInput },
    ];

    let accumulated = '';
    await this.client.streamChat(messages, options, (delta) => {
      accumulated += delta;
      onDelta(delta);
    });

    return { type: 'reply', text: accumulated, steps: [], iterationCount: 1 };
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /**
   * Make one final LLM call without tools to get a plain-text summary.
   * Used by both the normal-completion and max-iterations exit paths.
   *
   * @param systemMessages  The system-level messages (system prompt + memory).
   * @param conversation    The full conversation history (will be truncated for the call).
   * @param wrapUpPrompt    The user-role prompt appended to ask for a summary.
   * @param fallbackText    Returned if the LLM call fails.
   */
  private async getWrapUpResponse(
    systemMessages: ConversationMessage[],
    conversation: ConversationMessage[],
    wrapUpPrompt: string,
    fallbackText: string,
  ): Promise<string> {
    const wrapUpMessages: ConversationMessage[] = [
      ...systemMessages,
      ...this.truncateForFinalCall(conversation),
      { role: 'user', content: wrapUpPrompt },
    ];

    try {
      // No tools on the final call — force a plain text response.
      const finalResponse = await this.client.chat(wrapUpMessages);
      const extracted = finalResponse?.choices?.[0]?.message?.content;
      if (extracted) return extracted;
    } catch {
      this.log.error('Failed to get wrap-up response from LLM.');
    }

    return fallbackText;
  }

  /**
   * Convert the Tool[] array into the OpenAI-compatible API format.
   * This is called once at construction and whenever tools are added.
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
   * Sliding-window truncation of the conversation array (mutates in place).
   * Keeps the first message (original user query) and the most recent messages.
   * Inserts a truncation notice so the LLM knows history was dropped.
   */
  private truncateConversation(conversation: ConversationMessage[]): void {
    if (conversation.length <= this.maxContextMessages) return;

    const firstMessage = conversation[0]; // original user query
    const tailSize = this.maxContextMessages - 2; // -1 for first msg, -1 for truncation notice
    const tail = conversation.slice(-tailSize);
    const droppedCount = conversation.length - 1 - tailSize;

    this.log.info(`Truncating conversation: dropping ${droppedCount} messages from middle. Keeping first + last ${tailSize}.`);

    // Mutate in place: clear and rebuild.
    conversation.length = 0;
    conversation.push(firstMessage);
    conversation.push({
      role: 'system',
      content: `[Context truncated: ${droppedCount} earlier messages were removed to fit the context window. The original user request and the most recent messages are preserved.]`,
    });
    conversation.push(...tail);
  }

  /**
   * Build a truncated copy of the conversation for the final wrap-up call.
   * We don't want to send an enormous history for the summary.
   */
  private truncateForFinalCall(
    conversation: ConversationMessage[]
  ): ConversationMessage[] {
    const maxForFinal = Math.min(this.maxContextMessages, 30);
    if (conversation.length <= maxForFinal) return [...conversation];

    const firstMessage = conversation[0];
    const tail = conversation.slice(-(maxForFinal - 2));
    return [
      firstMessage,
      {
        role: 'system',
        content: `[Context truncated for final summary: ${conversation.length - 1 - tail.length} earlier messages were removed.]`,
      },
      ...tail,
    ];
  }
}
