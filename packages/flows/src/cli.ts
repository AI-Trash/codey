#!/usr/bin/env node
import { cac } from 'cac'

import { loadWorkspaceEnv } from './utils/env'
loadWorkspaceEnv()

import { setRuntimeConfig } from './config'
import {
  loginChatGPTAndInviteMembers,
  loginChatGPT,
  openNoopFlow,
  registerChatGPT,
  runCodexOAuthFlow,
} from './flows'
import { ExchangeClient } from './modules/exchange'
import {
  resolveCliNotificationsAuthState,
  exchangeDeviceChallenge,
  startDeviceLogin,
  streamCliNotifications,
} from './modules/app-auth/device-login'
import { clearAppSession, readAppSession } from './modules/app-auth/token-store'
import { getDefaultCliName } from './utils/cli-name'
import {
  applyFlowOptionDefaults,
  attachFlowArtifactPaths,
  createConsoleFlowProgressReporter,
  execute,
  keepBrowserOpenForHarWhenUnspecified,
  parseBooleanFlag,
  parseNumberFlag,
  prepareRuntimeConfig,
  printFlowCompletionSummary,
  redactForOutput,
  shouldKeepFlowOpen,
  type AuthOptions,
  type CommonOptions,
  type ExchangeOptions,
  type FlowOptions,
} from './modules/flow-cli/helpers'
import {
  isCliFlowTaskPayload,
  type CliFlowCommandId,
} from './modules/flow-cli/flow-registry'
import { runWithSession } from './modules/flow-cli/run-with-session'
import { sleep } from './utils/wait'

async function runFlowCommand(
  subcommand: CliFlowCommandId,
  options: FlowOptions,
): Promise<void> {
  const runtimeOptions: FlowOptions = {
    ...options,
    progressReporter:
      options.progressReporter ||
      createConsoleFlowProgressReporter(`flow:${subcommand}`),
  }
  let result: unknown
  let browserHarPath: string | undefined

  await runWithSession(
    { artifactName: subcommand, context: {} },
    async (session) => {
      browserHarPath = session.harPath
      if (subcommand === 'chatgpt-register') {
        result = await registerChatGPT(session.page, runtimeOptions)
        return
      }

      if (subcommand === 'chatgpt-login') {
        result = await loginChatGPT(session.page, runtimeOptions)
        return
      }

      if (subcommand === 'chatgpt-login-invite') {
        result = await loginChatGPTAndInviteMembers(
          session.page,
          runtimeOptions,
        )
        return
      }

      if (subcommand === 'codex-oauth') {
        result = await runCodexOAuthFlow(session.page, runtimeOptions)
        return
      }

      if (subcommand === 'noop') {
        result = await openNoopFlow(session.page)
        return
      }

      throw new Error(`Unsupported flow command: ${subcommand || '(missing)'}`)
    },
    { closeOnComplete: !shouldKeepFlowOpen(runtimeOptions) },
  )

  result = attachFlowArtifactPaths(result, {
    harPath: browserHarPath,
  })
  printFlowCompletionSummary(`flow:${subcommand}`, result)
  if (shouldKeepFlowOpen(runtimeOptions)) {
    console.error(
      'Flow completed and the browser remains open because --record is enabled. Press Ctrl+C to exit or close the browser window.',
    )
  }
}

function resolveFlowCommandOptions(
  subcommand: CliFlowCommandId,
  options: FlowOptions,
): FlowOptions {
  if (subcommand === 'codex-oauth') {
    return keepBrowserOpenForHarWhenUnspecified(
      applyFlowOptionDefaults(options),
    )
  }

  if (subcommand === 'noop') {
    return applyFlowOptionDefaults(options, {
      har: true,
      record: true,
    })
  }

  return applyFlowOptionDefaults(options)
}

async function executeFlowSubcommand(
  subcommand: CliFlowCommandId,
  options: FlowOptions,
): Promise<void> {
  const resolvedOptions = resolveFlowCommandOptions(subcommand, options)
  prepareRuntimeConfig(`flow:${subcommand}`, resolvedOptions)
  await runFlowCommand(subcommand, resolvedOptions)
}

