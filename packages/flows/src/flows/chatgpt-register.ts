import type { Page } from 'patchright'
import { pathToFileURL } from 'url'
import {
  assignContext,
  assignContextFromInput,
  composeStateMachineConfig,
  createGuardedCaseTransitions,
  createPatchTransitionMap,
  createRetryTransition,
  createSelfPatchTransitionMap,
  createStateMachine,
  defineStateMachineFragment,
  GuardedBranchError,
  runGuardedBranches,
} from '../state-machine'
import type { RegistrationResult } from '../modules/registration'
import type {
  VirtualAuthenticatorOptions,
  VirtualPasskeyStore,
} from '../modules/webauthn'
import {
  persistChatGPTIdentity,
  type StoredChatGPTIdentitySummary,
} from '../modules/credentials'
import type {
  StateMachineController,
  StateMachineSnapshot,
} from '../state-machine'
import { loadVirtualPasskeyStore } from '../modules/webauthn/virtual-authenticator'
import { getRuntimeConfig } from '../config'
import { syncManagedIdentityToCodeyApp } from '../modules/app-auth/managed-identities'
import {
  createVerificationProvider,
  type VerificationProvider,
} from '../modules/verification'
import {
  clickAddPasskey,
  type ChatGPTAgeGateFieldMode,
  type ChatGPTRegistrationEntrySurface,
  type ChatGPTPostEmailLoginStep,
  clickCompleteAccountCreation,
  clickOnboardingAction,
  clickPasskeyDoneIfPresent,
  clearAuthenticatedSessionState,
  clickPasswordSubmit,
  clickPasskeyEntry,
  clickRetryButtonIfPresent,
  clickSignupEntry,
  clickVerificationContinue,
  buildPassword,
  CHATGPT_ENTRY_LOGIN_URL,
  completePasswordOrVerificationLoginFallback,
  confirmAgeDialogIfPresent,
  fillAgeGateAge,
  fillAgeGateBirthday,
  fillAgeGateName,
  gotoSecuritySettings,
  submitLoginEmail,
  typePassword,
  typeVerificationCode,
  gotoLoginEntry,
  waitForAnySelectorState,
  waitForAuthenticatedSession,
  getAgeGateFieldCandidates,
  waitForEnabledSelector,
  waitForLoginEmailFormReady,
  waitForLoginSurface,
  waitForPasswordInputReady,
  waitForPasskeyEntryReady,
  waitForAgeGateFieldCandidates,
  waitForPostEmailLoginCandidates,
  waitForPasswordSubmissionOutcome,
  waitForPasskeyCreation,
  waitForRegistrationEntryCandidates,
  waitUntilChatGPTHomeReady,
  waitForVerificationCodeInputReady,
  waitForVerificationCode,
  waitForVerificationCodeUpdatesAfterSubmit,
  isSecuritySettingsReady,
  DEFAULT_EVENT_TIMEOUT_MS,
  COMPLETE_ACCOUNT_SELECTORS,
  AGE_GATE_INPUT_SELECTORS,
  PASSWORD_TIMEOUT_RETRY_SELECTORS,
  SECURITY_READY_SELECTORS,
  clickLoginEntryIfPresent,
  clickPasswordTimeoutRetry,
} from '../modules/chatgpt/shared'
import {
  attachStateMachineProgressReporter,
  parseBooleanFlag,
  parseNumberFlag,
  sanitizeErrorForOutput,
  type FlowOptions,
} from '../modules/flow-cli/helpers'
import { sleep } from '../utils/wait'
import {
  runSingleFileFlowFromCli,
  type SingleFileFlowDefinition,
} from '../modules/flow-cli/single-file'
import { parseFlowCliArgs } from '../modules/flow-cli/parse-argv'

export type ChatGPTRegistrationFlowKind = 'chatgpt-registration'

export type ChatGPTRegistrationFlowState =
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
  | 'authenticated'
  | 'completed'
  | 'failed'

export type ChatGPTRegistrationFlowEvent =
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
  | 'chatgpt.age-gate.outcome'
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

export interface SameSessionPasskeyCheckResult {
  attempted: boolean
  authenticated: boolean
  method?: 'passkey' | 'password' | 'verification'
  error?: string
}

interface SameSessionBranchResolution {
  attempted: boolean
  authenticated: boolean
  method: 'passkey' | 'password' | 'verification'
  error?: string
}

interface RegistrationPostEmailResolution {
  verificationEvent: 'chatgpt.password.submitted' | 'context.updated'
  verificationMessage: string
}

export interface ChatGPTRegistrationFlowContext<Result = unknown> {
  kind: ChatGPTRegistrationFlowKind
  url?: string
  title?: string
  email?: string
  postEmailStep?: ChatGPTPostEmailLoginStep
  prefix?: string
  verificationCode?: string
  method?: 'password' | 'passkey' | 'verification'
  createPasskey?: boolean
  passkeyCreated?: boolean
  passkeyStore?: VirtualPasskeyStore
  usedEmailFallback?: boolean
  assertionObserved?: boolean
  storedIdentity?: StoredChatGPTIdentitySummary
  registration?: RegistrationResult
  sameSessionPasskeyCheck?: SameSessionPasskeyCheckResult
  mailbox?: string
  retryCount?: number
  retryReason?: string
  retryFromState?: ChatGPTRegistrationFlowState
  ageGateActive?: boolean
  ageGateRetryCount?: number
  lastMessage?: string
  lastAttempt?: number
  result?: Result
}

export type ChatGPTRegistrationFlowMachine<Result = unknown> =
  StateMachineController<
    ChatGPTRegistrationFlowState,
    ChatGPTRegistrationFlowContext<Result>,
    ChatGPTRegistrationFlowEvent
  >

export type ChatGPTRegistrationFlowSnapshot<Result = unknown> =
  StateMachineSnapshot<
    ChatGPTRegistrationFlowState,
    ChatGPTRegistrationFlowContext<Result>,
    ChatGPTRegistrationFlowEvent
  >

export interface ChatGPTRegistrationFlowOptions {
  password?: string
  verificationTimeoutMs?: number
  pollIntervalMs?: number
  createPasskey?: boolean
  sameSessionPasskeyCheck?: boolean
  virtualAuthenticator?: VirtualAuthenticatorOptions
  passkeyStore?: VirtualPasskeyStore
  machine?: ChatGPTRegistrationFlowMachine<ChatGPTRegistrationFlowResult>
}

