import type { Page } from 'patchright'
import { pathToFileURL } from 'url'
import { getRuntimeConfig } from '../config'
import { createStateMachine } from '../state-machine'
import { syncManagedIdentityToCodeyApp } from '../modules/app-auth/managed-identities'
import {
  resolveStoredChatGPTIdentity,
  type StoredChatGPTIdentitySummary,
} from '../modules/credentials'
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
  createPasskeyAssertionTracker,
  logStep,
  summarizePasskeyCredentials,
  waitForAuthenticatedSession,
  waitForLoginSurface,
  waitForPasskeyEntryReady,
  waitForRetryOrPasskeyEntryReady,
  clickLoginEntryIfPresent,
  clickPasskeyEntry,
  clickPasswordTimeoutRetry,
  completePasswordOrVerificationLoginFallback,
  gotoLoginEntry,
  submitLoginEmail,
  waitForPostEmailLoginStep,
} from '../modules/chatgpt/shared'
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
  sanitizeErrorForOutput,
} from '../modules/flow-cli/helpers'
import { parseFlowCliArgs } from '../modules/flow-cli/parse-argv'

export type ChatGPTLoginPasskeyFlowKind = 'chatgpt-login-passkey'

export type ChatGPTLoginPasskeyFlowState =
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
  | 'authenticated'
  | 'completed'
  | 'failed'

export type ChatGPTLoginPasskeyFlowEvent =
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
  | 'chatgpt.authenticated'
  | 'chatgpt.completed'
  | 'chatgpt.failed'
  | 'context.updated'
  | 'action.started'
  | 'action.finished'

export interface ChatGPTLoginPasskeyFlowContext<Result = unknown> {
  kind: ChatGPTLoginPasskeyFlowKind
  url?: string
  title?: string
  email?: string
  verificationCode?: string
  method?: 'password' | 'passkey' | 'verification'
  passkeyCreated?: boolean
  passkeyStore?: VirtualPasskeyStore
  assertionObserved?: boolean
  storedIdentity?: StoredChatGPTIdentitySummary
  lastMessage?: string
  result?: Result
}

export type ChatGPTLoginPasskeyFlowMachine<Result = unknown> =
  StateMachineController<
    ChatGPTLoginPasskeyFlowState,
    ChatGPTLoginPasskeyFlowContext<Result>,
    ChatGPTLoginPasskeyFlowEvent
  >

export type ChatGPTLoginPasskeyFlowSnapshot<Result = unknown> =
  StateMachineSnapshot<
    ChatGPTLoginPasskeyFlowState,
    ChatGPTLoginPasskeyFlowContext<Result>,
    ChatGPTLoginPasskeyFlowEvent
  >

export interface ChatGPTLoginPasskeyFlowOptions {
  identityId?: string
  email?: string
  virtualAuthenticator?: VirtualAuthenticatorOptions
  machine?: ChatGPTLoginPasskeyFlowMachine<ChatGPTLoginPasskeyFlowResult>
}

export interface ChatGPTLoginPasskeyFlowResult {
  pageName: 'chatgpt-login-passkey'
  url: string
  title: string
  email: string
  method: 'passkey' | 'password' | 'verification'
  authenticated: boolean
  storedIdentity: StoredChatGPTIdentitySummary
  machine: ChatGPTLoginPasskeyFlowSnapshot<ChatGPTLoginPasskeyFlowResult>
}

type ChatGPTLoginSurfaceStrategy = 'open-entry' | 'current-page'

export interface ChatGPTStoredPasskeyLoginResult {
  email: string
  storedIdentity: StoredChatGPTIdentitySummary
  surface: 'authenticated' | 'email' | 'passkey'
  method: 'passkey' | 'password' | 'verification'
  assertionObserved: boolean
  passkeyStore: VirtualPasskeyStore
  verificationCode?: string
}