async function runExchangeCommand(
  subcommand: string,
  options: ExchangeOptions,
  config: ReturnType<typeof prepareRuntimeConfig>,
): Promise<void> {
  if (!config.exchange) {
    throw new Error(
      'Exchange config is required. Provide Microsoft Graph client credentials in env or JSON config.',
    )
  }

  const client = new ExchangeClient(config.exchange)

  if (subcommand === 'verify') {
    const result = await client.verifyAccess()
    console.log(
      JSON.stringify(
        { command: 'exchange:verify', config: redactForOutput(config), result },
        null,
        2,
      ),
    )
    return
  }

  if (subcommand === 'folders') {
    const result = await client.listFolders()
    console.log(
      JSON.stringify(
        {
          command: 'exchange:folders',
          config: redactForOutput(config),
          result,
        },
        null,
        2,
      ),
    )
    return
  }

  if (subcommand === 'messages') {
    const result = await client.listMessages({
      folderId: options.folderId,
      maxItems: parseNumberFlag(options.maxItems, 20) ?? 20,
      unreadOnly: parseBooleanFlag(options.unreadOnly, false) ?? false,
    })
    console.log(
      JSON.stringify(
        {
          command: 'exchange:messages',
          config: redactForOutput(config),
          result,
        },
        null,
        2,
      ),
    )
    return
  }

  throw new Error(`Unsupported exchange command: ${subcommand || '(missing)'}`)
}

async function runAuthCommand(
  subcommand: string,
  options: AuthOptions,
  config: ReturnType<typeof prepareRuntimeConfig>,
): Promise<void> {
  if (subcommand === 'login') {
    const cliName = options.cliName || getDefaultCliName()
    const challenge = await startDeviceLogin({
      flowType: options.flowType || 'flow-cli',
      cliName,
      scope: options.scope,
    })
    console.log(
      JSON.stringify(
        {
          command: 'auth:login:start',
          config: redactForOutput(config),
          challenge: {
            userCode: challenge.userCode,
            verificationUri: challenge.verificationUri,
            verificationUriComplete: challenge.verificationUriComplete,
            expiresAt: challenge.expiresAt,
            interval: challenge.interval,
            scope: challenge.scope,
          },
          instructions: [
            challenge.verificationUriComplete
              ? `Open ${challenge.verificationUriComplete} in a browser, or visit ${challenge.verificationUri} and enter the user code ${challenge.userCode} manually to authorize this CLI session.`
              : `Visit ${challenge.verificationUri} and enter the user code ${challenge.userCode} to authorize this CLI session.`,
          ],
        },
        null,
        2,
      ),
    )

    const session = await exchangeDeviceChallenge(challenge, options.target)
    console.log(
      JSON.stringify(
        {
          command: 'auth:login:completed',
          config: redactForOutput(config),
          status: {
            status: session.status,
            expiresAt: session.expiresAt,
          },
          session: redactForOutput({
            target: options.target,
            subject: session.subject,
            tokenType: session.tokenType,
            scope: session.scope,
            expiresAt: session.expiresAt,
          }),
        },
        null,
        2,
      ),
    )
    return
  }

  if (subcommand === 'status') {
    const session = readAppSession()
    console.log(
      JSON.stringify(
        {
          command: 'auth:status',
          config: redactForOutput(config),
          session: redactForOutput(session),
        },
        null,
        2,
      ),
    )
    return
  }

  if (subcommand === 'logout') {
    clearAppSession()
    console.log(
      JSON.stringify(
        {
          command: 'auth:logout',
          config: redactForOutput(config),
          ok: true,
        },
        null,
        2,
      ),
    )
    return
  }

  throw new Error(`Unsupported auth command: ${subcommand || '(missing)'}`)
}