export interface ChatGPTRegistrationFlowResult {
  pageName: 'chatgpt-register'
  url: string
  title: string
  email: string
  prefix?: string
  verificationCode: string
  verified: boolean
  registration: RegistrationResult
  passkeyCreated: boolean
  passkeyStore?: VirtualPasskeyStore
  storedIdentity?: StoredChatGPTIdentitySummary
  sameSessionPasskeyCheck?: SameSessionPasskeyCheckResult
  machine: ChatGPTRegistrationFlowSnapshot<ChatGPTRegistrationFlowResult>
}

export type ChatGPTRegistrationEntryResolution = 'authenticated' | 'email'

const MAX_AGE_GATE_SUBMIT_ATTEMPTS = 3
const MAX_REGISTRATION_ENTRY_ATTEMPTS = 3
const INITIAL_REGISTRATION_ENTRY_TIMEOUT_MS = 15000
const RETRY_REGISTRATION_ENTRY_TIMEOUT_MS = 10000

interface ChatGPTAgeGateOutcomeInput {
  outcome: 'advanced' | 'retry' | 'age-gate'
  url: string
}

interface ChatGPTVerificationSubmittedInput {
  verificationCode: string
  url: string
}

interface ChatGPTRegistrationEmailSubmittedInput<Result = unknown> {
  step: ChatGPTPostEmailLoginStep
  url: string
  patch?: Partial<ChatGPTRegistrationFlowContext<Result>>
}

interface ChatGPTRegistrationLoginSurfaceInput<Result = unknown> {
  step: Exclude<ChatGPTRegistrationEntrySurface, 'unknown'>
  url: string
  patch?: Partial<ChatGPTRegistrationFlowContext<Result>>
}

function isAgeGateOutcomeInput(
  value: unknown,
): value is ChatGPTAgeGateOutcomeInput {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ChatGPTAgeGateOutcomeInput>
  return (
    typeof candidate.outcome === 'string' && typeof candidate.url === 'string'
  )
}

function isVerificationSubmittedInput(
  value: unknown,
): value is ChatGPTVerificationSubmittedInput {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ChatGPTVerificationSubmittedInput>
  return (
    typeof candidate.verificationCode === 'string' &&
    typeof candidate.url === 'string'
  )
}

function isChatGPTRegistrationEmailSubmittedInput<Result>(
  value: unknown,
): value is ChatGPTRegistrationEmailSubmittedInput<Result> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<
    ChatGPTRegistrationEmailSubmittedInput<Result>
  >
  return typeof candidate.step === 'string' && typeof candidate.url === 'string'
}

function isChatGPTRegistrationLoginSurfaceInput<Result>(
  value: unknown,
): value is ChatGPTRegistrationLoginSurfaceInput<Result> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<
    ChatGPTRegistrationLoginSurfaceInput<Result>
  >
  return typeof candidate.step === 'string' && typeof candidate.url === 'string'
}

const chatgptRegistrationEventTargets = {
  'chatgpt.entry.opened': 'opening-entry',
  'chatgpt.email.started': 'email-step',
  'chatgpt.password.started': 'password-step',
  'chatgpt.password.submitted': 'verification-polling',
  'chatgpt.verification.polling': 'verification-polling',
  'chatgpt.verification.code-found': 'verification-code-entry',
  'chatgpt.home.waiting': 'post-signup-home',
  'chatgpt.security.started': 'security-settings',
  'chatgpt.passkey.provisioning': 'passkey-provisioning',
  'chatgpt.identity.persisting': 'persisting-identity',
  'chatgpt.same-session-passkey-check.started': 'same-session-passkey-check',
  'chatgpt.same-session-passkey-check.completed': 'same-session-passkey-check',
} as const satisfies Partial<
  Record<ChatGPTRegistrationFlowEvent, ChatGPTRegistrationFlowState>
>

const chatgptRegistrationMutableContextEvents = [
  'context.updated',
  'action.started',
  'action.finished',
] as const satisfies ChatGPTRegistrationFlowEvent[]

