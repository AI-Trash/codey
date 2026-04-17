import type { Page } from 'patchright'
import { pathToFileURL } from 'url'
import { getRuntimeConfig } from '../config'
import {
  assignContextFromInput,
  composeStateMachineConfig,
  createGuardedCaseTransitions,
  createOpenAIAddPhoneFailureFragment,
  createPatchTransitionMap,
  createRetryTransition,
  createSelfPatchTransitionMap,
  createStateMachine,
  defineStateMachineFragment,
  GuardedBranchError,
  runGuardedBranches,
} from '../state-machine'
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
import { createAuthorizationCallbackCapture } from '../modules/authorization/codex-authorization'
import {
  clickLoginEntryIfPresent,
  type ChatGPTLoginEntrySurface,
  waitForLoginEntrySurface,
} from '../modules/chatgpt/shared'
import {
  continueChatGPTLoginWithStoredIdentity,
  type ChatGPTStoredLoginResult,
} from './chatgpt-login'

export type CodexOAuthFlowKind = 'codex-oauth'

export type CodexOAuthFlowState =
  | 'idle'
  | 'starting-oauth'
  | 'login-entry'
  | 'email-step'
  | 'passkey-step'
  | 'waiting-for-callback'
  | 'retrying'
  | 'add-phone-required'
  | 'exchanging-token'
  | 'persisting-token'
  | 'signing-in-admin'
  | 'creating-channel'
  | 'completed'
  | 'failed'

export type CodexOAuthFlowEvent =
  | 'machine.started'
  | 'codex.oauth.started'
  | 'codex.oauth.surface.ready'
  | 'codex.oauth.login.continuation.completed'
  | 'codex.oauth.callback.received'
  | 'codex.oauth.token.exchanged'
  | 'codex.oauth.token.persisted'
  | 'codex.oauth.retry.requested'
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
  email?: string
  redirectUri?: string
  authorizationUrl?: string
  tokenStorePath?: string
  channelName?: string
  projectId?: string
  surface?: Exclude<ChatGPTLoginEntrySurface, 'unknown'>
  method?: 'password' | 'passkey' | 'verification'
  retryCount?: number
  retryReason?: string
  retryFromState?: CodexOAuthFlowState
  lastAttempt?: number
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

type CodexOAuthLoginSurface = Exclude<ChatGPTLoginEntrySurface, 'unknown'>

interface CodexOAuthSurfaceInput<Result = unknown> {
  surface: CodexOAuthLoginSurface
  url: string
  patch?: Partial<CodexOAuthFlowContext<Result>>
}

interface CodexOAuthLoginContinuationInput<Result = unknown> {
  surface: Extract<CodexOAuthLoginSurface, 'email' | 'passkey'>
  email: string
  method: 'password' | 'passkey' | 'verification'
  url: string
  patch?: Partial<CodexOAuthFlowContext<Result>>
}

interface CodexOAuthCallbackPayload {
  code: string | null
  state: string | null
  scope?: string | null
  callbackUrl: string
  rawQuery: string
}

const CODEX_OAUTH_BROWSER_HANDOFF_TIMEOUT_MS = 180000
const CODEX_OAUTH_POST_ENTRY_TIMEOUT_MS = 15000

const codexOAuthEventTargets = {
  'codex.oauth.started': 'starting-oauth',
  'codex.oauth.callback.received': 'exchanging-token',
  'codex.oauth.token.exchanged': 'persisting-token',
  'codex.oauth.token.persisted': 'persisting-token',
  'axonhub.admin.signin.started': 'signing-in-admin',
  'axonhub.admin.signin.completed': 'creating-channel',
} as const satisfies Partial<Record<CodexOAuthFlowEvent, CodexOAuthFlowState>>

const codexOAuthMutableContextEvents = [
  'context.updated',
  'action.started',
  'action.finished',
] as const satisfies CodexOAuthFlowEvent[]

