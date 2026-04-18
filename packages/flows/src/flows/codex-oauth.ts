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
  keepBrowserOpenForHarWhenUnspecified,
  parseBooleanFlag,
  parseNumberFlag,
  sanitizeErrorForOutput,
  type FlowOptions,
} from '../modules/flow-cli/helpers'
import { shareCodexOAuthSessionWithCodeyApp } from '../modules/app-auth/codex-oauth-sharing'
import {
  runSingleFileFlowFromCli,
  type SingleFileFlowDefinition,
} from '../modules/flow-cli/single-file'
import { parseFlowCliArgs } from '../modules/flow-cli/parse-argv'
import {
  resolveStoredChatGPTIdentity,
  type ResolvedChatGPTIdentity,
  type StoredChatGPTIdentitySummary,
} from '../modules/credentials'
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
import { createNodeHarRecorder } from '../modules/authorization/har-recorder'
import {
  clickLoginEntryIfPresent,
  clickPasskeyEntry,
  clickPasswordSubmit,
  clickPasswordTimeoutRetry,
  clickVerificationContinue,
  continueCodexOAuthConsent,
  continueCodexWorkspaceSelection,
  submitLoginEmail,
  type ChatGPTCodexOAuthSurface,
  type ChatGPTPostEmailLoginStep,
  waitForCodexOAuthSurface,
  waitForPasswordInputReady,
  waitForPasskeyEntryReady,
  waitForPostEmailLoginCandidates,
  waitForRetryOrPasskeyEntryCandidates,
  waitForVerificationCode,
  waitForVerificationCodeInputReady,
  typePassword,
  typeVerificationCode,
} from '../modules/chatgpt/shared'
import {
  createVerificationProvider,
  type VerificationProvider,
} from '../modules/verification'
import { loadVirtualPasskeyStore } from '../modules/webauthn'

export type CodexOAuthFlowKind = 'codex-oauth'

export type CodexOAuthFlowState =
  | 'idle'
  | 'starting-oauth'
  | 'login-entry'
  | 'email-step'
  | 'password-step'
  | 'verification-step'
  | 'passkey-step'
  | 'workspace-step'
  | 'consent-step'
  | 'waiting-for-callback'
  | 'retrying'
  | 'add-phone-required'
  | 'exchanging-token'
  | 'persisting-token'
  | 'sharing-session'
  | 'signing-in-admin'
  | 'creating-channel'
  | 'completed'
  | 'failed'

export type CodexOAuthFlowEvent =
  | 'machine.started'
  | 'codex.oauth.started'
  | 'codex.oauth.surface.ready'
  | 'codex.oauth.callback.received'
  | 'codex.oauth.token.exchanged'
  | 'codex.oauth.token.persisted'
  | 'codey.app.sync.started'
  | 'codey.app.sync.completed'
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
  surface?: CodexOAuthLoginSurface
  method?: 'password' | 'passkey' | 'verification'
  storedIdentity?: StoredChatGPTIdentitySummary
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
  email?: string
  redirectUri: string
  tokenStorePath: string
  token: RedactedCodexTokenResult
  codeyApp?: {
    identityId: string
    identityRecordId: string
    sessionRecordId: string
  }
  axonHub?: {
    projectId?: string
    channel: CodexOAuthChannelResult
  }
  apiHarPath?: string
  machine: CodexOAuthFlowSnapshot<CodexOAuthFlowRunResult>
}

export interface CodexOAuthAuthorizeUrlResult {
  pageName: 'codex-oauth-authorize-url'
  url: string
  title: string
  redirectUri: string
  oauthUrl: string
  machine: CodexOAuthFlowSnapshot<CodexOAuthFlowRunResult>
}

export type CodexOAuthFlowRunResult =
  | CodexOAuthFlowResult
  | CodexOAuthAuthorizeUrlResult

type CodexOAuthLoginSurface = Exclude<ChatGPTCodexOAuthSurface, 'unknown'>
type CodexOAuthLoginProgressStep = Extract<
  ChatGPTPostEmailLoginStep,
  'authenticated' | 'password' | 'verification' | 'retry' | 'passkey'
>

