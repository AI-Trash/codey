import type { Page } from 'patchright'
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
} from '../state-machine'
import {
  resolveStoredChatGPTIdentity,
  type StoredChatGPTIdentitySummary,
} from '../modules/credentials'
import {
  persistChatGPTSessions,
  type StoredChatGPTSessionSummary,
} from '../modules/credentials/sessions'
import {
  createVerificationProvider,
  type VerificationProvider,
} from '../modules/verification'
import type {
  StateMachineController,
  StateMachineSnapshot,
} from '../state-machine'
import {
  CHATGPT_ENTRY_LOGIN_URL,
  CHATGPT_HOME_URL,
  type ChatGPTPostLoginCompletionSurface,
  type ChatGPTPostEmailLoginStep,
  logStep,
  waitForAuthenticatedSession,
  waitForLoginSurface,
  clickLoginEntryIfPresent,
  continueOpenAIWorkspaceSelection,
  completePasswordOrVerificationLoginFallback,
  gotoLoginEntry,
  submitLoginEmail,
  waitForPostLoginCompletionCandidates,
  waitForPostEmailLoginCandidates,
  createChatGPTBackendMeSessionProbe,
} from '../modules/chatgpt/shared'
import { createChatGPTSessionCapture } from '../modules/chatgpt/session'
import type { ChatGPTSessionCapture } from '../modules/chatgpt/session'
import { saveLocalChatGPTStorageState } from '../modules/chatgpt/storage-state'
import type { ResolvedChatGPTIdentity } from '../modules/credentials'
import type { FlowOptions } from '../modules/flow-cli/helpers'
import {
  runSingleFileFlowFromCommandLine,
  type SingleFileFlowDefinition,
} from '../modules/flow-cli/single-file'
import { createFlowLifecycleFragment } from './machine-fragments'
import {
  attachStateMachineProgressReporter,
  parseBooleanFlag,
  sanitizeErrorForOutput,
} from '../modules/flow-cli/helpers'
import { reportChatGPTAccountDeactivationToCodeyApp } from '../modules/chatgpt/account-deactivation'
import { isChatGPTAccountDeactivatedError } from '../modules/chatgpt/errors'

export type ChatGPTLoginFlowKind = 'chatgpt-login'

export type ChatGPTLoginFlowState =
  | 'idle'
  | 'restoring-session'
  | 'opening-entry'
  | 'email-step'
  | 'password-step'
  | 'verification-polling'
  | 'verification-code-entry'
  | 'workspace-selection'
  | 'age-gate'
  | 'post-signup-home'
  | 'security-settings'
  | 'persisting-identity'
  | 'login-surface'
  | 'retrying'
  | 'add-phone-required'
  | 'authenticated'
  | 'completed'
  | 'failed'

export type ChatGPTLoginFlowEvent =
  | 'machine.started'
  | 'chatgpt.session.restoring'
  | 'chatgpt.entry.opened'
  | 'chatgpt.email.started'
  | 'chatgpt.email.observed'
  | 'chatgpt.email.submitted'
  | 'chatgpt.password.started'
  | 'chatgpt.password.submitted'
  | 'chatgpt.verification.polling'
  | 'chatgpt.verification.code-found'
  | 'chatgpt.verification.submitted'
  | 'chatgpt.workspace.ready'
  | 'chatgpt.workspace.selected'
  | 'chatgpt.age-gate.started'
  | 'chatgpt.age-gate.completed'
  | 'chatgpt.home.waiting'
  | 'chatgpt.security.started'
  | 'chatgpt.identity.persisting'
  | 'chatgpt.login.surface.ready'
  | 'chatgpt.retry.requested'
  | 'chatgpt.authenticated'
  | 'chatgpt.completed'
  | 'chatgpt.failed'
  | 'context.updated'
  | 'action.started'
  | 'action.finished'

export interface ChatGPTLoginFlowContext<Result = unknown> {
  kind: ChatGPTLoginFlowKind
  url?: string
  title?: string
  email?: string
  postEmailStep?: ChatGPTPostEmailLoginStep
  verificationCode?: string
  method?: 'password' | 'verification' | 'restored'
  selectedWorkspaceId?: string
  storedIdentity?: StoredChatGPTIdentitySummary
  storedSession?: StoredChatGPTSessionSummary
  retryCount?: number
  retryReason?: string
  retryFromState?: ChatGPTLoginFlowState
  lastAttempt?: number
  lastMessage?: string
  result?: Result
}

export type ChatGPTLoginFlowMachine<Result = unknown> = StateMachineController<
  ChatGPTLoginFlowState,
  ChatGPTLoginFlowContext<Result>,
  ChatGPTLoginFlowEvent
>

