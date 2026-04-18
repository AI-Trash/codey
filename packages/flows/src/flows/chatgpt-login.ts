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
import { syncManagedIdentityToCodeyApp } from '../modules/app-auth/managed-identities'
import { syncManagedSessionToCodeyApp } from '../modules/app-auth/managed-sessions'
import {
  resolveStoredChatGPTIdentity,
  type StoredChatGPTIdentitySummary,
} from '../modules/credentials'
import {
  persistChatGPTSession,
  type StoredChatGPTSessionSummary,
} from '../modules/credentials/sessions'
import {
  createVerificationProvider,
  type VerificationProvider,
} from '../modules/verification'
import type {
  VirtualAuthenticatorOptions,
  VirtualPasskeyStore,
} from '../modules/webauthn'
import type {
  StateMachineController,
  StateMachineSnapshot,
} from '../state-machine'
import {
  CHATGPT_ENTRY_LOGIN_URL,
  type ChatGPTPostEmailLoginStep,
  createPasskeyAssertionTracker,
  logStep,
  summarizePasskeyCredentials,
  waitForAuthenticatedSession,
  waitForLoginSurface,
  waitForPasskeyEntryReady,
  clickLoginEntryIfPresent,
  clickPasskeyEntry,
  clickPasswordTimeoutRetry,
  completePasswordOrVerificationLoginFallback,
  gotoLoginEntry,
  submitLoginEmail,
  waitForPasswordInputReady,
  waitForPostEmailLoginCandidates,
  waitForRetryOrPasskeyEntryCandidates,
  waitForVerificationCodeInputReady,
} from '../modules/chatgpt/shared'
import { createChatGPTSessionCapture } from '../modules/chatgpt/session'
import {
  captureVirtualPasskeyStore,
  loadVirtualPasskeyStore,
} from '../modules/webauthn/virtual-authenticator'
import type { ResolvedChatGPTIdentity } from '../modules/credentials'
import type { FlowOptions } from '../modules/flow-cli/helpers'
import {
  runSingleFileFlowFromCli,
  type SingleFileFlowDefinition,
} from '../modules/flow-cli/single-file'
import {
  attachStateMachineProgressReporter,
  parseBooleanFlag,
  sanitizeErrorForOutput,
} from '../modules/flow-cli/helpers'
import { parseFlowCliArgs } from '../modules/flow-cli/parse-argv'

export type ChatGPTLoginFlowKind = 'chatgpt-login'

export type ChatGPTLoginFlowState =
  | 'idle'
  | 'opening-entry'
  | 'email-step'
  | 'password-step'
  | 'verification-polling'
  | 'verification-code-entry'
  | 'age-gate'
  | 'post-signup-home'
  | 'security-settings'
  | 'passkey-provisioning'
  | 'persisting-identity'
  | 'same-session-passkey-check'
  | 'login-surface'
  | 'passkey-login'
  | 'retrying'
  | 'add-phone-required'
  | 'authenticated'
  | 'completed'
  | 'failed'

export type ChatGPTLoginFlowEvent =
  | 'machine.started'
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
  | 'chatgpt.passkey.provisioning'
  | 'chatgpt.identity.persisting'
  | 'chatgpt.same-session-passkey-check.started'
  | 'chatgpt.same-session-passkey-check.completed'
  | 'chatgpt.login.surface.ready'
  | 'chatgpt.passkey.login.started'
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
  method?: 'password' | 'passkey' | 'verification'
  passkeyCreated?: boolean
  passkeyStore?: VirtualPasskeyStore
  assertionObserved?: boolean
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
  preferPasskey?: boolean
  virtualAuthenticator?: VirtualAuthenticatorOptions
  machine?: ChatGPTLoginFlowMachine<ChatGPTLoginFlowResult>
}

export interface ChatGPTLoginFlowResult {
  pageName: 'chatgpt-login'
  url: string
  title: string
  email: string
  method: 'passkey' | 'password' | 'verification'
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
  onPasskeyRetry?: (
    attempt: number,
    trigger: 'retry' | 'passkey',
  ) => void | Promise<void>
}

