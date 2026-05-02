import type { APIRequestContext, Page } from 'patchright'
import { pathToFileURL } from 'url'
import { getRuntimeConfig } from '../config'
import {
  assignContextFromInput,
  composeStateMachineConfig,
  createGuardedCaseTransitions,
  createOpenAIAddPhoneFailureFragment,
  createStateMachine,
  declareStateMachineStates,
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
  parseBooleanFlag,
  parseNumberFlag,
  printFlowArtifactPath,
  sanitizeErrorForOutput,
  type FlowOptions,
} from '../modules/flow-cli/helpers'
import { shareCodexOAuthSessionWithCodeyApp } from '../modules/app-auth/codex-oauth-sharing'
import { resolveAssociatedManagedWorkspaceFromCodeyApp } from '../modules/app-auth/workspaces'
import {
  runSingleFileFlowFromCommandLine,
  type SingleFileFlowDefinition,
} from '../modules/flow-cli/single-file'
import { reportChatGPTAccountDeactivationToCodeyApp } from '../modules/chatgpt/account-deactivation'
import {
  resolveStoredChatGPTIdentity,
  type ResolvedChatGPTIdentity,
  type StoredChatGPTIdentitySummary,
} from '../modules/credentials'
import {
  exchangeCodexAuthorizationCode,
  startCodexAuthorization,
  type CodexTokenResponse,
} from '../modules/authorization/codex-client'
import { createAuthorizationCallbackCapture } from '../modules/authorization/codex-authorization'
import { createNodeHarRecorder } from '../modules/authorization/har-recorder'
import {
  clickLoginEntryIfPresent,
  completePasswordOrVerificationLoginFallback,
  continueCodexOAuthConsent,
  continueCodexOrganizationSelection,
  continueCodexWorkspaceSelection,
  submitLoginEmail,
  type ChatGPTCodexOAuthSurface,
  type ChatGPTPostEmailLoginStep,
  waitForCodexOAuthSurfaceCandidates,
  waitForPasswordInputReady,
  waitForPostEmailLoginCandidates,
  waitForVerificationCodeInputReady,
} from '../modules/chatgpt/shared'
import {
  createVerificationProvider,
  type VerificationProvider,
} from '../modules/verification'
import { isChatGPTAccountDeactivatedError } from '../modules/chatgpt/errors'
import { createFlowLifecycleFragment } from './machine-fragments'

export type CodexOAuthFlowKind = 'codex-oauth'

export type CodexOAuthFlowState =
  | 'idle'
  | 'starting-oauth'
  | 'login-entry'
  | 'email-step'
  | 'password-step'
  | 'verification-step'
  | 'workspace-step'
  | 'organization-step'
  | 'consent-step'
  | 'waiting-for-callback'
  | 'retrying'
  | 'add-phone-required'
  | 'exchanging-token'
  | 'persisting-token'
  | 'sharing-session'
  | 'completed'
  | 'failed'

export type CodexOAuthFlowEvent =
  | 'machine.started'
  | 'codex.oauth.started'
  | 'codex.oauth.surface.ready'
  | 'codex.oauth.callback.waiting'
  | 'codex.oauth.email.submitting'
  | 'codex.oauth.password.submitting'
  | 'codex.oauth.password.submitted'
  | 'codex.oauth.verification.submitting'
  | 'codex.oauth.verification.submitted'
  | 'codex.oauth.callback.received'
  | 'codex.oauth.token.exchanged'
  | 'codex.oauth.token.persisted'
  | 'codey.app.sync.started'
  | 'codey.app.sync.completed'
  | 'codex.oauth.retry.requested'
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

function resolvePageRequestContext(page: Page): APIRequestContext | undefined {
  if (typeof page.context !== 'function') {
    return undefined
  }

  return page.context().request
}