interface CodexOAuthSurfaceInput<Result = unknown> {
  surface: CodexOAuthLoginSurface
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

interface CodexOAuthStoredLoginProgress {
  startedAt?: string
  verificationProvider?: VerificationProvider
}

const CODEX_OAUTH_BROWSER_HANDOFF_TIMEOUT_MS = 180000
const CODEX_OAUTH_POST_ENTRY_TIMEOUT_MS = 15000

const codexOAuthEventTargets = {
  'codex.oauth.started': 'starting-oauth',
  'codex.oauth.callback.received': 'exchanging-token',
  'codex.oauth.token.exchanged': 'persisting-token',
  'codex.oauth.token.persisted': 'persisting-token',
  'codey.app.sync.started': 'sharing-session',
  'codey.app.sync.completed': 'sharing-session',
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
  'codex.oauth.callback.received',
  'codex.oauth.token.exchanged',
  'codex.oauth.token.persisted',
  'codey.app.sync.started',
  'codey.app.sync.completed',
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
        priority: 50,
        when: ({ input }) => input.surface === 'workspace',
        target: 'workspace-step',
        actions: assignSurfaceContext('Codex workspace selection ready'),
      },
      {
        priority: 45,
        when: ({ input }) => input.surface === 'consent',
        target: 'consent-step',
        actions: assignSurfaceContext('Codex OAuth consent ready'),
      },
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

export function createCodexOAuthMachine(): CodexOAuthFlowMachine<CodexOAuthFlowRunResult> {
  return createStateMachine<
    CodexOAuthFlowState,
    CodexOAuthFlowContext<CodexOAuthFlowRunResult>,
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
      createCodexOAuthLifecycleFragment<CodexOAuthFlowRunResult>(),
      createCodexOAuthAddPhoneFailureFragment<CodexOAuthFlowRunResult>(),
      createCodexOAuthSurfaceFragment<CodexOAuthFlowRunResult>(),
    ),
  )
}

