import type { Page } from 'patchright';
import { pathToFileURL } from 'url';
import { createStateMachine } from '../state-machine';
import type { StoredChatGPTIdentitySummary } from '../modules/credentials';
import type { VirtualAuthenticatorOptions, VirtualPasskeyStore } from '../modules/webauthn';
import type { StateMachineController, StateMachineSnapshot } from '../state-machine';
import {
  loginChatGPTWithStoredPasskey as loginChatGPTWithStoredPasskeyShared,
} from '../modules/chatgpt/shared';
import type { FlowOptions } from '../modules/flow-cli/helpers';
import { runSingleFileFlowFromCli, type SingleFileFlowDefinition } from '../modules/flow-cli/single-file';
import { parseFlowCliArgs } from '../modules/flow-cli/parse-argv';

export type ChatGPTLoginPasskeyFlowKind = 'chatgpt-login-passkey';

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
  | 'failed';

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
  | 'action.finished';

export interface ChatGPTLoginPasskeyFlowContext<Result = unknown> {
  kind: ChatGPTLoginPasskeyFlowKind;
  url?: string;
  title?: string;
  email?: string;
  verificationCode?: string;
  method?: 'password' | 'passkey';
  passkeyCreated?: boolean;
  passkeyStore?: VirtualPasskeyStore;
  usedEmailFallback?: boolean;
  assertionObserved?: boolean;
  storedIdentity?: StoredChatGPTIdentitySummary;
  lastMessage?: string;
  result?: Result;
}

export type ChatGPTLoginPasskeyFlowMachine<Result = unknown> = StateMachineController<
  ChatGPTLoginPasskeyFlowState,
  ChatGPTLoginPasskeyFlowContext<Result>,
  ChatGPTLoginPasskeyFlowEvent
>;

export type ChatGPTLoginPasskeyFlowSnapshot<Result = unknown> = StateMachineSnapshot<
  ChatGPTLoginPasskeyFlowState,
  ChatGPTLoginPasskeyFlowContext<Result>,
  ChatGPTLoginPasskeyFlowEvent
>;

export interface ChatGPTLoginPasskeyFlowOptions {
  identityId?: string;
  email?: string;
  virtualAuthenticator?: VirtualAuthenticatorOptions;
  machine?: ChatGPTLoginPasskeyFlowMachine<ChatGPTLoginPasskeyFlowResult>;
}

export interface ChatGPTLoginPasskeyFlowResult {
  pageName: 'chatgpt-login-passkey';
  url: string;
  title: string;
  email: string;
  method: 'passkey' | 'password';
  authenticated: boolean;
  storedIdentity: StoredChatGPTIdentitySummary;
  machine: ChatGPTLoginPasskeyFlowSnapshot<ChatGPTLoginPasskeyFlowResult>;
}

export function createChatGPTLoginPasskeyMachine(): ChatGPTLoginPasskeyFlowMachine<ChatGPTLoginPasskeyFlowResult> {
  return createStateMachine<ChatGPTLoginPasskeyFlowState, ChatGPTLoginPasskeyFlowContext<ChatGPTLoginPasskeyFlowResult>, ChatGPTLoginPasskeyFlowEvent>({
    id: 'flow.chatgpt.login-passkey',
    initialState: 'idle',
    initialContext: {
      kind: 'chatgpt-login-passkey',
    },
    historyLimit: 200,
  });
}

export async function loginChatGPTWithStoredPasskey(
  page: Page,
  options: FlowOptions = {},
): Promise<ChatGPTLoginPasskeyFlowResult> {
  return loginChatGPTWithStoredPasskeyShared(page, {
    identityId: options.identityId,
    email: options.email,
    machine: createChatGPTLoginPasskeyMachine(),
  });
}

export const chatgptLoginPasskeyFlow: SingleFileFlowDefinition<FlowOptions, ChatGPTLoginPasskeyFlowResult> = {
  command: 'flow:chatgpt-login-passkey',
  run: loginChatGPTWithStoredPasskey,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSingleFileFlowFromCli(chatgptLoginPasskeyFlow, parseFlowCliArgs(process.argv.slice(2)));
}
