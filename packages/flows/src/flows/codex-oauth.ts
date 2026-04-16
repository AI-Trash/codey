import type { Page } from 'patchright'
import { pathToFileURL } from 'url'
import { getRuntimeConfig } from '../config'
import { createStateMachine } from '../state-machine'
import type {
  StateMachineController,
  StateMachineSnapshot,
} from '../state-machine'
import {
  attachStateMachineProgressReporter,
  parseNumberFlag,
  sanitizeErrorForOutput,
  type FlowOptions,
} from '../modules/flow-cli/helpers'
import {
  runSingleFileFlowFromCli,
  type SingleFileFlowDefinition,
} from '../modules/flow-cli/single-file'
import { parseFlowCliArgs } from '../modules/flow-cli/parse-argv'
import {
  AxonHubAdminClient,
  buildCodexOAuthCredentials,
  type CreateAxonHubChannelInput,
} from '../modules/authorization/axonhub-client'
import {
  exchangeCodexAuthorizationCode,
  startCodexAuthorization,
  type CodexTokenResponse,
} from '../modules/authorization/codex-client'
import { saveCodexToken } from '../modules/authorization/codex-token-store'
import { waitForAuthorizationCode } from '../modules/authorization/codex-authorization'

export type CodexOAuthFlowKind = 'codex-oauth'

export type CodexOAuthFlowState =
  | 'idle'
  | 'starting-oauth'
  | 'waiting-for-callback'
  | 'exchanging-token'
  | 'persisting-token'
  | 'signing-in-admin'
  | 'creating-channel'
  | 'completed'
  | 'failed'

export type CodexOAuthFlowEvent =
  | 'machine.started'
  | 'codex.oauth.started'
  | 'codex.oauth.callback.received'
  | 'codex.oauth.token.exchanged'
  | 'codex.oauth.token.persisted'
  | 'axonhub.admin.signin.started'
  | 'axonhub.admin.signin.completed'
  | 'codex.oauth.completed'
  | 'codex.oauth.failed'
  | 'context.updated'
  | 'action.started'
  | 'action.finished'

interface RedactedCodexTokenResult {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  scope?: string
  tokenType?: string
  createdAt: string
}

interface CodexOAuthChannelResult {
  id?: string
  type?: string
  name?: string
  baseURL?: string | null
  supportedModels?: string[] | null
  manualModels?: string[] | null
  tags?: string[] | null
  defaultTestModel?: string | null
  remark?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  credentials: {
    oauth: {
      accessToken: string
      refreshToken?: string
      clientID: string
      expiresAt?: string
      tokenType?: string
      scopes: string[]
    }
  }
}

function sanitizeUrl(value: string): string {
  try {
    const parsed = new URL(value)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return value
  }
}

export interface CodexOAuthFlowContext<Result = unknown> {
  kind: CodexOAuthFlowKind
  url?: string
  title?: string
  redirectUri?: string
  authorizationUrl?: string
  tokenStorePath?: string
  channelName?: string
  projectId?: string
  lastMessage?: string
  result?: Result
}

export type CodexOAuthFlowMachine<Result = unknown> = StateMachineController<
  CodexOAuthFlowState,
  CodexOAuthFlowContext<Result>,
  CodexOAuthFlowEvent
>

export type CodexOAuthFlowSnapshot<Result = unknown> = StateMachineSnapshot<
  CodexOAuthFlowState,
  CodexOAuthFlowContext<Result>,
  CodexOAuthFlowEvent
>

export interface CodexOAuthFlowResult {
  pageName: 'codex-oauth'
  url: string
  title: string
  redirectUri: string
  tokenStorePath: string
  token: RedactedCodexTokenResult
  axonHub: {
    projectId?: string
    channel: CodexOAuthChannelResult
  }
  machine: CodexOAuthFlowSnapshot<CodexOAuthFlowResult>
}

export function createCodexOAuthMachine(): CodexOAuthFlowMachine<CodexOAuthFlowResult> {
  return createStateMachine<
    CodexOAuthFlowState,
    CodexOAuthFlowContext<CodexOAuthFlowResult>,
    CodexOAuthFlowEvent
  >({
    id: 'flow.codex.oauth',
    initialState: 'idle',
    initialContext: {
      kind: 'codex-oauth',
    },
    historyLimit: 100,
  })
}

function transitionCodexOAuthMachine(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowResult>,
  state: CodexOAuthFlowState,
  event: CodexOAuthFlowEvent,
  patch?: Partial<CodexOAuthFlowContext<CodexOAuthFlowResult>>,
): void {
  machine.transition(state, {
    event,
    patch,
  })
}