const codexOAuthAddPhoneGuardEvents = [
  'codex.oauth.started',
  'codex.oauth.surface.ready',
  'codex.oauth.login.continuation.completed',
  'codex.oauth.callback.received',
  'codex.oauth.token.exchanged',
  'codex.oauth.token.persisted',
  'codex.oauth.retry.requested',
  'axonhub.admin.signin.started',
  'axonhub.admin.signin.completed',
  ...codexOAuthMutableContextEvents,
] as const satisfies CodexOAuthFlowEvent[]

function isCodexOAuthSurfaceInput<Result>(
  value: unknown,
): value is CodexOAuthSurfaceInput<Result> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<CodexOAuthSurfaceInput<Result>>
  return (
    typeof candidate.surface === 'string' && typeof candidate.url === 'string'
  )
}

function isCodexOAuthLoginContinuationInput<Result>(
  value: unknown,
): value is CodexOAuthLoginContinuationInput<Result> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<CodexOAuthLoginContinuationInput<Result>>
  return (
    typeof candidate.surface === 'string' &&
    typeof candidate.email === 'string' &&
    typeof candidate.method === 'string' &&
    typeof candidate.url === 'string'
  )
}

function createCodexOAuthSurfaceTransitions<Result>() {
  const assignSurfaceContext = (
    lastMessage: string,
    extras: Partial<CodexOAuthFlowContext<Result>> = {},
  ) =>
    assignContextFromInput<
      CodexOAuthFlowState,
      CodexOAuthFlowContext<Result>,
      CodexOAuthFlowEvent,
      CodexOAuthSurfaceInput<Result>
    >(isCodexOAuthSurfaceInput, (_context, { input }) => ({
      ...input.patch,
      ...extras,
      surface: input.surface,
      url: input.url,
      lastMessage,
    }))

  return createGuardedCaseTransitions<
    CodexOAuthFlowState,
    CodexOAuthFlowContext<Result>,
    CodexOAuthFlowEvent,
    CodexOAuthSurfaceInput<Result>
  >({
    isInput: isCodexOAuthSurfaceInput,
    cases: [
      {
        priority: 40,
        when: ({ input }) => input.surface === 'authenticated',
        target: 'waiting-for-callback',
        actions: assignSurfaceContext(
          'OpenAI session detected; waiting for Codex OAuth callback',
        ),
      },
      {
        priority: 30,
        when: ({ input }) => input.surface === 'login',
        target: 'login-entry',
        actions: assignSurfaceContext('OpenAI login entry detected'),
      },
      {
        priority: 20,
        when: ({ input }) => input.surface === 'email',
        target: 'email-step',
        actions: assignSurfaceContext('OpenAI email login surface ready'),
      },
      {
        priority: 10,
        when: ({ input }) => input.surface === 'passkey',
        target: 'passkey-step',
        actions: assignSurfaceContext('OpenAI passkey login surface ready'),
      },
    ],
  })
}

function createCodexOAuthLoginContinuationTransitions<Result>() {
  return createGuardedCaseTransitions<
    CodexOAuthFlowState,
    CodexOAuthFlowContext<Result>,
    CodexOAuthFlowEvent,
    CodexOAuthLoginContinuationInput<Result>
  >({
    isInput: isCodexOAuthLoginContinuationInput,
    cases: [
      {
        priority: 20,
        when: ({ input }) => input.surface === 'email',
        target: 'waiting-for-callback',
        actions: assignContextFromInput<
          CodexOAuthFlowState,
          CodexOAuthFlowContext<Result>,
          CodexOAuthFlowEvent,
          CodexOAuthLoginContinuationInput<Result>
        >(isCodexOAuthLoginContinuationInput, (_context, { input }) => ({
          ...input.patch,
          email: input.email,
          method: input.method,
          surface: input.surface,
          url: input.url,
          lastMessage: `Submitted ChatGPT ${input.method} login for ${input.email}; waiting for Codex OAuth callback`,
        })),
      },
      {
        priority: 10,
        when: ({ input }) => input.surface === 'passkey',
        target: 'waiting-for-callback',
        actions: assignContextFromInput<
          CodexOAuthFlowState,
          CodexOAuthFlowContext<Result>,
          CodexOAuthFlowEvent,
          CodexOAuthLoginContinuationInput<Result>
        >(isCodexOAuthLoginContinuationInput, (_context, { input }) => ({
          ...input.patch,
          email: input.email,
          method: input.method,
          surface: input.surface,
          url: input.url,
          lastMessage: `Submitted ChatGPT ${input.method} login for ${input.email}; waiting for Codex OAuth callback`,
        })),
      },
    ],
  })
}

