import type { Page } from 'patchright'
import type { SelectorList } from '../../types'
import {
  assignContextFromInput,
  composeStateMachineConfig,
  createGuardedCaseTransitions,
  createPatchTransitionMap,
  createRetryTransition,
  createSelfPatchTransitionMap,
  createStateMachine,
  defineStateMachineFragment,
  type StateMachineController,
  type StateMachineSnapshot,
} from '../../state-machine'
import type { AccountType } from '../common/account-types'
import type { LoginOptions, LoginResult } from '../login'
import type { RegistrationOptions, RegistrationResult } from '../registration'
import type { VirtualPasskeyStore } from '../webauthn'

export type AuthMachineKind = 'login' | 'registration'

export type AuthMachineState =
  | 'idle'
  | 'opening'
  | 'ready'
  | 'retrying'
  | 'typing-email'
  | 'typing-password'
  | 'typing-organization'
  | 'toggling-remember-me'
  | 'choosing-passkey'
  | 'waiting-passkey'
  | 'submitting'
  | 'post-submit'
  | 'capturing-passkey'
  | 'completed'
  | 'failed'

export type AuthMachineEvent =
  | 'machine.started'
  | 'auth.opened'
  | 'auth.ready'
  | 'auth.retry.requested'
  | 'auth.email.typed'
  | 'auth.password.typed'
  | 'auth.organization.typed'
  | 'auth.remember-me.checked'
  | 'auth.method.resolved'
  | 'auth.passkey.chosen'
  | 'auth.passkey.prompted'
  | 'auth.submitted'
  | 'auth.after-submit.started'
  | 'auth.after-submit.finished'
  | 'auth.passkey.capture.started'
  | 'auth.passkey.capture.finished'
  | 'auth.completed'
  | 'auth.failed'
  | 'context.updated'
  | 'action.started'
  | 'action.finished'

export interface AuthMachineContext<Result = unknown> {
  kind: AuthMachineKind
  accountType?: AccountType
  url?: string
  email?: string | null
  method?: 'password' | 'passkey'
  createPasskey?: boolean
  preferPasskey?: boolean
  organizationName?: string | null
  passkeyCreated?: boolean
  passkeyStore?: VirtualPasskeyStore
  lastSelectors?: SelectorList
  retryCount?: number
  retryReason?: string
  retryFromState?: AuthMachineState
  lastAttempt?: number
  lastMessage?: string
  result?: Result
}

export type AuthMachine<Result = unknown> = StateMachineController<
  AuthMachineState,
  AuthMachineContext<Result>,
  AuthMachineEvent
>

export type AuthMachineSnapshotResult<Result = unknown> = StateMachineSnapshot<
  AuthMachineState,
  AuthMachineContext<Result>,
  AuthMachineEvent
>

export interface LoginMachineOptions {
  id?: string
  options?: LoginOptions
}

export interface RegistrationMachineOptions {
  id?: string
  options?: RegistrationOptions
}

export interface AuthMethodResolutionInput {
  supportsPasskey: boolean
  passkeySelectors?: SelectorList
  emailSelectors?: SelectorList
  passkeyMessage?: string
  passwordMessage?: string
}

function isAuthMethodResolutionInput(
  value: unknown,
): value is AuthMethodResolutionInput {
  if (!value || typeof value !== 'object') {
    return false
  }

  return 'supportsPasskey' in value
}

const authEventTargets = {
  'action.started': 'opening',
  'auth.opened': 'ready',
  'auth.ready': 'ready',
  'auth.email.typed': 'typing-email',
  'auth.password.typed': 'typing-password',
  'auth.organization.typed': 'typing-organization',
  'auth.remember-me.checked': 'toggling-remember-me',
  'auth.passkey.chosen': 'choosing-passkey',
  'auth.passkey.prompted': 'waiting-passkey',
  'auth.submitted': 'submitting',
  'auth.after-submit.started': 'post-submit',
  'auth.after-submit.finished': 'post-submit',
  'auth.passkey.capture.started': 'capturing-passkey',
  'auth.passkey.capture.finished': 'capturing-passkey',
} as const satisfies Partial<Record<AuthMachineEvent, AuthMachineState>>

const authMutableContextEvents = [
  'context.updated',
  'action.finished',
] as const satisfies AuthMachineEvent[]

function createAuthLifecycleFragment<Result>() {
  return defineStateMachineFragment<
    AuthMachineState,
    AuthMachineContext<Result>,
    AuthMachineEvent
  >({
    on: {
      ...createPatchTransitionMap<
        AuthMachineState,
        AuthMachineContext<Result>,
        AuthMachineEvent
      >(authEventTargets),
      'auth.retry.requested': createRetryTransition<
        AuthMachineState,
        AuthMachineContext<Result>,
        AuthMachineEvent
      >({
        target: 'retrying',
        defaultMessage: 'Retrying auth flow',
      }),
      ...createSelfPatchTransitionMap<
        AuthMachineState,
        AuthMachineContext<Result>,
        AuthMachineEvent
      >([...authMutableContextEvents]),
    },
  })
}

