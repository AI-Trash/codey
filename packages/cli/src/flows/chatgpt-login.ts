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
  declareStateMachineStates,
  defineStateMachineFragment,
  GuardedBranchError,
  runGuardedBranches,
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
  type ChatGPTPostEmailLoginStep,
  logStep,
  waitForAuthenticatedSession,
  waitForLoginSurface,
  clickLoginEntryIfPresent,
  completePasswordOrVerificationLoginFallback,
  gotoLoginEntry,
  submitLoginEmail,
  waitForPasswordInputReady,
  waitForPostEmailLoginCandidates,
  waitForProfileReady,
  waitForVerificationCodeInputReady,
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
import {
  attachStateMachineProgressReporter,
  parseBooleanFlag,
  sanitizeErrorForOutput,
} from '../modules/flow-cli/helpers'
import { syncManagedIdentityToCodeyApp } from '../modules/app-auth/managed-identities'
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
  | 'chatgpt.email.submitted'
  | 'chatgpt.password.started'
  | 'chatgpt.password.submitted'
  | 'chatgpt.verification.polling'
  | 'chatgpt.verification.code-found'
  | 'chatgpt.verification.submitted'
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
}

export interface ChatGPTStoredLoginResult {
  email: string
  storedIdentity: StoredChatGPTIdentitySummary
  surface: 'authenticated' | 'email'
  method: 'password' | 'verification'
  verificationCode?: string
}

interface StoredLoginBranchResolution {
  method: 'password' | 'verification'
  verificationCode?: string
}