function createCodexOAuthLifecycleFragment<Result>() {
  return defineStateMachineFragment<
    CodexOAuthFlowState,
    CodexOAuthFlowContext<Result>,
    CodexOAuthFlowEvent
  >({
    on: {
      ...createPatchTransitionMap<
        CodexOAuthFlowState,
        CodexOAuthFlowContext<Result>,
        CodexOAuthFlowEvent
      >(codexOAuthEventTargets),
      'codex.oauth.retry.requested': createRetryTransition<
        CodexOAuthFlowState,
        CodexOAuthFlowContext<Result>,
        CodexOAuthFlowEvent
      >({
        target: 'retrying',
        defaultMessage: 'Retrying Codex OAuth login handoff',
      }),
      ...createSelfPatchTransitionMap<
        CodexOAuthFlowState,
        CodexOAuthFlowContext<Result>,
        CodexOAuthFlowEvent
      >([...codexOAuthMutableContextEvents]),
    },
  })
}

function createCodexOAuthSurfaceFragment<Result>() {
  return defineStateMachineFragment<
    CodexOAuthFlowState,
    CodexOAuthFlowContext<Result>,
    CodexOAuthFlowEvent
  >({
    on: {
      'codex.oauth.surface.ready': createCodexOAuthSurfaceTransitions<Result>(),
      'codex.oauth.login.continuation.completed':
        createCodexOAuthLoginContinuationTransitions<Result>(),
    },
  })
}

function createCodexOAuthAddPhoneFailureFragment<Result>() {
  return createOpenAIAddPhoneFailureFragment<
    CodexOAuthFlowState,
    CodexOAuthFlowContext<Result>,
    CodexOAuthFlowEvent
  >({
    events: codexOAuthAddPhoneGuardEvents,
    target: 'add-phone-required',
  })
}

export function createCodexOAuthMachine(): CodexOAuthFlowMachine<CodexOAuthFlowResult> {
  return createStateMachine<
    CodexOAuthFlowState,
    CodexOAuthFlowContext<CodexOAuthFlowResult>,
    CodexOAuthFlowEvent
  >(
    composeStateMachineConfig(
      {
        id: 'flow.codex.oauth',
        initialState: 'idle',
        initialContext: {
          kind: 'codex-oauth',
        },
        historyLimit: 100,
      },
      createCodexOAuthLifecycleFragment<CodexOAuthFlowResult>(),
      createCodexOAuthAddPhoneFailureFragment<CodexOAuthFlowResult>(),
      createCodexOAuthSurfaceFragment<CodexOAuthFlowResult>(),
    ),
  )
}