export function createChatGPTLoginPasskeyMachine(): ChatGPTLoginPasskeyFlowMachine<ChatGPTLoginPasskeyFlowResult> {
  return createStateMachine<
    ChatGPTLoginPasskeyFlowState,
    ChatGPTLoginPasskeyFlowContext<ChatGPTLoginPasskeyFlowResult>,
    ChatGPTLoginPasskeyFlowEvent
  >({
    id: 'flow.chatgpt.login-passkey',
    initialState: 'idle',
    initialContext: {
      kind: 'chatgpt-login-passkey',
    },
    historyLimit: 200,
  })
}

function transitionLoginMachine(
  machine: ChatGPTLoginPasskeyFlowMachine<ChatGPTLoginPasskeyFlowResult>,
  state: ChatGPTLoginPasskeyFlowState,
  event: ChatGPTLoginPasskeyFlowEvent,
  patch?: Partial<
    ChatGPTLoginPasskeyFlowContext<ChatGPTLoginPasskeyFlowResult>
  >,
): void {
  machine.transition(state, {
    event,
    patch,
  })
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

async function triggerStoredPasskeyLogin(
  page: Page,
  stored: ResolvedChatGPTIdentity,
  options: {
    virtualAuthenticator?: VirtualAuthenticatorOptions
    onPasskeyRetry?: (
      attempt: number,
      trigger: 'retry' | 'passkey',
    ) => void
  } = {},
): Promise<{
  method: 'passkey' | 'password' | 'verification'
  assertionObserved: boolean
  passkeyStore: VirtualPasskeyStore
  verificationCode?: string
}> {
  const hasPasskey = Boolean(stored.identity.passkeyStore?.credentials.length)
  if (!hasPasskey) {
    throw new Error(
      `Stored identity ${stored.identity.email} does not contain a passkey credential.`,
    )
  }

  logStep('login_passkey_store_before_import', {
    email: stored.identity.email,
    credentials: summarizePasskeyCredentials(stored.identity.passkeyStore),
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

  const importedStore = await captureVirtualPasskeyStore(
    virtualAuth.session,
    virtualAuth.authenticatorId,
  )
  const tracker = createPasskeyAssertionTracker(
    virtualAuth.session,
    virtualAuth.authenticatorId,
    importedStore,
  )

  try {
    let assertionObserved = false

    if (await waitForAuthenticatedSession(page, 5000)) {
      return {
        method: 'passkey',
        assertionObserved: false,
        passkeyStore: importedStore,
      }
    }

    const startedAt = new Date().toISOString()
    await submitLoginEmail(page, stored.identity.email)

    const postEmailStep = await waitForPostEmailLoginStep(page, 20000)
    if (postEmailStep === 'password' || postEmailStep === 'verification') {
      const config = getRuntimeConfig()
      let verificationProvider: VerificationProvider | undefined
      const fallback = await completePasswordOrVerificationLoginFallback(page, {
        email: stored.identity.email,
        password: stored.identity.password,
        step: postEmailStep,
        startedAt,
        getVerificationProvider: () => {
          verificationProvider ??= createVerificationProvider(config)
          return verificationProvider
        },
      })
      return {
        method: fallback.method,
        assertionObserved: false,
        passkeyStore: importedStore,
        verificationCode: fallback.verificationCode,
      }
    }

    if (postEmailStep === 'authenticated') {
      return {
        method: 'passkey',
        assertionObserved: false,
        passkeyStore: importedStore,
      }
    }

    let initialTrigger: 'retry' | 'passkey' = 'passkey'
    let retryOnlyMode = false
    if (postEmailStep === 'passkey') {
      const conditionalAssertionObserved = await tracker.waitForAssertion(4000)
      assertionObserved = conditionalAssertionObserved || assertionObserved

      if (conditionalAssertionObserved) {
        logStep('login_passkey_conditional_attempt_observed', {
          email: stored.identity.email,
        })
        if (await waitForAuthenticatedSession(page, 5000)) {
          const passkeyStore = await captureVirtualPasskeyStore(
            virtualAuth.session,
            virtualAuth.authenticatorId,
          )
          return {
            method: 'passkey',
            assertionObserved,
            passkeyStore,
          }
        }
      }

      const settledTrigger = await waitForRetryOrPasskeyEntryReady(page, 4000)
      if (settledTrigger !== 'none') {
        initialTrigger = settledTrigger
        retryOnlyMode = settledTrigger === 'retry'
      }
    } else {
      const passkeyReady = await waitForPasskeyEntryReady(page, 20000)
      if (!passkeyReady) {
        throw new Error(
          'Passkey entry button did not appear on the login surface.',
        )
      }
    }

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      let triggered = false
      let trigger: 'retry' | 'passkey' = initialTrigger

      if (attempt === 1) {
        triggered =
          trigger === 'retry'
            ? await clickPasswordTimeoutRetry(page)
            : await clickPasskeyEntry(page)
      } else {
        const nextTrigger = await waitForRetryOrPasskeyEntryReady(
          page,
          10000,
          !retryOnlyMode,
        )
        if (nextTrigger === 'none') break
        trigger = nextTrigger
        retryOnlyMode ||= trigger === 'retry'

        options.onPasskeyRetry?.(attempt, trigger)
        logStep('login_passkey_retry_triggered', {
          email: stored.identity.email,
          attempt,
          trigger,
        })
        triggered =
          trigger === 'retry'
            ? await clickPasswordTimeoutRetry(page)
            : await clickPasskeyEntry(page)
      }

      if (!triggered) {
        throw new Error(
          trigger === 'retry'
            ? 'Passkey retry button became visible but could not be clicked.'
            : 'Passkey entry button became visible but could not be clicked.',
        )
      }

      assertionObserved =
        (await tracker.waitForAssertion(10000)) || assertionObserved

      if (await waitForAuthenticatedSession(page, 5000)) {
        const passkeyStore = await captureVirtualPasskeyStore(
          virtualAuth.session,
          virtualAuth.authenticatorId,
        )
        return {
          method: 'passkey',
          assertionObserved,
          passkeyStore,
        }
      }

      if (trigger === 'retry') {
        retryOnlyMode = true
      }
    }

    const passkeyStore = await captureVirtualPasskeyStore(
      virtualAuth.session,
      virtualAuth.authenticatorId,
    )
    return {
      method: 'passkey',
      assertionObserved,
      passkeyStore,
    }
  } finally {
    tracker.dispose()
  }
}

export async function performStoredPasskeyLogin(
  page: Page,
  stored: ResolvedChatGPTIdentity,
  options: {
    virtualAuthenticator?: VirtualAuthenticatorOptions
    surfaceStrategy?: ChatGPTLoginSurfaceStrategy
    onPasskeyRetry?: (
      attempt: number,
      trigger: 'retry' | 'passkey',
    ) => void
  } = {},
): Promise<{
  surface: 'authenticated' | 'email' | 'passkey'
  method: 'passkey' | 'password' | 'verification'
  assertionObserved: boolean
  passkeyStore: VirtualPasskeyStore
  verificationCode?: string
}> {
  const surface = await reachChatGPTLoginSurface(
    page,
    options.surfaceStrategy,
  )
  const passkey = await triggerStoredPasskeyLogin(page, stored, options)
  return {
    surface,
    ...passkey,
  }
}

// Continue an already-open ChatGPT/OpenAI login challenge without navigating away.
export async function continueChatGPTLoginWithStoredPasskey(
  page: Page,
  options: FlowOptions &
    Pick<Partial<ChatGPTLoginPasskeyFlowOptions>, 'virtualAuthenticator'> = {},
): Promise<ChatGPTStoredPasskeyLoginResult> {
  const stored = resolveStoredChatGPTIdentity({
    id: options.identityId,
    email: options.email,
  })
  const passkey = await performStoredPasskeyLogin(page, stored, {
    virtualAuthenticator: options.virtualAuthenticator,
    surfaceStrategy: 'current-page',
    onPasskeyRetry: (attempt, trigger) => {
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

export async function loginChatGPTWithStoredPasskey(
  page: Page,
  options: FlowOptions &
    Pick<Partial<ChatGPTLoginPasskeyFlowOptions>, 'virtualAuthenticator'> = {},
): Promise<ChatGPTLoginPasskeyFlowResult> {
  const machine = createChatGPTLoginPasskeyMachine()
  const detachProgress = attachStateMachineProgressReporter(
    machine,
    options.progressReporter,
  )
  const stored = resolveStoredChatGPTIdentity({
    id: options.identityId,
    email: options.email,
  })

  try {
    machine.start(
      {
        email: stored.identity.email,
        storedIdentity: stored.summary,
        method: 'passkey',
        passkeyCreated: Boolean(stored.identity.passkeyStore?.credentials.length),
        passkeyStore: stored.identity.passkeyStore,
        url: CHATGPT_ENTRY_LOGIN_URL,
      },
      {
        source: 'loginChatGPTWithStoredPasskey',
      },
    )

    transitionLoginMachine(machine, 'opening-entry', 'chatgpt.entry.opened', {
      email: stored.identity.email,
      url: CHATGPT_ENTRY_LOGIN_URL,
      lastMessage: 'Opening ChatGPT login entry',
    })
    const passkey = await performStoredPasskeyLogin(page, stored, {
      virtualAuthenticator: options.virtualAuthenticator,
      onPasskeyRetry: (attempt, trigger) => {
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
      transitionLoginMachine(
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
      transitionLoginMachine(
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
      transitionLoginMachine(machine, 'email-step', 'chatgpt.email.started', {
        email: stored.identity.email,
        url: page.url(),
        lastMessage: 'Submitting login email',
      })
      transitionLoginMachine(
        machine,
        'passkey-login',
        'chatgpt.email.submitted',
        {
          email: stored.identity.email,
          url: page.url(),
          lastMessage: 'Login email submitted',
        },
      )
    }

    if (passkey.method === 'passkey') {
      transitionLoginMachine(
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
      transitionLoginMachine(machine, 'passkey-login', 'context.updated', {
        email: stored.identity.email,
        method: passkey.method,
        assertionObserved: passkey.assertionObserved,
        passkeyStore: passkey.passkeyStore,
        storedIdentity: stored.summary,
        url: page.url(),
        lastMessage: 'Passkey login triggered',
      })
    } else {
      transitionLoginMachine(
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
      transitionLoginMachine(
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
    try {
      const syncedIdentity = await syncManagedIdentityToCodeyApp({
        identityId: stored.summary.id,
        email: stored.summary.email,
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
    const result = {
      pageName: 'chatgpt-login-passkey' as const,
      url: page.url(),
      title,
      email: stored.identity.email,
      method: passkey.method,
      authenticated: true,
      storedIdentity: stored.summary,
      machine:
        undefined as unknown as ChatGPTLoginPasskeyFlowSnapshot<ChatGPTLoginPasskeyFlowResult>,
    }
    const snapshot = machine.succeed('completed', {
      event: 'chatgpt.completed',
      patch: {
        email: stored.identity.email,
        method: passkey.method,
        storedIdentity: stored.summary,
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
        lastMessage: 'ChatGPT passkey login failed',
      },
    })
    throw error
  } finally {
    detachProgress()
  }
}

export const chatgptLoginPasskeyFlow: SingleFileFlowDefinition<
  FlowOptions,
  ChatGPTLoginPasskeyFlowResult
> = {
  command: 'flow:chatgpt-login-passkey',
  run: loginChatGPTWithStoredPasskey,
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runSingleFileFlowFromCli(
    chatgptLoginPasskeyFlow,
    parseFlowCliArgs(process.argv.slice(2)),
  )
}
