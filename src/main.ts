#!/usr/bin/env node

import { parseArgs } from './cli/args.js';
import { ansi } from './cli/renderer.js';
import { createAgent, runOnce, runRepl } from './cli/repl.js';
import { APP_VERSION } from './config/constants.js';
import { validateConfig } from './config/env.js';

// ─── Help Text ─────────────────────────────────────────────────────────────

const HELP = `
${ansi.bold}sk${ansi.reset} ${ansi.dim}\u2014 minimalistic AI agent CLI${ansi.reset}

${ansi.yellow}Usage:${ansi.reset}
  sk ${ansi.dim}"prompt"${ansi.reset}            One-shot: run prompt, print answer, exit
  sk                      Interactive REPL mode

${ansi.yellow}Options:${ansi.reset}
  --model ${ansi.dim}<name>${ansi.reset}          Model name ${ansi.dim}(env: MODEL_NAME)${ansi.reset}
  --url ${ansi.dim}<url>${ansi.reset}             LLM endpoint URL ${ansi.dim}(env: MODEL_BASE_URL)${ansi.reset}
  --max-tokens ${ansi.dim}<n>${ansi.reset}        Max response tokens ${ansi.dim}(env: MODEL_MAX_TOKENS)${ansi.reset}
  --system ${ansi.dim}<prompt>${ansi.reset}       Override system prompt
  -v, --verbose           Verbose logging
  -h, --help              Show this help
  --version               Show version

${ansi.yellow}REPL Commands:${ansi.reset}
  /help                   Show REPL commands
  /clear                  Clear conversation history
  /exit                   Exit the REPL
`;

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * CLI entry point. Parses arguments, validates configuration,
 * and dispatches to one-shot or REPL mode.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (args.version) {
    console.log(APP_VERSION);
    process.exit(0);
  }

  // Validate environment configuration at startup.
  validateConfig();

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
  console.error(`${ansi.red}${err instanceof Error ? err.message : String(err)}${ansi.reset}`);
  process.exit(1);
});