interface ChatGPTLoginEmailSubmittedInput<Result = unknown> {
  step: ChatGPTPostEmailLoginStep
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

const chatgptLoginEventTargets = {
  'chatgpt.session.restoring': 'restoring-session',
  'chatgpt.entry.opened': 'opening-entry',
  'chatgpt.authenticated': 'authenticated',
  'chatgpt.login.surface.ready': 'login-surface',
  'chatgpt.email.started': 'email-step',
  'chatgpt.password.started': 'password-step',
  'chatgpt.verification.polling': 'verification-polling',
  'chatgpt.verification.code-found': 'verification-code-entry',
  'chatgpt.verification.submitted': 'verification-code-entry',
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
  'chatgpt.email.submitted',
  'chatgpt.password.started',
  'chatgpt.password.submitted',
  'chatgpt.verification.polling',
  'chatgpt.verification.code-found',
  'chatgpt.verification.submitted',
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
  return defineStateMachineFragment<
    ChatGPTLoginFlowState,
    ChatGPTLoginFlowContext<Result>,
    ChatGPTLoginFlowEvent
  >({
    on: {
      ...createPatchTransitionMap<
        ChatGPTLoginFlowState,
        ChatGPTLoginFlowContext<Result>,
        ChatGPTLoginFlowEvent
      >(chatgptLoginEventTargets),
      'chatgpt.retry.requested': createRetryTransition<
        ChatGPTLoginFlowState,
        ChatGPTLoginFlowContext<Result>,
        ChatGPTLoginFlowEvent
      >({
        target: 'retrying',
        defaultMessage: 'Retrying ChatGPT login',
      }),
      ...createSelfPatchTransitionMap<
        ChatGPTLoginFlowState,
        ChatGPTLoginFlowContext<Result>,
        ChatGPTLoginFlowEvent
      >([...chatgptLoginMutableContextEvents]),
    },
  })
}

function createChatGPTLoginPostEmailFragment<Result>() {
  return defineStateMachineFragment<
    ChatGPTLoginFlowState,
    ChatGPTLoginFlowContext<Result>,
    ChatGPTLoginFlowEvent
  >({
    on: {
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
  state: ChatGPTLoginFlowState,
  event: ChatGPTLoginFlowEvent,
  patch?: Partial<ChatGPTLoginFlowContext<ChatGPTLoginFlowResult>>,
): Promise<void> {
  await machine.send(event, {
    target: state,
    patch,
  })
}

async function waitForRestoredChatGPTSession(page: Page): Promise<boolean> {
  await page
    .goto(CHATGPT_HOME_URL, { waitUntil: 'domcontentloaded' })
    .catch(() => undefined)
  await page
    .locator('body')
    .waitFor({ state: 'visible' })
    .catch(() => undefined)
  await page.waitForLoadState('networkidle').catch(() => undefined)
  return waitForProfileReady(page, 8000)
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
  return (
    await runGuardedBranches<
      {
        email: string
      },
      {
        postEmailCandidates: Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[]
      },
      StoredLoginBranchResolution,
      'authenticated' | 'password' | 'verification' | 'retry'
    >(
      [
        {
          branch: 'authenticated' as const,
          priority: 60,
          guard: ({ input }) =>
            input.postEmailCandidates.includes('authenticated'),
          run: async () => ({
            method: 'password',
          }),
        },
        {
          branch: 'password' as const,
          priority: 50,
          guard: async ({ input }) =>
            input.postEmailCandidates.includes('password') ||
            (await waitForPasswordInputReady(page, 500)),
          run: async () => {
            try {
              const fallback =
                await completePasswordOrVerificationLoginFallback(page, {
                  email: stored.identity.email,
                  password: stored.identity.password,
                  step: 'password',
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
              throw wrapRecoverableLoginBranchError('password', error)
            }
          },
        },
        {
          branch: 'verification' as const,
          priority: 40,
          guard: async ({ input }) =>
            input.postEmailCandidates.includes('verification') ||
            (await waitForVerificationCodeInputReady(page, 500)),
          run: async () => {
            try {
              const fallback =
                await completePasswordOrVerificationLoginFallback(page, {
                  email: stored.identity.email,
                  password: stored.identity.password,
                  step: 'verification',
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
              throw wrapRecoverableLoginBranchError('verification', error)
            }
          },
        },
        {
          branch: 'retry' as const,
          priority: 30,
          guard: ({ input }) => input.postEmailCandidates.includes('retry'),
          run: async () => {
            throw new GuardedBranchError(
              'retry',
              'ChatGPT login returned to the email step repeatedly after submission.',
            )
          },
        },
      ],
      {
        context: {
          email: stored.identity.email,
        },
        input: {
          postEmailCandidates,
        },
        onFallback: async ({ branch, error }) => {
          logStep('login_post_email_branch_fallback', {
            email: stored.identity.email,
            branch,
            message: error.message,
            candidates: postEmailCandidates,
          })
        },
      },
    )
  ).result
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
      await sendLoginMachine(
        machine,
        'restoring-session',
        'chatgpt.session.restoring',
        {
          email: stored.identity.email,
          storedIdentity: stored.summary,
          url: CHATGPT_HOME_URL,
          lastMessage:
            'Checking whether local ChatGPT session state restores login',
        },
      )
      const sessionRestored = await waitForRestoredChatGPTSession(page)
      if (sessionRestored) {
        await sendLoginMachine(
          machine,
          'authenticated',
          'chatgpt.authenticated',
          {
            email: stored.identity.email,
            method: 'restored',
            storedIdentity: stored.summary,
            url: page.url(),
            lastMessage:
              'Authenticated ChatGPT session restored from local storage state',
          },
        )

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

    await sendLoginMachine(machine, 'opening-entry', 'chatgpt.entry.opened', {
      email: stored.identity.email,
      url: CHATGPT_ENTRY_LOGIN_URL,
      lastMessage: 'Opening ChatGPT login entry',
    })
    const login = await performStoredLogin(page, stored, {
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
      await sendLoginMachine(
        machine,
        'authenticated',
        'chatgpt.authenticated',
        {
          email: stored.identity.email,
          url: page.url(),
          lastMessage: 'Already authenticated',
        },
      )
    } else {
      await sendLoginMachine(
        machine,
        'login-surface',
        'chatgpt.login.surface.ready',
        {
          email: stored.identity.email,
          url: page.url(),
          lastMessage: `Login surface ready: ${surface}`,
        },
      )
    }

    if (surface !== 'authenticated') {
      await sendLoginMachine(machine, 'email-step', 'chatgpt.email.started', {
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

    await sendLoginMachine(
      machine,
      'password-step',
      'chatgpt.password.started',
      {
        email: stored.identity.email,
        method: login.method,
        storedIdentity: stored.summary,
        url: page.url(),
        lastMessage:
          login.method === 'verification'
            ? 'Starting verification fallback'
            : 'Starting password fallback',
      },
    )
    await sendLoginMachine(
      machine,
      login.method === 'verification'
        ? 'verification-code-entry'
        : 'password-step',
      'context.updated',
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

    const authenticated = await waitForAuthenticatedSession(page, 30000)
    if (!authenticated) {
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
    if (isChatGPTAccountDeactivatedError(error)) {
      try {
        const reported = await syncManagedIdentityToCodeyApp({
          identityId: stored.summary.id,
          email: stored.summary.email,
          credentialCount: stored.summary.credentialCount,
          status: 'BANNED',
        })
        options.progressReporter?.({
          message: reported
            ? `OpenAI returned account_deactivated; marked ${stored.summary.email} as banned in Codey app`
            : `OpenAI returned account_deactivated for ${stored.summary.email}, but Codey app access was unavailable to report the banned status`,
        })
      } catch (reportError) {
        options.progressReporter?.({
          message: `OpenAI returned account_deactivated for ${stored.summary.email}, but reporting the banned status to Codey app failed: ${sanitizeErrorForOutput(reportError).message}`,
        })
      }
    }

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