async function runDaemonCommand(
  subcommand: string,
  options: AuthOptions,
  config: ReturnType<typeof prepareRuntimeConfig>,
): Promise<void> {
  if (subcommand !== 'start') {
    throw new Error(`Unsupported daemon command: ${subcommand || '(missing)'}`)
  }

  const cliName = options.cliName || getDefaultCliName()
  let announced = false

  while (true) {
    setRuntimeConfig(config)
    const authState = await resolveCliNotificationsAuthState()

    console.log(
      JSON.stringify(
        {
          command: announced ? 'daemon:reconnect' : 'daemon:start',
          config: redactForOutput(config),
          cliName,
          auth: redactForOutput({
            mode: authState.mode,
            clientId: authState.clientId,
            target: authState.session?.target,
            subject: authState.session?.subject,
            expiresAt: authState.session?.tokenSet.expiresAt,
          }),
          session:
            authState.mode === 'device_session'
              ? redactForOutput(authState.session)
              : undefined,
          status: 'listening',
        },
        null,
        2,
      ),
    )
    announced = true

    try {
      for await (const notification of streamCliNotifications(
        {
          cliName,
          target: options.target,
        },
        authState,
      )) {
        console.log(
          JSON.stringify(
            {
              command: 'daemon:event',
              notification,
            },
            null,
            2,
          ),
        )

        if (!isCliFlowTaskPayload(notification.payload)) {
          continue
        }

        const flowId = notification.payload.flowId
        const taskOptions = notification.payload.options as FlowOptions

        console.log(
          JSON.stringify(
            {
              command: 'daemon:task:start',
              notificationId: notification.id,
              flowId,
              options: redactForOutput(taskOptions),
            },
            null,
            2,
          ),
        )

        try {
          await executeFlowSubcommand(flowId, taskOptions)
          console.log(
            JSON.stringify(
              {
                command: 'daemon:task:completed',
                notificationId: notification.id,
                flowId,
              },
              null,
              2,
            ),
          )
        } catch (error) {
          console.error(
            JSON.stringify(
              {
                command: 'daemon:task:error',
                notificationId: notification.id,
                flowId,
                error: sanitizeErrorForOutput(error).message,
              },
              null,
              2,
            ),
          )
        } finally {
          setRuntimeConfig(config)
        }
      }
    } catch (error) {
      console.error(
        JSON.stringify(
          {
            command: 'daemon:stream:error',
            error: sanitizeErrorForOutput(error).message,
          },
          null,
          2,
        ),
      )
    }

    await sleep(1000)
  }
}

const cli = cac('codey')
const flowCli = cac('codey flow')
const exchangeCli = cac('codey exchange')
const authCli = cac('codey auth')
const daemonCli = cac('codey daemon')

function withCommonOptions<
  TCommand extends {
    option(name: string, description?: string, config?: never): TCommand
  },
>(command: TCommand): TCommand {
  return command
    .option('--config <file>', 'JSON config file')
    .option('--profile <name>', 'Reserved for future config profile selection')
    .option(
      '--chromeDefaultProfile <bool>',
      'Use the local Chrome Default profile for browser-based flow startup',
    )
    .option('--headless <bool>', 'Override browser headless')
    .option('--slowMo <ms>', 'Override browser slow motion delay')
}

withCommonOptions(
  flowCli
    .command(
      'chatgpt-register',
      'Register a ChatGPT account using the configured Exchange mailbox',
    )
    .option('--password <password>', 'Optional password override')
    .option('--har <bool>', 'Whether to record a HAR file for this flow run')
    .option(
      '--record <bool>',
      'Whether to keep the browser session open after the flow completes',
    )
    .option(
      '--verificationTimeoutMs <ms>',
      'How long to wait for the verification email',
    )
    .option(
      '--pollIntervalMs <ms>',
      'How often to poll Exchange for the verification email',
    )
    .example('codey flow chatgpt-register --verificationTimeoutMs 180000'),
).action((options: FlowOptions) => {
  execute(
    (async () => {
      await executeFlowSubcommand('chatgpt-register', options)
    })(),
  )
})