async function sendCodexOAuthMachine(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  state: CodexOAuthFlowState,
  event: CodexOAuthFlowEvent,
  patch?: Partial<CodexOAuthFlowContext<CodexOAuthFlowRunResult>>,
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

function hasCodeyAppSyncConfig(): boolean {
  const config = getRuntimeConfig()
  return Boolean(
    config.verification?.app?.baseUrl?.trim() || config.app?.baseUrl?.trim(),
  )
}

function hasCompleteAxonHubConfig(): boolean {
  const config = getRuntimeConfig()
  return Boolean(
    config.axonHub?.baseUrl?.trim() &&
    config.axonHub?.email?.trim() &&
    config.axonHub?.password?.trim(),
  )
}

function hasPartialAxonHubConfig(): boolean {
  const config = getRuntimeConfig()
  return Boolean(config.axonHub)
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

type CodexOAuthStep =
  | { kind: 'callback'; callback: CodexOAuthCallbackPayload }
  | { kind: 'callback-navigation' }
  | { kind: 'post-login-step'; step: CodexOAuthLoginProgressStep }
  | { kind: 'surface'; surface: CodexOAuthLoginSurface }

function normalizeCallbackPort(protocol: string, port: string): string {
  if (port) {
    return port
  }

  if (protocol === 'http:') {
    return '80'
  }

  if (protocol === 'https:') {
    return '443'
  }

  return ''
}

function buildCodexOAuthCallbackUrlMatcher(
  redirectUri: string,
): (url: string) => boolean {
  const expected = new URL(redirectUri)
  const expectedPort = normalizeCallbackPort(expected.protocol, expected.port)

  return (url: string) => {
    try {
      const candidate = new URL(url)
      return (
        candidate.protocol === expected.protocol &&
        candidate.hostname === expected.hostname &&
        normalizeCallbackPort(candidate.protocol, candidate.port) ===
          expectedPort &&
        candidate.pathname === expected.pathname
      )
    } catch {
      return false
    }
  }
}

async function waitForCodexOAuthCallbackNavigation(
  page: Page,
  redirectUri: string,
  timeoutMs: number,
): Promise<boolean> {
  const matchesCallbackUrl = buildCodexOAuthCallbackUrlMatcher(redirectUri)

  if (matchesCallbackUrl(page.url())) {
    return true
  }

  const waitForURL = (
    page as Page & {
      waitForURL?: (
        predicate: (url: URL) => boolean,
        options?: { timeout?: number },
      ) => Promise<unknown>
    }
  ).waitForURL

  if (typeof waitForURL !== 'function') {
    return false
  }

  try {
    await waitForURL.call(page, (url) => matchesCallbackUrl(String(url)), {
      timeout: timeoutMs,
    })
    return true
  } catch {
    return matchesCallbackUrl(page.url())
  }
}

async function waitForCodexOAuthStep(
  page: Page,
  waitForCallback: Promise<CodexOAuthCallbackPayload>,
  redirectUri: string,
  timeoutMs = CODEX_OAUTH_BROWSER_HANDOFF_TIMEOUT_MS,
  getResolvedCallback?: () => CodexOAuthCallbackPayload | undefined,
): Promise<CodexOAuthStep> {
  const resolvedCallback = getResolvedCallback?.()
  if (resolvedCallback) {
    return {
      kind: 'callback',
      callback: resolvedCallback,
    }
  }

  const waitForSurface = waitForCodexOAuthSurface(page, timeoutMs).then(
    (surface) => {
      if (surface === 'unknown') {
        throw new Error(
          'Codex OAuth page did not reach a supported login, workspace, or callback surface.',
        )
      }

      return {
        kind: 'surface' as const,
        surface,
      }
    },
  )

  const waitForCallbackNavigation = new Promise<CodexOAuthStep>((resolve) => {
    void waitForCodexOAuthCallbackNavigation(page, redirectUri, timeoutMs).then(
      (matched) => {
        if (matched) {
          resolve({
            kind: 'callback-navigation',
          })
        }
      },
    )
  })

  const nextStep = await Promise.race([
    waitForCallback.then(
      (callback) =>
        ({
          kind: 'callback' as const,
          callback,
        }) satisfies CodexOAuthStep,
    ),
    waitForCallbackNavigation,
    waitForSurface,
  ])

  return nextStep
}

async function waitForCodexOAuthLoginProgressStep(
  page: Page,
  waitForCallback: Promise<CodexOAuthCallbackPayload>,
  redirectUri: string,
  timeoutMs = CODEX_OAUTH_POST_ENTRY_TIMEOUT_MS,
  getResolvedCallback?: () => CodexOAuthCallbackPayload | undefined,
): Promise<CodexOAuthStep> {
  const resolvedCallback = getResolvedCallback?.()
  if (resolvedCallback) {
    return {
      kind: 'callback',
      callback: resolvedCallback,
    }
  }

  const waitForSurface = waitForCodexOAuthSurface(page, timeoutMs).then(
    (surface) => {
      if (surface === 'unknown') {
        throw new Error(
          'Codex OAuth page did not reach a supported login, workspace, consent, or callback surface.',
        )
      }

      return {
        kind: 'surface' as const,
        surface,
      }
    },
  )

  const waitForCallbackNavigation = new Promise<CodexOAuthStep>((resolve) => {
    void waitForCodexOAuthCallbackNavigation(page, redirectUri, timeoutMs).then(
      (matched) => {
        if (matched) {
          resolve({
            kind: 'callback-navigation',
          })
        }
      },
    )
  })

  const waitForPostLoginStep = new Promise<CodexOAuthStep>((resolve) => {
    void waitForPostEmailLoginCandidates(page, timeoutMs).then((candidates) => {
      const step = candidates[0]
      if (!step) {
        return
      }

      resolve({
        kind: 'post-login-step',
        step,
      })
    })
  })

  return Promise.race([
    waitForCallback.then(
      (callback) =>
        ({
          kind: 'callback' as const,
          callback,
        }) satisfies CodexOAuthStep,
    ),
    waitForCallbackNavigation,
    waitForPostLoginStep,
    waitForSurface,
  ])
}

function buildCodexOAuthRetryCallbacks(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
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
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
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

function resolveCodexWorkspaceIndex(options: FlowOptions): number {
  const requestedWorkspaceIndex = parseNumberFlag(options.workspaceIndex, 1)

  if (
    requestedWorkspaceIndex == null ||
    !Number.isInteger(requestedWorkspaceIndex) ||
    requestedWorkspaceIndex < 1
  ) {
    throw new Error(
      'The Codex OAuth workspace index must be a positive 1-based integer.',
    )
  }

  return requestedWorkspaceIndex
}

async function completeCodexOAuthWorkspaceSelection(
  page: Page,
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
  redirectUri: string,
): Promise<void> {
  const workspaceIndex = resolveCodexWorkspaceIndex(options)

  await sendCodexOAuthMachine(machine, 'workspace-step', 'context.updated', {
    url: sanitizeUrl(page.url()),
    redirectUri,
    lastMessage: `Selecting Codex workspace #${workspaceIndex}`,
  })

  const selection = await continueCodexWorkspaceSelection(page, workspaceIndex)

  await sendCodexOAuthMachine(
    machine,
    'waiting-for-callback',
    'context.updated',
    {
      url: sanitizeUrl(page.url()),
      redirectUri,
      lastMessage: `Selected Codex workspace #${selection.selectedWorkspaceIndex}; waiting for Codex OAuth callback`,
    },
  )
}

function resolveCodexOAuthStoredIdentitySelection(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
): {
  id?: string
  email?: string
} {
  const snapshot = machine.getSnapshot().context
  const identityIdCandidates = [
    snapshot.storedIdentity?.id,
    typeof options.identityId === 'string' ? options.identityId : undefined,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
  const emailCandidates = [
    snapshot.email,
    snapshot.storedIdentity?.email,
    typeof options.email === 'string' ? options.email : undefined,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))

  return {
    id: identityIdCandidates[0],
    email: emailCandidates[0],
  }
}

function requireCodexOAuthStoredLoginIdentity(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
): ResolvedChatGPTIdentity {
  const selected = resolveCodexOAuthStoredIdentitySelection(machine, options)
  if (!selected.id && !selected.email) {
    throw new Error(
      'Codex OAuth login continuation requires a stored ChatGPT identity. Pass --identityId or --email.',
    )
  }

  return resolveStoredChatGPTIdentity(selected)
}

async function submitCodexOAuthStoredLoginEmail(
  page: Page,
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
  redirectUri: string,
  progress: CodexOAuthStoredLoginProgress,
): Promise<StoredChatGPTIdentitySummary> {
  const stored = requireCodexOAuthStoredLoginIdentity(machine, options)

  await sendCodexOAuthMachine(machine, 'email-step', 'context.updated', {
    url: sanitizeUrl(page.url()),
    redirectUri,
    email: stored.identity.email,
    storedIdentity: stored.summary,
    lastMessage: 'ChatGPT login required; submitting stored identity email',
  })

  progress.startedAt = new Date().toISOString()

  await submitLoginEmail(page, stored.identity.email, {
    onRetry: buildCodexOAuthRetryCallbacks(machine, page, redirectUri)
      .onEmailRetry,
  })

  return stored.summary
}

async function submitCodexOAuthStoredPassword(
  page: Page,
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
  redirectUri: string,
): Promise<StoredChatGPTIdentitySummary> {
  const stored = requireCodexOAuthStoredLoginIdentity(machine, options)

  await sendCodexOAuthMachine(machine, 'password-step', 'context.updated', {
    url: sanitizeUrl(page.url()),
    redirectUri,
    email: stored.identity.email,
    storedIdentity: stored.summary,
    lastMessage: 'Submitting stored ChatGPT password',
  })

  const passwordReady = await waitForPasswordInputReady(page, 10000)
  if (!passwordReady) {
    throw new Error('ChatGPT password step did not become ready.')
  }

  const typed = await typePassword(page, stored.identity.password)
  if (!typed) {
    throw new Error(
      'ChatGPT password field was visible but could not be typed into.',
    )
  }

  await clickPasswordSubmit(page)

  return stored.summary
}

async function submitCodexOAuthStoredVerification(
  page: Page,
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
  redirectUri: string,
  progress: CodexOAuthStoredLoginProgress,
): Promise<StoredChatGPTIdentitySummary> {
  const stored = requireCodexOAuthStoredLoginIdentity(machine, options)

  await sendCodexOAuthMachine(
    machine,
    'verification-step',
    'context.updated',
    {
      url: sanitizeUrl(page.url()),
      redirectUri,
      email: stored.identity.email,
      storedIdentity: stored.summary,
      lastMessage: 'Submitting ChatGPT verification code',
    },
  )

  const verificationReady = await waitForVerificationCodeInputReady(page, 10000)
  if (!verificationReady) {
    throw new Error('ChatGPT verification code input did not become ready.')
  }

  progress.startedAt ??= new Date().toISOString()
  progress.verificationProvider ??= createVerificationProvider(getRuntimeConfig())

  const verificationTimeoutMs =
    parseNumberFlag(options.verificationTimeoutMs, 180000) ?? 180000
  const pollIntervalMs = parseNumberFlag(options.pollIntervalMs, 5000) ?? 5000
  const code = await waitForVerificationCode({
    verificationProvider: progress.verificationProvider,
    email: stored.identity.email,
    startedAt: progress.startedAt,
    timeoutMs: verificationTimeoutMs,
    pollIntervalMs,
  })

  await typeVerificationCode(page, code)
  await clickVerificationContinue(page)

  return stored.summary
}

async function submitCodexOAuthStoredPasskey(
  page: Page,
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
  redirectUri: string,
): Promise<StoredChatGPTIdentitySummary> {
  const stored = requireCodexOAuthStoredLoginIdentity(machine, options)
  if (!stored.identity.passkeyStore?.credentials.length) {
    throw new Error(
      `Stored identity ${stored.identity.email} does not contain a passkey credential, but ChatGPT requested a passkey step.`,
    )
  }

  await sendCodexOAuthMachine(machine, 'passkey-step', 'context.updated', {
    url: sanitizeUrl(page.url()),
    redirectUri,
    email: stored.identity.email,
    storedIdentity: stored.summary,
    lastMessage: 'Triggering stored ChatGPT passkey login',
  })

  await loadVirtualPasskeyStore(page, stored.identity.passkeyStore)

  let triggerCandidates = await waitForRetryOrPasskeyEntryCandidates(
    page,
    10000,
  )
  if (
    triggerCandidates.length === 0 &&
    (await waitForPasskeyEntryReady(page, 2000))
  ) {
    triggerCandidates = ['passkey']
  }

  const retryCallbacks = buildCodexOAuthRetryCallbacks(machine, page, redirectUri)

  if (triggerCandidates.includes('retry')) {
    if (!(await clickPasswordTimeoutRetry(page))) {
      throw new Error(
        'Passkey retry button became visible but could not be clicked.',
      )
    }
    await retryCallbacks.onPasskeyRetry?.(1, 'retry')
  } else if (triggerCandidates.includes('passkey')) {
    if (!(await clickPasskeyEntry(page))) {
      throw new Error(
        'Passkey entry button became visible but could not be clicked.',
      )
    }
  } else {
    throw new Error(
      'ChatGPT passkey step did not expose a retry or passkey entry action.',
    )
  }

  return stored.summary
}

function resolveCodexOAuthStoredIdentity(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
): StoredChatGPTIdentitySummary | undefined {
  const snapshot = machine.getSnapshot().context
  if (snapshot.storedIdentity) {
    return snapshot.storedIdentity
  }

  const selected = resolveCodexOAuthStoredIdentitySelection(machine, options)
  if (!selected.id && !selected.email) {
    return undefined
  }

  try {
    return resolveStoredChatGPTIdentity(selected).summary
  } catch {
    return undefined
  }
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

async function resolveCodexOAuthNextStep(
  page: Page,
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
  redirectUri: string,
  progress: CodexOAuthStoredLoginProgress,
  nextStep: CodexOAuthStep,
  waitForCallback: Promise<CodexOAuthCallbackPayload>,
  getResolvedCallback: () => CodexOAuthCallbackPayload | undefined,
): Promise<CodexOAuthCallbackPayload> {
  let currentStep = nextStep

  for (let transitionCount = 0; transitionCount < 12; transitionCount += 1) {
    currentStep = (
      await runGuardedBranches<
        CodexOAuthFlowContext<CodexOAuthFlowRunResult>,
        CodexOAuthStep,
        CodexOAuthStep,
        | 'callback'
        | 'callback-navigation'
        | 'authenticated'
        | 'login'
        | 'email'
        | 'password'
        | 'verification'
        | 'retry'
        | 'passkey'
        | 'workspace'
        | 'consent'
      >(
        [
          {
            branch: 'callback' as const,
            priority: 70,
            guard: ({ input }) => input.kind === 'callback',
            run: async ({ input }) => {
              if (input.kind !== 'callback') {
                throw new Error('Codex OAuth callback was not ready yet.')
              }
              return input
            },
          },
          {
            branch: 'callback-navigation' as const,
            priority: 65,
            guard: ({ input }) => input.kind === 'callback-navigation',
            run: async () => ({
              kind: 'callback' as const,
              callback: await waitForCallback,
            }),
          },
          {
            branch: 'workspace' as const,
            priority: 60,
            guard: ({ input }) =>
              input.kind === 'surface' && input.surface === 'workspace',
            run: async () => {
              await sendCodexOAuthSurfaceReady(
                machine,
                page,
                'workspace',
                redirectUri,
              )
              await completeCodexOAuthWorkspaceSelection(
                page,
                machine,
                options,
                redirectUri,
              )
              return waitForCodexOAuthStep(
                page,
                waitForCallback,
                redirectUri,
                CODEX_OAUTH_POST_ENTRY_TIMEOUT_MS,
                getResolvedCallback,
              )
            },
          },
          {
            branch: 'consent' as const,
            priority: 55,
            guard: ({ input }) =>
              input.kind === 'surface' && input.surface === 'consent',
            run: async () => {
              await sendCodexOAuthSurfaceReady(
                machine,
                page,
                'consent',
                redirectUri,
              )
              try {
                await continueCodexOAuthConsent(page)
              } catch (error) {
                throw wrapRecoverableCodexOAuthBranchError('consent', error)
              }

              return waitForCodexOAuthStep(
                page,
                waitForCallback,
                redirectUri,
                CODEX_OAUTH_POST_ENTRY_TIMEOUT_MS,
                getResolvedCallback,
              )
            },
          },
          {
            branch: 'authenticated' as const,
            priority: 50,
            guard: ({ input }) =>
              (input.kind === 'surface' &&
                input.surface === 'authenticated') ||
              (input.kind === 'post-login-step' &&
                input.step === 'authenticated'),
            run: async () => {
              if (
                currentStep.kind === 'surface' &&
                currentStep.surface === 'authenticated'
              ) {
                await sendCodexOAuthSurfaceReady(
                  machine,
                  page,
                  'authenticated',
                  redirectUri,
                )
              } else {
                await sendCodexOAuthMachine(
                  machine,
                  'waiting-for-callback',
                  'context.updated',
                  {
                    url: sanitizeUrl(page.url()),
                    redirectUri,
                    lastMessage:
                      'OpenAI session detected after stored login step; waiting for Codex OAuth callback or consent',
                  },
                )
              }

              return waitForCodexOAuthStep(
                page,
                waitForCallback,
                redirectUri,
                CODEX_OAUTH_POST_ENTRY_TIMEOUT_MS,
                getResolvedCallback,
              )
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

              const postLoginStep = await waitForCodexOAuthStep(
                page,
                waitForCallback,
                redirectUri,
                CODEX_OAUTH_POST_ENTRY_TIMEOUT_MS,
                getResolvedCallback,
              )
              if (
                postLoginStep.kind === 'surface' &&
                postLoginStep.surface === 'login'
              ) {
                throw new GuardedBranchError(
                  'login',
                  'OpenAI login entry did not advance to an authenticated, workspace, email, or passkey surface.',
                )
              }
              return postLoginStep
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
              await submitCodexOAuthStoredLoginEmail(
                page,
                machine,
                options,
                redirectUri,
                progress,
              )
              return waitForCodexOAuthLoginProgressStep(
                page,
                waitForCallback,
                redirectUri,
                CODEX_OAUTH_POST_ENTRY_TIMEOUT_MS,
                getResolvedCallback,
              )
            },
          },
          {
            branch: 'password' as const,
            priority: 25,
            guard: ({ input }) =>
              input.kind === 'post-login-step' && input.step === 'password',
            run: async () => {
              await submitCodexOAuthStoredPassword(
                page,
                machine,
                options,
                redirectUri,
              )
              return waitForCodexOAuthLoginProgressStep(
                page,
                waitForCallback,
                redirectUri,
                CODEX_OAUTH_POST_ENTRY_TIMEOUT_MS,
                getResolvedCallback,
              )
            },
          },
          {
            branch: 'verification' as const,
            priority: 24,
            guard: ({ input }) =>
              input.kind === 'post-login-step' &&
              input.step === 'verification',
            run: async () => {
              await submitCodexOAuthStoredVerification(
                page,
                machine,
                options,
                redirectUri,
                progress,
              )
              return waitForCodexOAuthLoginProgressStep(
                page,
                waitForCallback,
                redirectUri,
                CODEX_OAUTH_POST_ENTRY_TIMEOUT_MS,
                getResolvedCallback,
              )
            },
          },
          {
            branch: 'retry' as const,
            priority: 23,
            guard: ({ input }) =>
              input.kind === 'post-login-step' && input.step === 'retry',
            run: async () => {
              await machine.send('codex.oauth.retry.requested', {
                reason: 'post-login:retry',
                message:
                  'ChatGPT login returned to the email step; retrying stored identity email submission',
                patch: {
                  url: sanitizeUrl(page.url()),
                  redirectUri,
                },
              })
              await submitCodexOAuthStoredLoginEmail(
                page,
                machine,
                options,
                redirectUri,
                progress,
              )
              return waitForCodexOAuthLoginProgressStep(
                page,
                waitForCallback,
                redirectUri,
                CODEX_OAUTH_POST_ENTRY_TIMEOUT_MS,
                getResolvedCallback,
              )
            },
          },
          {
            branch: 'passkey' as const,
            priority: 20,
            guard: ({ input }) =>
              (input.kind === 'surface' && input.surface === 'passkey') ||
              (input.kind === 'post-login-step' && input.step === 'passkey'),
            run: async () => {
              if (
                currentStep.kind === 'surface' &&
                currentStep.surface === 'passkey'
              ) {
                await sendCodexOAuthSurfaceReady(
                  machine,
                  page,
                  'passkey',
                  redirectUri,
                )
              }
              await submitCodexOAuthStoredPasskey(
                page,
                machine,
                options,
                redirectUri,
              )
              return waitForCodexOAuthLoginProgressStep(
                page,
                waitForCallback,
                redirectUri,
                CODEX_OAUTH_BROWSER_HANDOFF_TIMEOUT_MS,
                getResolvedCallback,
              )
            },
          },
        ],
        {
          context: machine.getSnapshot().context,
          input: currentStep,
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

    if (currentStep.kind === 'callback') {
      return currentStep.callback
    }
  }

  throw new Error(
    'Codex OAuth did not reach a callback after multiple surface transitions.',
  )
}

export async function runCodexOAuthFlow(
  page: Page,
  options: FlowOptions = {},
): Promise<CodexOAuthFlowRunResult> {
  const config = getRuntimeConfig()
  const codexConfig = getRequiredCodexConfig()
  const apiHarRecorder = createNodeHarRecorder('flow-codex-oauth-api')
  const machine = createCodexOAuthMachine()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )
  const channelName = resolveChannelName(options)
  const projectId = resolveProjectId(options)
  const authorizeUrlOnly = parseBooleanFlag(options.authorizeUrlOnly, false)

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

    if (authorizeUrlOnly) {
      const result = {
        pageName: 'codex-oauth-authorize-url' as const,
        url: sanitizeUrl(started.authorizationUrl),
        title: 'Codex OAuth authorization URL generated',
        redirectUri: started.redirectUri,
        oauthUrl: started.authorizationUrl,
        machine:
          undefined as unknown as CodexOAuthFlowSnapshot<CodexOAuthFlowRunResult>,
      }

      const snapshot = machine.succeed('completed', {
        event: 'codex.oauth.completed',
        patch: {
          url: result.url,
          title: result.title,
          redirectUri: started.redirectUri,
          authorizationUrl: result.oauthUrl,
          channelName,
          projectId,
          lastMessage:
            'Generated Codex OAuth URL and exited before browser login',
        },
      })
      result.machine = snapshot
      return result
    }

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
      lastMessage:
        'Waiting for Codex OAuth callback, login, or workspace surface',
    })

    let resolvedCallback: CodexOAuthCallbackPayload | undefined
    const waitForCallback = (
      callbackCapture.result as Promise<CodexOAuthCallbackPayload>
    ).then((callback) => {
      resolvedCallback = callback
      return callback
    })
    const nextStep = await waitForCodexOAuthStep(
      page,
      waitForCallback,
      started.redirectUri,
      CODEX_OAUTH_BROWSER_HANDOFF_TIMEOUT_MS,
      () => resolvedCallback,
    )

    const callback = await resolveCodexOAuthNextStep(
      page,
      machine,
      options,
      started.redirectUri,
      {},
      nextStep,
      waitForCallback,
      () => resolvedCallback,
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
      harRecorder: apiHarRecorder,
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

    const storedIdentity = resolveCodexOAuthStoredIdentity(machine, options)
    let codeyApp:
      | Awaited<ReturnType<typeof shareCodexOAuthSessionWithCodeyApp>>
      | undefined

    if (hasCodeyAppSyncConfig()) {
      if (storedIdentity) {
        await sendCodexOAuthMachine(
          machine,
          'sharing-session',
          'codey.app.sync.started',
          {
            url: sanitizeUrl(page.url()),
            tokenStorePath,
            email: storedIdentity.email,
            storedIdentity,
            lastMessage: 'Sharing Codex OAuth session with Codey app',
          },
        )

        codeyApp =
          (await shareCodexOAuthSessionWithCodeyApp({
            identity: storedIdentity,
            token,
            clientId: codexConfig.clientId,
            redirectUri: started.redirectUri,
            tokenStorePath,
          })) || undefined

        await sendCodexOAuthMachine(
          machine,
          'sharing-session',
          'codey.app.sync.completed',
          {
            url: sanitizeUrl(page.url()),
            tokenStorePath,
            email: storedIdentity.email,
            storedIdentity,
            lastMessage: 'Shared Codex OAuth session with Codey app',
          },
        )
      } else {
        await sendCodexOAuthMachine(
          machine,
          'persisting-token',
          'context.updated',
          {
            url: sanitizeUrl(page.url()),
            tokenStorePath,
            lastMessage:
              'Skipped Codey app sync because no stored ChatGPT identity was selected',
          },
        )
      }
    }

    let axonHub:
      | {
          projectId?: string
          channel: CodexOAuthChannelResult
        }
      | undefined

    if (hasCompleteAxonHubConfig()) {
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

      const axonHubClient = new AxonHubAdminClient(
        {
          ...config.axonHub,
          projectId,
        },
        {
          harRecorder: apiHarRecorder,
        },
      )
      const adminSession = await axonHubClient.signIn()

      await sendCodexOAuthMachine(
        machine,
        'creating-channel',
        'action.started',
        {
          url: sanitizeUrl(page.url()),
          tokenStorePath,
          lastMessage: 'Creating Codex channel in AxonHub',
        },
      )

      const channelInput = buildCreateChannelInput(token, options)
      const createdChannel = await axonHubClient.createChannel(
        adminSession.token,
        channelInput,
      )

      axonHub = {
        projectId,
        channel: redactChannelCredentials(channelInput, createdChannel),
      }
    } else if (hasPartialAxonHubConfig()) {
      await sendCodexOAuthMachine(
        machine,
        'persisting-token',
        'context.updated',
        {
          url: sanitizeUrl(page.url()),
          tokenStorePath,
          lastMessage:
            'Skipping AxonHub channel creation because the admin config is incomplete',
        },
      )
    }

    const title = await page.title()
    const email = machine.getSnapshot().context.email || storedIdentity?.email
    const result = {
      pageName: 'codex-oauth' as const,
      url: sanitizeUrl(page.url()),
      title,
      email,
      redirectUri: started.redirectUri,
      tokenStorePath,
      token: redactToken(token),
      codeyApp: codeyApp || undefined,
      axonHub,
      apiHarPath: apiHarRecorder?.path,
      machine:
        undefined as unknown as CodexOAuthFlowSnapshot<CodexOAuthFlowRunResult>,
    }

    const snapshot = machine.succeed('completed', {
      event: 'codex.oauth.completed',
      patch: {
        url: result.url,
        title: result.title,
        email: result.email,
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
    apiHarRecorder?.flush()
    detachProgress()
  }
}

export const codexOAuthFlow: SingleFileFlowDefinition<
  FlowOptions,
  CodexOAuthFlowRunResult
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
    keepBrowserOpenForHarWhenUnspecified(
      parseFlowCliArgs(process.argv.slice(2)),
    ),
  )
}