export interface CodexOAuthFlowContext<Result = unknown> {
  kind: CodexOAuthFlowKind
  url?: string
  title?: string
  email?: string
  redirectUri?: string
  authorizationUrl?: string
  tokenStorePath?: string
  surface?: CodexOAuthLoginSurface
  method?: 'password' | 'verification'
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
  sub2api?: {
    accountId: number
    action: 'created' | 'updated'
    email: string
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

type CodexOAuthSurfaceCandidate = Exclude<ChatGPTCodexOAuthSurface, 'unknown'>
type CodexOAuthLoginSurface = CodexOAuthSurfaceCandidate
type CodexOAuthLoginProgressStep = Exclude<ChatGPTPostEmailLoginStep, 'unknown'>

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
  'codex.oauth.callback.waiting': 'waiting-for-callback',
  'codex.oauth.email.submitting': 'email-step',
  'codex.oauth.password.submitting': 'password-step',
  'codex.oauth.password.submitted': 'password-step',
  'codex.oauth.verification.submitting': 'verification-step',
  'codex.oauth.verification.submitted': 'verification-step',
  'codex.oauth.callback.received': 'exchanging-token',
  'codex.oauth.token.exchanged': 'persisting-token',
  'codex.oauth.token.persisted': 'persisting-token',
  'codey.app.sync.started': 'sharing-session',
  'codey.app.sync.completed': 'sharing-session',
} as const satisfies Partial<Record<CodexOAuthFlowEvent, CodexOAuthFlowState>>

const codexOAuthMutableContextEvents = [
  'context.updated',
  'action.started',
  'action.finished',
] as const satisfies CodexOAuthFlowEvent[]

const codexOAuthAddPhoneGuardEvents = [
  'codex.oauth.started',
  'codex.oauth.surface.ready',
  'codex.oauth.callback.waiting',
  'codex.oauth.email.submitting',
  'codex.oauth.password.submitting',
  'codex.oauth.password.submitted',
  'codex.oauth.verification.submitting',
  'codex.oauth.verification.submitted',
  'codex.oauth.callback.received',
  'codex.oauth.token.exchanged',
  'codex.oauth.token.persisted',
  'codey.app.sync.started',
  'codey.app.sync.completed',
  'codex.oauth.retry.requested',
  ...codexOAuthMutableContextEvents,
] as const satisfies CodexOAuthFlowEvent[]

const codexOAuthStates = [
  'idle',
  'starting-oauth',
  'login-entry',
  'email-step',
  'password-step',
  'verification-step',
  'workspace-step',
  'organization-step',
  'consent-step',
  'waiting-for-callback',
  'retrying',
  'add-phone-required',
  'exchanging-token',
  'persisting-token',
  'sharing-session',
  'completed',
  'failed',
] as const satisfies readonly CodexOAuthFlowState[]

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
        when: ({ input }) => input.surface === 'organization',
        target: 'organization-step',
        actions: assignSurfaceContext('Codex API organization selection ready'),
      },
      {
        priority: 44,
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
    ],
  })
}

function createCodexOAuthLifecycleFragment<Result>() {
  return createFlowLifecycleFragment<
    CodexOAuthFlowState,
    CodexOAuthFlowContext<Result>,
    CodexOAuthFlowEvent
  >({
    eventTargets: codexOAuthEventTargets,
    mutableContextEvents: codexOAuthMutableContextEvents,
    retryEvent: 'codex.oauth.retry.requested',
    retryTarget: 'retrying',
    defaultRetryMessage: 'Retrying Codex OAuth login handoff',
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
        states: declareStateMachineStates<
          CodexOAuthFlowState,
          CodexOAuthFlowContext<CodexOAuthFlowRunResult>,
          CodexOAuthFlowEvent
        >(codexOAuthStates),
      },
      createCodexOAuthLifecycleFragment<CodexOAuthFlowRunResult>(),
      createCodexOAuthAddPhoneFailureFragment<CodexOAuthFlowRunResult>(),
      createCodexOAuthSurfaceFragment<CodexOAuthFlowRunResult>(),
    ),
  )
}