withCommonOptions(
  flowCli
    .command(
      'chatgpt-login',
      'Sign in to ChatGPT with a previously shared identity',
    )
    .option('--har <bool>', 'Whether to record a HAR file for this flow run')
    .option(
      '--record <bool>',
      'Whether to keep the browser session open after the flow completes',
    )
    .option(
      '--identityId <id>',
      'Shared identity id from a previous chatgpt-register run',
    )
    .option(
      '--email <email>',
      'Shared identity email; defaults to the latest shared identity',
    )
    .example('codey flow chatgpt-login')
    .example('codey flow chatgpt-login --email someone@example.com'),
).action((options: FlowOptions) => {
  execute(
    (async () => {
      await executeFlowSubcommand('chatgpt-login', options)
    })(),
  )
})

withCommonOptions(
  flowCli
    .command(
      'chatgpt-login-invite',
      'Sign in with a shared ChatGPT identity and invite workspace members',
    )
    .option('--har <bool>', 'Whether to record a HAR file for this flow run')
    .option(
      '--record <bool>',
      'Whether to keep the browser session open after the flow completes',
    )
    .option(
      '--identityId <id>',
      'Shared identity id from a previous chatgpt-register run',
    )
    .option(
      '--email <email>',
      'Shared identity email; defaults to the latest shared identity',
    )
    .option(
      '--inviteEmail <email>',
      'Invite email(s), repeatable or comma-separated',
    )
    .option(
      '--inviteFile <file>',
      'CSV or JSON file containing invite email addresses',
    )
    .example(
      'codey flow chatgpt-login-invite --inviteEmail a@example.com --inviteEmail b@example.com',
    )
    .example(
      'codey flow chatgpt-login-invite --inviteEmail a@example.com,b@example.com',
    )
    .example(
      'codey flow chatgpt-login-invite --inviteFile ./members.csv --record true',
    ),
).action((options: FlowOptions) => {
  execute(
    (async () => {
      await executeFlowSubcommand('chatgpt-login-invite', options)
    })(),
  )
})

withCommonOptions(
  flowCli
    .command(
      'codex-oauth',
      'Run Codex OAuth, save the session in Codey app, and optionally create an AxonHub Codex channel',
    )
    .option('--har <bool>', 'Whether to record a HAR file for this flow run')
    .option(
      '--record <bool>',
      'Whether to keep the browser session open after the flow completes',
    )
    .option(
      '--identityId <id>',
      'Shared identity id to use if the OpenAI login flow needs credentials',
    )
    .option(
      '--email <email>',
      'Shared identity email to use if the OpenAI login flow needs credentials; defaults to the latest shared identity',
    )
    .option(
      '--workspaceIndex <index>',
      '1-based workspace position to select on the Codex consent page (defaults to 1)',
    )
    .option('--redirectPort <port>', 'Override OAuth callback redirect port')
    .option(
      '--authorizeUrlOnly <bool>',
      'Generate the OAuth URL and exit before continuing browser login',
    )
    .option(
      '--projectId <id>',
      'Optional AxonHub project context sent as X-Project-ID when channel creation is enabled',
    )
    .option(
      '--channelName <name>',
      'Override the AxonHub channel name for this run when channel creation is enabled',
    )
    .example('codey flow codex-oauth --redirectPort 3005')
    .example('codey flow codex-oauth --authorizeUrlOnly true')
    .example('codey flow codex-oauth --email someone@example.com')
    .example('codey flow codex-oauth --workspaceIndex 2')
    .example('codey flow codex-oauth --projectId gid://axonhub/project/123'),
).action((options: FlowOptions) => {
  execute(
    (async () => {
      await executeFlowSubcommand('codex-oauth', options)
    })(),
  )
})

withCommonOptions(
  flowCli
    .command(
      'noop',
      'Open an empty browser page and keep it available for manual inspection',
    )
    .option('--har <bool>', 'Whether to record a HAR file for this flow run')
    .option(
      '--record <bool>',
      'Whether to keep the browser session open after the flow completes',
    )
    .example('codey flow noop')
    .example('codey flow noop --record false --har false'),
).action((options: FlowOptions) => {
  execute(
    (async () => {
      await executeFlowSubcommand('noop', options)
    })(),
  )
})

