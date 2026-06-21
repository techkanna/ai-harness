import type { LocalLlmClient } from './client.js';

export interface Tool {
  name: string;
  description: string;
  func: (args: string) => Promise<string>;
}

function buildToolInstructions(tools: Tool[]): string {
  const lines = tools.map((tool) => `- ${tool.name}: ${tool.description}`);
  return `You can use the following tools:\n${lines.join('\n')}`;
}

interface ParsedToolCall {
  name: string;
  args: string;
}

function parseToolCall(text: string): ParsedToolCall | null {
  const toolRegex = /\[TOOL:(?<name>[A-Za-z0-9_-]+)\]([\s\S]*?)\[\/TOOL:\k<name>\]/;
  const match = text.match(toolRegex);
  if (!match) return null;
  return {
    name: match.groups?.name ?? '',
    args: match[2].trim()
  };
}

export interface AgentHarnessOptions {
  client: LocalLlmClient;
  tools?: Tool[];
  systemPrompt?: string;
}

export interface AgentResult {
  type: 'reply' | 'tool_response' | 'error';
  text: string;
  tool?: string;
  toolArgs?: string;
  toolResult?: string;
}

export class AgentHarness {
  private client: LocalLlmClient;
  private tools: Tool[];
  private memory: string[];
  public systemPrompt: string;

  constructor({ client, tools = [], systemPrompt = 'You are a helpful assistant agent.' }: AgentHarnessOptions) {
    this.client = client;
    this.tools = tools;
    this.memory = [];
    this.systemPrompt = systemPrompt;
  }

  addMemory(note: string): void {
    this.memory.push(note);
  }

  addTool(tool: Tool): void {
    this.tools.push(tool);
  }

  async run(userInput: string): Promise<AgentResult> {
    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...this.memory.map((item) => ({ role: 'system', content: item })),
      { role: 'user', content: this.buildPrompt(userInput) }
    ];

    const response = await this.client.chat(messages);
    const text = this.extractText(response);

    const toolCall = parseToolCall(text);
    if (!toolCall) {
      return { type: 'reply', text };
    }

    const tool = this.tools.find((item) => item.name === toolCall.name);
    if (!tool) {
      return { type: 'error', text: `Tool not found: ${toolCall.name}` };
    }

    const toolResult = await tool.func(toolCall.args);
    const followUp = await this.client.chat([
      ...messages,
      { role: 'assistant', content: text },
      { role: 'tool', name: tool.name, content: toolResult }
    ]);

    return {
      type: 'tool_response',
      tool: tool.name,
      toolArgs: toolCall.args,
      toolResult,
      text: this.extractText(followUp)
    };
  }

  async streamRun(userInput: string, onDelta: (delta: string) => void, options: Record<string, unknown> = {}): Promise<AgentResult> {
    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...this.memory.map((item) => ({ role: 'system', content: item })),
      { role: 'user', content: this.buildPrompt(userInput) }
    ];

    let accumulated = '';
    await this.client.streamChat(messages, options, (delta) => {
      accumulated += delta;
      onDelta(delta);
    });

    return { type: 'reply', text: accumulated };
  }

  private buildPrompt(userInput: string): string {
    if (this.tools.length === 0) {
      return userInput;
    }

    const description = buildToolInstructions(this.tools);
    return `${description}\n\nWhen you need a tool, use this format exactly:\n[TOOL:tool_name]\narguments here\n[/TOOL:tool_name]\n\n${userInput}`;
  }

  private extractText(response: { choices?: Array<{ message?: { content?: string }; text?: string }> }): string {
    if (!response?.choices?.length) return JSON.stringify(response, null, 2);
    const choice = response.choices[0];
    return choice.message?.content ?? choice.text ?? JSON.stringify(choice);
  }
}