function createChatGPTRegistrationEmailSubmittedTransitions<Result>() {
  const assignPostEmailContext = (
    lastMessage: string,
    extras: Partial<ChatGPTRegistrationFlowContext<Result>> = {},
  ) =>
    assignContextFromInput<
      ChatGPTRegistrationFlowState,
      ChatGPTRegistrationFlowContext<Result>,
      ChatGPTRegistrationFlowEvent,
      ChatGPTRegistrationEmailSubmittedInput<Result>
    >(isChatGPTRegistrationEmailSubmittedInput, (_context, { input }) => ({
      ...input.patch,
      ...extras,
      postEmailStep: input.step,
      url: input.url,
      lastMessage,
    }))

  return createGuardedCaseTransitions<
    ChatGPTRegistrationFlowState,
    ChatGPTRegistrationFlowContext<Result>,
    ChatGPTRegistrationFlowEvent,
    ChatGPTRegistrationEmailSubmittedInput<Result>
  >({
    isInput: isChatGPTRegistrationEmailSubmittedInput,
    cases: [
      {
        priority: 60,
        when: ({ input }) => input.step === 'authenticated',
        target: 'authenticated',
        actions: assignPostEmailContext(
          'Authenticated after registration email submission',
        ),
      },
      {
        priority: 50,
        when: ({ input }) => input.step === 'password',
        target: 'password-step',
        actions: assignPostEmailContext(
          'Password step detected after registration email submission',
        ),
      },
      {
        priority: 40,
        when: ({ input }) => input.step === 'verification',
        target: 'verification-polling',
        actions: assignPostEmailContext(
          'Verification step detected after registration email submission',
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
          ChatGPTRegistrationFlowState,
          ChatGPTRegistrationFlowContext<Result>,
          ChatGPTRegistrationFlowEvent,
          ChatGPTRegistrationEmailSubmittedInput<Result>
        >(
          isChatGPTRegistrationEmailSubmittedInput,
          (context, { input, from }) => {
            const nextAttempt = (context.retryCount ?? 0) + 1
            return {
              ...input.patch,
              postEmailStep: input.step,
              url: input.url,
              retryCount: nextAttempt,
              retryReason: 'post-email:retry',
              retryFromState: from,
              lastAttempt: nextAttempt,
              lastMessage:
                'Retry step detected after registration email submission',
            }
          },
        ),
      },
      {
        priority: 20,
        when: ({ input }) => input.step === 'passkey',
        target: 'passkey-login',
        actions: assignPostEmailContext(
          'Passkey step detected after registration email submission',
        ),
      },
    ],
  })
}

function createChatGPTRegistrationLoginSurfaceTransitions<Result>() {
  const assignSurfaceContext = (
    lastMessage: string,
    extras: Partial<ChatGPTRegistrationFlowContext<Result>> = {},
  ) =>
    assignContextFromInput<
      ChatGPTRegistrationFlowState,
      ChatGPTRegistrationFlowContext<Result>,
      ChatGPTRegistrationFlowEvent,
      ChatGPTRegistrationLoginSurfaceInput<Result>
    >(isChatGPTRegistrationLoginSurfaceInput, (_context, { input }) => ({
      ...input.patch,
      ...extras,
      url: input.url,
      lastMessage,
    }))

  return createGuardedCaseTransitions<
    ChatGPTRegistrationFlowState,
    ChatGPTRegistrationFlowContext<Result>,
    ChatGPTRegistrationFlowEvent,
    ChatGPTRegistrationLoginSurfaceInput<Result>
  >({
    isInput: isChatGPTRegistrationLoginSurfaceInput,
    cases: [
      {
        priority: 30,
        when: ({ input }) => input.step === 'authenticated',
        target: 'authenticated',
        actions: assignSurfaceContext(
          'Already authenticated on registration entry',
        ),
      },
      {
        priority: 20,
        when: ({ input }) => input.step === 'email',
        target: 'email-step',
        actions: assignSurfaceContext('Registration email surface ready'),
      },
      {
        priority: 10,
        when: ({ input }) => input.step === 'signup',
        target: 'login-surface',
        actions: assignSurfaceContext('Registration signup surface ready'),
      },
    ],
  })
}

function createChatGPTRegistrationLifecycleFragment<Result>() {
  return defineStateMachineFragment<
    ChatGPTRegistrationFlowState,
    ChatGPTRegistrationFlowContext<Result>,
    ChatGPTRegistrationFlowEvent
  >({
    on: {
      ...createPatchTransitionMap<
        ChatGPTRegistrationFlowState,
        ChatGPTRegistrationFlowContext<Result>,
        ChatGPTRegistrationFlowEvent
      >(chatgptRegistrationEventTargets),
      'chatgpt.retry.requested': createRetryTransition<
        ChatGPTRegistrationFlowState,
        ChatGPTRegistrationFlowContext<Result>,
        ChatGPTRegistrationFlowEvent
      >({
        target: 'retrying',
        defaultMessage: 'Retrying ChatGPT registration',
      }),
      ...createSelfPatchTransitionMap<
        ChatGPTRegistrationFlowState,
        ChatGPTRegistrationFlowContext<Result>,
        ChatGPTRegistrationFlowEvent
      >([...chatgptRegistrationMutableContextEvents]),
    },
  })
}

function createChatGPTRegistrationLoginSurfaceFragment<Result>() {
  return defineStateMachineFragment<
    ChatGPTRegistrationFlowState,
    ChatGPTRegistrationFlowContext<Result>,
    ChatGPTRegistrationFlowEvent
  >({
    on: {
      'chatgpt.login.surface.ready':
        createChatGPTRegistrationLoginSurfaceTransitions<Result>(),
    },
  })
}

function createChatGPTRegistrationPostEmailFragment<Result>() {
  return defineStateMachineFragment<
    ChatGPTRegistrationFlowState,
    ChatGPTRegistrationFlowContext<Result>,
    ChatGPTRegistrationFlowEvent
  >({
    on: {
      'chatgpt.email.submitted':
        createChatGPTRegistrationEmailSubmittedTransitions<Result>(),
      'chatgpt.verification.submitted': {
        target: 'age-gate',
        actions: assignContextFromInput<
          ChatGPTRegistrationFlowState,
          ChatGPTRegistrationFlowContext<Result>,
          ChatGPTRegistrationFlowEvent,
          ChatGPTVerificationSubmittedInput
        >(isVerificationSubmittedInput, (_context, { input }) => ({
          verificationCode: input.verificationCode,
          url: input.url,
          lastMessage: 'Verification code submitted',
        })),
      },
    },
  })
}

function createChatGPTRegistrationAgeGateFragment<Result>() {
  return defineStateMachineFragment<
    ChatGPTRegistrationFlowState,
    ChatGPTRegistrationFlowContext<Result>,
    ChatGPTRegistrationFlowEvent
  >({
    states: {
      'age-gate': {
        entryActions: assignContext<
          ChatGPTRegistrationFlowState,
          ChatGPTRegistrationFlowContext<Result>,
          ChatGPTRegistrationFlowEvent
        >(() => ({
          ageGateActive: true,
        })),
        exitActions: assignContext<
          ChatGPTRegistrationFlowState,
          ChatGPTRegistrationFlowContext<Result>,
          ChatGPTRegistrationFlowEvent
        >(() => ({
          ageGateActive: false,
          ageGateRetryCount: 0,
        })),
        on: {
          'chatgpt.age-gate.outcome': createGuardedCaseTransitions<
            ChatGPTRegistrationFlowState,
            ChatGPTRegistrationFlowContext<Result>,
            ChatGPTRegistrationFlowEvent,
            ChatGPTAgeGateOutcomeInput
          >({
            isInput: isAgeGateOutcomeInput,
            cases: [
              {
                priority: 30,
                when: ({ input }) => input.outcome === 'advanced',
                target: 'post-signup-home',
                actions: assignContextFromInput<
                  ChatGPTRegistrationFlowState,
                  ChatGPTRegistrationFlowContext<Result>,
                  ChatGPTRegistrationFlowEvent,
                  ChatGPTAgeGateOutcomeInput
                >(isAgeGateOutcomeInput, (_context, { input }) => ({
                  url: input.url,
                  lastMessage: 'Age gate completed',
                })),
              },
              {
                priority: 20,
                when: ({ context, input }) =>
                  input.outcome === 'retry' &&
                  (context.ageGateRetryCount ?? 0) <
                    MAX_AGE_GATE_SUBMIT_ATTEMPTS,
                target: 'age-gate',
                actions: assignContextFromInput<
                  ChatGPTRegistrationFlowState,
                  ChatGPTRegistrationFlowContext<Result>,
                  ChatGPTRegistrationFlowEvent,
                  ChatGPTAgeGateOutcomeInput
                >(isAgeGateOutcomeInput, (context, { input }) => {
                  const nextAttempt = (context.ageGateRetryCount ?? 0) + 1
                  return {
                    url: input.url,
                    ageGateRetryCount: nextAttempt,
                    lastAttempt: nextAttempt,
                    lastMessage: 'Retrying age gate submission',
                  }
                }),
              },
              {
                priority: 10,
                target: 'age-gate',
                actions: assignContextFromInput<
                  ChatGPTRegistrationFlowState,
                  ChatGPTRegistrationFlowContext<Result>,
                  ChatGPTRegistrationFlowEvent,
                  ChatGPTAgeGateOutcomeInput
                >(isAgeGateOutcomeInput, (context, { input }) => ({
                  url: input.url,
                  ageGateRetryCount: context.ageGateRetryCount ?? 0,
                  lastAttempt: context.lastAttempt,
                  lastMessage: 'Age gate is still pending',
                })),
              },
            ],
          }),
        },
      },
    },
  })
}

export function createChatGPTRegistrationMachine(): ChatGPTRegistrationFlowMachine<ChatGPTRegistrationFlowResult> {
  return createStateMachine<
    ChatGPTRegistrationFlowState,
    ChatGPTRegistrationFlowContext<ChatGPTRegistrationFlowResult>,
    ChatGPTRegistrationFlowEvent
  >(
    composeStateMachineConfig(
      {
        id: 'flow.chatgpt.registration',
        initialState: 'idle',
        initialContext: {
          kind: 'chatgpt-registration',
        },
        historyLimit: 200,
      },
      createChatGPTRegistrationLifecycleFragment<ChatGPTRegistrationFlowResult>(),
      createChatGPTRegistrationLoginSurfaceFragment<ChatGPTRegistrationFlowResult>(),
      createChatGPTRegistrationPostEmailFragment<ChatGPTRegistrationFlowResult>(),
      createChatGPTRegistrationAgeGateFragment<ChatGPTRegistrationFlowResult>(),
    ),
  )
}

async function sendRegistrationMachine(
  machine: ChatGPTRegistrationFlowMachine<ChatGPTRegistrationFlowResult>,
  state: ChatGPTRegistrationFlowState,
  event: ChatGPTRegistrationFlowEvent,
  patch?: Partial<
    ChatGPTRegistrationFlowContext<ChatGPTRegistrationFlowResult>
  >,
): Promise<void> {
  await machine.send(event, {
    target: state,
    patch,
  })
}

async function isRegistrationAgeGateActive(page: Page): Promise<boolean> {
  return (await getAgeGateFieldCandidates(page)).length > 0
}

function isRecoverableRegistrationBranchEntryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /did not become ready|did not finish rendering|could not be clicked|could not be typed into|could not be filled/i.test(
      error.message,
    )
  )
}