function createAuthMethodResolutionFragment<Result>() {
  return defineStateMachineFragment<
    AuthMachineState,
    AuthMachineContext<Result>,
    AuthMachineEvent
  >({
    on: {
      'auth.method.resolved': createGuardedCaseTransitions<
        AuthMachineState,
        AuthMachineContext<Result>,
        AuthMachineEvent,
        AuthMethodResolutionInput
      >({
        isInput: isAuthMethodResolutionInput,
        cases: [
          {
            priority: 20,
            when: ({ context, input }) =>
              context.preferPasskey !== false && input.supportsPasskey,
            target: 'choosing-passkey',
            actions: assignContextFromInput<
              AuthMachineState,
              AuthMachineContext<Result>,
              AuthMachineEvent,
              AuthMethodResolutionInput
            >(isAuthMethodResolutionInput, (currentContext, { input }) => ({
              method: 'passkey',
              lastSelectors:
                input.passkeySelectors ?? currentContext.lastSelectors,
              lastMessage: input.passkeyMessage || 'Trying passkey login',
            })),
          },
          {
            priority: 10,
            target: 'typing-email',
            actions: assignContextFromInput<
              AuthMachineState,
              AuthMachineContext<Result>,
              AuthMachineEvent,
              AuthMethodResolutionInput
            >(isAuthMethodResolutionInput, (currentContext, { input }) => ({
              method: 'password',
              lastSelectors:
                input.emailSelectors ?? currentContext.lastSelectors,
              lastMessage: input.passwordMessage || 'Typing login email',
            })),
          },
        ],
      }),
    },
  })
}

function buildBaseMachine<Result>(
  kind: AuthMachineKind,
  id: string,
  context: Partial<AuthMachineContext<Result>> = {},
): AuthMachine<Result> {
  return createStateMachine<
    AuthMachineState,
    AuthMachineContext<Result>,
    AuthMachineEvent
  >(
    composeStateMachineConfig(
      {
        id,
        initialState: 'idle',
        initialContext: {
          kind,
          ...context,
        } as AuthMachineContext<Result>,
      },
      createAuthLifecycleFragment<Result>(),
      createAuthMethodResolutionFragment<Result>(),
    ),
  )
}

export function createLoginMachine(
  config: LoginMachineOptions = {},
): AuthMachine<LoginResult> {
  return buildBaseMachine<LoginResult>('login', config.id ?? 'auth.login', {
    accountType: config.options?.accountType as AccountType | undefined,
    url: config.options?.url,
    email: config.options?.email ?? null,
    preferPasskey: config.options?.preferPasskey,
  })
}

export function createRegistrationMachine(
  config: RegistrationMachineOptions = {},
): AuthMachine<RegistrationResult> {
  return buildBaseMachine<RegistrationResult>(
    'registration',
    config.id ?? 'auth.registration',
    {
      accountType: config.options?.accountType as AccountType | undefined,
      url: config.options?.url,
      email: config.options?.email ?? null,
      organizationName: config.options?.organizationName ?? null,
      createPasskey: config.options?.createPasskey ?? false,
    },
  )
}

export function startAuthMachine<Result>(
  machine: AuthMachine<Result>,
  context: Partial<AuthMachineContext<Result>>,
): AuthMachineSnapshotResult<Result> {
  return machine.start(context, {
    source: 'auth-machine',
  })
}

export async function runWithAuthMachine<Result>(
  machine: AuthMachine<Result> | undefined,
  context: Partial<AuthMachineContext<Result>>,
  action: () => Promise<Result>,
): Promise<Result> {
  if (!machine) return action()

  startAuthMachine(machine, context)
  try {
    const result = await action()
    machine.succeed('completed', {
      event: 'auth.completed',
      patch: { result } as Partial<AuthMachineContext<Result>>,
      meta: { source: 'auth-machine' },
    })
    return result
  } catch (error) {
    machine.fail(error, 'failed', {
      event: 'auth.failed',
      meta: { source: 'auth-machine' },
    })
    throw error
  }
}

export async function resolveAuthMethod<Result>(
  machine: AuthMachine<Result>,
  input: AuthMethodResolutionInput,
): Promise<'password' | 'passkey'> {
  const snapshot = await machine.send('auth.method.resolved', input)
  return snapshot.context.method === 'passkey' ? 'passkey' : 'password'
}

export async function markAuthOpened<Result>(
  machine: AuthMachine<Result> | undefined,
  page: Page,
  selectors?: SelectorList,
): Promise<void> {
  if (!machine) return
  await machine.send('auth.opened', {
    target: 'ready',
    patch: {
      url: page.url(),
      lastSelectors: selectors,
      lastMessage: 'Authentication surface opened',
    } as Partial<AuthMachineContext<Result>>,
  })
}

export async function markAuthStep<Result>(
  machine: AuthMachine<Result> | undefined,
  state: AuthMachineState,
  event: AuthMachineEvent,
  patch?: Partial<AuthMachineContext<Result>>,
): Promise<void> {
  if (!machine) return
  await machine.send(event, {
    target: state,
    patch,
  })
}
