#!/usr/bin/env node
import { cac } from 'cac';

import { loadWorkspaceEnv } from './utils/env';
loadWorkspaceEnv();

import { resolveConfig, setRuntimeConfig, type CliRuntimeConfig } from './config';
import { newSession } from './core/browser';
import { registerChatGPTWithExchange, verifyChatGPTEntry, verifyOpenAIHome } from './flows/openai';
import { ExchangeClient } from './modules/exchange';

interface CommonOptions {
  config?: string;
  profile?: string;
  headless?: string | boolean;
  slowMo?: string | boolean;
}

interface FlowOptions extends CommonOptions {
  waitMs?: string | boolean;
  verificationTimeoutMs?: string | boolean;
  pollIntervalMs?: string | boolean;
  password?: string;
  createPasskey?: string | boolean;
}

interface ExchangeOptions extends CommonOptions {
  folderId?: string;
  maxItems?: string | boolean;
  unreadOnly?: string | boolean;
}

function parseBooleanFlag(value: string | boolean | undefined, fallback?: boolean): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseNumberFlag(value: string | boolean | undefined, fallback?: number): number | undefined {
  if (typeof value !== 'string') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildRuntimeConfig(command: string, options: CommonOptions): CliRuntimeConfig {
  return resolveConfig({
    command,
    configFile: options.config,
    profile: options.profile,
    overrides: {
      browser: {
        headless: parseBooleanFlag(options.headless),
        slowMo: parseNumberFlag(options.slowMo),
      },
    },
  });
}

async function runFlowCommand(
  subcommand: string,
  options: FlowOptions,
  config: CliRuntimeConfig,
): Promise<void> {
  const session = await newSession({
    context: {},
  });
  try {
    if (subcommand === 'openai-home') {
      const result = await verifyOpenAIHome(session.page);
      console.log(JSON.stringify({ command: 'flow:openai-home', config, result }, null, 2));
      return;
    }

    if (subcommand === 'chatgpt-entry') {
      const result = await verifyChatGPTEntry(session.page);
      console.log(JSON.stringify({ command: 'flow:chatgpt-entry', config, result }, null, 2));
      return;
    }

    if (subcommand === 'chatgpt-open') {
      const waitMs = parseNumberFlag(options.waitMs, 300000) ?? 300000;
      await session.page.goto(config.openai.chatgptUrl, { waitUntil: 'domcontentloaded' });
      console.log(
        JSON.stringify(
          {
            command: 'flow:chatgpt-open',
            status: 'opened',
            url: session.page.url(),
            waitMs,
            note: 'ChatGPT has been opened and no automated actions will be performed.',
          },
          null,
          2,
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return;
    }

    if (subcommand === 'chatgpt-register-exchange') {
      const result = await registerChatGPTWithExchange(session.page, {
        password: options.password,
        verificationTimeoutMs: parseNumberFlag(options.verificationTimeoutMs, 180000) ?? 180000,
        pollIntervalMs: parseNumberFlag(options.pollIntervalMs, 5000) ?? 5000,
        createPasskey: parseBooleanFlag(options.createPasskey, true) ?? true,
      });
      console.log(JSON.stringify({ command: 'flow:chatgpt-register-exchange', config, result }, null, 2));
      return;
    }

    throw new Error(`Unsupported flow command: ${subcommand || '(missing)'}`);
  } finally {
    await session.close();
  }
}

async function runExchangeCommand(
  subcommand: string,
  options: ExchangeOptions,
  config: CliRuntimeConfig,
): Promise<void> {
  if (!config.exchange) {
    throw new Error('Exchange config is required. Provide Microsoft Graph client credentials in env or JSON config.');
  }

  const client = new ExchangeClient(config.exchange);

  if (subcommand === 'verify') {
    const result = await client.verifyAccess();
    console.log(JSON.stringify({ command: 'exchange:verify', result }, null, 2));
    return;
  }

  if (subcommand === 'folders') {
    const result = await client.listFolders();
    console.log(JSON.stringify({ command: 'exchange:folders', result }, null, 2));
    return;
  }

  if (subcommand === 'messages') {
    const result = await client.listMessages({
      folderId: options.folderId,
      maxItems: parseNumberFlag(options.maxItems, 20) ?? 20,
      unreadOnly: parseBooleanFlag(options.unreadOnly, false) ?? false,
    });
    console.log(JSON.stringify({ command: 'exchange:messages', result }, null, 2));
    return;
  }

  throw new Error(`Unsupported exchange command: ${subcommand || '(missing)'}`);
}

function reportError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: 'failed', error: message }, null, 2));
  process.exit(1);
}

function execute(task: Promise<void>): void {
  task.catch(reportError);
}

const cli = cac('codey');
const flowCli = cac('codey flow');
const exchangeCli = cac('codey exchange');