export interface ChatGPTStoredLoginResult {
  email: string
  storedIdentity: StoredChatGPTIdentitySummary
  surface: 'authenticated' | 'email' | 'passkey'
  method: 'passkey' | 'password' | 'verification'
  assertionObserved: boolean
  passkeyStore: VirtualPasskeyStore
  verificationCode?: string
}

interface StoredLoginBranchResolution {
  method: 'passkey' | 'password' | 'verification'
  assertionObserved: boolean
  passkeyStore: VirtualPasskeyStore
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
  'chatgpt.entry.opened': 'opening-entry',
  'chatgpt.authenticated': 'authenticated',
  'chatgpt.login.surface.ready': 'login-surface',
  'chatgpt.email.started': 'email-step',
  'chatgpt.password.started': 'password-step',
  'chatgpt.passkey.login.started': 'passkey-login',
  'chatgpt.verification.polling': 'verification-polling',
  'chatgpt.verification.code-found': 'verification-code-entry',
  'chatgpt.verification.submitted': 'verification-code-entry',
  'chatgpt.age-gate.started': 'age-gate',
  'chatgpt.age-gate.completed': 'age-gate',
  'chatgpt.home.waiting': 'post-signup-home',
  'chatgpt.security.started': 'security-settings',
  'chatgpt.passkey.provisioning': 'passkey-provisioning',
  'chatgpt.identity.persisting': 'persisting-identity',
  'chatgpt.same-session-passkey-check.started': 'same-session-passkey-check',
  'chatgpt.same-session-passkey-check.completed': 'same-session-passkey-check',
} as const satisfies Partial<
  Record<ChatGPTLoginFlowEvent, ChatGPTLoginFlowState>
>

const chatgptLoginMutableContextEvents = [
  'context.updated',
  'action.started',
  'action.finished',
] as const satisfies ChatGPTLoginFlowEvent[]