function wrapRecoverableRegistrationBranchError<Branch extends string>(
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
      recoverable: isRecoverableRegistrationBranchEntryError(error),
    },
  )
}

export async function resolveRegistrationEntrySurface(
  page: Page,
  options: {
    email: string
    machine: ChatGPTRegistrationFlowMachine<ChatGPTRegistrationFlowResult>
    maxAttempts?: number
  },
): Promise<ChatGPTRegistrationEntryResolution> {
  const maxAttempts = Math.max(
    1,
    options.maxAttempts ?? MAX_REGISTRATION_ENTRY_ATTEMPTS,
  )
  let lastRecoverableError: GuardedBranchError<'email' | 'signup'> | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const entryCandidates = await waitForRegistrationEntryCandidates(
      page,
      attempt === 1
        ? INITIAL_REGISTRATION_ENTRY_TIMEOUT_MS
        : RETRY_REGISTRATION_ENTRY_TIMEOUT_MS,
    )

    if (entryCandidates.length === 0) {
      if (lastRecoverableError && attempt < maxAttempts) {
        continue
      }

      throw (
        lastRecoverableError ??
        new Error(
          'ChatGPT registration entry page did not reach a supported surface.',
        )
      )
    }

    try {
      return (
        await runGuardedBranches(
          [
            {
              branch: 'authenticated' as const,
              priority: 60,
              guard: ({ input }) =>
                input.entryCandidates.includes('authenticated'),
              run: async () => {
                await options.machine.send('chatgpt.login.surface.ready', {
                  step: 'authenticated',
                  url: page.url(),
                  patch: {
                    email: options.email,
                  },
                })
                return 'authenticated' as const
              },
            },
            {
              branch: 'email' as const,
              priority: 50,
              guard: ({ input }) => input.entryCandidates.includes('email'),
              run: async () => {
                try {
                  const ready = await waitForLoginEmailFormReady(page, 5000)
                  if (!ready) {
                    throw new Error(
                      'Registration email form did not become ready on the direct email surface.',
                    )
                  }
                  await options.machine.send('chatgpt.login.surface.ready', {
                    step: 'email',
                    url: page.url(),
                    patch: {
                      email: options.email,
                    },
                  })
                  return 'email' as const
                } catch (error) {
                  throw wrapRecoverableRegistrationBranchError('email', error)
                }
              },
            },
            {
              branch: 'signup' as const,
              priority: 40,
              guard: ({ input }) => input.entryCandidates.includes('signup'),
              run: async () => {
                await options.machine.send('chatgpt.login.surface.ready', {
                  step: 'signup',
                  url: page.url(),
                  patch: {
                    email: options.email,
                  },
                })
                try {
                  await clickSignupEntry(page)
                  const ready = await waitForLoginEmailFormReady(page, 15000)
                  if (!ready) {
                    throw new Error(
                      'Registration email form did not become ready after selecting signup.',
                    )
                  }
                  await options.machine.send('chatgpt.login.surface.ready', {
                    step: 'email',
                    url: page.url(),
                    patch: {
                      email: options.email,
                    },
                  })
                  return 'email' as const
                } catch (error) {
                  throw wrapRecoverableRegistrationBranchError('signup', error)
                }
              },
            },
          ],
          {
            context: {
              email: options.email,
            },
            input: {
              attempt,
              entryCandidates,
            },
            onFallback: async ({ branch, error }) => {
              await options.machine.send('chatgpt.retry.requested', {
                reason: `entry:${branch}`,
                message: `Retrying registration entry after ${branch} branch failed`,
                patch: {
                  email: options.email,
                  url: page.url(),
                  lastMessage: error.message,
                },
              })
            },
          },
        )
      ).result
    } catch (error) {
      if (
        error instanceof GuardedBranchError &&
        error.recoverable &&
        attempt < maxAttempts
      ) {
        lastRecoverableError = error
        continue
      }

      throw error
    }
  }

  throw (
    lastRecoverableError ??
    new Error(
      'ChatGPT registration entry page did not reach a supported surface.',
    )
  )
}

