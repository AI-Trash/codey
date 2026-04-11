#!/usr/bin/env node
import { cac } from 'cac';

import { loadWorkspaceEnv } from './utils/env';
loadWorkspaceEnv();

import {
  chatgptOpenFlow,
  loginChatGPTWithStoredPasskey,
  registerChatGPTWithExchange,
  verifyChatGPTEntry,
  verifyOpenAIHome,
} from './flows';
import { ExchangeClient } from './modules/exchange';
import {
  execute,
  parseBooleanFlag,
  parseNumberFlag,
  prepareRuntimeConfig,
  redactForOutput,
  type CommonOptions,
  type ExchangeOptions,
  type FlowOptions,
} from './modules/flow-cli/helpers';
import { runWithSession } from './modules/flow-cli/run-with-session';

async function runFlowCommand(
  subcommand: string,
  options: FlowOptions,
  config: ReturnType<typeof prepareRuntimeConfig>,
): Promise<void> {
  await runWithSession({ context: {} }, async (session) => {
    if (subcommand === 'openai-home') {
      const result = await verifyOpenAIHome(session.page);
      console.log(JSON.stringify({ command: 'flow:openai-home', config: redactForOutput(config), result }, null, 2));
      return;
    }

    if (subcommand === 'chatgpt-entry') {
      const result = await verifyChatGPTEntry(session.page);
      console.log(JSON.stringify({ command: 'flow:chatgpt-entry', config: redactForOutput(config), result }, null, 2));
      return;
    }

    if (subcommand === 'chatgpt-open') {
      const result = await chatgptOpenFlow.run(session.page, options);
      console.log(JSON.stringify({ command: 'flow:chatgpt-open', config: redactForOutput(config), result }, null, 2));
      return;
    }

    if (subcommand === 'chatgpt-register-exchange') {
      const result = await registerChatGPTWithExchange(session.page, options);
      console.log(JSON.stringify({ command: 'flow:chatgpt-register-exchange', config: redactForOutput(config), result }, null, 2));
      return;
    }

    if (subcommand === 'chatgpt-login-passkey') {
      const result = await loginChatGPTWithStoredPasskey(session.page, options);
      console.log(JSON.stringify({ command: 'flow:chatgpt-login-passkey', config: redactForOutput(config), result }, null, 2));
      return;
    }

    throw new Error(`Unsupported flow command: ${subcommand || '(missing)'}`);
  });
}

async function runExchangeCommand(
  subcommand: string,
  options: ExchangeOptions,
  config: ReturnType<typeof prepareRuntimeConfig>,
): Promise<void> {
  if (!config.exchange) {
    throw new Error('Exchange config is required. Provide Microsoft Graph client credentials in env or JSON config.');
  }

  const client = new ExchangeClient(config.exchange);

  if (subcommand === 'verify') {
    const result = await client.verifyAccess();
    console.log(JSON.stringify({ command: 'exchange:verify', config: redactForOutput(config), result }, null, 2));
    return;
  }

  if (subcommand === 'folders') {
    const result = await client.listFolders();
    console.log(JSON.stringify({ command: 'exchange:folders', config: redactForOutput(config), result }, null, 2));
    return;
  }

  if (subcommand === 'messages') {
    const result = await client.listMessages({
      folderId: options.folderId,
      maxItems: parseNumberFlag(options.maxItems, 20) ?? 20,
      unreadOnly: parseBooleanFlag(options.unreadOnly, false) ?? false,
    });
    console.log(JSON.stringify({ command: 'exchange:messages', config: redactForOutput(config), result }, null, 2));
    return;
  }

  throw new Error(`Unsupported exchange command: ${subcommand || '(missing)'}`);
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
      const config = prepareRuntimeConfig('flow:openai-home', options);
      await runFlowCommand('openai-home', options, config);
    })(),
  );
});

withCommonOptions(
  flowCli.command('chatgpt-entry', 'Validate the ChatGPT entry page').example('codey flow chatgpt-entry --headless true'),
).action((options: CommonOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('flow:chatgpt-entry', options);
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
      const config = prepareRuntimeConfig('flow:chatgpt-open', options);
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
    .option('--sameSessionPasskeyCheck <bool>', 'Whether to run a same-session passkey re-login diagnostic after registration')
    .example('codey flow chatgpt-register-exchange --verificationTimeoutMs 180000 --createPasskey true'),
).action((options: FlowOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('flow:chatgpt-register-exchange', options);
      await runFlowCommand('chatgpt-register-exchange', options, config);
    })(),
  );
});

withCommonOptions(
  flowCli
    .command('chatgpt-login-passkey', 'Try to sign in to ChatGPT with a previously stored passkey identity')
    .option('--identityId <id>', 'Stored identity id from a previous chatgpt-register-exchange run')
    .option('--email <email>', 'Stored identity email; defaults to the latest saved identity')
    .example('codey flow chatgpt-login-passkey')
    .example('codey flow chatgpt-login-passkey --email someone@example.com'),
).action((options: FlowOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('flow:chatgpt-login-passkey', options);
      await runFlowCommand('chatgpt-login-passkey', options, config);
    })(),
  );
});

withCommonOptions(
  exchangeCli.command('verify', 'Verify Exchange token, mailbox folder access, and inbox message access').example('codey exchange verify'),
).action((options: CommonOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('exchange:verify', options);
      await runExchangeCommand('verify', options, config);
    })(),
  );
});

withCommonOptions(
  exchangeCli.command('folders', 'List mailbox folders').example('codey exchange folders --config path/to/config.json'),
).action((options: CommonOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('exchange:folders', options);
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
      const config = prepareRuntimeConfig('exchange:messages', options);
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
  .example('codey flow chatgpt-login-passkey --email someone@example.com')
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
