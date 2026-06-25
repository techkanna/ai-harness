import { createInterface, type Interface } from 'readline';
import { createLocalLlmClient } from '../llm/client.js';
import { AgentHarness } from '../agents/agent-harness.js';
import { tools } from '../tools/index.js';
import { SYSTEM_PROMPT } from '../prompts/system.js';
import { APP_VERSION, DEFAULT_MAX_ITERATIONS, DEFAULT_MAX_CONTEXT_MESSAGES } from '../config/constants.js';
import type { CliArgs } from './args.js';
import { ansi, createEventHandler } from './renderer.js';

// ─── Agent Factory ───────────────────────────────────────────────────────────

/**
 * Creates an AgentHarness instance configured from CLI arguments.
 *
 * @param args - Parsed CLI arguments.
 * @returns A configured AgentHarness ready to process user input.
 */
export function createAgent(args: CliArgs): AgentHarness {
  const client = createLocalLlmClient({
    ...(args.model && { model: args.model }),
    ...(args.url && { baseUrl: args.url }),
    ...(args.maxTokens && { maxTokens: args.maxTokens }),
  });

  return new AgentHarness({
    client,
    tools,
    systemPrompt: args.system ?? SYSTEM_PROMPT,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    maxContextMessages: DEFAULT_MAX_CONTEXT_MESSAGES,
    logLevel: args.verbose ? 'debug' : 'silent',
  });
}

// ─── One-shot Mode ──────────────────────────────────────────────────────────

/**
 * Runs the agent once with a single prompt, then exits.
 *
 * @param agent - The configured AgentHarness instance.
 * @param prompt - The user's prompt.
 */
export async function runOnce(agent: AgentHarness, prompt: string): Promise<void> {
  const onEvent = createEventHandler();
  const result = await agent.run(prompt, { onEvent });

  if (result.type === 'error') {
    process.exit(1);
  }
}

// ─── REPL Mode ──────────────────────────────────────────────────────────────

const REPL_HELP = `
${ansi.yellow}REPL Commands:${ansi.reset}
  ${ansi.cyan}/help${ansi.reset}    Show this help
  ${ansi.cyan}/clear${ansi.reset}   Clear conversation & start fresh
  ${ansi.cyan}/exit${ansi.reset}    Exit the REPL
`;

/**
 * Starts the interactive REPL mode.
 * Reads user input line-by-line, processes agent commands,
 * and runs the agent for each input.
 *
 * @param args - Parsed CLI arguments.
 */
export async function runRepl(args: CliArgs): Promise<void> {
  console.log(`${ansi.bold}${ansi.cyan}sk${ansi.reset} ${ansi.dim}v${APP_VERSION}${ansi.reset} ${ansi.dim}\u2014 type /help for commands, /exit to quit${ansi.reset}`);
  console.log();

  let agent = createAgent(args);

  const rl: Interface = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${ansi.green}sk>${ansi.reset} `,
  });

  rl.prompt();

  rl.on('line', async (line: string) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // REPL commands
    if (input === '/exit' || input === '/quit' || input === '/bye') {
      console.log(`${ansi.dim}bye.${ansi.reset}`);
      rl.close();
      process.exit(0);
    }
    if (input === '/help') {
      console.log(REPL_HELP);
      rl.prompt();
      return;
    }
    if (input === '/clear') {
      agent = createAgent(args);
      console.log(`${ansi.dim}Conversation cleared.${ansi.reset}`);
      rl.prompt();
      return;
    }

    // Run the agent with streaming events
    try {
      console.log();
      const onEvent = createEventHandler();
      await agent.run(input, { onEvent });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${ansi.red}Error: ${msg}${ansi.reset}`);
    }

    console.log();
    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}