const chatgptLoginAddPhoneGuardEvents = [
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
  'chatgpt.passkey.provisioning',
  'chatgpt.identity.persisting',
  'chatgpt.same-session-passkey-check.started',
  'chatgpt.same-session-passkey-check.completed',
  'chatgpt.login.surface.ready',
  'chatgpt.passkey.login.started',
  'chatgpt.retry.requested',
  'chatgpt.authenticated',
  ...chatgptLoginMutableContextEvents,
] as const satisfies ChatGPTLoginFlowEvent[]

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
      {
        priority: 20,
        when: ({ input }) => input.step === 'passkey',
        target: 'passkey-login',
        actions: assignPostEmailContext(
          'Passkey step detected after email submission',
        ),
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

function emptyPasskeyStore(): VirtualPasskeyStore {
  return { credentials: [] }
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
): Promise<'authenticated' | 'email' | 'passkey'> {
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
  return surface
}

async function completeStoredPasskeyChallenge(
  page: Page,
  stored: ResolvedChatGPTIdentity,
  virtualAuth: Awaited<ReturnType<typeof loadVirtualPasskeyStore>>,
  tracker: ReturnType<typeof createPasskeyAssertionTracker>,
  options: {
    enteredFromPasskeySurface: boolean
    onPasskeyRetry?: (
      attempt: number,
      trigger: 'retry' | 'passkey',
    ) => void | Promise<void>
  } = {
    enteredFromPasskeySurface: false,
  },
): Promise<{
  method: 'passkey'
  assertionObserved: boolean
  passkeyStore: VirtualPasskeyStore
}> {
  let assertionObserved = false
  let retryOnlyMode = false

  if (options.enteredFromPasskeySurface) {
    const conditionalAssertionObserved = await tracker.waitForAssertion(4000)
    assertionObserved = conditionalAssertionObserved || assertionObserved

    if (conditionalAssertionObserved) {
      logStep('login_passkey_conditional_attempt_observed', {
        email: stored.identity.email,
      })
      if (await waitForAuthenticatedSession(page, 5000)) {
        return {
          method: 'passkey',
          assertionObserved,
          passkeyStore: await captureVirtualPasskeyStore(
            virtualAuth.session,
            virtualAuth.authenticatorId,
          ),
        }
      }
    }
  }

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    let triggerCandidates = await waitForRetryOrPasskeyEntryCandidates(
      page,
      attempt === 1
        ? options.enteredFromPasskeySurface
          ? 4000
          : 20000
        : 10000,
      !retryOnlyMode,
    )

    if (
      triggerCandidates.length === 0 &&
      !retryOnlyMode &&
      (await waitForPasskeyEntryReady(page, attempt === 1 ? 2000 : 1000))
    ) {
      triggerCandidates = ['passkey']
    }

    if (triggerCandidates.length === 0) {
      break
    }

    const trigger = (
      await runGuardedBranches(
        [
          {
            branch: 'retry' as const,
            priority: 20,
            guard: ({ input }) => input.triggerCandidates.includes('retry'),
            run: async () => {
              if (!(await clickPasswordTimeoutRetry(page))) {
                throw new GuardedBranchError(
                  'retry',
                  'Passkey retry button became visible but could not be clicked.',
                )
              }
              return 'retry' as const
            },
          },
          {
            branch: 'passkey' as const,
            priority: 10,
            guard: ({ input }) =>
              !input.retryOnlyMode &&
              input.triggerCandidates.includes('passkey'),
            run: async () => {
              if (!(await clickPasskeyEntry(page))) {
                throw new GuardedBranchError(
                  'passkey',
                  'Passkey entry button became visible but could not be clicked.',
                )
              }
              return 'passkey' as const
            },
          },
        ],
        {
          context: {
            retryOnlyMode,
          },
          input: {
            attempt,
            retryOnlyMode,
            triggerCandidates,
          },
          onFallback: async ({ branch, error }) => {
            logStep('login_passkey_trigger_fallback', {
              email: stored.identity.email,
              attempt,
              branch,
              message: error.message,
            })
          },
        },
      )
    ).branch

    if (attempt > 1 || trigger === 'retry') {
      await options.onPasskeyRetry?.(attempt, trigger)
      logStep('login_passkey_retry_triggered', {
        email: stored.identity.email,
        attempt,
        trigger,
      })
    }

    assertionObserved =
      (await tracker.waitForAssertion(10000)) || assertionObserved

    if (await waitForAuthenticatedSession(page, 5000)) {
      return {
        method: 'passkey',
        assertionObserved,
        passkeyStore: await captureVirtualPasskeyStore(
          virtualAuth.session,
          virtualAuth.authenticatorId,
        ),
      }
    }

    if (trigger === 'retry') {
      retryOnlyMode = true
    }
  }

  return {
    method: 'passkey',
    assertionObserved,
    passkeyStore: await captureVirtualPasskeyStore(
      virtualAuth.session,
      virtualAuth.authenticatorId,
    ),
  }
}

