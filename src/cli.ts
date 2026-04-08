#!/usr/bin/env node
import { loadWorkspaceEnv } from './utils/env';
loadWorkspaceEnv();

import { resolveConfig, setRuntimeConfig, type CliRuntimeConfig } from './config';
import { newSession } from './core/browser';
import { verifyChatGPTEntry, verifyOpenAIHome } from './flows/openai';
import { ExchangeClient } from './modules/exchange';

interface ParsedArgs {
  command: string;
  subcommand?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, inlineValue] = arg.slice(2).split('=');
      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }

  return {
    command: positionals[0] || 'help',
    subcommand: positionals[1],
    positionals,
    flags,
  };
}

function printHelp(): void {
  console.log(`codey CLI

Usage:
  codey flow openai-home [--config path]
  codey flow chatgpt-entry [--config path]
  codey exchange folders [--config path]
  codey exchange messages [--folderId id] [--maxItems 20] [--unreadOnly true]

Config:
  --config <file>     JSON config file
  --profile <name>    Reserved for future profile selection
  --headless <bool>   Override browser headless
`);
}

function parseBooleanFlag(value: string | boolean | undefined, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseNumberFlag(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildRuntimeConfig(args: ParsedArgs): CliRuntimeConfig {
  return resolveConfig({
    command: [args.command, args.subcommand].filter(Boolean).join(':'),
    configFile: typeof args.flags.config === 'string' ? args.flags.config : undefined,
    profile: typeof args.flags.profile === 'string' ? args.flags.profile : undefined,
    overrides: {
      browser: {
        headless: parseBooleanFlag(args.flags.headless, undefined as unknown as boolean),
        slowMo: parseNumberFlag(args.flags.slowMo, undefined as unknown as number),
      },
    },
  });
}

async function runFlowCommand(args: ParsedArgs, config: CliRuntimeConfig): Promise<void> {
  const session = await newSession({
    context: {},
  });
  try {
    if (args.subcommand === 'openai-home') {
      const result = await verifyOpenAIHome(session.page);
      console.log(JSON.stringify({ command: 'flow:openai-home', config, result }, null, 2));
      return;
    }

    if (args.subcommand === 'chatgpt-entry') {
      const result = await verifyChatGPTEntry(session.page);
      console.log(JSON.stringify({ command: 'flow:chatgpt-entry', config, result }, null, 2));
      return;
    }

    throw new Error(`Unsupported flow command: ${args.subcommand || '(missing)'}`);
  } finally {
    await session.close();
  }
}

async function runExchangeCommand(args: ParsedArgs, config: CliRuntimeConfig): Promise<void> {
  if (!config.exchange) {
    throw new Error('Exchange config is required. Provide Microsoft Graph client credentials in env or JSON config.');
  }

  const client = new ExchangeClient(config.exchange);

  if (args.subcommand === 'folders') {
    const result = await client.listFolders();
    console.log(JSON.stringify({ command: 'exchange:folders', result }, null, 2));
    return;
  }

  if (args.subcommand === 'messages') {
    const result = await client.listMessages({
      folderId: typeof args.flags.folderId === 'string' ? args.flags.folderId : undefined,
      maxItems: parseNumberFlag(args.flags.maxItems, 20),
      unreadOnly: parseBooleanFlag(args.flags.unreadOnly, false),
    });
    console.log(JSON.stringify({ command: 'exchange:messages', result }, null, 2));
    return;
  }

  throw new Error(`Unsupported exchange command: ${args.subcommand || '(missing)'}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'help' || args.flags.help) {
    printHelp();
    return;
  }

  const config = buildRuntimeConfig(args);
  setRuntimeConfig(config);

  if (args.command === 'flow') {
    await runFlowCommand(args, config);
    return;
  }

  if (args.command === 'exchange') {
    await runExchangeCommand(args, config);
    return;
  }

  printHelp();
  process.exitCode = 1;
}

void main().catch((error: Error) => {
  console.error(JSON.stringify({ status: 'failed', error: error.message }, null, 2));
  process.exit(1);
});
