import type { Page } from 'patchright';
import { pathToFileURL } from 'url';
import { createStateMachine } from '../state-machine';
import { resolveStoredChatGPTIdentity, type StoredChatGPTIdentitySummary } from '../modules/credentials';
import type { VirtualAuthenticatorOptions, VirtualPasskeyStore } from '../modules/webauthn';
import type { StateMachineController, StateMachineSnapshot } from '../state-machine';
import {
  CHATGPT_ENTRY_LOGIN_URL,
  openLogin,
  submitEmailForLogin,
  tryPasskeyLogin,
  waitForAuthenticatedSession,
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

function transitionLoginMachine(
  machine: ChatGPTLoginPasskeyFlowMachine<ChatGPTLoginPasskeyFlowResult>,
  state: ChatGPTLoginPasskeyFlowState,
  event: ChatGPTLoginPasskeyFlowEvent,
  patch?: Partial<ChatGPTLoginPasskeyFlowContext<ChatGPTLoginPasskeyFlowResult>>,
): void {
  machine.transition(state, {
    event,
    patch,
  });
}

export async function loginChatGPTWithStoredPasskey(
  page: Page,
  options: FlowOptions = {},
): Promise<ChatGPTLoginPasskeyFlowResult> {
  const machine = createChatGPTLoginPasskeyMachine();
  const stored = resolveStoredChatGPTIdentity({
    id: options.identityId,
    email: options.email,
  });

  machine.start({
    email: stored.identity.email,
    storedIdentity: stored.summary,
    method: 'passkey',
    passkeyCreated: Boolean(stored.identity.passkeyStore?.credentials.length),
    passkeyStore: stored.identity.passkeyStore,
    url: CHATGPT_ENTRY_LOGIN_URL,
  }, {
    source: 'loginChatGPTWithStoredPasskey',
  });

  try {
    transitionLoginMachine(machine, 'opening-entry', 'chatgpt.entry.opened', {
      email: stored.identity.email,
      url: CHATGPT_ENTRY_LOGIN_URL,
      lastMessage: 'Opening ChatGPT login entry',
    });
    const surface = await openLogin(page);

    if (surface === 'authenticated') {
      transitionLoginMachine(machine, 'authenticated', 'chatgpt.authenticated', {
        email: stored.identity.email,
        url: page.url(),
        lastMessage: 'Already authenticated',
      });
    } else {
      transitionLoginMachine(machine, 'login-surface', 'chatgpt.login.surface.ready', {
        email: stored.identity.email,
        url: page.url(),
        lastMessage: `Login surface ready: ${surface}`,
      });
    }

    transitionLoginMachine(machine, 'email-step', 'chatgpt.email.started', {
      email: stored.identity.email,
      url: page.url(),
      lastMessage: 'Submitting login email',
    });
    await submitEmailForLogin(page, stored.identity.email);

    transitionLoginMachine(machine, 'passkey-login', 'chatgpt.email.submitted', {
      email: stored.identity.email,
      url: page.url(),
      lastMessage: 'Login email submitted',
    });

    transitionLoginMachine(machine, 'passkey-login', 'chatgpt.passkey.login.started', {
      email: stored.identity.email,
      storedIdentity: stored.summary,
      url: page.url(),
      lastMessage: 'Starting passkey login',
    });
    const passkey = await tryPasskeyLogin(page, stored, {});

    transitionLoginMachine(machine, 'passkey-login', 'context.updated', {
      email: stored.identity.email,
      method: passkey.method,
      usedEmailFallback: passkey.usedEmailFallback,
      assertionObserved: passkey.assertionObserved,
      passkeyStore: passkey.passkeyStore,
      storedIdentity: stored.summary,
      url: page.url(),
      lastMessage: 'Passkey login triggered',
    });

    const authenticated = await waitForAuthenticatedSession(page, 30000);
    if (!authenticated) {
      throw new Error(`ChatGPT login did not reach an authenticated session for ${stored.identity.email}.`);
    }

    const title = await page.title();
    const result = {
      pageName: 'chatgpt-login-passkey' as const,
      url: page.url(),
      title,
      email: stored.identity.email,
      method: passkey.method,
      authenticated: true,
      storedIdentity: stored.summary,
      machine: undefined as unknown as ChatGPTLoginPasskeyFlowSnapshot<ChatGPTLoginPasskeyFlowResult>,
    };
    const snapshot = machine.succeed('completed', {
      event: 'chatgpt.completed',
      patch: {
        email: stored.identity.email,
        method: passkey.method,
        storedIdentity: stored.summary,
        url: result.url,
        title: result.title,
        lastMessage: 'ChatGPT passkey login completed',
      },
    });
    result.machine = snapshot;
    return result;
  } catch (error) {
    machine.fail(error, 'failed', {
      event: 'chatgpt.failed',
      patch: {
        email: stored.identity.email,
        storedIdentity: stored.summary,
        url: page.url(),
        lastMessage: 'ChatGPT passkey login failed',
      },
    });
    throw error;
  }
}

export const chatgptLoginPasskeyFlow: SingleFileFlowDefinition<FlowOptions, ChatGPTLoginPasskeyFlowResult> = {
  command: 'flow:chatgpt-login-passkey',
  run: loginChatGPTWithStoredPasskey,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSingleFileFlowFromCli(chatgptLoginPasskeyFlow, parseFlowCliArgs(process.argv.slice(2)));
}