async function fillRegistrationAgeGateFields(
  page: Page,
): Promise<'birthday' | 'age' | null> {
  await fillAgeGateName(page)
  const candidates = await waitForAgeGateFieldCandidates(page, 3000)
  if (candidates.length === 0) {
    return null
  }

  return (
    await runGuardedBranches(
      [
        {
          branch: 'age' as const,
          priority: 20,
          guard: ({ input }) => input.candidates.includes('age'),
          run: async () => {
            const filled = await fillAgeGateAge(page)
            if (!filled) {
              throw new Error('Age gate age field could not be filled.')
            }
            return 'age' as const
          },
        },
        {
          branch: 'birthday' as const,
          priority: 10,
          guard: ({ input }) => input.candidates.includes('birthday'),
          run: async () => {
            const filled = await fillAgeGateBirthday(page)
            if (!filled) {
              throw new Error('Age gate birthday field could not be filled.')
            }
            return 'birthday' as const
          },
        },
      ],
      {
        context: {},
        input: {
          candidates,
        } satisfies {
          candidates: ChatGPTAgeGateFieldMode[]
        },
      },
    )
  ).result
}

async function waitForAgeGateSubmissionOutcome(
  page: Page,
  timeoutMs = 10000,
): Promise<'advanced' | 'retry' | 'age-gate'> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const retryVisible = await waitForAnySelectorState(
      page,
      PASSWORD_TIMEOUT_RETRY_SELECTORS,
      'visible',
      250,
    )
    if (retryVisible) {
      return 'retry'
    }
    if (!(await isRegistrationAgeGateActive(page))) {
      return 'advanced'
    }
    await sleep(250)
  }

  if (!(await isRegistrationAgeGateActive(page))) {
    return 'advanced'
  }

  return (await waitForAnySelectorState(
    page,
    PASSWORD_TIMEOUT_RETRY_SELECTORS,
    'visible',
    250,
  ))
    ? 'retry'
    : 'age-gate'
}

async function completeRegistrationAgeGate(
  page: Page,
  machine?: ChatGPTRegistrationFlowMachine<ChatGPTRegistrationFlowResult>,
): Promise<void> {
  const ageGateReady = await waitForAnySelectorState(
    page,
    AGE_GATE_INPUT_SELECTORS,
    'visible',
    20000,
  )
  if (!ageGateReady) {
    throw new Error('Age gate did not become ready.')
  }

  let filledMode = await fillRegistrationAgeGateFields(page)
  if (!filledMode) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await clickCompleteAccountCreation(page)
      await waitForAnySelectorState(
        page,
        AGE_GATE_INPUT_SELECTORS,
        'visible',
        DEFAULT_EVENT_TIMEOUT_MS,
      )
      filledMode = await fillRegistrationAgeGateFields(page)
      if (filledMode) break
    }
  }

  if (!filledMode) {
    throw new Error('Age gate fields were visible but could not be filled.')
  }

  for (let attempt = 1; attempt <= MAX_AGE_GATE_SUBMIT_ATTEMPTS; attempt += 1) {
    await waitForEnabledSelector(page, COMPLETE_ACCOUNT_SELECTORS, 5000)
    const submitted = await clickCompleteAccountCreation(page)
    if (!submitted) {
      throw new Error('Age gate submit button was not clickable.')
    }
    await confirmAgeDialogIfPresent(page)

    const outcome = await waitForAgeGateSubmissionOutcome(page)
    const ageGateSnapshot = machine
      ? await machine.send('chatgpt.age-gate.outcome', {
          outcome,
          url: page.url(),
        })
      : undefined

    if (
      outcome === 'advanced' ||
      ageGateSnapshot?.state === 'post-signup-home'
    ) {
      return
    }

    if (outcome === 'retry') {
      const retried = await clickRetryButtonIfPresent(page)
      if (!retried) {
        throw new Error(
          'Age gate retry button became visible but could not be clicked.',
        )
      }
    }

    const ageGateVisible = await waitForAnySelectorState(
      page,
      AGE_GATE_INPUT_SELECTORS,
      'visible',
      DEFAULT_EVENT_TIMEOUT_MS,
    )
    if (!ageGateVisible && !(await isRegistrationAgeGateActive(page))) {
      return
    }

    filledMode = await fillRegistrationAgeGateFields(page)
    if (!filledMode) {
      throw new Error('Age gate fields reappeared but could not be refilled.')
    }
  }

  throw new Error('Age gate submission did not complete successfully.')
}

async function provisionRegistrationPasskey(
  page: Page,
  options: {
    passkeyStore?: VirtualPasskeyStore
    virtualAuthenticator?: VirtualAuthenticatorOptions
  } = {},
): Promise<{
  passkeyCreated: boolean
  passkeyStore?: VirtualPasskeyStore
  homeReady: boolean
  securityAttemptCount: number
}> {
  const virtualAuth = await loadVirtualPasskeyStore(
    page,
    options.passkeyStore,
    options.virtualAuthenticator,
  )

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await gotoSecuritySettings(page)
    if (!(await isSecuritySettingsReady(page))) {
      const action = await clickOnboardingAction(page)
      if (action) continue
    }

    for (let wait = 0; wait < 45; wait += 1) {
      const ready = await isSecuritySettingsReady(page)
      if (ready) break
      await clickOnboardingAction(page)
      await waitForAnySelectorState(
        page,
        SECURITY_READY_SELECTORS,
        'visible',
        DEFAULT_EVENT_TIMEOUT_MS,
      ).catch(() => false)
    }

    const addClicked = await clickAddPasskey(page)
    if (!addClicked) continue

    const passkeyStore = await waitForPasskeyCreation(
      page,
      virtualAuth.session,
      virtualAuth.authenticatorId,
    )
    const passkeyCreated = passkeyStore.credentials.length > 0
    await clickPasskeyDoneIfPresent(page)
    return {
      passkeyCreated,
      passkeyStore: passkeyCreated ? passkeyStore : undefined,
      homeReady: true,
      securityAttemptCount: attempt + 1,
    }
  }

  return { passkeyCreated: false, homeReady: true, securityAttemptCount: 10 }
}

