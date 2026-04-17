import type { Page } from 'patchright'
import type { SelectorList } from '../../types'
import {
  assignContext,
  createStateMachine,
  type StateMachineTransitionDefinition,
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

interface AuthMachineEventInput<Result = unknown> {
  target?: AuthMachineState
  patch?: Partial<AuthMachineContext<Result>>
}

interface AuthMachineRetryInput<Result = unknown> {
  patch?: Partial<AuthMachineContext<Result>>
  reason?: string
  message?: string
}

function isAuthMethodResolutionInput(
  value: unknown,
): value is AuthMethodResolutionInput {
  if (!value || typeof value !== 'object') {
    return false
  }

  return 'supportsPasskey' in value
}

function shouldUsePasskey<Result>({
  context,
  input,
}: {
  context: AuthMachineContext<Result>
  input: unknown
}): boolean {
  return (
    isAuthMethodResolutionInput(input) &&
    context.preferPasskey !== false &&
    input.supportsPasskey
  )
}

function isAuthMachineEventInput<Result>(
  value: unknown,
): value is AuthMachineEventInput<Result> {
  if (!value || typeof value !== 'object') {
    return false
  }

  return 'patch' in value || 'target' in value
}

function isAuthMachineRetryInput<Result>(
  value: unknown,
): value is AuthMachineRetryInput<Result> {
  return Boolean(value && typeof value === 'object')
}

function createAuthEventTransition<Result>(
  defaultTarget: AuthMachineState,
): StateMachineTransitionDefinition<
  AuthMachineState,
  AuthMachineContext<Result>,
  AuthMachineEvent
> {
  return {
    target: ({ input }) =>
      isAuthMachineEventInput<Result>(input)
        ? (input.target ?? defaultTarget)
        : defaultTarget,
    actions: assignContext<
      AuthMachineState,
      AuthMachineContext<Result>,
      AuthMachineEvent,
      AuthMachineEventInput<Result>
    >((_context, { input }) =>
      isAuthMachineEventInput<Result>(input) ? (input.patch ?? {}) : {},
    ),
  }
}

function createAuthRetryTransition<Result>(): StateMachineTransitionDefinition<
  AuthMachineState,
  AuthMachineContext<Result>,
  AuthMachineEvent
> {
  return {
    priority: 100,
    target: 'retrying',
    actions: assignContext<
      AuthMachineState,
      AuthMachineContext<Result>,
      AuthMachineEvent,
      AuthMachineRetryInput<Result>
    >((context, { input, from }) => {
      const retryInput = isAuthMachineRetryInput<Result>(input)
        ? input
        : undefined
      const nextAttempt = (context.retryCount ?? 0) + 1
      return {
        ...retryInput?.patch,
        retryCount: nextAttempt,
        retryReason: retryInput?.reason ?? context.retryReason,
        retryFromState: from,
        lastAttempt: nextAttempt,
        lastMessage: retryInput?.message ?? 'Retrying auth flow',
      }
    }),
  }
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
  >({
    id,
    initialState: 'idle',
    initialContext: {
      kind,
      ...context,
    } as AuthMachineContext<Result>,
    on: {
      'action.started': createAuthEventTransition<Result>('opening'),
      'auth.opened': createAuthEventTransition<Result>('ready'),
      'auth.ready': createAuthEventTransition<Result>('ready'),
      'auth.retry.requested': createAuthRetryTransition<Result>(),
      'auth.email.typed': createAuthEventTransition<Result>('typing-email'),
      'auth.password.typed':
        createAuthEventTransition<Result>('typing-password'),
      'auth.organization.typed': createAuthEventTransition<Result>(
        'typing-organization',
      ),
      'auth.remember-me.checked': createAuthEventTransition<Result>(
        'toggling-remember-me',
      ),
      'auth.method.resolved': [
        {
          priority: 20,
          guard: ({ context: currentContext, input }) =>
            shouldUsePasskey<Result>({
              context: currentContext,
              input,
            }),
          target: 'choosing-passkey',
          actions: assignContext<
            AuthMachineState,
            AuthMachineContext<Result>,
            AuthMachineEvent,
            AuthMethodResolutionInput
          >((currentContext, { input }) => ({
            method: 'passkey',
            lastSelectors:
              input.passkeySelectors ?? currentContext.lastSelectors,
            lastMessage: input.passkeyMessage || 'Trying passkey login',
          })),
        },
        {
          priority: 10,
          target: 'typing-email',
          actions: assignContext<
            AuthMachineState,
            AuthMachineContext<Result>,
            AuthMachineEvent,
            AuthMethodResolutionInput
          >((currentContext, { input }) => ({
            method: 'password',
            lastSelectors: input.emailSelectors ?? currentContext.lastSelectors,
            lastMessage: input.passwordMessage || 'Typing login email',
          })),
        },
      ],
      'auth.passkey.chosen':
        createAuthEventTransition<Result>('choosing-passkey'),
      'auth.passkey.prompted':
        createAuthEventTransition<Result>('waiting-passkey'),
      'auth.submitted': createAuthEventTransition<Result>('submitting'),
      'auth.after-submit.started':
        createAuthEventTransition<Result>('post-submit'),
      'auth.after-submit.finished':
        createAuthEventTransition<Result>('post-submit'),
      'auth.passkey.capture.started':
        createAuthEventTransition<Result>('capturing-passkey'),
      'auth.passkey.capture.finished':
        createAuthEventTransition<Result>('capturing-passkey'),
      'context.updated': {
        target: ({ from, input }) =>
          isAuthMachineEventInput<Result>(input)
            ? (input.target ?? from)
            : from,
        actions: assignContext<
          AuthMachineState,
          AuthMachineContext<Result>,
          AuthMachineEvent,
          AuthMachineEventInput<Result>
        >((_context, { input }) =>
          isAuthMachineEventInput<Result>(input) ? (input.patch ?? {}) : {},
        ),
      },
      'action.finished': {
        target: ({ from, input }) =>
          isAuthMachineEventInput<Result>(input)
            ? (input.target ?? from)
            : from,
        actions: assignContext<
          AuthMachineState,
          AuthMachineContext<Result>,
          AuthMachineEvent,
          AuthMachineEventInput<Result>
        >((_context, { input }) =>
          isAuthMachineEventInput<Result>(input) ? (input.patch ?? {}) : {},
        ),
      },
    },
  })
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