export type ChatGPTLoginFlowSnapshot<Result = unknown> = StateMachineSnapshot<
  ChatGPTLoginFlowState,
  ChatGPTLoginFlowContext<Result>,
  ChatGPTLoginFlowEvent
>

export interface ChatGPTLoginFlowOptions {
  identityId?: string
  email?: string
  machine?: ChatGPTLoginFlowMachine<ChatGPTLoginFlowResult>
}

export interface ChatGPTLoginFlowResult {
  pageName: 'chatgpt-login'
  url: string
  title: string
  email: string
  method: 'password' | 'verification' | 'restored'
  selectedWorkspaceId?: string
  authenticated: boolean
  storedIdentity: StoredChatGPTIdentitySummary
  storedSession?: StoredChatGPTSessionSummary
  machine: ChatGPTLoginFlowSnapshot<ChatGPTLoginFlowResult>
}

type ChatGPTLoginSurfaceStrategy = 'open-entry' | 'current-page'

interface ChatGPTStoredLoginRetryCallbacks {
  onEmailRetry?: (
    attempt: number,
    reason: 'retry' | 'timeout',
  ) => void | Promise<void>
  machineObserver?: ChatGPTStoredLoginMachineObserver
}

export interface ChatGPTStoredLoginResult {
  email: string
  storedIdentity: StoredChatGPTIdentitySummary
  surface: 'authenticated' | 'email'
  method: 'password' | 'verification'
  verificationCode?: string
}

interface ChatGPTStoredLoginMachineObserver {
  machine: ChatGPTLoginFlowMachine<ChatGPTLoginFlowResult>
  storedIdentity: StoredChatGPTIdentitySummary
}

interface ChatGPTLoginEmailSubmittedInput<Result = unknown> {
  step: ChatGPTPostEmailLoginStep
  url: string
  patch?: Partial<ChatGPTLoginFlowContext<Result>>
}

interface ChatGPTLoginPostEmailObservedInput<Result = unknown> {
  candidates: Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[]
  url: string
  patch?: Partial<ChatGPTLoginFlowContext<Result>>
}

function isChatGPTLoginEmailSubmittedInput<Result>(
  value: unknown,
): value is ChatGPTLoginEmailSubmittedInput<Result> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ChatGPTLoginEmailSubmittedInput<Result>>
  return typeof candidate.step === 'string' && typeof candidate.url === 'string'
}

function isChatGPTLoginPostEmailObservedInput<Result>(
  value: unknown,
): value is ChatGPTLoginPostEmailObservedInput<Result> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ChatGPTLoginPostEmailObservedInput<Result>>
  return (
    Array.isArray(candidate.candidates) && typeof candidate.url === 'string'
  )
}

const chatgptLoginEventTargets = {
  'chatgpt.session.restoring': 'restoring-session',
  'chatgpt.entry.opened': 'opening-entry',
  'chatgpt.authenticated': 'authenticated',
  'chatgpt.login.surface.ready': 'login-surface',
  'chatgpt.email.started': 'email-step',
  'chatgpt.password.started': 'password-step',
  'chatgpt.password.submitted': 'password-step',
  'chatgpt.verification.polling': 'verification-polling',
  'chatgpt.verification.code-found': 'verification-code-entry',
  'chatgpt.verification.submitted': 'verification-code-entry',
  'chatgpt.workspace.ready': 'workspace-selection',
  'chatgpt.workspace.selected': 'workspace-selection',
  'chatgpt.age-gate.started': 'age-gate',
  'chatgpt.age-gate.completed': 'age-gate',
  'chatgpt.home.waiting': 'post-signup-home',
  'chatgpt.security.started': 'security-settings',
  'chatgpt.identity.persisting': 'persisting-identity',
} as const satisfies Partial<
  Record<ChatGPTLoginFlowEvent, ChatGPTLoginFlowState>
>

const chatgptLoginMutableContextEvents = [
  'context.updated',
  'action.started',
  'action.finished',
] as const satisfies ChatGPTLoginFlowEvent[]

const chatgptLoginAddPhoneGuardEvents = [
  'chatgpt.session.restoring',
  'chatgpt.entry.opened',
  'chatgpt.email.started',
  'chatgpt.email.observed',
  'chatgpt.email.submitted',
  'chatgpt.password.started',
  'chatgpt.password.submitted',
  'chatgpt.verification.polling',
  'chatgpt.verification.code-found',
  'chatgpt.verification.submitted',
  'chatgpt.workspace.ready',
  'chatgpt.workspace.selected',
  'chatgpt.age-gate.started',
  'chatgpt.age-gate.completed',
  'chatgpt.home.waiting',
  'chatgpt.security.started',
  'chatgpt.identity.persisting',
  'chatgpt.login.surface.ready',
  'chatgpt.retry.requested',
  'chatgpt.authenticated',
  ...chatgptLoginMutableContextEvents,
] as const satisfies ChatGPTLoginFlowEvent[]

