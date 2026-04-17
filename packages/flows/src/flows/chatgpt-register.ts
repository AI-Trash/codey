import type { Page } from 'patchright'
import { pathToFileURL } from 'url'
import {
  assignContext,
  createStateMachine,
  type StateMachineTransitionDefinition,
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
  waitForEnabledSelector,
  waitForLoginSurface,
  waitForPasskeyEntryReady,
  waitForPostEmailLoginStep,
  waitForPasswordInputReady,
  waitForPasswordSubmissionOutcome,
  waitForPasskeyCreation,
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

export interface ChatGPTRegistrationFlowContext<Result = unknown> {
  kind: ChatGPTRegistrationFlowKind
  url?: string
  title?: string
  email?: string
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

const MAX_AGE_GATE_SUBMIT_ATTEMPTS = 3

interface ChatGPTAgeGateOutcomeInput {
  outcome: 'advanced' | 'retry' | 'age-gate'
  url: string
}

interface ChatGPTVerificationSubmittedInput {
  verificationCode: string
  url: string
}

interface ChatGPTRegistrationMachineEventInput<Result = unknown> {
  target?: ChatGPTRegistrationFlowState
  patch?: Partial<ChatGPTRegistrationFlowContext<Result>>
}

interface ChatGPTRegistrationRetryInput<Result = unknown> {
  patch?: Partial<ChatGPTRegistrationFlowContext<Result>>
  reason?: string
  message?: string
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

function isChatGPTRegistrationMachineEventInput<Result>(
  value: unknown,
): value is ChatGPTRegistrationMachineEventInput<Result> {
  if (!value || typeof value !== 'object') {
    return false
  }

  return 'patch' in value || 'target' in value
}

function isChatGPTRegistrationRetryInput<Result>(
  value: unknown,
): value is ChatGPTRegistrationRetryInput<Result> {
  return Boolean(value && typeof value === 'object')
}

function createChatGPTRegistrationEventTransition<Result>(
  defaultTarget: ChatGPTRegistrationFlowState,
): StateMachineTransitionDefinition<
  ChatGPTRegistrationFlowState,
  ChatGPTRegistrationFlowContext<Result>,
  ChatGPTRegistrationFlowEvent
> {
  return {
    target: ({ input }) =>
      isChatGPTRegistrationMachineEventInput<Result>(input)
        ? (input.target ?? defaultTarget)
        : defaultTarget,
    actions: assignContext<
      ChatGPTRegistrationFlowState,
      ChatGPTRegistrationFlowContext<Result>,
      ChatGPTRegistrationFlowEvent,
      ChatGPTRegistrationMachineEventInput<Result>
    >((_context, { input }) =>
      isChatGPTRegistrationMachineEventInput<Result>(input)
        ? (input.patch ?? {})
        : {},
    ),
  }
}

function createChatGPTRegistrationRetryTransition<
  Result,
>(): StateMachineTransitionDefinition<
  ChatGPTRegistrationFlowState,
  ChatGPTRegistrationFlowContext<Result>,
  ChatGPTRegistrationFlowEvent
> {
  return {
    priority: 100,
    target: 'retrying',
    actions: assignContext<
      ChatGPTRegistrationFlowState,
      ChatGPTRegistrationFlowContext<Result>,
      ChatGPTRegistrationFlowEvent,
      ChatGPTRegistrationRetryInput<Result>
    >((context, { input, from }) => {
      const retryInput = isChatGPTRegistrationRetryInput<Result>(input)
        ? input
        : undefined
      const nextAttempt = (context.retryCount ?? 0) + 1
      return {
        ...retryInput?.patch,
        retryCount: nextAttempt,
        retryReason: retryInput?.reason ?? context.retryReason,
        retryFromState: from,
        lastAttempt: nextAttempt,
        lastMessage: retryInput?.message ?? 'Retrying ChatGPT registration',
      }
    }),
  }
}

export function createChatGPTRegistrationMachine(): ChatGPTRegistrationFlowMachine<ChatGPTRegistrationFlowResult> {
  return createStateMachine<
    ChatGPTRegistrationFlowState,
    ChatGPTRegistrationFlowContext<ChatGPTRegistrationFlowResult>,
    ChatGPTRegistrationFlowEvent
  >({
    id: 'flow.chatgpt.registration',
    initialState: 'idle',
    initialContext: {
      kind: 'chatgpt-registration',
    },
    historyLimit: 200,
    on: {
      'chatgpt.entry.opened':
        createChatGPTRegistrationEventTransition<ChatGPTRegistrationFlowResult>(
          'opening-entry',
        ),
      'chatgpt.email.started':
        createChatGPTRegistrationEventTransition<ChatGPTRegistrationFlowResult>(
          'email-step',
        ),
      'chatgpt.email.submitted':
        createChatGPTRegistrationEventTransition<ChatGPTRegistrationFlowResult>(
          'password-step',
        ),
      'chatgpt.password.started':
        createChatGPTRegistrationEventTransition<ChatGPTRegistrationFlowResult>(
          'password-step',
        ),
      'chatgpt.password.submitted':
        createChatGPTRegistrationEventTransition<ChatGPTRegistrationFlowResult>(
          'verification-polling',
        ),
      'chatgpt.verification.polling':
        createChatGPTRegistrationEventTransition<ChatGPTRegistrationFlowResult>(
          'verification-polling',
        ),
      'chatgpt.verification.code-found':
        createChatGPTRegistrationEventTransition<ChatGPTRegistrationFlowResult>(
          'verification-code-entry',
        ),
      'chatgpt.verification.submitted': {
        target: 'age-gate',
        actions: assignContext<
          ChatGPTRegistrationFlowState,
          ChatGPTRegistrationFlowContext<ChatGPTRegistrationFlowResult>,
          ChatGPTRegistrationFlowEvent,
          ChatGPTVerificationSubmittedInput
        >((_context, { input }) =>
          isVerificationSubmittedInput(input)
            ? {
                verificationCode: input.verificationCode,
                url: input.url,
                lastMessage: 'Verification code submitted',
              }
            : {},
        ),
      },
      'chatgpt.home.waiting':
        createChatGPTRegistrationEventTransition<ChatGPTRegistrationFlowResult>(
          'post-signup-home',
        ),
      'chatgpt.security.started':
        createChatGPTRegistrationEventTransition<ChatGPTRegistrationFlowResult>(
          'security-settings',
        ),
      'chatgpt.passkey.provisioning':
        createChatGPTRegistrationEventTransition<ChatGPTRegistrationFlowResult>(
          'passkey-provisioning',
        ),
      'chatgpt.identity.persisting':
        createChatGPTRegistrationEventTransition<ChatGPTRegistrationFlowResult>(
          'persisting-identity',
        ),
      'chatgpt.same-session-passkey-check.started':
        createChatGPTRegistrationEventTransition<ChatGPTRegistrationFlowResult>(
          'same-session-passkey-check',
        ),
      'chatgpt.same-session-passkey-check.completed':
        createChatGPTRegistrationEventTransition<ChatGPTRegistrationFlowResult>(
          'same-session-passkey-check',
        ),
      'chatgpt.retry.requested':
        createChatGPTRegistrationRetryTransition<ChatGPTRegistrationFlowResult>(),
      'context.updated': {
        target: ({ from, input }) =>
          isChatGPTRegistrationMachineEventInput<ChatGPTRegistrationFlowResult>(
            input,
          )
            ? (input.target ?? from)
            : from,
        actions: assignContext<
          ChatGPTRegistrationFlowState,
          ChatGPTRegistrationFlowContext<ChatGPTRegistrationFlowResult>,
          ChatGPTRegistrationFlowEvent,
          ChatGPTRegistrationMachineEventInput<ChatGPTRegistrationFlowResult>
        >((_context, { input }) =>
          isChatGPTRegistrationMachineEventInput<ChatGPTRegistrationFlowResult>(
            input,
          )
            ? (input.patch ?? {})
            : {},
        ),
      },
      'action.started': {
        target: ({ from, input }) =>
          isChatGPTRegistrationMachineEventInput<ChatGPTRegistrationFlowResult>(
            input,
          )
            ? (input.target ?? from)
            : from,
        actions: assignContext<
          ChatGPTRegistrationFlowState,
          ChatGPTRegistrationFlowContext<ChatGPTRegistrationFlowResult>,
          ChatGPTRegistrationFlowEvent,
          ChatGPTRegistrationMachineEventInput<ChatGPTRegistrationFlowResult>
        >((_context, { input }) =>
          isChatGPTRegistrationMachineEventInput<ChatGPTRegistrationFlowResult>(
            input,
          )
            ? (input.patch ?? {})
            : {},
        ),
      },
      'action.finished': {
        target: ({ from, input }) =>
          isChatGPTRegistrationMachineEventInput<ChatGPTRegistrationFlowResult>(
            input,
          )
            ? (input.target ?? from)
            : from,
        actions: assignContext<
          ChatGPTRegistrationFlowState,
          ChatGPTRegistrationFlowContext<ChatGPTRegistrationFlowResult>,
          ChatGPTRegistrationFlowEvent,
          ChatGPTRegistrationMachineEventInput<ChatGPTRegistrationFlowResult>
        >((_context, { input }) =>
          isChatGPTRegistrationMachineEventInput<ChatGPTRegistrationFlowResult>(
            input,
          )
            ? (input.patch ?? {})
            : {},
        ),
      },
    },
    states: {
      'age-gate': {
        entryActions: assignContext<
          ChatGPTRegistrationFlowState,
          ChatGPTRegistrationFlowContext<ChatGPTRegistrationFlowResult>,
          ChatGPTRegistrationFlowEvent
        >(() => ({
          ageGateActive: true,
        })),
        exitActions: assignContext<
          ChatGPTRegistrationFlowState,
          ChatGPTRegistrationFlowContext<ChatGPTRegistrationFlowResult>,
          ChatGPTRegistrationFlowEvent
        >(() => ({
          ageGateActive: false,
          ageGateRetryCount: 0,
        })),
        on: {
          'chatgpt.age-gate.outcome': [
            {
              priority: 30,
              guard: ({ input }) =>
                isAgeGateOutcomeInput(input) && input.outcome === 'advanced',
              target: 'post-signup-home',
              actions: assignContext<
                ChatGPTRegistrationFlowState,
                ChatGPTRegistrationFlowContext<ChatGPTRegistrationFlowResult>,
                ChatGPTRegistrationFlowEvent,
                ChatGPTAgeGateOutcomeInput
              >((_context, { input }) =>
                isAgeGateOutcomeInput(input)
                  ? {
                      url: input.url,
                      lastMessage: 'Age gate completed',
                    }
                  : {},
              ),
            },
            {
              priority: 20,
              guard: ({ context, input }) =>
                isAgeGateOutcomeInput(input) &&
                input.outcome === 'retry' &&
                (context.ageGateRetryCount ?? 0) < MAX_AGE_GATE_SUBMIT_ATTEMPTS,
              target: 'age-gate',
              actions: assignContext<
                ChatGPTRegistrationFlowState,
                ChatGPTRegistrationFlowContext<ChatGPTRegistrationFlowResult>,
                ChatGPTRegistrationFlowEvent,
                ChatGPTAgeGateOutcomeInput
              >((context, { input }) => {
                const nextAttempt = (context.ageGateRetryCount ?? 0) + 1
                return isAgeGateOutcomeInput(input)
                  ? {
                      url: input.url,
                      ageGateRetryCount: nextAttempt,
                      lastAttempt: nextAttempt,
                      lastMessage: 'Retrying age gate submission',
                    }
                  : {}
              }),
            },
            {
              priority: 10,
              target: 'age-gate',
              actions: assignContext<
                ChatGPTRegistrationFlowState,
                ChatGPTRegistrationFlowContext<ChatGPTRegistrationFlowResult>,
                ChatGPTRegistrationFlowEvent,
                ChatGPTAgeGateOutcomeInput
              >((context, { input }) =>
                isAgeGateOutcomeInput(input)
                  ? {
                      url: input.url,
                      ageGateRetryCount: context.ageGateRetryCount ?? 0,
                      lastAttempt: context.lastAttempt,
                      lastMessage: 'Age gate is still pending',
                    }
                  : {},
              ),
            },
          ],
        },
      },
    },
  })
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

function isAboutYouUrl(url: string): boolean {
  return /\/about-you(?:[/?#]|$)/i.test(url)
}

async function fillRegistrationAgeGateFields(
  page: Page,
): Promise<'birthday' | 'age' | null> {
  await fillAgeGateName(page)
  if (await fillAgeGateBirthday(page)) {
    return 'birthday'
  }
  if (await fillAgeGateAge(page)) {
    return 'age'
  }
  return null
}

async function waitForAgeGateSubmissionOutcome(
  page: Page,
  timeoutMs = 10000,
): Promise<'advanced' | 'retry' | 'age-gate'> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAboutYouUrl(page.url())) {
      return 'advanced'
    }
    const retryVisible = await waitForAnySelectorState(
      page,
      PASSWORD_TIMEOUT_RETRY_SELECTORS,
      'visible',
      250,
    )
    if (retryVisible) {
      return 'retry'
    }
    await sleep(250)
  }

  if (!isAboutYouUrl(page.url())) {
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
    if (!ageGateVisible && !isAboutYouUrl(page.url())) {
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

    const postEmailStep = await waitForPostEmailLoginStep(page, 20000)
    if (postEmailStep === 'password' || postEmailStep === 'verification') {
      attemptedMethod = 'password'
      const fallback = await completePasswordOrVerificationLoginFallback(page, {
        email: options.email,
        password: options.password,
        step: postEmailStep,
        startedAt,
        verificationProvider: options.verificationProvider,
        verificationTimeoutMs: options.verificationTimeoutMs,
        pollIntervalMs: options.pollIntervalMs,
      })
      const authenticated = await waitForAuthenticatedSession(page, 30000)
      return {
        attempted: true,
        authenticated,
        method: fallback.method,
        ...(authenticated
          ? {}
          : { error: 'Password fallback login did not authenticate.' }),
      }
    }

    if (postEmailStep === 'authenticated') {
      return { attempted: true, authenticated: true, method: 'passkey' }
    }

    const passkeyReady =
      postEmailStep === 'passkey'
        ? true
        : await waitForPasskeyEntryReady(page, 20000)
    if (!passkeyReady)
      throw new Error(
        'Passkey entry button did not appear on the login surface.',
      )
    const triggered = await clickPasskeyEntry(page)
    if (!triggered)
      throw new Error(
        'Passkey entry button became visible but could not be clicked.',
      )

    const authenticated = await waitForAuthenticatedSession(page, 30000)
    return {
      attempted: true,
      authenticated,
      method: 'passkey',
      ...(authenticated
        ? {}
        : { error: 'Passkey login did not authenticate.' }),
    }
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
  const { email, prefix, mailbox } =
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
    await clickSignupEntry(page)

    await sendRegistrationMachine(
      machine,
      'email-step',
      'chatgpt.email.started',
      {
        email,
        url: page.url(),
        lastMessage: 'Waiting for registration email step',
      },
    )
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

    await sendRegistrationMachine(
      machine,
      'password-step',
      'chatgpt.email.submitted',
      {
        email,
        url: page.url(),
        lastMessage: 'Registration email submitted',
      },
    )
    const postEmailStep = await waitForPostEmailLoginStep(page, 20000)
    if (postEmailStep === 'password') {
      await sendRegistrationMachine(
        machine,
        'password-step',
        'chatgpt.password.started',
        {
          url: page.url(),
          lastMessage: 'Waiting for password step',
        },
      )
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const passwordReady = await waitForPasswordInputReady(page, 10000)
        if (!passwordReady) {
          throw new Error('ChatGPT password step did not become ready.')
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
            { role: 'button', options: { name: /继续|continue|注册|create/i } },
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
    } else if (postEmailStep === 'retry') {
      throw new Error(
        'ChatGPT registration returned to the email step repeatedly after submission.',
      )
    } else if (postEmailStep !== 'verification') {
      throw new Error(
        'ChatGPT registration did not reach a supported post-email step.',
      )
    }

    await sendRegistrationMachine(
      machine,
      'verification-polling',
      postEmailStep === 'password'
        ? 'chatgpt.password.submitted'
        : 'context.updated',
      {
        url: page.url(),
        lastMessage:
          postEmailStep === 'password'
            ? 'Waiting for verification email'
            : 'Registration requested email verification',
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