function withCommonOptions<TCommand extends { option(name: string, description?: string, config?: never): TCommand }>(
  command: TCommand,
): TCommand {
  return command
    .option('--config <file>', 'JSON config file')
    .option('--profile <name>', 'Reserved for future profile selection')
    .option('--headless <bool>', 'Override browser headless')
    .option('--slowMo <ms>', 'Override browser slow motion delay');
}

withCommonOptions(
  flowCli.command('openai-home', 'Validate the OpenAI home page').example('codey flow openai-home --config path/to/config.json'),
).action((options: CommonOptions) => {
  execute(
    (async () => {
      const config = buildRuntimeConfig('flow:openai-home', options);
      setRuntimeConfig(config);
      await runFlowCommand('openai-home', options, config);
    })(),
  );
});

withCommonOptions(
  flowCli.command('chatgpt-entry', 'Validate the ChatGPT entry page').example('codey flow chatgpt-entry --headless true'),
).action((options: CommonOptions) => {
  execute(
    (async () => {
      const config = buildRuntimeConfig('flow:chatgpt-entry', options);
      setRuntimeConfig(config);
      await runFlowCommand('chatgpt-entry', options, config);
    })(),
  );
});

withCommonOptions(
  flowCli
    .command('chatgpt-open', 'Open ChatGPT and keep the page open')
    .option('--waitMs <ms>', 'How long to keep ChatGPT open for chatgpt-open')
    .example('codey flow chatgpt-open --waitMs 300000'),
).action((options: FlowOptions) => {
  execute(
    (async () => {
      const config = buildRuntimeConfig('flow:chatgpt-open', options);
      setRuntimeConfig(config);
      await runFlowCommand('chatgpt-open', options, config);
    })(),
  );
});

withCommonOptions(
  flowCli
    .command('chatgpt-register-exchange', 'Register a ChatGPT account using the configured Exchange mailbox')
    .option('--password <password>', 'Optional password override')
    .option('--verificationTimeoutMs <ms>', 'How long to wait for the verification email')
    .option('--pollIntervalMs <ms>', 'How often to poll Exchange for the verification email')
    .option('--createPasskey <bool>', 'Whether to provision a passkey after registration')
    .example('codey flow chatgpt-register-exchange --verificationTimeoutMs 180000 --createPasskey true'),
).action((options: FlowOptions) => {
  execute(
    (async () => {
      const config = buildRuntimeConfig('flow:chatgpt-register-exchange', options);
      setRuntimeConfig(config);
      await runFlowCommand('chatgpt-register-exchange', options, config);
    })(),
  );
});

withCommonOptions(
  exchangeCli.command('verify', 'Verify Exchange token, mailbox folder access, and inbox message access').example('codey exchange verify'),
).action((options: CommonOptions) => {
  execute(
    (async () => {
      const config = buildRuntimeConfig('exchange:verify', options);
      setRuntimeConfig(config);
      await runExchangeCommand('verify', options, config);
    })(),
  );
});

withCommonOptions(
  exchangeCli.command('folders', 'List mailbox folders').example('codey exchange folders --config path/to/config.json'),
).action((options: CommonOptions) => {
  execute(
    (async () => {
      const config = buildRuntimeConfig('exchange:folders', options);
      setRuntimeConfig(config);
      await runExchangeCommand('folders', options, config);
    })(),
  );
});

withCommonOptions(
  exchangeCli
    .command('messages', 'List mailbox messages')
    .option('--folderId <id>', 'Mailbox folder id')
    .option('--maxItems <count>', 'Maximum number of messages to return')
    .option('--unreadOnly <bool>', 'Only return unread messages')
    .example('codey exchange messages --folderId id --maxItems 20 --unreadOnly true'),
).action((options: ExchangeOptions) => {
  execute(
    (async () => {
      const config = buildRuntimeConfig('exchange:messages', options);
      setRuntimeConfig(config);
      await runExchangeCommand('messages', options, config);
    })(),
  );
});

cli
  .command('flow', 'Run OpenAI flow commands')
  .example('codey flow openai-home --config path/to/config.json')
  .example('codey flow chatgpt-entry --headless true')
  .example('codey flow chatgpt-open --waitMs 300000')
  .example('codey flow chatgpt-register-exchange --verificationTimeoutMs 180000 --createPasskey true')
  .action(() => {
    flowCli.outputHelp();
  });

cli
  .command('exchange', 'Run Exchange commands')
  .example('codey exchange verify')
  .example('codey exchange folders --config path/to/config.json')
  .example('codey exchange messages --folderId id --maxItems 20 --unreadOnly true')
  .action(() => {
    exchangeCli.outputHelp();
  });

cli.help();
flowCli.help();
exchangeCli.help();

const argv = process.argv.slice(2);

if (argv.length === 0) {
  cli.outputHelp();
} else if (argv[0] === 'flow') {
  flowCli.parse(['codey', 'flow', ...argv.slice(1)]);
} else if (argv[0] === 'exchange') {
  exchangeCli.parse(['codey', 'exchange', ...argv.slice(1)]);
} else {
  cli.parse();
}