const chatgptLoginStates = [
  'idle',
  'restoring-session',
  'opening-entry',
  'email-step',
  'password-step',
  'verification-polling',
  'verification-code-entry',
  'workspace-selection',
  'age-gate',
  'post-signup-home',
  'security-settings',
  'persisting-identity',
  'login-surface',
  'retrying',
  'add-phone-required',
  'authenticated',
  'completed',
  'failed',
] as const satisfies readonly ChatGPTLoginFlowState[]

function createChatGPTLoginPostEmailObservedTransitions<Result>() {
  const assignObservedPostEmailContext = (
    postEmailStep: Exclude<ChatGPTPostEmailLoginStep, 'unknown'>,
    lastMessage: string,
    extras: Partial<ChatGPTLoginFlowContext<Result>> = {},
  ) =>
    assignContextFromInput<
      ChatGPTLoginFlowState,
      ChatGPTLoginFlowContext<Result>,
      ChatGPTLoginFlowEvent,
      ChatGPTLoginPostEmailObservedInput<Result>
    >(isChatGPTLoginPostEmailObservedInput, (_context, { input }) => ({
      ...input.patch,
      ...extras,
      postEmailStep,
      url: input.url,
      lastMessage,
    }))

  return createGuardedCaseTransitions<
    ChatGPTLoginFlowState,
    ChatGPTLoginFlowContext<Result>,
    ChatGPTLoginFlowEvent,
    ChatGPTLoginPostEmailObservedInput<Result>
  >({
    isInput: isChatGPTLoginPostEmailObservedInput,
    cases: [
      {
        priority: 60,
        when: ({ input }) => input.candidates.includes('authenticated'),
        target: 'authenticated',
        actions: assignObservedPostEmailContext(
          'authenticated',
          'Authenticated after email submission',
        ),
      },
      {
        priority: 50,
        when: ({ input }) => input.candidates.includes('password'),
        target: 'password-step',
        actions: assignObservedPostEmailContext(
          'password',
          'Password step detected after email submission',
        ),
      },
      {
        priority: 40,
        when: ({ input }) => input.candidates.includes('verification'),
        target: 'verification-polling',
        actions: assignObservedPostEmailContext(
          'verification',
          'Verification step detected after email submission',
          {
            method: 'verification',
          },
        ),
      },
      {
        priority: 30,
        when: ({ input }) => input.candidates.includes('retry'),
        target: 'retrying',
        actions: assignContextFromInput<
          ChatGPTLoginFlowState,
          ChatGPTLoginFlowContext<Result>,
          ChatGPTLoginFlowEvent,
          ChatGPTLoginPostEmailObservedInput<Result>
        >(isChatGPTLoginPostEmailObservedInput, (context, { input, from }) => {
          const nextAttempt = (context.retryCount ?? 0) + 1
          return {
            ...input.patch,
            postEmailStep: 'retry',
            url: input.url,
            retryCount: nextAttempt,
            retryReason: 'post-email:retry',
            retryFromState: from,
            lastAttempt: nextAttempt,
            lastMessage: 'Retry step detected after email submission',
          }
        }),
      },
    ],
  })
}

function createChatGPTLoginEmailSubmittedTransitions<Result>() {
  const assignPostEmailContext = (
    lastMessage: string,
    extras: Partial<ChatGPTLoginFlowContext<Result>> = {},
  ) =>
    assignContextFromInput<
      ChatGPTLoginFlowState,
      ChatGPTLoginFlowContext<Result>,
      ChatGPTLoginFlowEvent,
      ChatGPTLoginEmailSubmittedInput<Result>
    >(isChatGPTLoginEmailSubmittedInput, (_context, { input }) => ({
      ...input.patch,
      ...extras,
      postEmailStep: input.step,
      url: input.url,
      lastMessage,
    }))

  return createGuardedCaseTransitions<
    ChatGPTLoginFlowState,
    ChatGPTLoginFlowContext<Result>,
    ChatGPTLoginFlowEvent,
    ChatGPTLoginEmailSubmittedInput<Result>
  >({
    isInput: isChatGPTLoginEmailSubmittedInput,
    cases: [
      {
        priority: 60,
        when: ({ input }) => input.step === 'authenticated',
        target: 'authenticated',
        actions: assignPostEmailContext('Authenticated after email submission'),
      },
      {
        priority: 50,
        when: ({ input }) => input.step === 'password',
        target: 'password-step',
        actions: assignPostEmailContext(
          'Password step detected after email submission',
        ),
      },
      {
        priority: 40,
        when: ({ input }) => input.step === 'verification',
        target: 'verification-polling',
        actions: assignPostEmailContext(
          'Verification step detected after email submission',
          {
            method: 'verification',
          },
        ),
      },
      {
        priority: 30,
        when: ({ input }) => input.step === 'retry',
        target: 'retrying',
        actions: assignContextFromInput<
          ChatGPTLoginFlowState,
          ChatGPTLoginFlowContext<Result>,
          ChatGPTLoginFlowEvent,
          ChatGPTLoginEmailSubmittedInput<Result>
        >(isChatGPTLoginEmailSubmittedInput, (context, { input, from }) => {
          const nextAttempt = (context.retryCount ?? 0) + 1
          return {
            ...input.patch,
            postEmailStep: input.step,
            url: input.url,
            retryCount: nextAttempt,
            retryReason: 'post-email:retry',
            retryFromState: from,
            lastAttempt: nextAttempt,
            lastMessage: 'Retry step detected after email submission',
          }
        }),
      },
    ],
  })
}

