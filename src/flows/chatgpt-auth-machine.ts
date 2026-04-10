import { createStateMachine, type StateMachineController, type StateMachineSnapshot } from '../state-machine';
import type { RegistrationResult } from '../modules/registration';
import type { StoredChatGPTIdentitySummary } from '../modules/credentials';
import type { VirtualPasskeyStore } from '../modules/webauthn';
import type {
  ChatGPTLoginPasskeyFlowResult,
  ChatGPTRegistrationFlowResult,
  SameSessionPasskeyCheckResult,
} from './openai';

export type ChatGPTAuthFlowKind = 'chatgpt-registration' | 'chatgpt-login-passkey';

export type ChatGPTAuthFlowState =
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
  | 'failed';

export type ChatGPTAuthFlowEvent =
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
  | 'action.finished';

export interface ChatGPTAuthFlowContext<Result = unknown> {
  kind: ChatGPTAuthFlowKind;
  url?: string;
  title?: string;
  email?: string;
  prefix?: string;
  verificationCode?: string;
  method?: 'password' | 'passkey';
  createPasskey?: boolean;
  passkeyCreated?: boolean;
  passkeyStore?: VirtualPasskeyStore;
  usedEmailFallback?: boolean;
  assertionObserved?: boolean;
  storedIdentity?: StoredChatGPTIdentitySummary;
  registration?: RegistrationResult;
  sameSessionPasskeyCheck?: SameSessionPasskeyCheckResult;
  mailbox?: string;
  lastMessage?: string;
  lastAttempt?: number;
  result?: Result;
}

export type ChatGPTAuthFlowMachine<Result = unknown> = StateMachineController<
  ChatGPTAuthFlowState,
  ChatGPTAuthFlowContext<Result>,
  ChatGPTAuthFlowEvent
>;

export type ChatGPTAuthFlowSnapshot<Result = unknown> = StateMachineSnapshot<
  ChatGPTAuthFlowState,
  ChatGPTAuthFlowContext<Result>,
  ChatGPTAuthFlowEvent
>;

function createChatGPTAuthMachine<Result>(
  id: string,
  kind: ChatGPTAuthFlowKind,
): ChatGPTAuthFlowMachine<Result> {
  return createStateMachine<ChatGPTAuthFlowState, ChatGPTAuthFlowContext<Result>, ChatGPTAuthFlowEvent>({
    id,
    initialState: 'idle',
    initialContext: {
      kind,
    } as ChatGPTAuthFlowContext<Result>,
    historyLimit: 200,
  });
}

export function createChatGPTRegistrationMachine(): ChatGPTAuthFlowMachine<ChatGPTRegistrationFlowResult> {
  return createChatGPTAuthMachine('flow.chatgpt.registration', 'chatgpt-registration');
}

export function createChatGPTLoginPasskeyMachine(): ChatGPTAuthFlowMachine<ChatGPTLoginPasskeyFlowResult> {
  return createChatGPTAuthMachine('flow.chatgpt.login-passkey', 'chatgpt-login-passkey');
}
