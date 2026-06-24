#!/usr/bin/env node

import { createInterface, type Interface } from 'readline';
import { createLocalLlmClient } from './client.js';
import { AgentHarness } from './agent.js';
import { tools } from './tools.js';
import { SYSTEM_PROMPT } from './prompts.js';
import type { AgentEvent } from './types.js';

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  italic: '\x1b[3m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

// ─── Version & Help ──────────────────────────────────────────────────────────

const VERSION = '0.1.0';

const HELP = `
${c.bold}sk${c.reset} ${c.dim}— minimalistic AI agent CLI${c.reset}

${c.yellow}Usage:${c.reset}
  sk ${c.dim}"prompt"${c.reset}            One-shot: run prompt, print answer, exit
  sk                      Interactive REPL mode

${c.yellow}Options:${c.reset}
  --model ${c.dim}<name>${c.reset}          Model name ${c.dim}(env: MODEL_NAME)${c.reset}
  --url ${c.dim}<url>${c.reset}             LLM endpoint URL ${c.dim}(env: MODEL_BASE_URL)${c.reset}
  --max-tokens ${c.dim}<n>${c.reset}        Max response tokens ${c.dim}(env: MODEL_MAX_TOKENS)${c.reset}
  --system ${c.dim}<prompt>${c.reset}       Override system prompt
  -v, --verbose           Verbose logging
  -h, --help              Show this help
  --version               Show version

${c.yellow}REPL Commands:${c.reset}
  /help                   Show REPL commands
  /clear                  Clear conversation history
  /exit                   Exit the REPL
`;

// ─── Arg parsing ─────────────────────────────────────────────────────────────

interface CliArgs {
  model?: string;
  url?: string;
  maxTokens?: number;
  system?: string;
  verbose: boolean;
  help: boolean;
  version: boolean;
  prompt: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    verbose: false,
    help: false,
    version: false,
    prompt: '',
  };

  const positional: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '--version':
        args.version = true;
        break;
      case '-v':
      case '--verbose':
        args.verbose = true;
        break;
      case '--model':
        args.model = argv[++i];
        break;
      case '--url':
        args.url = argv[++i];
        break;
      case '--max-tokens':
        args.maxTokens = Number(argv[++i]);
        break;
      case '--system':
        args.system = argv[++i];
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`${c.red}Unknown option: ${arg}${c.reset}`);
          process.exit(1);
        }
        positional.push(arg);
        break;
    }
    i++;
  }

  args.prompt = positional.join(' ');
  return args;
}

// ─── Agent factory ───────────────────────────────────────────────────────────

function createAgent(args: CliArgs): AgentHarness {
  const client = createLocalLlmClient({
    ...(args.model && { model: args.model }),
    ...(args.url && { baseUrl: args.url }),
    ...(args.maxTokens && { maxTokens: args.maxTokens }),
  });

  return new AgentHarness({
    client,
    tools,
    systemPrompt: args.system ?? SYSTEM_PROMPT,
    maxIterations: 25,
    maxContextMessages: 50,
    logLevel: args.verbose ? 'debug' : 'silent',
  });
}

// ─── Event renderer ──────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function createEventHandler(): (event: AgentEvent) => void {
  let isThinking = false;
  let needsNewline = false;

  return (event: AgentEvent) => {
    switch (event.type) {
      case 'llm_start':
        // No visible output — just an internal signal
        break;

      case 'thinking_delta':
        if (!isThinking) {
          if (needsNewline) {
            process.stdout.write('\n');
            needsNewline = false;
          }
          process.stdout.write(`${c.dim}${c.italic}`);
          isThinking = true;
        }
        process.stdout.write(event.delta);
        needsNewline = !event.delta.endsWith('\n');
        break;

      case 'text_delta':
        if (isThinking) {
          if (needsNewline) process.stdout.write('\n');
          process.stdout.write(`${c.reset}`);
          isThinking = false;
          needsNewline = false;
        }
        process.stdout.write(event.delta);
        needsNewline = event.delta.length > 0 && !event.delta.endsWith('\n');
        break;

      case 'tool_call_start': {
        if (isThinking) {
          if (needsNewline) process.stdout.write('\n');
          process.stdout.write(`${c.reset}`);
          isThinking = false;
        }
        if (needsNewline) {
          process.stdout.write('\n');
          needsNewline = false;
        }
        const argsStr = Object.entries(event.args)
          .map(([k, v]) => {
            const val = typeof v === 'string' ? v : JSON.stringify(v);
            return `${k}: ${truncate(val, 60)}`;
          })
          .join(', ');
        process.stdout.write(`  ${c.yellow}⟡ ${event.name}${c.reset}${c.dim}(${argsStr})${c.reset}\n`);
        break;
      }

      case 'tool_call_end': {
        const preview = event.result.split('\n').slice(0, 3).join(' ').trim();
        process.stdout.write(`  ${c.green}✓ ${event.name}${c.reset}${c.dim} → ${truncate(preview, 120)}${c.reset}\n`);
        break;
      }

      case 'complete':
        if (isThinking) {
          process.stdout.write(`${c.reset}`);
          isThinking = false;
        }
        if (needsNewline) {
          process.stdout.write('\n');
          needsNewline = false;
        }
        break;
    }
  };
}

// ─── One-shot mode ───────────────────────────────────────────────────────────

async function runOnce(agent: AgentHarness, prompt: string): Promise<void> {
  const onEvent = createEventHandler();
  const result = await agent.run(prompt, { onEvent });

  if (result.type === 'error') {
    process.exit(1);
  }
}

// ─── REPL mode ───────────────────────────────────────────────────────────────

const REPL_HELP = `
${c.yellow}REPL Commands:${c.reset}
  ${c.cyan}/help${c.reset}    Show this help
  ${c.cyan}/clear${c.reset}   Clear conversation & start fresh
  ${c.cyan}/exit${c.reset}    Exit the REPL
`;

async function runRepl(args: CliArgs): Promise<void> {
  console.log(`${c.bold}${c.cyan}sk${c.reset} ${c.dim}v${VERSION}${c.reset} ${c.dim}— type /help for commands, /exit to quit${c.reset}`);
  console.log();

  let agent = createAgent(args);

  const rl: Interface = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c.green}sk>${c.reset} `,
  });

  rl.prompt();

  rl.on('line', async (line: string) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // REPL commands
    if (input === '/exit' || input === '/quit') {
      console.log(`${c.dim}bye.${c.reset}`);
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
      console.log(`${c.dim}Conversation cleared.${c.reset}`);
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
      console.error(`${c.red}Error: ${msg}${c.reset}`);
    }

    console.log();
    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (args.version) {
    console.log(VERSION);
    process.exit(0);
  }

  if (args.prompt) {
    // One-shot mode
    const agent = createAgent(args);
    await runOnce(agent, args.prompt);
  } else {
    // Interactive REPL
    await runRepl(args);
  }
}

main().catch((err) => {
  console.error(`${c.red}${err instanceof Error ? err.message : String(err)}${c.reset}`);
  process.exit(1);
});