function createChatGPTLoginLifecycleFragment<Result>() {
  return createFlowLifecycleFragment<
    ChatGPTLoginFlowState,
    ChatGPTLoginFlowContext<Result>,
    ChatGPTLoginFlowEvent
  >({
    eventTargets: chatgptLoginEventTargets,
    mutableContextEvents: chatgptLoginMutableContextEvents,
    retryEvent: 'chatgpt.retry.requested',
    retryTarget: 'retrying',
    defaultRetryMessage: 'Retrying ChatGPT login',
  })
}

function createChatGPTLoginPostEmailFragment<Result>() {
  return defineStateMachineFragment<
    ChatGPTLoginFlowState,
    ChatGPTLoginFlowContext<Result>,
    ChatGPTLoginFlowEvent
  >({
    on: {
      'chatgpt.email.observed':
        createChatGPTLoginPostEmailObservedTransitions<Result>(),
      'chatgpt.email.submitted':
        createChatGPTLoginEmailSubmittedTransitions<Result>(),
    },
  })
}

function createChatGPTLoginAddPhoneFailureFragment<Result>() {
  return createOpenAIAddPhoneFailureFragment<
    ChatGPTLoginFlowState,
    ChatGPTLoginFlowContext<Result>,
    ChatGPTLoginFlowEvent
  >({
    events: chatgptLoginAddPhoneGuardEvents,
    target: 'add-phone-required',
  })
}

export function createChatGPTLoginMachine(): ChatGPTLoginFlowMachine<ChatGPTLoginFlowResult> {
  return createStateMachine<
    ChatGPTLoginFlowState,
    ChatGPTLoginFlowContext<ChatGPTLoginFlowResult>,
    ChatGPTLoginFlowEvent
  >(
    composeStateMachineConfig(
      {
        id: 'flow.chatgpt.login',
        initialState: 'idle',
        initialContext: {
          kind: 'chatgpt-login',
        },
        historyLimit: 200,
        states: declareStateMachineStates<
          ChatGPTLoginFlowState,
          ChatGPTLoginFlowContext<ChatGPTLoginFlowResult>,
          ChatGPTLoginFlowEvent
        >(chatgptLoginStates),
      },
      createChatGPTLoginLifecycleFragment<ChatGPTLoginFlowResult>(),
      createChatGPTLoginAddPhoneFailureFragment<ChatGPTLoginFlowResult>(),
      createChatGPTLoginPostEmailFragment<ChatGPTLoginFlowResult>(),
    ),
  )
}

async function sendLoginMachine(
  machine: ChatGPTLoginFlowMachine<ChatGPTLoginFlowResult>,
  event: ChatGPTLoginFlowEvent,
  patch?: Partial<ChatGPTLoginFlowContext<ChatGPTLoginFlowResult>>,
): Promise<void> {
  await machine.send(event, {
    patch,
  })
}

async function waitForRestoredChatGPTSession(
  page: Page,
  expectedEmail: string,
): Promise<boolean> {
  const backendMeProbe = createChatGPTBackendMeSessionProbe(page, {
    expectedEmail,
  })
  try {
    await page
      .goto(CHATGPT_HOME_URL, { waitUntil: 'domcontentloaded' })
      .catch(() => undefined)
    await page
      .locator('body')
      .waitFor({ state: 'visible' })
      .catch(() => undefined)
    await page.waitForLoadState('networkidle').catch(() => undefined)
    return backendMeProbe.wait(8000)
  } finally {
    backendMeProbe.dispose()
  }
}

function shouldAttemptLocalStorageStateRestore(options: FlowOptions): boolean {
  return Boolean(options.chatgptStorageStatePath?.trim())
}

