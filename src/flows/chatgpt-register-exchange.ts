import type { Page } from 'patchright';
import { pathToFileURL } from 'url';
import { createStateMachine } from '../state-machine';
import type { RegistrationResult } from '../modules/registration';
import type { VirtualAuthenticatorOptions, VirtualPasskeyStore } from '../modules/webauthn';
import { persistChatGPTIdentity, type StoredChatGPTIdentitySummary } from '../modules/credentials';
import type { StateMachineController, StateMachineSnapshot } from '../state-machine';
import { ExchangeClient } from '../modules/exchange';
import { getRuntimeConfig } from '../config';
import {
  buildExchangeEmail,
  buildPassword,
  CHATGPT_HOME_URL,
  completeAgeGate,
  openSignup,
  provisionPasskey,
  runSameSessionPasskeyCheck,
  submitPasswordStep,
  submitRegistrationEmailStep,
  submitVerificationCode,
  waitForVerificationCode,
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

function transitionRegistrationMachine(
  machine: ChatGPTRegistrationFlowMachine<ChatGPTRegistrationFlowResult>,
  state: ChatGPTRegistrationFlowState,
  event: ChatGPTRegistrationFlowEvent,
  patch?: Partial<ChatGPTRegistrationFlowContext<ChatGPTRegistrationFlowResult>>,
): void {
  machine.transition(state, {
    event,
    patch,
  });
}

export async function registerChatGPTWithExchange(
  page: Page,
  options: FlowOptions = {},
): Promise<ChatGPTRegistrationFlowResult> {
  const config = getRuntimeConfig();
  if (!config.exchange) throw new Error('Exchange config is required for ChatGPT registration flow.');

  const machine = createChatGPTRegistrationMachine();
  const exchangeClient = new ExchangeClient(config.exchange);
  const { email, prefix } = buildExchangeEmail();
  const password = options.password || buildPassword();
  const createPasskey = parseBooleanFlag(options.createPasskey, true) ?? true;
  const sameSessionPasskeyCheckEnabled = parseBooleanFlag(options.sameSessionPasskeyCheck, false) ?? false;
  const verificationTimeoutMs = parseNumberFlag(options.verificationTimeoutMs, 180000) ?? 180000;
  const pollIntervalMs = parseNumberFlag(options.pollIntervalMs, 5000) ?? 5000;
  const startedAt = new Date().toISOString();

  machine.start({
    email,
    prefix,
    mailbox: config.exchange.mailbox,
    createPasskey,
    passkeyCreated: false,
    url: CHATGPT_HOME_URL,
  }, {
    source: 'registerChatGPTWithExchange',
  });

  try {
    await exchangeClient.primeMessageDelta();

    transitionRegistrationMachine(machine, 'opening-entry', 'chatgpt.entry.opened', {
      url: CHATGPT_HOME_URL,
      lastMessage: 'Opening ChatGPT sign-up entry',
    });
    await openSignup(page);

    transitionRegistrationMachine(machine, 'email-step', 'chatgpt.email.started', {
      email,
      url: page.url(),
      lastMessage: 'Typing registration email',
    });
    await submitRegistrationEmailStep(page, email);

    transitionRegistrationMachine(machine, 'password-step', 'chatgpt.email.submitted', {
      email,
      url: page.url(),
      lastMessage: 'Registration email submitted',
    });
    transitionRegistrationMachine(machine, 'password-step', 'chatgpt.password.started', {
      url: page.url(),
      lastMessage: 'Waiting for password step',
    });
    await submitPasswordStep(page, password, 'unknown');

    transitionRegistrationMachine(machine, 'verification-polling', 'chatgpt.password.submitted', {
      url: page.url(),
      lastMessage: 'Waiting for verification email',
    });

    const registration: RegistrationResult = {
      module: 'registration',
      accountType: 'parent',
      email,
      organizationName: null,
      passkeyCreated: false,
    };

    const verificationCode = await waitForVerificationCode({
      exchangeClient,
      email,
      startedAt,
      timeoutMs: verificationTimeoutMs,
      pollIntervalMs,
      onPollAttempt: (attempt) => {
        transitionRegistrationMachine(machine, 'verification-polling', 'context.updated', {
          email,
          lastAttempt: attempt,
          lastMessage: 'Polling Exchange for verification email',
        });
      },
    });

    transitionRegistrationMachine(machine, 'verification-code-entry', 'chatgpt.verification.code-found', {
      verificationCode,
      url: page.url(),
      lastMessage: 'Submitting verification code',
    });
    await submitVerificationCode(page, verificationCode);

    transitionRegistrationMachine(machine, 'age-gate', 'chatgpt.verification.submitted', {
      verificationCode,
      url: page.url(),
      lastMessage: 'Verification code submitted',
    });
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await completeAgeGate(page);

    transitionRegistrationMachine(machine, 'post-signup-home', 'chatgpt.age-gate.completed', {
      url: page.url(),
      lastMessage: 'Age gate completed',
    });

    const passkeyPromise = createPasskey === false
      ? { passkeyCreated: false as const, passkeyStore: undefined, homeReady: false, securityAttemptCount: 0 }
      : (() => {
          transitionRegistrationMachine(machine, 'passkey-provisioning', 'chatgpt.passkey.provisioning', {
            url: page.url(),
            lastMessage: 'Starting passkey provisioning',
          });
          return provisionPasskey(page, {
            passkeyStore: undefined,
            virtualAuthenticator: undefined,
          });
        })();
    const resolvedPasskey = await passkeyPromise;

    if (createPasskey) {
      transitionRegistrationMachine(machine, 'post-signup-home', 'chatgpt.home.waiting', {
        url: page.url(),
        lastMessage: resolvedPasskey.homeReady ? 'ChatGPT home ready' : 'ChatGPT home not ready yet',
      });
      if (resolvedPasskey.securityAttemptCount > 0) {
        transitionRegistrationMachine(machine, 'security-settings', 'chatgpt.security.started', {
          lastAttempt: resolvedPasskey.securityAttemptCount,
          url: page.url(),
          lastMessage: 'Opening security settings',
        });
      }
      transitionRegistrationMachine(machine, 'passkey-provisioning', 'context.updated', {
        passkeyCreated: resolvedPasskey.passkeyCreated,
        passkeyStore: resolvedPasskey.passkeyStore,
        lastAttempt: resolvedPasskey.securityAttemptCount,
        url: page.url(),
        lastMessage: resolvedPasskey.passkeyCreated ? 'Passkey provisioned' : 'Passkey not created yet',
      });
    }

    const sameSessionPasskeyCheck =
      sameSessionPasskeyCheckEnabled && resolvedPasskey.passkeyCreated
        ? (() => {
            transitionRegistrationMachine(machine, 'same-session-passkey-check', 'chatgpt.same-session-passkey-check.started', {
              email,
              url: page.url(),
              lastMessage: 'Running same-session passkey check',
            });
            return runSameSessionPasskeyCheck(page, email);
          })()
        : undefined;
    const resolvedSameSessionPasskeyCheck = await sameSessionPasskeyCheck;

    if (resolvedSameSessionPasskeyCheck) {
      transitionRegistrationMachine(machine, 'same-session-passkey-check', 'chatgpt.same-session-passkey-check.completed', {
        email,
        url: page.url(),
        sameSessionPasskeyCheck: resolvedSameSessionPasskeyCheck,
        lastMessage: resolvedSameSessionPasskeyCheck.authenticated
          ? 'Same-session passkey check completed'
          : 'Same-session passkey check failed',
      });
    }

    transitionRegistrationMachine(machine, 'persisting-identity', 'chatgpt.identity.persisting', {
      passkeyCreated: resolvedPasskey.passkeyCreated,
      passkeyStore: resolvedPasskey.passkeyStore,
      sameSessionPasskeyCheck: resolvedSameSessionPasskeyCheck,
      url: page.url(),
      lastMessage: 'Persisting ChatGPT identity',
    });

    const storedIdentity = persistChatGPTIdentity({
      email,
      password,
      prefix,
      mailbox: config.exchange.mailbox,
      passkeyCreated: resolvedPasskey.passkeyCreated,
      passkeyStore: resolvedPasskey.passkeyStore,
    }).summary;

    const title = await page.title();
    const result = {
      pageName: 'chatgpt-register' as const,
      url: page.url(),
      title,
      email,
      prefix,
      verificationCode,
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
      machine: undefined as unknown as ChatGPTRegistrationFlowSnapshot<ChatGPTRegistrationFlowResult>,
    };

    const snapshot = machine.succeed('completed', {
      event: 'chatgpt.completed',
      patch: {
        email,
        prefix,
        verificationCode,
        passkeyCreated: resolvedPasskey.passkeyCreated,
        passkeyStore: resolvedPasskey.passkeyStore,
        storedIdentity,
        registration: result.registration,
        sameSessionPasskeyCheck: resolvedSameSessionPasskeyCheck,
        url: result.url,
        title: result.title,
        lastMessage: 'ChatGPT registration completed',
      },
    });
    result.machine = snapshot;
    return result;
  } catch (error) {
    machine.fail(error, 'failed', {
      event: 'chatgpt.failed',
      patch: {
        email,
        prefix,
        url: page.url(),
        lastMessage: 'ChatGPT registration failed',
      },
    });
    throw error;
  }
}

export const chatgptRegisterExchangeFlow: SingleFileFlowDefinition<FlowOptions, ChatGPTRegistrationFlowResult> = {
  command: 'flow:chatgpt-register-exchange',
  run: registerChatGPTWithExchange,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSingleFileFlowFromCli(chatgptRegisterExchangeFlow, parseFlowCliArgs(process.argv.slice(2)));
}