function redactToken(token: CodexTokenResponse): RedactedCodexTokenResult {
  return {
    ...token,
    accessToken: '***redacted***',
    refreshToken: token.refreshToken ? '***redacted***' : undefined,
  }
}

function resolveChannelName(options: FlowOptions): string {
  const config = getRuntimeConfig()
  return (
    options.channelName?.trim() ||
    config.codexChannel?.name?.trim() ||
    'Codex OAuth'
  )
}

function resolveProjectId(options: FlowOptions): string | undefined {
  const config = getRuntimeConfig()
  return options.projectId?.trim() || config.axonHub?.projectId?.trim()
}

function getRequiredCodexConfig(): {
  authorizeUrl: string
  tokenUrl: string
  clientId: string
  clientSecret?: string
  scope?: string
  redirectHost?: string
  redirectPort?: number
  redirectPath?: string
} {
  const config = getRuntimeConfig()
  if (
    !config.codex?.authorizeUrl ||
    !config.codex?.tokenUrl ||
    !config.codex?.clientId
  ) {
    throw new Error(
      'Codex OAuth config is required. Set CODEX_AUTHORIZE_URL, CODEX_TOKEN_URL, and CODEX_CLIENT_ID.',
    )
  }

  return {
    authorizeUrl: config.codex.authorizeUrl,
    tokenUrl: config.codex.tokenUrl,
    clientId: config.codex.clientId,
    clientSecret: config.codex.clientSecret,
    scope: config.codex.scope,
    redirectHost: config.codex.redirectHost,
    redirectPort: config.codex.redirectPort,
    redirectPath: config.codex.redirectPath,
  }
}

function buildCreateChannelInput(
  token: CodexTokenResponse,
  options: FlowOptions,
): CreateAxonHubChannelInput {
  const config = getRuntimeConfig()
  const codexConfig = getRequiredCodexConfig()
  const channelName = resolveChannelName(options)
  const supportedModels = config.codexChannel?.supportedModels || []
  const manualModels = config.codexChannel?.manualModels || []
  const defaultTestModel =
    config.codexChannel?.defaultTestModel ||
    supportedModels[0] ||
    manualModels[0] ||
    'codex-mini-latest'

  return {
    type: 'codex',
    baseURL: config.codexChannel?.baseUrl,
    name: channelName,
    credentials: buildCodexOAuthCredentials(token, codexConfig.clientId),
    supportedModels,
    manualModels,
    tags: config.codexChannel?.tags || ['codex'],
    defaultTestModel,
    autoSyncSupportedModels: supportedModels.length === 0,
    remark: 'Created by codey flow codex-oauth',
  }
}

function redactChannelCredentials(
  input: CreateAxonHubChannelInput,
  createdChannel: Awaited<ReturnType<AxonHubAdminClient['createChannel']>>,
): CodexOAuthChannelResult {
  return {
    ...createdChannel,
    credentials: {
      oauth: {
        ...input.credentials.oauth,
        accessToken: '***redacted***',
        refreshToken: input.credentials.oauth.refreshToken
          ? '***redacted***'
          : undefined,
      },
    },
  }
}