function wasLocalStorageStateRestoreRequested(options: FlowOptions): boolean {
  return parseBooleanFlag(options.restoreStorageState, false) ?? false
}

async function persistLoginSessionArtifacts(input: {
  page: Page
  sessionCapture: ChatGPTSessionCapture
  storedIdentity: StoredChatGPTIdentitySummary
  flowType: 'chatgpt-login'
  progressReporter?: FlowOptions['progressReporter']
}): Promise<StoredChatGPTSessionSummary | undefined> {
  let storedSession: StoredChatGPTSessionSummary | undefined

  try {
    const capturedSessions = await input.sessionCapture.capture()
    if (capturedSessions.length > 0) {
      const persistedSessions = await persistChatGPTSessions({
        identityId: input.storedIdentity.id,
        email: input.storedIdentity.email,
        flowType: input.flowType,
        snapshots: capturedSessions,
      })
      storedSession = persistedSessions.primarySummary
      input.progressReporter?.({
        message: `Saved ${persistedSessions.sessions.length} ChatGPT session snapshot(s) to Codey app`,
      })
    } else {
      input.progressReporter?.({
        message: 'No ChatGPT session snapshot was captured after login',
      })
    }
  } catch (error) {
    input.progressReporter?.({
      message: `Codey app session save failed: ${sanitizeErrorForOutput(error).message}`,
    })
  }

  try {
    await saveLocalChatGPTStorageState(input.page, {
      identityId: input.storedIdentity.id,
      email: input.storedIdentity.email,
      flowType: input.flowType,
    })
    input.progressReporter?.({
      message: `Saved local ChatGPT storage state for ${input.storedIdentity.email}`,
    })
  } catch (error) {
    input.progressReporter?.({
      message: `Local ChatGPT storage state save failed: ${sanitizeErrorForOutput(error).message}`,
    })
  }

  return storedSession
}

function isRecoverableLoginBranchEntryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /did not become ready|did not finish rendering|could not be clicked|could not be typed into|could not be filled/i.test(
      error.message,
    )
  )
}

function wrapRecoverableLoginBranchError<Branch extends string>(
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
      recoverable: isRecoverableLoginBranchEntryError(error),
    },
  )
}

async function reachChatGPTLoginSurface(
  page: Page,
  surfaceStrategy: ChatGPTLoginSurfaceStrategy = 'open-entry',
): Promise<'authenticated' | 'email'> {
  if (surfaceStrategy === 'open-entry') {
    await gotoLoginEntry(page)
    if (await waitForAuthenticatedSession(page, 5000)) {
      return 'authenticated'
    }

    await clickLoginEntryIfPresent(page)
  } else if (await waitForAuthenticatedSession(page, 5000)) {
    return 'authenticated'
  }

  const surface = await waitForLoginSurface(page, 15000)
  if (surface === 'unknown') {
    throw new Error(
      surfaceStrategy === 'current-page'
        ? 'Current page did not reach a supported ChatGPT login surface.'
        : 'ChatGPT login entry page did not reach a supported login surface.',
    )
  }
  if (surface !== 'authenticated' && surface !== 'email') {
    throw new Error('ChatGPT login surface did not resolve to email login.')
  }
  return surface
}

async function triggerStoredLogin(
  page: Page,
  stored: ResolvedChatGPTIdentity,
  options: ChatGPTStoredLoginRetryCallbacks = {},
): Promise<{
  method: 'password' | 'verification'
  verificationCode?: string
}> {
  if (await waitForAuthenticatedSession(page, 5000)) {
    await options.machineObserver?.machine.send('chatgpt.email.observed', {
      candidates: ['authenticated'],
      url: page.url(),
      patch: {
        email: stored.identity.email,
        storedIdentity: options.machineObserver.storedIdentity,
      },
    })
    return {
      method: 'password',
    }
  }

  const startedAt = new Date().toISOString()
  await submitLoginEmail(page, stored.identity.email, {
    onRetry: options.onEmailRetry,
  })

  const postEmailCandidates = await waitForPostEmailLoginCandidates(page, 20000)
  if (postEmailCandidates.length === 0) {
    throw new Error('ChatGPT login did not reach a supported post-email step.')
  }

  const config = getRuntimeConfig()
  let verificationProvider: VerificationProvider | undefined
  const selectedStep = await observeStoredLoginPostEmailStep(
    page,
    stored,
    postEmailCandidates,
    options.machineObserver,
  )

  if (selectedStep === 'authenticated') {
    return {
      method: 'password',
    }
  }

  if (selectedStep === 'retry') {
    throw new GuardedBranchError(
      'retry',
      'ChatGPT login returned to the email step repeatedly after submission.',
    )
  }

  try {
    const fallback = await completePasswordOrVerificationLoginFallback(page, {
      email: stored.identity.email,
      password: stored.identity.password,
      step: selectedStep,
      startedAt,
      getVerificationProvider: () => {
        verificationProvider ??= createVerificationProvider(config)
        return verificationProvider
      },
    })
    return {
      method: fallback.method,
      verificationCode: fallback.verificationCode,
    }
  } catch (error) {
    const wrapped = wrapRecoverableLoginBranchError(selectedStep, error)
    logStep('login_post_email_branch_fallback', {
      email: stored.identity.email,
      branch: selectedStep,
      message: wrapped.message,
      candidates: postEmailCandidates,
    })
    throw wrapped
  }
}