withCommonOptions(
  authCli
    .command(
      'login',
      'Authenticate this CLI with the Codey app via device flow',
    )
    .option('--flowType <name>', 'Logical flow type for the device challenge')
    .option('--cliName <name>', 'CLI instance label')
    .option('--scope <scope>', 'Requested CLI scope')
    .option(
      '--target <target>',
      'Notification target label, such as a GitHub login',
    )
    .example('codey auth login --target octocat'),
).action((options: AuthOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('auth:login', options)
      await runAuthCommand('login', options, config)
    })(),
  )
})

withCommonOptions(
  authCli.command('status', 'Show stored Codey app authentication status'),
).action((options: AuthOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('auth:status', options)
      await runAuthCommand('status', options, config)
    })(),
  )
})

withCommonOptions(
  authCli.command('logout', 'Clear stored Codey app authentication'),
).action((options: AuthOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('auth:logout', options)
      await runAuthCommand('logout', options, config)
    })(),
  )
})

withCommonOptions(
  daemonCli
    .command('start', 'Run the CLI in notification daemon mode')
    .option('--cliName <name>', 'CLI instance label')
    .option(
      '--target <target>',
      'Notification target label, such as a GitHub login',
    )
    .example('codey daemon start --target octocat'),
).action((options: AuthOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('daemon:start', options)
      await runDaemonCommand('start', options, config)
    })(),
  )
})

withCommonOptions(
  exchangeCli
    .command(
      'verify',
      'Verify Exchange token, mailbox folder access, and inbox message access',
    )
    .example('codey exchange verify'),
).action((options: CommonOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('exchange:verify', options)
      await runExchangeCommand('verify', options, config)
    })(),
  )
})

withCommonOptions(
  exchangeCli
    .command('folders', 'List mailbox folders')
    .example('codey exchange folders --config path/to/config.json'),
).action((options: CommonOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('exchange:folders', options)
      await runExchangeCommand('folders', options, config)
    })(),
  )
})

withCommonOptions(
  exchangeCli
    .command('messages', 'List mailbox messages')
    .option('--folderId <id>', 'Mailbox folder id')
    .option('--maxItems <count>', 'Maximum number of messages to return')
    .option('--unreadOnly <bool>', 'Only return unread messages')
    .example(
      'codey exchange messages --folderId id --maxItems 20 --unreadOnly true',
    ),
).action((options: ExchangeOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('exchange:messages', options)
      await runExchangeCommand('messages', options, config)
    })(),
  )
})

cli
  .command('flow', 'Run OpenAI flow commands')
  .example('codey flow chatgpt-register --verificationTimeoutMs 180000')
  .example('codey flow chatgpt-login --email someone@example.com')
  .example(
    'codey flow chatgpt-login-invite --inviteEmail a@example.com,b@example.com',
  )
  .example('codey flow codex-oauth --projectId gid://axonhub/project/123')
  .action(() => {
    flowCli.outputHelp()
  })

cli
  .command('exchange', 'Run Exchange commands')
  .example('codey exchange verify')
  .example('codey exchange folders --config path/to/config.json')
  .example(
    'codey exchange messages --folderId id --maxItems 20 --unreadOnly true',
  )
  .action(() => {
    exchangeCli.outputHelp()
  })

cli
  .command('auth', 'Run Codey app authentication commands')
  .example('codey auth login --target octocat')
  .example('codey auth logout')
  .action(() => {
    authCli.outputHelp()
  })

cli
  .command('daemon', 'Run CLI daemon and notification commands')
  .example('codey daemon start --target octocat')
  .action(() => {
    daemonCli.outputHelp()
  })

cli.help()
flowCli.help()
exchangeCli.help()
authCli.help()
daemonCli.help()

const argv = process.argv.slice(2)

if (argv.length === 0) {
  cli.outputHelp()
} else if (argv[0] === 'flow') {
  flowCli.parse(['codey', 'flow', ...argv.slice(1)])
} else if (argv[0] === 'exchange') {
  exchangeCli.parse(['codey', 'exchange', ...argv.slice(1)])
} else if (argv[0] === 'auth') {
  authCli.parse(['codey', 'auth', ...argv.slice(1)])
} else if (argv[0] === 'daemon') {
  daemonCli.parse(['codey', 'daemon', ...argv.slice(1)])
} else {
  cli.parse()
}