export async function runCodexOAuthFlow(
  page: Page,
  options: FlowOptions = {},
): Promise<CodexOAuthFlowResult> {
  const config = getRuntimeConfig()
  const codexConfig = getRequiredCodexConfig()
  const machine = createCodexOAuthMachine()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )
  const channelName = resolveChannelName(options)
  const projectId = resolveProjectId(options)

  try {
    machine.start(
      {
        channelName,
        projectId,
      },
      {
        source: 'runCodexOAuthFlow',
      },
    )

    const redirectPort =
      parseNumberFlag(options.redirectPort, codexConfig.redirectPort) ||
      codexConfig.redirectPort ||
      3000
    const callbackAbortController = new AbortController()

    transitionCodexOAuthMachine(
      machine,
      'starting-oauth',
      'codex.oauth.started',
      {
        channelName,
        projectId,
        lastMessage: 'Starting local Codex PKCE OAuth',
      },
    )

    const started = startCodexAuthorization({
      authorizeUrl: codexConfig.authorizeUrl,
      clientId: codexConfig.clientId,
      scope: codexConfig.scope,
      redirectHost: codexConfig.redirectHost,
      redirectPort,
      redirectPath: codexConfig.redirectPath,
      openBrowserWindow: false,
    })

    const callbackPromise = waitForAuthorizationCode({
      host: started.redirectHost,
      port: started.redirectPort,
      path: started.redirectPath,
      signal: callbackAbortController.signal,
    })

    try {
      await page.goto(started.authorizationUrl, {
        waitUntil: 'domcontentloaded',
      })
    } catch (error) {
      callbackAbortController.abort()
      await callbackPromise.catch(() => undefined)
      throw error
    }

    transitionCodexOAuthMachine(
      machine,
      'waiting-for-callback',
      'context.updated',
      {
        url: sanitizeUrl(page.url()),
        redirectUri: started.redirectUri,
        lastMessage: 'Waiting for Codex OAuth callback',
      },
    )

    const callback = await callbackPromise
    if (!callback.code) {
      throw new Error(
        'Codex OAuth callback did not include an authorization code.',
      )
    }
    if (callback.state !== started.state) {
      throw new Error('Codex OAuth state mismatch.')
    }

    transitionCodexOAuthMachine(
      machine,
      'exchanging-token',
      'codex.oauth.callback.received',
      {
        url: sanitizeUrl(page.url()),
        redirectUri: started.redirectUri,
        lastMessage: 'Received Codex OAuth callback; exchanging token',
      },
    )

    const token = await exchangeCodexAuthorizationCode({
      tokenUrl: codexConfig.tokenUrl,
      clientId: codexConfig.clientId,
      clientSecret: codexConfig.clientSecret,
      code: callback.code,
      redirectUri: started.redirectUri,
      codeVerifier: started.codeVerifier,
    })

    transitionCodexOAuthMachine(
      machine,
      'persisting-token',
      'codex.oauth.token.exchanged',
      {
        url: sanitizeUrl(page.url()),
        lastMessage: 'Persisting Codex token locally',
      },
    )

    const tokenStorePath = saveCodexToken(token)

    transitionCodexOAuthMachine(
      machine,
      'persisting-token',
      'codex.oauth.token.persisted',
      {
        url: sanitizeUrl(page.url()),
        tokenStorePath,
        lastMessage: 'Stored Codex token locally',
      },
    )

    transitionCodexOAuthMachine(
      machine,
      'signing-in-admin',
      'axonhub.admin.signin.started',
      {
        url: sanitizeUrl(page.url()),
        tokenStorePath,
        lastMessage: 'Signing into AxonHub admin',
      },
    )

    const axonHubClient = new AxonHubAdminClient({
      ...config.axonHub,
      projectId,
    })
    const adminSession = await axonHubClient.signIn()

    transitionCodexOAuthMachine(machine, 'creating-channel', 'action.started', {
      url: sanitizeUrl(page.url()),
      tokenStorePath,
      lastMessage: 'Creating Codex channel in AxonHub',
    })

    const channelInput = buildCreateChannelInput(token, options)
    const createdChannel = await axonHubClient.createChannel(
      adminSession.token,
      channelInput,
    )

    const title = await page.title()
    const result = {
      pageName: 'codex-oauth' as const,
      url: sanitizeUrl(page.url()),
      title,
      redirectUri: started.redirectUri,
      tokenStorePath,
      token: redactToken(token),
      axonHub: {
        projectId,
        channel: redactChannelCredentials(channelInput, createdChannel),
      },
      machine:
        undefined as unknown as CodexOAuthFlowSnapshot<CodexOAuthFlowResult>,
    }

    const snapshot = machine.succeed('completed', {
      event: 'codex.oauth.completed',
      patch: {
        url: result.url,
        title: result.title,
        redirectUri: started.redirectUri,
        tokenStorePath,
        channelName,
        projectId,
        lastMessage: 'Codex OAuth flow completed',
      },
    })
    result.machine = snapshot
    return result
  } catch (error) {
    machine.fail(error, 'failed', {
      event: 'codex.oauth.failed',
      patch: {
        url: sanitizeUrl(page.url()),
        channelName,
        projectId,
        lastMessage: sanitizeErrorForOutput(error).message,
      },
    })
    throw error
  } finally {
    detachProgress()
  }
}

export const codexOAuthFlow: SingleFileFlowDefinition<
  FlowOptions,
  CodexOAuthFlowResult
> = {
  command: 'flow:codex-oauth',
  run: runCodexOAuthFlow,
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runSingleFileFlowFromCli(
    codexOAuthFlow,
    parseFlowCliArgs(process.argv.slice(2)),
  )
}