async function sendCodexOAuthMachine(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowResult>,
  state: CodexOAuthFlowState,
  event: CodexOAuthFlowEvent,
  patch?: Partial<CodexOAuthFlowContext<CodexOAuthFlowResult>>,
): Promise<void> {
  await machine.send(event, {
    target: state,
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
      'Codex OAuth config is incomplete. Set CODEX_AUTHORIZE_URL, CODEX_TOKEN_URL, and CODEX_CLIENT_ID only if you need to override the built-in defaults.',
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

async function waitForCodexOAuthLoginSurface(
  page: Page,
  timeoutMs = CODEX_OAUTH_BROWSER_HANDOFF_TIMEOUT_MS,
): Promise<ChatGPTLoginEntrySurface> {
  return waitForLoginEntrySurface(page, timeoutMs)
}

function buildCodexOAuthRetryCallbacks(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowResult>,
  page: Page,
  redirectUri: string,
) {
  return {
    onEmailRetry: async (_attempt: number, reason: 'retry' | 'timeout') => {
      await machine.send('codex.oauth.retry.requested', {
        reason: `email:${reason}`,
        message:
          reason === 'retry'
            ? 'Retrying OpenAI email submission during Codex OAuth'
            : 'Retrying timed out OpenAI email submission during Codex OAuth',
        patch: {
          url: sanitizeUrl(page.url()),
          redirectUri,
        },
      })
    },
    onPasskeyRetry: async (_attempt: number, trigger: 'retry' | 'passkey') => {
      await machine.send('codex.oauth.retry.requested', {
        reason: `passkey:${trigger}`,
        message:
          trigger === 'retry'
            ? 'Retrying OpenAI passkey challenge during Codex OAuth'
            : 'Re-triggering OpenAI passkey challenge during Codex OAuth',
        patch: {
          url: sanitizeUrl(page.url()),
          redirectUri,
        },
      })
    },
  }
}

async function sendCodexOAuthSurfaceReady(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowResult>,
  page: Page,
  surface: CodexOAuthLoginSurface,
  redirectUri: string,
): Promise<void> {
  await machine.send('codex.oauth.surface.ready', {
    surface,
    url: sanitizeUrl(page.url()),
    patch: {
      redirectUri,
    },
  })
}

async function continueCodexOAuthStoredLogin(
  page: Page,
  machine: CodexOAuthFlowMachine<CodexOAuthFlowResult>,
  options: FlowOptions,
  surface: Extract<CodexOAuthLoginSurface, 'email' | 'passkey'>,
  redirectUri: string,
): Promise<ChatGPTStoredLoginResult> {
  await sendCodexOAuthMachine(
    machine,
    surface === 'passkey' ? 'passkey-step' : 'email-step',
    'context.updated',
    {
      url: sanitizeUrl(page.url()),
      redirectUri,
      lastMessage: 'ChatGPT login required; continuing stored identity login',
    },
  )

  const login = await continueChatGPTLoginWithStoredIdentity(page, {
    ...options,
    ...buildCodexOAuthRetryCallbacks(machine, page, redirectUri),
  })

  await machine.send('codex.oauth.login.continuation.completed', {
    surface,
    email: login.email,
    method: login.method,
    url: sanitizeUrl(page.url()),
    patch: {
      redirectUri,
    },
  })

  return login
}

function wrapRecoverableCodexOAuthBranchError<Branch extends string>(
  branch: Branch,
  error: unknown,
): GuardedBranchError<Branch> {
  if (error instanceof GuardedBranchError) {
    return error as GuardedBranchError<Branch>
  }

  return new GuardedBranchError(
    branch,
    error instanceof Error ? error.message : String(error),
    {
      cause: error,
      recoverable: true,
    },
  )
}

async function resolveCodexOAuthAfterLoginEntry(
  page: Page,
  machine: CodexOAuthFlowMachine<CodexOAuthFlowResult>,
  options: FlowOptions,
  redirectUri: string,
  waitForCallback: Promise<CodexOAuthCallbackPayload>,
): Promise<CodexOAuthCallbackPayload> {
  const surface = await waitForCodexOAuthLoginSurface(
    page,
    CODEX_OAUTH_POST_ENTRY_TIMEOUT_MS,
  )
  if (surface === 'unknown' || surface === 'login') {
    throw new GuardedBranchError(
      'login',
      'OpenAI login entry did not advance to an authenticated, email, or passkey surface.',
    )
  }

  await sendCodexOAuthSurfaceReady(machine, page, surface, redirectUri)

  return (
    await runGuardedBranches<
      CodexOAuthFlowContext<CodexOAuthFlowResult>,
      {
        surface: Extract<
          CodexOAuthLoginSurface,
          'authenticated' | 'email' | 'passkey'
        >
      },
      CodexOAuthCallbackPayload,
      'authenticated' | 'email' | 'passkey'
    >(
      [
        {
          branch: 'authenticated' as const,
          priority: 30,
          guard: ({ input }) => input.surface === 'authenticated',
          run: async () => waitForCallback,
        },
        {
          branch: 'email' as const,
          priority: 20,
          guard: ({ input }) => input.surface === 'email',
          run: async () => {
            await continueCodexOAuthStoredLogin(
              page,
              machine,
              options,
              'email',
              redirectUri,
            )
            return waitForCallback
          },
        },
        {
          branch: 'passkey' as const,
          priority: 10,
          guard: ({ input }) => input.surface === 'passkey',
          run: async () => {
            await continueCodexOAuthStoredLogin(
              page,
              machine,
              options,
              'passkey',
              redirectUri,
            )
            return waitForCallback
          },
        },
      ],
      {
        context: machine.getSnapshot().context,
        input: {
          surface,
        },
        onFallback: async ({ branch, error }) => {
          await machine.send('codex.oauth.retry.requested', {
            reason: `login-entry:${branch}`,
            message: `Retrying Codex OAuth login entry after ${branch} branch failed`,
            patch: {
              url: sanitizeUrl(page.url()),
              redirectUri,
              lastMessage: error.message,
            },
          })
        },
      },
    )
  ).result
}

async function resolveCodexOAuthNextStep(
  page: Page,
  machine: CodexOAuthFlowMachine<CodexOAuthFlowResult>,
  options: FlowOptions,
  redirectUri: string,
  nextStep:
    | { kind: 'callback'; callback: CodexOAuthCallbackPayload }
    | { kind: 'surface'; surface: ChatGPTLoginEntrySurface },
  waitForCallback: Promise<CodexOAuthCallbackPayload>,
): Promise<CodexOAuthCallbackPayload> {
  return (
    await runGuardedBranches<
      CodexOAuthFlowContext<CodexOAuthFlowResult>,
      typeof nextStep,
      CodexOAuthCallbackPayload,
      'callback' | 'authenticated' | 'login' | 'email' | 'passkey'
    >(
      [
        {
          branch: 'callback' as const,
          priority: 60,
          guard: ({ input }) => input.kind === 'callback',
          run: async ({ input }) => {
            if (input.kind !== 'callback') {
              throw new Error('Codex OAuth callback was not ready yet.')
            }
            return input.callback
          },
        },
        {
          branch: 'authenticated' as const,
          priority: 50,
          guard: ({ input }) =>
            input.kind === 'surface' && input.surface === 'authenticated',
          run: async () => {
            await sendCodexOAuthSurfaceReady(
              machine,
              page,
              'authenticated',
              redirectUri,
            )
            return waitForCallback
          },
        },
        {
          branch: 'login' as const,
          priority: 40,
          guard: ({ input }) =>
            input.kind === 'surface' && input.surface === 'login',
          run: async () => {
            await sendCodexOAuthSurfaceReady(
              machine,
              page,
              'login',
              redirectUri,
            )
            try {
              if (!(await clickLoginEntryIfPresent(page))) {
                throw new Error(
                  'OpenAI login entry button became visible but could not be clicked.',
                )
              }
            } catch (error) {
              throw wrapRecoverableCodexOAuthBranchError('login', error)
            }

            return resolveCodexOAuthAfterLoginEntry(
              page,
              machine,
              options,
              redirectUri,
              waitForCallback,
            )
          },
        },
        {
          branch: 'email' as const,
          priority: 30,
          guard: ({ input }) =>
            input.kind === 'surface' && input.surface === 'email',
          run: async () => {
            await sendCodexOAuthSurfaceReady(
              machine,
              page,
              'email',
              redirectUri,
            )
            await continueCodexOAuthStoredLogin(
              page,
              machine,
              options,
              'email',
              redirectUri,
            )
            return waitForCallback
          },
        },
        {
          branch: 'passkey' as const,
          priority: 20,
          guard: ({ input }) =>
            input.kind === 'surface' && input.surface === 'passkey',
          run: async () => {
            await sendCodexOAuthSurfaceReady(
              machine,
              page,
              'passkey',
              redirectUri,
            )
            await continueCodexOAuthStoredLogin(
              page,
              machine,
              options,
              'passkey',
              redirectUri,
            )
            return waitForCallback
          },
        },
      ],
      {
        context: machine.getSnapshot().context,
        input: nextStep,
        onFallback: async ({ branch, error }) => {
          await machine.send('codex.oauth.retry.requested', {
            reason: `surface:${branch}`,
            message: `Retrying Codex OAuth ${branch} surface after branch entry failed`,
            patch: {
              url: sanitizeUrl(page.url()),
              redirectUri,
              lastMessage: error.message,
            },
          })
        },
      },
    )
  ).result
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

    await sendCodexOAuthMachine(
      machine,
      'starting-oauth',
      'codex.oauth.started',
      {
        channelName,
        projectId,
        lastMessage: 'Starting Codex PKCE OAuth',
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

    const callbackCapture = await createAuthorizationCallbackCapture(page, {
      host: started.redirectHost,
      port: started.redirectPort,
      path: started.redirectPath,
      timeoutMs: CODEX_OAUTH_BROWSER_HANDOFF_TIMEOUT_MS,
    })

    try {
      await page.goto(started.authorizationUrl, {
        waitUntil: 'domcontentloaded',
      })
    } catch (error) {
      await callbackCapture.abort()
      await callbackCapture.result.catch(() => undefined)
      throw error
    }

    await sendCodexOAuthMachine(machine, 'starting-oauth', 'context.updated', {
      authorizationUrl: sanitizeUrl(started.authorizationUrl),
      url: sanitizeUrl(page.url()),
      redirectUri: started.redirectUri,
      lastMessage: 'Waiting for Codex OAuth callback or login surface',
    })

    const waitForCallback =
      callbackCapture.result as Promise<CodexOAuthCallbackPayload>
    const nextStep = await Promise.race([
      waitForCallback.then((callback) => ({
        kind: 'callback' as const,
        callback,
      })),
      waitForCodexOAuthLoginSurface(page).then((surface) => ({
        kind: 'surface' as const,
        surface,
      })),
    ])

    if (nextStep.kind === 'surface' && nextStep.surface === 'unknown') {
      throw new Error(
        'Codex OAuth page did not reach a supported login or callback surface.',
      )
    }

    const callback = await resolveCodexOAuthNextStep(
      page,
      machine,
      options,
      started.redirectUri,
      nextStep,
      waitForCallback,
    )
    if (!callback.code) {
      throw new Error(
        'Codex OAuth callback did not include an authorization code.',
      )
    }
    if (callback.state !== started.state) {
      throw new Error('Codex OAuth state mismatch.')
    }

    await sendCodexOAuthMachine(
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

    await sendCodexOAuthMachine(
      machine,
      'persisting-token',
      'codex.oauth.token.exchanged',
      {
        url: sanitizeUrl(page.url()),
        lastMessage: 'Persisting Codex token locally',
      },
    )

    const tokenStorePath = saveCodexToken(token)

    await sendCodexOAuthMachine(
      machine,
      'persisting-token',
      'codex.oauth.token.persisted',
      {
        url: sanitizeUrl(page.url()),
        tokenStorePath,
        lastMessage: 'Stored Codex token locally',
      },
    )

    await sendCodexOAuthMachine(
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

    await sendCodexOAuthMachine(machine, 'creating-channel', 'action.started', {
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
