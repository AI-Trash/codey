import type { Page } from 'patchright';
import { pathToFileURL } from 'url';
import { createStateMachine } from '../state-machine';
import type { RegistrationResult } from '../modules/registration';
import type { VirtualAuthenticatorOptions, VirtualPasskeyStore } from '../modules/webauthn';
import type { StoredChatGPTIdentitySummary } from '../modules/credentials';
import type { StateMachineController, StateMachineSnapshot } from '../state-machine';
import {
  registerChatGPTWithExchange as registerChatGPTWithExchangeShared,
} from '../modules/chatgpt/shared';
import {
  parseBooleanFlag,
  parseNumberFlag,
  type FlowOptions,
} from '../modules/flow-cli/helpers';
import { runSingleFileFlowFromCli, type SingleFileFlowDefinition } from '../modules/flow-cli/single-file';
import { parseFlowCliArgs } from '../modules/flow-cli/parse-argv';

export type ChatGPTRegistrationFlowKind = 'chatgpt-registration';

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
  | 'authenticated'
  | 'completed'
  | 'failed';

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

export interface SameSessionPasskeyCheckResult {
  attempted: boolean;
  authenticated: boolean;
  method?: 'passkey';
  error?: string;
}

export interface ChatGPTRegistrationFlowContext<Result = unknown> {
  kind: ChatGPTRegistrationFlowKind;
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

export type ChatGPTRegistrationFlowMachine<Result = unknown> = StateMachineController<
  ChatGPTRegistrationFlowState,
  ChatGPTRegistrationFlowContext<Result>,
  ChatGPTRegistrationFlowEvent
>;

export type ChatGPTRegistrationFlowSnapshot<Result = unknown> = StateMachineSnapshot<
  ChatGPTRegistrationFlowState,
  ChatGPTRegistrationFlowContext<Result>,
  ChatGPTRegistrationFlowEvent
>;

export interface ChatGPTRegistrationFlowOptions {
  password?: string;
  verificationTimeoutMs?: number;
  pollIntervalMs?: number;
  createPasskey?: boolean;
  sameSessionPasskeyCheck?: boolean;
  virtualAuthenticator?: VirtualAuthenticatorOptions;
  passkeyStore?: VirtualPasskeyStore;
  machine?: ChatGPTRegistrationFlowMachine<ChatGPTRegistrationFlowResult>;
}

export interface ChatGPTRegistrationFlowResult {
  pageName: 'chatgpt-register';
  url: string;
  title: string;
  email: string;
  prefix?: string;
  verificationCode: string;
  verified: boolean;
  registration: RegistrationResult;
  passkeyCreated: boolean;
  passkeyStore?: VirtualPasskeyStore;
  storedIdentity?: StoredChatGPTIdentitySummary;
  sameSessionPasskeyCheck?: SameSessionPasskeyCheckResult;
  machine: ChatGPTRegistrationFlowSnapshot<ChatGPTRegistrationFlowResult>;
}

export function createChatGPTRegistrationMachine(): ChatGPTRegistrationFlowMachine<ChatGPTRegistrationFlowResult> {
  return createStateMachine<ChatGPTRegistrationFlowState, ChatGPTRegistrationFlowContext<ChatGPTRegistrationFlowResult>, ChatGPTRegistrationFlowEvent>({
    id: 'flow.chatgpt.registration',
    initialState: 'idle',
    initialContext: {
      kind: 'chatgpt-registration',
    },
    historyLimit: 200,
  });
}

export async function registerChatGPTWithExchange(
  page: Page,
  options: FlowOptions = {},
): Promise<ChatGPTRegistrationFlowResult> {
  return registerChatGPTWithExchangeShared(page, {
    password: options.password,
    verificationTimeoutMs: parseNumberFlag(options.verificationTimeoutMs, 180000) ?? 180000,
    pollIntervalMs: parseNumberFlag(options.pollIntervalMs, 5000) ?? 5000,
    createPasskey: parseBooleanFlag(options.createPasskey, true) ?? true,
    sameSessionPasskeyCheck: parseBooleanFlag(options.sameSessionPasskeyCheck, false) ?? false,
    machine: createChatGPTRegistrationMachine(),
  });
}

export const chatgptRegisterExchangeFlow: SingleFileFlowDefinition<FlowOptions, ChatGPTRegistrationFlowResult> = {
  command: 'flow:chatgpt-register-exchange',
  run: registerChatGPTWithExchange,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSingleFileFlowFromCli(chatgptRegisterExchangeFlow, parseFlowCliArgs(process.argv.slice(2)));
}