async function triggerStoredPasskeyLogin(
  page: Page,
  stored: ResolvedChatGPTIdentity,
  options: {
    preferPasskey?: boolean
    virtualAuthenticator?: VirtualAuthenticatorOptions
  } & ChatGPTStoredLoginRetryCallbacks = {},
): Promise<{
  method: 'passkey' | 'password' | 'verification'
  assertionObserved: boolean
  passkeyStore: VirtualPasskeyStore
  verificationCode?: string
}> {
  const preferPasskey = options.preferPasskey ?? false
  const hasPasskey = Boolean(stored.identity.passkeyStore?.credentials.length)
  const fallbackStore = stored.identity.passkeyStore ?? emptyPasskeyStore()
  let importedStore = fallbackStore
  let tracker: ReturnType<typeof createPasskeyAssertionTracker> | undefined

  try {
    if (await waitForAuthenticatedSession(page, 5000)) {
      return {
        method: preferPasskey && hasPasskey ? 'passkey' : 'password',
        assertionObserved: false,
        passkeyStore: importedStore,
      }
    }

    const startedAt = new Date().toISOString()
    await submitLoginEmail(page, stored.identity.email, {
      onRetry: options.onEmailRetry,
    })

    const postEmailCandidates = await waitForPostEmailLoginCandidates(
      page,
      20000,
    )
    if (postEmailCandidates.length === 0) {
      throw new Error(
        'ChatGPT login did not reach a supported post-email step.',
      )
    }

    const config = getRuntimeConfig()
    let verificationProvider: VerificationProvider | undefined
    return (
      await runGuardedBranches<
        {
          email: string
          preferPasskey: boolean
          hasPasskey: boolean
        },
        {
          postEmailCandidates: Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[]
        },
        StoredLoginBranchResolution,
        'authenticated' | 'password' | 'verification' | 'retry' | 'passkey'
      >(
        [
          {
            branch: 'authenticated' as const,
            priority: 60,
            guard: ({ input }) =>
              input.postEmailCandidates.includes('authenticated'),
            run: async () => ({
              method: preferPasskey && hasPasskey ? 'passkey' : 'password',
              assertionObserved: false,
              passkeyStore: importedStore,
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
                      verificationProvider ??=
                        createVerificationProvider(config)
                      return verificationProvider
                    },
                  })
                return {
                  method: fallback.method,
                  assertionObserved: false,
                  passkeyStore: importedStore,
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
                      verificationProvider ??=
                        createVerificationProvider(config)
                      return verificationProvider
                    },
                  })
                return {
                  method: fallback.method,
                  assertionObserved: false,
                  passkeyStore: importedStore,
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
          {
            branch: 'passkey' as const,
            priority: 20,
            guard: ({ input }) => input.postEmailCandidates.includes('passkey'),
            run: async () => {
              if (!hasPasskey) {
                throw new Error(
                  `Stored identity ${stored.identity.email} does not contain a passkey credential, but ChatGPT requested a passkey step.`,
                )
              }

              if (!preferPasskey) {
                logStep('login_passkey_used_as_last_resort', {
                  email: stored.identity.email,
                })
              }

              logStep('login_passkey_store_before_import', {
                email: stored.identity.email,
                credentials: summarizePasskeyCredentials(
                  stored.identity.passkeyStore,
                ),
              })

              const virtualAuth = await loadVirtualPasskeyStore(
                page,
                stored.identity.passkeyStore,
                options.virtualAuthenticator,
              )
              virtualAuth.session.on('WebAuthn.credentialAsserted', (event) => {
                logStep('login_passkey_credential_asserted', {
                  email: stored.identity.email,
                  credential: {
                    credentialId: event.credential.credentialId,
                    rpId: event.credential.rpId,
                    userHandle: event.credential.userHandle,
                    signCount: event.credential.signCount,
                    isResidentCredential: event.credential.isResidentCredential,
                    backupEligibility: event.credential.backupEligibility,
                    backupState: event.credential.backupState,
                    userName: event.credential.userName,
                    userDisplayName: event.credential.userDisplayName,
                  },
                })
              })

              importedStore = await captureVirtualPasskeyStore(
                virtualAuth.session,
                virtualAuth.authenticatorId,
              )
              tracker = createPasskeyAssertionTracker(
                virtualAuth.session,
                virtualAuth.authenticatorId,
                importedStore,
              )

              try {
                return await completeStoredPasskeyChallenge(
                  page,
                  stored,
                  virtualAuth,
                  tracker,
                  {
                    enteredFromPasskeySurface:
                      postEmailCandidates.includes('passkey'),
                    onPasskeyRetry: options.onPasskeyRetry,
                  },
                )
              } catch (error) {
                throw wrapRecoverableLoginBranchError('passkey', error)
              }
            },
          },
        ],
        {
          context: {
            email: stored.identity.email,
            preferPasskey,
            hasPasskey,
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
  } finally {
    tracker?.dispose()
  }
}

export async function performStoredPasskeyLogin(
  page: Page,
  stored: ResolvedChatGPTIdentity,
  options: {
    preferPasskey?: boolean
    virtualAuthenticator?: VirtualAuthenticatorOptions
    surfaceStrategy?: ChatGPTLoginSurfaceStrategy
  } & ChatGPTStoredLoginRetryCallbacks = {},
): Promise<{
  surface: 'authenticated' | 'email' | 'passkey'
  method: 'passkey' | 'password' | 'verification'
  assertionObserved: boolean
  passkeyStore: VirtualPasskeyStore
  verificationCode?: string
}> {
  const surface = await reachChatGPTLoginSurface(page, options.surfaceStrategy)
  const passkey = await triggerStoredPasskeyLogin(page, stored, options)
  return {
    surface,
    ...passkey,
  }
}

// Continue an already-open ChatGPT/OpenAI login challenge without navigating away.
export async function continueChatGPTLoginWithStoredIdentity(
  page: Page,
  options: FlowOptions &
    Pick<Partial<ChatGPTLoginFlowOptions>, 'virtualAuthenticator'> &
    ChatGPTStoredLoginRetryCallbacks = {},
): Promise<ChatGPTStoredLoginResult> {
  const preferPasskey = parseBooleanFlag(options.preferPasskey, false) ?? false
  const stored = resolveStoredChatGPTIdentity({
    id: options.identityId,
    email: options.email,
  })
  const passkey = await performStoredPasskeyLogin(page, stored, {
    preferPasskey,
    virtualAuthenticator: options.virtualAuthenticator,
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
    onPasskeyRetry: async (attempt, trigger) => {
      await options.onPasskeyRetry?.(attempt, trigger)
      options.progressReporter?.({
        message:
          trigger === 'retry'
            ? 'Retrying passkey login'
            : 'Re-triggering passkey login',
        attempt,
      })
    },
  })

  return {
    email: stored.identity.email,
    storedIdentity: stored.summary,
    ...passkey,
  }
}

export async function loginChatGPT(
  page: Page,
  options: FlowOptions &
    Pick<Partial<ChatGPTLoginFlowOptions>, 'virtualAuthenticator'> = {},
): Promise<ChatGPTLoginFlowResult> {
  const machine = createChatGPTLoginMachine()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )
  const preferPasskey = parseBooleanFlag(options.preferPasskey, false) ?? false
  const stored = resolveStoredChatGPTIdentity({
    id: options.identityId,
    email: options.email,
  })
  const sessionCapture = createChatGPTSessionCapture(page)

  try {
    machine.start(
      {
        email: stored.identity.email,
        storedIdentity: stored.summary,
        method: preferPasskey ? 'passkey' : 'password',
        passkeyCreated: Boolean(
          stored.identity.passkeyStore?.credentials.length,
        ),
        passkeyStore: stored.identity.passkeyStore,
        url: CHATGPT_ENTRY_LOGIN_URL,
      },
      {
        source: 'loginChatGPT',
      },
    )

    await sendLoginMachine(machine, 'opening-entry', 'chatgpt.entry.opened', {
      email: stored.identity.email,
      url: CHATGPT_ENTRY_LOGIN_URL,
      lastMessage: 'Opening ChatGPT login entry',
    })
    const passkey = await performStoredPasskeyLogin(page, stored, {
      preferPasskey,
      virtualAuthenticator: options.virtualAuthenticator,
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
      onPasskeyRetry: async (attempt, trigger) => {
        await machine.send('chatgpt.retry.requested', {
          reason: `passkey:${trigger}`,
          message:
            trigger === 'retry'
              ? 'Retrying passkey login'
              : 'Re-triggering passkey login',
          patch: {
            email: stored.identity.email,
            storedIdentity: stored.summary,
            url: page.url(),
          },
        })
        options.progressReporter?.({
          message:
            trigger === 'retry'
              ? 'Retrying passkey login'
              : 'Re-triggering passkey login',
          attempt,
        })
      },
    })
    const surface = passkey.surface

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
        step:
          passkey.method === 'verification'
            ? 'verification'
            : passkey.method === 'password'
              ? 'password'
              : 'passkey',
        url: page.url(),
        patch: {
          email: stored.identity.email,
        },
      })
    }

    if (passkey.method === 'passkey') {
      await sendLoginMachine(
        machine,
        'passkey-login',
        'chatgpt.passkey.login.started',
        {
          email: stored.identity.email,
          storedIdentity: stored.summary,
          url: page.url(),
          lastMessage: 'Starting passkey login',
        },
      )
      await sendLoginMachine(machine, 'passkey-login', 'context.updated', {
        email: stored.identity.email,
        method: passkey.method,
        assertionObserved: passkey.assertionObserved,
        passkeyStore: passkey.passkeyStore,
        storedIdentity: stored.summary,
        url: page.url(),
        lastMessage: 'Passkey login triggered',
      })
    } else {
      await sendLoginMachine(
        machine,
        'password-step',
        'chatgpt.password.started',
        {
          email: stored.identity.email,
          method: passkey.method,
          storedIdentity: stored.summary,
          url: page.url(),
          lastMessage:
            passkey.method === 'verification'
              ? 'Starting verification fallback'
              : 'Starting password fallback',
        },
      )
      await sendLoginMachine(
        machine,
        passkey.method === 'verification'
          ? 'verification-code-entry'
          : 'password-step',
        'context.updated',
        {
          email: stored.identity.email,
          method: passkey.method,
          verificationCode: passkey.verificationCode,
          assertionObserved: passkey.assertionObserved,
          passkeyStore: passkey.passkeyStore,
          storedIdentity: stored.summary,
          url: page.url(),
          lastMessage:
            passkey.method === 'verification'
              ? 'Verification fallback completed'
              : passkey.verificationCode
                ? 'Password fallback completed with verification code'
                : 'Password fallback submitted',
        },
      )
    }

    const authenticated = await waitForAuthenticatedSession(page, 30000)
    if (!authenticated) {
      throw new Error(
        `ChatGPT login did not reach an authenticated session for ${stored.identity.email}.`,
      )
    }

    const title = await page.title()
    let storedSession: StoredChatGPTSessionSummary | undefined
    let persistedSessionRecord:
      | ReturnType<typeof persistChatGPTSession>['session']
      | undefined

    try {
      const capturedSession = await sessionCapture.capture()
      if (capturedSession) {
        const persistedSession = persistChatGPTSession({
          identityId: stored.summary.id,
          email: stored.summary.email,
          flowType: 'chatgpt-login',
          snapshot: capturedSession,
        })
        persistedSessionRecord = persistedSession.session
        storedSession = persistedSession.summary
        options.progressReporter?.({
          message: 'Persisted ChatGPT session snapshot locally',
        })
      } else {
        options.progressReporter?.({
          message: 'No ChatGPT session snapshot was captured after login',
        })
      }
    } catch (error) {
      options.progressReporter?.({
        message: `ChatGPT session persistence failed: ${sanitizeErrorForOutput(error).message}`,
      })
    }

    try {
      const syncedIdentity = await syncManagedIdentityToCodeyApp({
        identityId: stored.summary.id,
        email: stored.summary.email,
        credentialCount: stored.summary.credentialCount,
      })
      if (syncedIdentity) {
        options.progressReporter?.({
          message: 'Synced ChatGPT identity to Codey app',
        })
      }
    } catch (error) {
      options.progressReporter?.({
        message: `Codey app identity sync failed: ${sanitizeErrorForOutput(error).message}`,
      })
    }

    if (persistedSessionRecord && storedSession) {
      try {
        const syncedSession = await syncManagedSessionToCodeyApp({
          identityId: stored.summary.id,
          email: stored.summary.email,
          flowType: 'chatgpt-login',
          session: persistedSessionRecord,
        })
        if (syncedSession) {
          options.progressReporter?.({
            message: 'Synced ChatGPT session snapshot to Codey app',
          })
        }
      } catch (error) {
        options.progressReporter?.({
          message: `Codey app session sync failed: ${sanitizeErrorForOutput(error).message}`,
        })
      }
    }

    const result = {
      pageName: 'chatgpt-login' as const,
      url: page.url(),
      title,
      email: stored.identity.email,
      method: passkey.method,
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
        method: passkey.method,
        storedIdentity: stored.summary,
        storedSession,
        url: result.url,
        title: result.title,
        lastMessage:
          passkey.method === 'passkey'
            ? 'ChatGPT passkey login completed'
            : passkey.method === 'verification'
              ? 'ChatGPT verification fallback login completed'
              : 'ChatGPT password fallback login completed',
      },
    })
    result.machine = snapshot
    return result
  } catch (error) {
    machine.fail(error, 'failed', {
      event: 'chatgpt.failed',
      patch: {
        email: stored.identity.email,
        storedIdentity: stored.summary,
        url: page.url(),
        lastMessage: 'ChatGPT login failed',
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
  runSingleFileFlowFromCli(
    chatgptLoginFlow,
    parseFlowCliArgs(process.argv.slice(2)),
  )
}