async function observeStoredLoginPostEmailStep(
  page: Page,
  stored: ResolvedChatGPTIdentity,
  postEmailCandidates: Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[],
  observer?: ChatGPTStoredLoginMachineObserver,
): Promise<'authenticated' | 'password' | 'verification' | 'retry'> {
  const step = observer
    ? await observeStoredLoginPostEmailStepWithMachine(
        page,
        stored,
        postEmailCandidates,
        observer,
      )
    : selectStoredLoginPostEmailStep(postEmailCandidates)

  if (!step) {
    throw new Error(
      `ChatGPT login reached unsupported post-email candidates: ${postEmailCandidates.join(', ')}`,
    )
  }

  return step
}

async function observeStoredLoginPostEmailStepWithMachine(
  page: Page,
  stored: ResolvedChatGPTIdentity,
  postEmailCandidates: Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[],
  observer: ChatGPTStoredLoginMachineObserver,
): Promise<
  'authenticated' | 'password' | 'verification' | 'retry' | undefined
> {
  const snapshot = await observer.machine.send('chatgpt.email.observed', {
    candidates: postEmailCandidates,
    url: page.url(),
    patch: {
      email: stored.identity.email,
      storedIdentity: observer.storedIdentity,
    },
  })

  if (snapshot.state === 'authenticated') return 'authenticated'
  if (snapshot.state === 'password-step') return 'password'
  if (snapshot.state === 'verification-polling') return 'verification'
  if (snapshot.state === 'retrying') return 'retry'
  return undefined
}

function selectStoredLoginPostEmailStep(
  postEmailCandidates: Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[],
): 'authenticated' | 'password' | 'verification' | 'retry' | undefined {
  if (postEmailCandidates.includes('authenticated')) return 'authenticated'
  if (postEmailCandidates.includes('password')) return 'password'
  if (postEmailCandidates.includes('verification')) return 'verification'
  if (postEmailCandidates.includes('retry')) return 'retry'
  return undefined
}

export async function performStoredLogin(
  page: Page,
  stored: ResolvedChatGPTIdentity,
  options: {
    surfaceStrategy?: ChatGPTLoginSurfaceStrategy
  } & ChatGPTStoredLoginRetryCallbacks = {},
): Promise<{
  surface: 'authenticated' | 'email'
  method: 'password' | 'verification'
  verificationCode?: string
}> {
  const surface = await reachChatGPTLoginSurface(page, options.surfaceStrategy)
  const login = await triggerStoredLogin(page, stored, options)
  return {
    surface,
    ...login,
  }
}

interface ChatGPTLoginCompletionResult {
  authenticated: boolean
  selectedWorkspaceId?: string
}

async function completeChatGPTPostLoginSurface(
  page: Page,
  machine: ChatGPTLoginFlowMachine<ChatGPTLoginFlowResult>,
  options: FlowOptions,
): Promise<ChatGPTLoginCompletionResult> {
  if (!options.autoSelectFirstWorkspace) {
    return {
      authenticated: await waitForAuthenticatedSession(page, 30000),
    }
  }

  const candidates = await waitForPostLoginCompletionCandidates(page, 30000)
  if (!candidates.length) {
    return { authenticated: false }
  }

  if (candidates.includes('workspace')) {
    await sendLoginMachine(machine, 'chatgpt.workspace.ready', {
      url: page.url(),
      lastMessage:
        'OpenAI workspace selection ready; selecting the first workspace',
    })

    try {
      const selection = await continueOpenAIWorkspaceSelection(page, 1)
      await sendLoginMachine(machine, 'chatgpt.workspace.selected', {
        url: page.url(),
        selectedWorkspaceId: selection.selectedWorkspaceId,
        lastMessage: selection.selectedWorkspaceId
          ? `Selected OpenAI workspace ${selection.selectedWorkspaceId}`
          : `Selected OpenAI workspace #${selection.selectedWorkspaceIndex}`,
      })
      options.progressReporter?.({
        message: selection.selectedWorkspaceId
          ? `Selected OpenAI workspace ${selection.selectedWorkspaceId}`
          : `Selected OpenAI workspace #${selection.selectedWorkspaceIndex}`,
      })

      return {
        authenticated: await waitForAuthenticatedSession(page, 30000),
        selectedWorkspaceId: selection.selectedWorkspaceId,
      }
    } catch (error) {
      await machine.send('chatgpt.retry.requested', {
        reason: 'workspace-selection',
        message:
          'Retrying ChatGPT login completion after workspace selection failed',
        patch: {
          url: page.url(),
          lastMessage: error instanceof Error ? error.message : String(error),
        },
      })
      throw new GuardedBranchError(
        'workspace',
        error instanceof Error ? error.message : String(error),
        {
          cause: error,
          recoverable: true,
        },
      )
    }
  }

  return {
    authenticated: candidates.includes('authenticated'),
  }
}

