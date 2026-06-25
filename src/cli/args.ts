// ─── CLI Argument Types ─────────────────────────────────────────────────────

import { ansi } from './renderer.js';

/** Parsed command-line arguments. */
export interface CliArgs {
  model?: string;
  url?: string;
  maxTokens?: number;
  system?: string;
  verbose: boolean;
  help: boolean;
  version: boolean;
  prompt: string;
}

// ─── Argument Parser ───────────────────────────────────────────────────────

/**
 * Parses raw CLI arguments into a structured `CliArgs` object.
 *
 * @param argv - The argument array (typically `process.argv.slice(2)`).
 * @returns Parsed CLI arguments.
 */
export function parseArgs(argv: string[]): CliArgs {
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
          console.error(`${ansi.red}Unknown option: ${arg}${ansi.reset}`);
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