async function runSameSessionPasskeyCheck(
  page: Page,
  options: {
    email: string
    password: string
    verificationProvider: VerificationProvider
    verificationTimeoutMs: number
    pollIntervalMs: number
  },
  machine?: ChatGPTRegistrationFlowMachine<ChatGPTRegistrationFlowResult>,
): Promise<SameSessionPasskeyCheckResult> {
  let attemptedMethod: SameSessionPasskeyCheckResult['method'] = 'passkey'
  try {
    await clearAuthenticatedSessionState(page)
    await gotoLoginEntry(page)

    if (await waitForAuthenticatedSession(page, 5000)) {
      return { attempted: true, authenticated: true, method: 'passkey' }
    }

    await clickLoginEntryIfPresent(page)
    const surface = await waitForLoginSurface(page, 15000)
    if (surface === 'unknown') {
      throw new Error(
        'ChatGPT login entry page did not reach a supported login surface.',
      )
    }

    // Reuse the existing virtual authenticator created during passkey provisioning.
    // Chrome only allows one internal virtual authenticator per environment.

    const startedAt = new Date().toISOString()
    await submitLoginEmail(page, options.email, {
      onRetry: async (_attempt, reason) => {
        await machine?.send('chatgpt.retry.requested', {
          reason: `same-session-email:${reason}`,
          message:
            reason === 'retry'
              ? 'Retrying same-session login email submission'
              : 'Retrying timed out same-session login email submission',
          patch: {
            email: options.email,
            url: page.url(),
          },
        })
      },
    })

    const postEmailCandidates = await waitForPostEmailLoginCandidates(
      page,
      20000,
    )
    if (postEmailCandidates.length === 0) {
      throw new Error(
        'Same-session ChatGPT login did not reach a supported post-email step.',
      )
    }

    return (
      await runGuardedBranches<
        {
          email: string
        },
        {
          postEmailCandidates: Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[]
        },
        SameSessionBranchResolution,
        'authenticated' | 'password' | 'verification' | 'retry' | 'passkey'
      >(
        [
          {
            branch: 'authenticated' as const,
            priority: 60,
            guard: ({ input }) =>
              input.postEmailCandidates.includes('authenticated'),
            run: async () => ({
              attempted: true,
              authenticated: true,
              method: 'passkey' as const,
            }),
          },
          {
            branch: 'password' as const,
            priority: 50,
            guard: async ({ input }) =>
              input.postEmailCandidates.includes('password') ||
              (await waitForPasswordInputReady(page, 500)),
            run: async () => {
              attemptedMethod = 'password'
              try {
                const fallback =
                  await completePasswordOrVerificationLoginFallback(page, {
                    email: options.email,
                    password: options.password,
                    step: 'password',
                    startedAt,
                    verificationProvider: options.verificationProvider,
                    verificationTimeoutMs: options.verificationTimeoutMs,
                    pollIntervalMs: options.pollIntervalMs,
                  })
                const authenticated = await waitForAuthenticatedSession(
                  page,
                  30000,
                )
                return {
                  attempted: true,
                  authenticated,
                  method: fallback.method,
                  ...(authenticated
                    ? {}
                    : {
                        error: 'Password fallback login did not authenticate.',
                      }),
                }
              } catch (error) {
                throw wrapRecoverableRegistrationBranchError('password', error)
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
              attemptedMethod = 'verification'
              try {
                const fallback =
                  await completePasswordOrVerificationLoginFallback(page, {
                    email: options.email,
                    password: options.password,
                    step: 'verification',
                    startedAt,
                    verificationProvider: options.verificationProvider,
                    verificationTimeoutMs: options.verificationTimeoutMs,
                    pollIntervalMs: options.pollIntervalMs,
                  })
                const authenticated = await waitForAuthenticatedSession(
                  page,
                  30000,
                )
                return {
                  attempted: true,
                  authenticated,
                  method: fallback.method,
                  ...(authenticated
                    ? {}
                    : {
                        error:
                          'Verification fallback login did not authenticate.',
                      }),
                }
              } catch (error) {
                throw wrapRecoverableRegistrationBranchError(
                  'verification',
                  error,
                )
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
                'Same-session ChatGPT login returned to the email step repeatedly after submission.',
              )
            },
          },
          {
            branch: 'passkey' as const,
            priority: 20,
            guard: async ({ input }) =>
              input.postEmailCandidates.includes('passkey') ||
              (await waitForPasskeyEntryReady(page, 500)),
            run: async () => {
              attemptedMethod = 'passkey'
              const passkeyReady = await waitForPasskeyEntryReady(page, 20000)
              if (!passkeyReady) {
                throw new GuardedBranchError(
                  'passkey',
                  'Passkey entry button did not appear on the login surface.',
                )
              }
              if (!(await clickPasskeyEntry(page))) {
                throw new GuardedBranchError(
                  'passkey',
                  'Passkey entry button became visible but could not be clicked.',
                )
              }

              const authenticated = await waitForAuthenticatedSession(
                page,
                30000,
              )
              return {
                attempted: true,
                authenticated,
                method: 'passkey' as const,
                ...(authenticated
                  ? {}
                  : { error: 'Passkey login did not authenticate.' }),
              }
            },
          },
        ],
        {
          context: {
            email: options.email,
          },
          input: {
            postEmailCandidates,
          },
          onFallback: async ({ branch, error }) => {
            await machine?.send('chatgpt.retry.requested', {
              reason: `same-session:${branch}`,
              message: `Falling back from same-session ${branch} branch`,
              patch: {
                email: options.email,
                url: page.url(),
                lastMessage: error.message,
              },
            })
          },
        },
      )
    ).result
  } catch (error) {
    return {
      attempted: true,
      authenticated: false,
      method: attemptedMethod,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function registerChatGPT(
  page: Page,
  options: FlowOptions &
    Pick<
      Partial<ChatGPTRegistrationFlowOptions>,
      'passkeyStore' | 'virtualAuthenticator'
    > = {},
): Promise<ChatGPTRegistrationFlowResult> {
  const config = getRuntimeConfig()

  const machine = createChatGPTRegistrationMachine()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )
  const verificationProvider = createVerificationProvider(config)
  const { email, prefix, mailbox, reservationId } =
    await verificationProvider.prepareEmailTarget()
  const password = options.password || buildPassword()
  const createPasskey = parseBooleanFlag(options.createPasskey, false) ?? false
  const sameSessionPasskeyCheckEnabled =
    parseBooleanFlag(options.sameSessionPasskeyCheck, false) ?? false
  const verificationTimeoutMs =
    parseNumberFlag(options.verificationTimeoutMs, 180000) ?? 180000
  const pollIntervalMs = parseNumberFlag(options.pollIntervalMs, 5000) ?? 5000
  const startedAt = new Date().toISOString()

  try {
    machine.start(
      {
        email,
        prefix,
        mailbox,
        createPasskey,
        passkeyCreated: false,
        url: CHATGPT_ENTRY_LOGIN_URL,
      },
      {
        source: 'registerChatGPT',
      },
    )

    await verificationProvider.primeInbox()

    await sendRegistrationMachine(
      machine,
      'opening-entry',
      'chatgpt.entry.opened',
      {
        url: CHATGPT_ENTRY_LOGIN_URL,
        lastMessage: 'Opening ChatGPT auth entry',
      },
    )
    await gotoLoginEntry(page)
    const entryResolution = await resolveRegistrationEntrySurface(page, {
      email,
      machine,
    })

    if (entryResolution === 'authenticated') {
      throw new Error(
        'ChatGPT was already authenticated before registration started.',
      )
    }

    await sendRegistrationMachine(machine, 'email-step', 'context.updated', {
      email,
      url: page.url(),
      lastMessage: 'Typing registration email',
    })
    await submitLoginEmail(page, email, {
      onRetry: async (_attempt, reason) => {
        await machine.send('chatgpt.retry.requested', {
          reason: `registration-email:${reason}`,
          message:
            reason === 'retry'
              ? 'Retrying registration email submission'
              : 'Retrying timed out registration email submission',
          patch: {
            email,
            url: page.url(),
          },
        })
      },
    })

    const postEmailCandidates = await waitForPostEmailLoginCandidates(
      page,
      20000,
    )
    if (postEmailCandidates.length === 0) {
      throw new Error(
        'ChatGPT registration did not reach a supported post-email step.',
      )
    }

    const postEmailResolution = (
      await runGuardedBranches<
        {
          email: string
        },
        {
          postEmailCandidates: Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[]
        },
        RegistrationPostEmailResolution,
        'password' | 'verification' | 'retry' | 'passkey'
      >(
        [
          {
            branch: 'password' as const,
            priority: 50,
            guard: async ({ input }) =>
              input.postEmailCandidates.includes('password') ||
              (await waitForPasswordInputReady(page, 500)),
            run: async () => {
              await machine.send('chatgpt.email.submitted', {
                step: 'password',
                url: page.url(),
                patch: {
                  email,
                },
              })
              await sendRegistrationMachine(
                machine,
                'password-step',
                'chatgpt.password.started',
                {
                  url: page.url(),
                  lastMessage: 'Waiting for password step',
                },
              )

              try {
                for (let attempt = 1; attempt <= 3; attempt += 1) {
                  const passwordReady = await waitForPasswordInputReady(
                    page,
                    10000,
                  )
                  if (!passwordReady) {
                    throw new Error(
                      'ChatGPT password step did not become ready.',
                    )
                  }
                  const passwordTyped = await typePassword(page, password)
                  if (!passwordTyped) {
                    throw new Error(
                      'ChatGPT password field was visible but could not be typed into.',
                    )
                  }
                  await waitForEnabledSelector(
                    page,
                    [
                      'button[type="submit"]',
                      {
                        role: 'button',
                        options: { name: /继续|continue|注册|create/i },
                      },
                      { text: /继续|continue|注册|create/i },
                    ],
                    5000,
                  )
                  await clickPasswordSubmit(page)
                  const outcome = await waitForPasswordSubmissionOutcome(page)
                  if (outcome === 'verification' || outcome === 'unknown') break
                  const retried = await clickPasswordTimeoutRetry(page)
                  if (!retried) {
                    throw new Error(
                      'Password submission timed out and retry button was not clickable.',
                    )
                  }
                }
              } catch (error) {
                throw wrapRecoverableRegistrationBranchError('password', error)
              }

              return {
                verificationEvent: 'chatgpt.password.submitted' as const,
                verificationMessage: 'Waiting for verification email',
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
              await machine.send('chatgpt.email.submitted', {
                step: 'verification',
                url: page.url(),
                patch: {
                  email,
                },
              })
              return {
                verificationEvent: 'context.updated' as const,
                verificationMessage:
                  'Registration requested email verification',
              }
            },
          },
          {
            branch: 'retry' as const,
            priority: 30,
            guard: ({ input }) => input.postEmailCandidates.includes('retry'),
            run: async () => {
              await machine.send('chatgpt.email.submitted', {
                step: 'retry',
                url: page.url(),
                patch: {
                  email,
                },
              })
              throw new GuardedBranchError(
                'retry',
                'ChatGPT registration returned to the email step repeatedly after submission.',
              )
            },
          },
          {
            branch: 'passkey' as const,
            priority: 20,
            guard: ({ input }) => input.postEmailCandidates.includes('passkey'),
            run: async () => {
              await machine.send('chatgpt.email.submitted', {
                step: 'passkey',
                url: page.url(),
                patch: {
                  email,
                },
              })
              throw new GuardedBranchError(
                'passkey',
                'ChatGPT registration unexpectedly reached a passkey challenge before verification.',
              )
            },
          },
        ],
        {
          context: {
            email,
          },
          input: {
            postEmailCandidates,
          },
          onFallback: async ({ branch, error }) => {
            if (branch !== 'retry') {
              await machine.send('chatgpt.retry.requested', {
                reason: `registration-post-email:${branch}`,
                message: `Falling back from registration ${branch} branch`,
                patch: {
                  email,
                  url: page.url(),
                  lastMessage: error.message,
                },
              })
            }
          },
        },
      )
    ).result

    await sendRegistrationMachine(
      machine,
      'verification-polling',
      postEmailResolution.verificationEvent,
      {
        url: page.url(),
        lastMessage: postEmailResolution.verificationMessage,
      },
    )

    const registration: RegistrationResult = {
      module: 'registration',
      accountType: 'parent',
      email,
      organizationName: null,
      passkeyCreated: false,
    }

    const verificationCode = await waitForVerificationCode({
      verificationProvider,
      email,
      startedAt,
      timeoutMs: verificationTimeoutMs,
      pollIntervalMs,
      onPollAttempt: async (attempt) => {
        await sendRegistrationMachine(
          machine,
          'verification-polling',
          'context.updated',
          {
            email,
            lastAttempt: attempt,
            lastMessage: 'Polling verification provider for verification code',
          },
        )
      },
    })

    await sendRegistrationMachine(
      machine,
      'verification-code-entry',
      'chatgpt.verification.code-found',
      {
        verificationCode,
        url: page.url(),
        lastMessage: 'Submitting verification code',
      },
    )
    await waitForVerificationCodeInputReady(page, 10000)
    await typeVerificationCode(page, verificationCode)
    await clickVerificationContinue(page)
    const submittedVerificationCode =
      await waitForVerificationCodeUpdatesAfterSubmit(page, {
        verificationProvider,
        email,
        startedAt,
        timeoutMs: verificationTimeoutMs,
        currentCode: verificationCode,
        onCodeUpdate: async (event) => {
          await sendRegistrationMachine(
            machine,
            'verification-code-entry',
            'context.updated',
            {
              verificationCode: event.code,
              url: page.url(),
              lastMessage:
                event.source === 'MANUAL'
                  ? 'Received a manual verification code update and resubmitted it'
                  : 'Received an updated verification code and resubmitted it',
            },
          )
        },
      })

    await machine.send('chatgpt.verification.submitted', {
      verificationCode: submittedVerificationCode,
      url: page.url(),
    })
    await page.waitForLoadState('domcontentloaded').catch(() => undefined)
    await completeRegistrationAgeGate(page, machine)

    await sendRegistrationMachine(
      machine,
      'post-signup-home',
      'chatgpt.home.waiting',
      {
        url: page.url(),
        lastMessage: 'Waiting for ChatGPT home and onboarding completion',
      },
    )
    const homeReady = await waitUntilChatGPTHomeReady(
      page,
      clickOnboardingAction,
      20,
    )
    await sendRegistrationMachine(
      machine,
      'post-signup-home',
      'context.updated',
      {
        url: page.url(),
        lastMessage: homeReady
          ? 'ChatGPT home ready'
          : 'ChatGPT home did not become ready after signup',
      },
    )
    if (!homeReady) {
      throw new Error(
        'ChatGPT home did not become ready after signup onboarding.',
      )
    }

    const passkeyPromise =
      createPasskey === false
        ? {
            passkeyCreated: false as const,
            passkeyStore: undefined,
            homeReady,
            securityAttemptCount: 0,
          }
        : (async () => {
            await sendRegistrationMachine(
              machine,
              'passkey-provisioning',
              'chatgpt.passkey.provisioning',
              {
                url: page.url(),
                lastMessage: 'Starting passkey provisioning',
              },
            )
            return provisionRegistrationPasskey(page, {
              passkeyStore: options.passkeyStore,
              virtualAuthenticator: options.virtualAuthenticator,
            })
          })()
    const resolvedPasskey = await passkeyPromise

    if (createPasskey) {
      if (resolvedPasskey.securityAttemptCount > 0) {
        await sendRegistrationMachine(
          machine,
          'security-settings',
          'chatgpt.security.started',
          {
            lastAttempt: resolvedPasskey.securityAttemptCount,
            url: page.url(),
            lastMessage: 'Opening security settings',
          },
        )
      }
      await sendRegistrationMachine(
        machine,
        'passkey-provisioning',
        'context.updated',
        {
          passkeyCreated: resolvedPasskey.passkeyCreated,
          passkeyStore: resolvedPasskey.passkeyStore,
          lastAttempt: resolvedPasskey.securityAttemptCount,
          url: page.url(),
          lastMessage: resolvedPasskey.passkeyCreated
            ? 'Passkey provisioned'
            : 'Passkey not created yet',
        },
      )
    }

    const sameSessionPasskeyCheck =
      sameSessionPasskeyCheckEnabled && resolvedPasskey.passkeyCreated
        ? (async () => {
            await sendRegistrationMachine(
              machine,
              'same-session-passkey-check',
              'chatgpt.same-session-passkey-check.started',
              {
                email,
                url: page.url(),
                lastMessage: 'Running same-session passkey check',
              },
            )
            return runSameSessionPasskeyCheck(
              page,
              {
                email,
                password,
                verificationProvider,
                verificationTimeoutMs,
                pollIntervalMs,
              },
              machine,
            )
          })()
        : undefined
    const resolvedSameSessionPasskeyCheck = await sameSessionPasskeyCheck

    if (resolvedSameSessionPasskeyCheck) {
      await sendRegistrationMachine(
        machine,
        'same-session-passkey-check',
        'chatgpt.same-session-passkey-check.completed',
        {
          email,
          url: page.url(),
          sameSessionPasskeyCheck: resolvedSameSessionPasskeyCheck,
          lastMessage: resolvedSameSessionPasskeyCheck.authenticated
            ? 'Same-session passkey check completed'
            : 'Same-session passkey check failed',
        },
      )
    }

    await sendRegistrationMachine(
      machine,
      'persisting-identity',
      'chatgpt.identity.persisting',
      {
        passkeyCreated: resolvedPasskey.passkeyCreated,
        passkeyStore: resolvedPasskey.passkeyStore,
        sameSessionPasskeyCheck: resolvedSameSessionPasskeyCheck,
        url: page.url(),
        lastMessage: 'Persisting ChatGPT identity',
      },
    )

    const storedIdentity = persistChatGPTIdentity({
      email,
      password,
      prefix,
      mailbox,
      passkeyCreated: resolvedPasskey.passkeyCreated,
      passkeyStore: resolvedPasskey.passkeyStore,
    }).summary
    try {
      const syncedIdentity = await syncManagedIdentityToCodeyApp({
        identityId: storedIdentity.id,
        email: storedIdentity.email,
        credentialCount: storedIdentity.credentialCount,
        reservationId,
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

    const title = await page.title()
    const result = {
      pageName: 'chatgpt-register' as const,
      url: page.url(),
      title,
      email,
      prefix,
      verificationCode: submittedVerificationCode,
      verified: true,
      registration: {
        ...registration,
        passkeyCreated: resolvedPasskey.passkeyCreated,
        passkeyStore: resolvedPasskey.passkeyStore,
      },
      passkeyCreated: resolvedPasskey.passkeyCreated,
      passkeyStore: resolvedPasskey.passkeyStore,
      storedIdentity,
      sameSessionPasskeyCheck: resolvedSameSessionPasskeyCheck,
      machine:
        undefined as unknown as ChatGPTRegistrationFlowSnapshot<ChatGPTRegistrationFlowResult>,
    }

    const snapshot = machine.succeed('completed', {
      event: 'chatgpt.completed',
      patch: {
        email,
        prefix,
        verificationCode: submittedVerificationCode,
        passkeyCreated: resolvedPasskey.passkeyCreated,
        passkeyStore: resolvedPasskey.passkeyStore,
        storedIdentity,
        registration: result.registration,
        sameSessionPasskeyCheck: resolvedSameSessionPasskeyCheck,
        url: result.url,
        title: result.title,
        lastMessage: 'ChatGPT registration completed',
      },
    })
    result.machine = snapshot
    return result
  } catch (error) {
    machine.fail(error, 'failed', {
      event: 'chatgpt.failed',
      patch: {
        email,
        prefix,
        url: page.url(),
        lastMessage: 'ChatGPT registration failed',
      },
    })
    throw error
  } finally {
    detachProgress()
  }
}

export const chatgptRegisterFlow: SingleFileFlowDefinition<
  FlowOptions,
  ChatGPTRegistrationFlowResult
> = {
  command: 'flow:chatgpt-register',
  run: registerChatGPT,
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runSingleFileFlowFromCli(
    chatgptRegisterFlow,
    parseFlowCliArgs(process.argv.slice(2)),
  )
}