// Continue an already-open ChatGPT/OpenAI login challenge without navigating away.
export async function continueChatGPTLoginWithStoredIdentity(
  page: Page,
  options: FlowOptions & ChatGPTStoredLoginRetryCallbacks = {},
): Promise<ChatGPTStoredLoginResult> {
  const stored = await resolveStoredChatGPTIdentity({
    id: options.identityId,
    email: options.email,
  })
  const login = await performStoredLogin(page, stored, {
    onEmailRetry: async (attempt, reason) => {
      await options.onEmailRetry?.(attempt, reason)
      options.progressReporter?.({
        message:
          reason === 'retry'
            ? 'Retrying login email submission'
            : 'Retrying timed out login email submission',
        attempt,
      })
    },
    surfaceStrategy: 'current-page',
  })

  return {
    email: stored.identity.email,
    storedIdentity: stored.summary,
    ...login,
  }
}

export async function loginChatGPT(
  page: Page,
  options: FlowOptions = {},
): Promise<ChatGPTLoginFlowResult> {
  const machine = createChatGPTLoginMachine()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )
  const stored = await resolveStoredChatGPTIdentity({
    id: options.identityId,
    email: options.email,
  })
  const sessionCapture = createChatGPTSessionCapture(page)

  try {
    machine.start(
      {
        email: stored.identity.email,
        storedIdentity: stored.summary,
        method: 'password',
        url: CHATGPT_HOME_URL,
      },
      {
        source: 'loginChatGPT',
      },
    )

    if (shouldAttemptLocalStorageStateRestore(options)) {
      await sendLoginMachine(machine, 'chatgpt.session.restoring', {
        email: stored.identity.email,
        storedIdentity: stored.summary,
        url: CHATGPT_HOME_URL,
        lastMessage:
          'Checking whether local ChatGPT session state restores login',
      })
      const sessionRestored = await waitForRestoredChatGPTSession(
        page,
        stored.identity.email,
      )
      if (sessionRestored) {
        await sendLoginMachine(machine, 'chatgpt.authenticated', {
          email: stored.identity.email,
          method: 'restored',
          storedIdentity: stored.summary,
          url: page.url(),
          lastMessage:
            'Authenticated ChatGPT session restored from local storage state',
        })

        const title = await page.title()
        const storedSession = await persistLoginSessionArtifacts({
          page,
          sessionCapture,
          storedIdentity: stored.summary,
          flowType: 'chatgpt-login',
          progressReporter: options.progressReporter,
        })
        const result = {
          pageName: 'chatgpt-login' as const,
          url: page.url(),
          title,
          email: stored.identity.email,
          method: 'restored' as const,
          authenticated: true,
          storedIdentity: stored.summary,
          storedSession,
          machine:
            undefined as unknown as ChatGPTLoginFlowSnapshot<ChatGPTLoginFlowResult>,
        }
        const snapshot = machine.succeed('completed', {
          event: 'chatgpt.completed',
          patch: {
            email: stored.identity.email,
            method: 'restored',
            storedIdentity: stored.summary,
            storedSession,
            url: result.url,
            title: result.title,
            lastMessage: 'ChatGPT login completed from restored session',
          },
        })
        result.machine = snapshot
        return result
      }

      options.progressReporter?.({
        message: `Local ChatGPT storage state did not restore login for ${stored.identity.email}; continuing with normal login`,
      })
    } else if (wasLocalStorageStateRestoreRequested(options)) {
      options.progressReporter?.({
        message: `No matching local ChatGPT storage state for ${stored.identity.email}; continuing with normal login`,
      })
    }

    await sendLoginMachine(machine, 'chatgpt.entry.opened', {
      email: stored.identity.email,
      url: CHATGPT_ENTRY_LOGIN_URL,
      lastMessage: 'Opening ChatGPT login entry',
    })
    const login = await performStoredLogin(page, stored, {
      machineObserver: {
        machine,
        storedIdentity: stored.summary,
      },
      onEmailRetry: async (attempt, reason) => {
        await machine.send('chatgpt.retry.requested', {
          reason: `email:${reason}`,
          message:
            reason === 'retry'
              ? 'Retrying login email submission'
              : 'Retrying timed out login email submission',
          patch: {
            email: stored.identity.email,
            storedIdentity: stored.summary,
            url: page.url(),
          },
        })
        options.progressReporter?.({
          message:
            reason === 'retry'
              ? 'Retrying login email submission'
              : 'Retrying timed out login email submission',
          attempt,
        })
      },
    })
    const surface = login.surface

    if (surface === 'authenticated') {
      await sendLoginMachine(machine, 'chatgpt.authenticated', {
        email: stored.identity.email,
        url: page.url(),
        lastMessage: 'Already authenticated',
      })
    } else {
      await sendLoginMachine(machine, 'chatgpt.login.surface.ready', {
        email: stored.identity.email,
        url: page.url(),
        lastMessage: `Login surface ready: ${surface}`,
      })
    }

    if (surface !== 'authenticated') {
      await sendLoginMachine(machine, 'chatgpt.email.started', {
        email: stored.identity.email,
        url: page.url(),
        lastMessage: 'Submitting login email',
      })
      await machine.send('chatgpt.email.submitted', {
        step: login.method === 'verification' ? 'verification' : 'password',
        url: page.url(),
        patch: {
          email: stored.identity.email,
        },
      })
    }

    await sendLoginMachine(machine, 'chatgpt.password.started', {
      email: stored.identity.email,
      method: login.method,
      storedIdentity: stored.summary,
      url: page.url(),
      lastMessage:
        login.method === 'verification'
          ? 'Starting verification fallback'
          : 'Starting password fallback',
    })
    await sendLoginMachine(
      machine,
      login.method === 'verification'
        ? 'chatgpt.verification.submitted'
        : 'chatgpt.password.submitted',
      {
        email: stored.identity.email,
        method: login.method,
        verificationCode: login.verificationCode,
        storedIdentity: stored.summary,
        url: page.url(),
        lastMessage:
          login.method === 'verification'
            ? 'Verification fallback completed'
            : login.verificationCode
              ? 'Password fallback completed with verification code'
              : 'Password fallback submitted',
      },
    )

    const completion = await completeChatGPTPostLoginSurface(
      page,
      machine,
      options,
    )
    if (!completion.authenticated) {
      throw new Error(
        `ChatGPT login did not reach an authenticated session for ${stored.identity.email}.`,
      )
    }

    const title = await page.title()
    const storedSession = await persistLoginSessionArtifacts({
      page,
      sessionCapture,
      storedIdentity: stored.summary,
      flowType: 'chatgpt-login',
      progressReporter: options.progressReporter,
    })

    const result = {
      pageName: 'chatgpt-login' as const,
      url: page.url(),
      title,
      email: stored.identity.email,
      method: login.method,
      selectedWorkspaceId: completion.selectedWorkspaceId,
      authenticated: true,
      storedIdentity: stored.summary,
      storedSession,
      machine:
        undefined as unknown as ChatGPTLoginFlowSnapshot<ChatGPTLoginFlowResult>,
    }
    const snapshot = machine.succeed('completed', {
      event: 'chatgpt.completed',
      patch: {
        email: stored.identity.email,
        method: login.method,
        storedIdentity: stored.summary,
        storedSession,
        selectedWorkspaceId: completion.selectedWorkspaceId,
        url: result.url,
        title: result.title,
        lastMessage:
          login.method === 'verification'
            ? 'ChatGPT verification fallback login completed'
            : 'ChatGPT password fallback login completed',
      },
    })
    result.machine = snapshot
    return result
  } catch (error) {
    await reportChatGPTAccountDeactivationToCodeyApp({
      error,
      identity: stored.summary,
      progressReporter: options.progressReporter,
    })

    machine.fail(error, 'failed', {
      event: 'chatgpt.failed',
      patch: {
        email: stored.identity.email,
        storedIdentity: stored.summary,
        url: page.url(),
        lastMessage: isChatGPTAccountDeactivatedError(error)
          ? 'ChatGPT identity was deactivated by OpenAI'
          : 'ChatGPT login failed',
      },
    })
    throw error
  } finally {
    sessionCapture.dispose()
    detachProgress()
  }
}

export const chatgptLoginFlow: SingleFileFlowDefinition<
  FlowOptions,
  ChatGPTLoginFlowResult
> = {
  command: 'flow:chatgpt-login',
  run: loginChatGPT,
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runSingleFileFlowFromCommandLine('chatgpt-login', chatgptLoginFlow)
}