async function sendCodexOAuthMachine(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  event: CodexOAuthFlowEvent,
  patch?: Partial<CodexOAuthFlowContext<CodexOAuthFlowRunResult>>,
): Promise<void> {
  await machine.send(event, {
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

function normalizeCodexOAuthIdentityId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeCodexOAuthEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  return normalized || undefined
}

function hasCodeyAppSyncConfig(): boolean {
  const config = getRuntimeConfig()
  return Boolean(
    config.verification?.app?.baseUrl?.trim() || config.app?.baseUrl?.trim(),
  )
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

type CodexOAuthStep =
  | { kind: 'callback'; callback: CodexOAuthCallbackPayload }
  | { kind: 'callback-navigation' }
  | {
      kind: 'post-login-candidates'
      candidates: CodexOAuthLoginProgressStep[]
    }
  | {
      kind: 'surface-candidates'
      candidates: CodexOAuthSurfaceCandidate[]
    }

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

  const waitForSurface = waitForCodexOAuthSurfaceCandidates(
    page,
    timeoutMs,
  ).then((candidates) => {
    if (candidates.length === 0) {
      throw new Error(
        'Codex OAuth page did not reach a supported login, workspace, or callback surface.',
      )
    }

    return {
      kind: 'surface-candidates' as const,
      candidates,
    }
  })

  const waitForCallbackNavigation = new Promise<CodexOAuthStep>((resolve) => {
    void waitForCodexOAuthCallbackNavigation(page, redirectUri, timeoutMs)
      .then((matched) => {
        if (matched) {
          resolve({
            kind: 'callback-navigation',
          })
        }
      })
      .catch(() => undefined)
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

  const waitForSurface = waitForCodexOAuthSurfaceCandidates(
    page,
    timeoutMs,
  ).then((candidates) => {
    if (candidates.length === 0) {
      throw new Error(
        'Codex OAuth page did not reach a supported login, workspace, consent, or callback surface.',
      )
    }

    return {
      kind: 'surface-candidates' as const,
      candidates,
    }
  })

  const waitForCallbackNavigation = new Promise<CodexOAuthStep>((resolve) => {
    void waitForCodexOAuthCallbackNavigation(page, redirectUri, timeoutMs)
      .then((matched) => {
        if (matched) {
          resolve({
            kind: 'callback-navigation',
          })
        }
      })
      .catch(() => undefined)
  })

  const waitForPostLoginStep = new Promise<CodexOAuthStep>((resolve) => {
    void waitForPostEmailLoginCandidates(page, timeoutMs)
      .then((candidates) => {
        if (candidates.length === 0) {
          return
        }

        resolve({
          kind: 'post-login-candidates',
          candidates,
        })
      })
      .catch(() => undefined)
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

function hasExplicitCodexWorkspaceIndex(options: FlowOptions): boolean {
  if (options.workspaceIndex === undefined || options.workspaceIndex === null) {
    return false
  }

  return String(options.workspaceIndex).trim().length > 0
}

function resolveExplicitCodexWorkspaceId(
  options: FlowOptions,
): string | undefined {
  if (typeof options.workspaceId !== 'string') {
    return undefined
  }

  const workspaceId = options.workspaceId.trim()
  return workspaceId || undefined
}

async function resolveCodexOAuthAssociatedWorkspace(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
) {
  const storedIdentity = await resolveCodexOAuthStoredIdentity(machine, options)
  if (!storedIdentity) {
    return undefined
  }

  try {
    return (
      (await resolveAssociatedManagedWorkspaceFromCodeyApp({
        identityId: storedIdentity.id,
        email: storedIdentity.email,
      })) || undefined
    )
  } catch {
    return undefined
  }
}

async function resolvePreferredCodexWorkspaceId(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
): Promise<string | undefined> {
  if (hasExplicitCodexWorkspaceIndex(options)) {
    return undefined
  }

  const explicitWorkspaceId = resolveExplicitCodexWorkspaceId(options)
  if (explicitWorkspaceId) {
    return explicitWorkspaceId
  }

  return (await resolveCodexOAuthAssociatedWorkspace(machine, options))
    ?.workspaceId
}

async function completeCodexOAuthWorkspaceSelection(
  page: Page,
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
  redirectUri: string,
  preferredWorkspaceId?: string,
): Promise<string | undefined> {
  const workspaceIndex = resolveCodexWorkspaceIndex(options)

  await sendCodexOAuthMachine(machine, 'context.updated', {
    url: sanitizeUrl(page.url()),
    redirectUri,
    lastMessage: preferredWorkspaceId
      ? `Selecting Codex workspace ${preferredWorkspaceId}`
      : `Selecting Codex workspace #${workspaceIndex}`,
  })

  const selection = await continueCodexWorkspaceSelection(
    page,
    workspaceIndex,
    preferredWorkspaceId,
  )

  const selectionMessage =
    preferredWorkspaceId &&
    selection.selectionStrategy === 'workspace_id' &&
    selection.selectedWorkspaceId
      ? `Selected Codex workspace ${selection.selectedWorkspaceId}; waiting for Codex OAuth callback`
      : preferredWorkspaceId
        ? `Preferred Codex workspace ${preferredWorkspaceId} was unavailable; selected workspace #${selection.selectedWorkspaceIndex} instead and waiting for Codex OAuth callback`
        : `Selected Codex workspace #${selection.selectedWorkspaceIndex}; waiting for Codex OAuth callback`

  await sendCodexOAuthMachine(machine, 'codex.oauth.callback.waiting', {
    url: sanitizeUrl(page.url()),
    redirectUri,
    lastMessage: selectionMessage,
  })

  return selection.selectedWorkspaceId
}

async function completeCodexOAuthOrganizationSelection(
  page: Page,
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  redirectUri: string,
): Promise<void> {
  await sendCodexOAuthMachine(machine, 'context.updated', {
    url: sanitizeUrl(page.url()),
    redirectUri,
    lastMessage: 'Selecting Codex API organization #1 and project #1',
  })

  const selection = await continueCodexOrganizationSelection(page, 1, 1)

  await sendCodexOAuthMachine(machine, 'codex.oauth.callback.waiting', {
    url: sanitizeUrl(page.url()),
    redirectUri,
    lastMessage: `Selected Codex API organization #${selection.selectedOrganizationIndex} and project #${selection.selectedProjectIndex}; waiting for Codex OAuth callback`,
  })
}

export function resolveCodexOAuthStoredIdentitySelection(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
): {
  id?: string
  email?: string
} {
  const snapshot = machine.getSnapshot().context
  const optionIdentityId = normalizeCodexOAuthIdentityId(options.identityId)
  const optionEmail = normalizeCodexOAuthEmail(options.email)

  if (optionIdentityId || optionEmail) {
    return {
      id: optionIdentityId,
      email: optionEmail,
    }
  }

  const identityIdCandidates = [snapshot.storedIdentity?.id]
    .map(normalizeCodexOAuthIdentityId)
    .filter((value): value is string => Boolean(value))
  const emailCandidates = [snapshot.email, snapshot.storedIdentity?.email]
    .map(normalizeCodexOAuthEmail)
    .filter((value): value is string => Boolean(value))

  return {
    id: identityIdCandidates[0],
    email: emailCandidates[0],
  }
}

export function shouldReuseCodexOAuthStoredIdentity(
  storedIdentity: StoredChatGPTIdentitySummary | undefined,
  selection: {
    id?: string
    email?: string
  },
): boolean {
  if (!storedIdentity) {
    return false
  }

  const selectedId = normalizeCodexOAuthIdentityId(selection.id)
  if (
    selectedId &&
    selectedId !== normalizeCodexOAuthIdentityId(storedIdentity.id)
  ) {
    return false
  }

  const selectedEmail = normalizeCodexOAuthEmail(selection.email)
  if (
    selectedEmail &&
    selectedEmail !== normalizeCodexOAuthEmail(storedIdentity.email)
  ) {
    return false
  }

  return true
}

async function requireCodexOAuthStoredLoginIdentity(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
): Promise<ResolvedChatGPTIdentity> {
  return resolveStoredChatGPTIdentity(
    resolveCodexOAuthStoredIdentitySelection(machine, options),
  )
}

async function submitCodexOAuthStoredLoginEmail(
  page: Page,
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
  redirectUri: string,
  progress: CodexOAuthStoredLoginProgress,
): Promise<StoredChatGPTIdentitySummary> {
  const stored = await requireCodexOAuthStoredLoginIdentity(machine, options)

  await sendCodexOAuthMachine(machine, 'codex.oauth.email.submitting', {
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
  progress: CodexOAuthStoredLoginProgress,
): Promise<StoredChatGPTIdentitySummary> {
  const stored = await requireCodexOAuthStoredLoginIdentity(machine, options)

  await sendCodexOAuthMachine(machine, 'codex.oauth.password.submitting', {
    url: sanitizeUrl(page.url()),
    redirectUri,
    email: stored.identity.email,
    storedIdentity: stored.summary,
    lastMessage: 'Submitting stored ChatGPT password',
  })

  progress.startedAt ??= new Date().toISOString()
  const verificationTimeoutMs =
    parseNumberFlag(options.verificationTimeoutMs, 180000) ?? 180000
  const pollIntervalMs = parseNumberFlag(options.pollIntervalMs, 5000) ?? 5000

  const fallback = await completePasswordOrVerificationLoginFallback(page, {
    email: stored.identity.email,
    password: stored.identity.password,
    step: 'password',
    startedAt: progress.startedAt,
    getVerificationProvider: () => {
      progress.verificationProvider ??=
        createVerificationProvider(getRuntimeConfig())
      return progress.verificationProvider
    },
    verificationTimeoutMs,
    pollIntervalMs,
  })

  await sendCodexOAuthMachine(machine, 'codex.oauth.password.submitted', {
    url: sanitizeUrl(page.url()),
    redirectUri,
    email: stored.identity.email,
    storedIdentity: stored.summary,
    method: fallback.method,
    lastMessage:
      fallback.method === 'verification'
        ? 'Stored ChatGPT password required email verification and completed it'
        : 'Stored ChatGPT password submitted',
  })

  return stored.summary
}

async function submitCodexOAuthStoredVerification(
  page: Page,
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
  redirectUri: string,
  progress: CodexOAuthStoredLoginProgress,
): Promise<StoredChatGPTIdentitySummary> {
  const stored = await requireCodexOAuthStoredLoginIdentity(machine, options)

  await sendCodexOAuthMachine(machine, 'codex.oauth.verification.submitting', {
    url: sanitizeUrl(page.url()),
    redirectUri,
    email: stored.identity.email,
    storedIdentity: stored.summary,
    lastMessage: 'Submitting ChatGPT verification code',
  })

  const verificationReady = await waitForVerificationCodeInputReady(page, 10000)
  if (!verificationReady) {
    throw new Error('ChatGPT verification code input did not become ready.')
  }

  progress.startedAt ??= new Date().toISOString()
  const verificationTimeoutMs =
    parseNumberFlag(options.verificationTimeoutMs, 180000) ?? 180000
  const pollIntervalMs = parseNumberFlag(options.pollIntervalMs, 5000) ?? 5000
  const fallback = await completePasswordOrVerificationLoginFallback(page, {
    email: stored.identity.email,
    password: stored.identity.password,
    step: 'verification',
    startedAt: progress.startedAt,
    getVerificationProvider: () => {
      progress.verificationProvider ??=
        createVerificationProvider(getRuntimeConfig())
      return progress.verificationProvider
    },
    verificationTimeoutMs,
    pollIntervalMs,
  })

  await sendCodexOAuthMachine(machine, 'codex.oauth.verification.submitted', {
    url: sanitizeUrl(page.url()),
    redirectUri,
    email: stored.identity.email,
    storedIdentity: stored.summary,
    method: fallback.method,
    lastMessage: 'ChatGPT verification code submitted',
  })

  return stored.summary
}

async function resolveCodexOAuthStoredIdentity(
  machine: CodexOAuthFlowMachine<CodexOAuthFlowRunResult>,
  options: FlowOptions,
): Promise<StoredChatGPTIdentitySummary | undefined> {
  const snapshot = machine.getSnapshot().context
  const selected = resolveCodexOAuthStoredIdentitySelection(machine, options)
  if (shouldReuseCodexOAuthStoredIdentity(snapshot.storedIdentity, selected)) {
    return snapshot.storedIdentity
  }

  try {
    return (await resolveStoredChatGPTIdentity(selected)).summary
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
      recoverable: !isChatGPTAccountDeactivatedError(error),
    },
  )
}

async function resolveCodexOAuthCallbackStepIfReady(
  page: Page,
  waitForCallback: Promise<CodexOAuthCallbackPayload>,
  redirectUri: string,
  getResolvedCallback: () => CodexOAuthCallbackPayload | undefined,
  timeoutMs = 1500,
): Promise<CodexOAuthStep | undefined> {
  const resolvedCallback = getResolvedCallback()
  if (resolvedCallback) {
    return {
      kind: 'callback',
      callback: resolvedCallback,
    }
  }

  const matchedCallbackUrl = await waitForCodexOAuthCallbackNavigation(
    page,
    redirectUri,
    timeoutMs,
  )
  if (!matchedCallbackUrl) {
    return undefined
  }

  const callback = await new Promise<CodexOAuthCallbackPayload | undefined>(
    (resolve) => {
      const timer = setTimeout(() => resolve(undefined), timeoutMs)
      void waitForCallback.then(
        (payload) => {
          clearTimeout(timer)
          resolve(payload)
        },
        () => {
          clearTimeout(timer)
          resolve(undefined)
        },
      )
    },
  )

  if (!callback) {
    return undefined
  }

  return {
    kind: 'callback',
    callback,
  }
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
  preferredWorkspaceId?: string,
  onSelectedWorkspaceId?: (workspaceId: string | undefined) => void,
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
        | 'unsupported-surface'
        | 'unsupported-post-login'
        | 'workspace'
        | 'organization'
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
              input.kind === 'surface-candidates' &&
              input.candidates.includes('workspace'),
            run: async () => {
              await sendCodexOAuthSurfaceReady(
                machine,
                page,
                'workspace',
                redirectUri,
              )
              try {
                const selectedWorkspaceId =
                  await completeCodexOAuthWorkspaceSelection(
                    page,
                    machine,
                    options,
                    redirectUri,
                    preferredWorkspaceId,
                  )
                onSelectedWorkspaceId?.(selectedWorkspaceId)
              } catch (error) {
                const callbackStep = await resolveCodexOAuthCallbackStepIfReady(
                  page,
                  waitForCallback,
                  redirectUri,
                  getResolvedCallback,
                )
                if (callbackStep) {
                  return callbackStep
                }
                throw wrapRecoverableCodexOAuthBranchError('workspace', error)
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
            branch: 'organization' as const,
            priority: 58,
            guard: ({ input }) =>
              input.kind === 'surface-candidates' &&
              input.candidates.includes('organization'),
            run: async () => {
              await sendCodexOAuthSurfaceReady(
                machine,
                page,
                'organization',
                redirectUri,
              )
              try {
                await completeCodexOAuthOrganizationSelection(
                  page,
                  machine,
                  redirectUri,
                )
              } catch (error) {
                const callbackStep = await resolveCodexOAuthCallbackStepIfReady(
                  page,
                  waitForCallback,
                  redirectUri,
                  getResolvedCallback,
                )
                if (callbackStep) {
                  return callbackStep
                }
                throw wrapRecoverableCodexOAuthBranchError(
                  'organization',
                  error,
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
            branch: 'consent' as const,
            priority: 55,
            guard: ({ input }) =>
              input.kind === 'surface-candidates' &&
              input.candidates.includes('consent'),
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
                const callbackStep = await resolveCodexOAuthCallbackStepIfReady(
                  page,
                  waitForCallback,
                  redirectUri,
                  getResolvedCallback,
                )
                if (callbackStep) {
                  return callbackStep
                }
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
              (input.kind === 'surface-candidates' &&
                input.candidates.includes('authenticated')) ||
              (input.kind === 'post-login-candidates' &&
                input.candidates.includes('authenticated')),
            run: async () => {
              if (currentStep.kind === 'surface-candidates') {
                await sendCodexOAuthSurfaceReady(
                  machine,
                  page,
                  'authenticated',
                  redirectUri,
                )
              } else {
                await sendCodexOAuthMachine(
                  machine,
                  'codex.oauth.callback.waiting',
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
            branch: 'email' as const,
            priority: 45,
            guard: ({ input }) =>
              input.kind === 'surface-candidates' &&
              input.candidates.includes('email'),
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
            branch: 'login' as const,
            priority: 40,
            guard: ({ input }) =>
              input.kind === 'surface-candidates' &&
              input.candidates.includes('login'),
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
                postLoginStep.kind === 'surface-candidates' &&
                postLoginStep.candidates.every(
                  (candidate) => candidate === 'login',
                ) &&
                postLoginStep.candidates.includes('login')
              ) {
                throw new GuardedBranchError(
                  'login',
                  'OpenAI login entry did not advance to an authenticated, workspace, organization, consent, or email surface.',
                )
              }
              return postLoginStep
            },
          },
          {
            branch: 'password' as const,
            priority: 25,
            guard: async ({ input }) =>
              input.kind === 'post-login-candidates' &&
              (input.candidates.includes('password') ||
                (await waitForPasswordInputReady(page, 500))),
            run: async () => {
              await submitCodexOAuthStoredPassword(
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
            branch: 'verification' as const,
            priority: 24,
            guard: async ({ input }) =>
              input.kind === 'post-login-candidates' &&
              (input.candidates.includes('verification') ||
                (await waitForVerificationCodeInputReady(page, 500))),
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
              input.kind === 'post-login-candidates' &&
              input.candidates.includes('retry'),
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
            branch: 'unsupported-surface' as const,
            priority: 22,
            guard: ({ input }) => input.kind === 'surface-candidates',
            run: async ({ input }) => {
              if (input.kind !== 'surface-candidates') {
                throw new Error('Codex OAuth reached an unsupported surface.')
              }
              throw new Error(
                `Codex OAuth reached unsupported surface candidates: ${input.candidates.join(', ')}`,
              )
            },
          },
          {
            branch: 'unsupported-post-login' as const,
            priority: 21,
            guard: ({ input }) => input.kind === 'post-login-candidates',
            run: async ({ input }) => {
              if (input.kind !== 'post-login-candidates') {
                throw new Error(
                  'Codex OAuth reached an unsupported post-email login step.',
                )
              }
              throw new Error(
                `Codex OAuth reached unsupported post-email login candidates: ${input.candidates.join(', ')}`,
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
  const codexConfig = getRequiredCodexConfig()
  const apiHarRecorder = createNodeHarRecorder('flow-codex-oauth-api')
  printFlowArtifactPath('API HAR', apiHarRecorder?.path, 'flow:codex-oauth')
  const machine = createCodexOAuthMachine()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )
  const authorizeUrlOnly = parseBooleanFlag(options.authorizeUrlOnly, false)

  try {
    machine.start({}, { source: 'runCodexOAuthFlow' })

    const redirectPort =
      parseNumberFlag(options.redirectPort, codexConfig.redirectPort) ||
      codexConfig.redirectPort ||
      3000
    const preferredWorkspaceId = await resolvePreferredCodexWorkspaceId(
      machine,
      options,
    )
    let selectedCodexWorkspaceId = preferredWorkspaceId

    await sendCodexOAuthMachine(machine, 'codex.oauth.started', {
      lastMessage: 'Starting Codex PKCE OAuth',
    })

    const started = startCodexAuthorization({
      authorizeUrl: codexConfig.authorizeUrl,
      clientId: codexConfig.clientId,
      scope: codexConfig.scope,
      redirectHost: codexConfig.redirectHost,
      redirectPort,
      redirectPath: codexConfig.redirectPath,
      openBrowserWindow: false,
      codexCliSimplifiedFlow: true,
      allowedWorkspaceId: preferredWorkspaceId,
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

    await sendCodexOAuthMachine(machine, 'context.updated', {
      authorizationUrl: sanitizeUrl(started.authorizationUrl),
      url: sanitizeUrl(page.url()),
      redirectUri: started.redirectUri,
      email:
        typeof options.email === 'string' ? options.email.trim() : undefined,
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
      preferredWorkspaceId,
      (workspaceId) => {
        if (workspaceId) {
          selectedCodexWorkspaceId = workspaceId
        }
      },
    )
    if (!callback.code) {
      throw new Error(
        'Codex OAuth callback did not include an authorization code.',
      )
    }
    if (callback.state !== started.state) {
      throw new Error('Codex OAuth state mismatch.')
    }

    await sendCodexOAuthMachine(machine, 'codex.oauth.callback.received', {
      url: sanitizeUrl(page.url()),
      redirectUri: started.redirectUri,
      lastMessage: 'Received Codex OAuth callback; exchanging token',
    })

    const token = await exchangeCodexAuthorizationCode({
      tokenUrl: codexConfig.tokenUrl,
      clientId: codexConfig.clientId,
      clientSecret: codexConfig.clientSecret,
      code: callback.code,
      redirectUri: started.redirectUri,
      codeVerifier: started.codeVerifier,
      harRecorder: apiHarRecorder,
      requestContext: resolvePageRequestContext(page),
    })

    await sendCodexOAuthMachine(machine, 'codex.oauth.token.exchanged', {
      url: sanitizeUrl(page.url()),
      lastMessage: 'Preparing Codex token for Codey app storage',
    })

    if (!hasCodeyAppSyncConfig()) {
      throw new Error(
        'Codey app session storage is required for codex-oauth. Configure CODEY_APP_* before running this flow.',
      )
    }

    await sendCodexOAuthMachine(machine, 'codex.oauth.token.persisted', {
      url: sanitizeUrl(page.url()),
      lastMessage: 'Codex token ready to save to Codey app',
    })

    const storedIdentity = await resolveCodexOAuthStoredIdentity(
      machine,
      options,
    )
    if (!storedIdentity) {
      throw new Error(
        'A shared ChatGPT identity is required to save the Codex OAuth session to Codey app. Re-run codex-oauth with --identityId or --email.',
      )
    }

    let codeyApp:
      | Awaited<ReturnType<typeof shareCodexOAuthSessionWithCodeyApp>>
      | undefined
    let tokenStorePath: string | undefined

    await sendCodexOAuthMachine(machine, 'codey.app.sync.started', {
      url: sanitizeUrl(page.url()),
      email: storedIdentity.email,
      storedIdentity,
      lastMessage: 'Saving Codex OAuth session to Codey app',
    })

    codeyApp =
      (await shareCodexOAuthSessionWithCodeyApp({
        identity: storedIdentity,
        token,
        clientId: codexConfig.clientId,
        redirectUri: started.redirectUri,
        workspaceId: selectedCodexWorkspaceId,
        workspaceRecordId: options.taskMetadata?.workspace?.recordId,
      })) || undefined

    if (!codeyApp) {
      throw new Error('Unable to save the Codex OAuth session to Codey app.')
    }

    tokenStorePath = codeyApp.sessionStorePath

    if (!tokenStorePath) {
      throw new Error('Codey app did not return a session storage location.')
    }

    const sub2api = codeyApp.sub2api

    await sendCodexOAuthMachine(machine, 'codey.app.sync.completed', {
      url: sanitizeUrl(page.url()),
      tokenStorePath,
      email: storedIdentity.email,
      storedIdentity,
      lastMessage: sub2api
        ? 'Saved Codex OAuth session to Codey app and synced it to Sub2API'
        : 'Saved Codex OAuth session to Codey app',
    })

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
      codeyApp: codeyApp
        ? {
            identityId: codeyApp.identityId,
            identityRecordId: codeyApp.identityRecordId,
            sessionRecordId: codeyApp.sessionRecordId,
          }
        : undefined,
      sub2api: sub2api
        ? {
            accountId: sub2api.accountId,
            action: sub2api.action,
            email: sub2api.email,
          }
        : undefined,
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
        lastMessage: sub2api
          ? 'Codex OAuth flow completed and synced to Sub2API'
          : 'Codex OAuth flow completed',
      },
    })
    result.machine = snapshot
    return result
  } catch (error) {
    await reportChatGPTAccountDeactivationToCodeyApp({
      error,
      identity: machine.getSnapshot().context.storedIdentity,
      progressReporter: options.progressReporter,
    })

    machine.fail(error, 'failed', {
      event: 'codex.oauth.failed',
      patch: {
        url: sanitizeUrl(page.url()),
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
  runSingleFileFlowFromCommandLine('codex-oauth', codexOAuthFlow)
}
