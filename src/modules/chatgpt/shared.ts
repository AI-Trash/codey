import crypto from 'crypto';
import type { CDPSession, Locator, Page } from 'patchright';
import type { RegistrationResult } from '../registration';
import { ExchangeClient } from '../exchange';
import { getRuntimeConfig } from '../../config';
import {
  persistChatGPTIdentity,
  resolveStoredChatGPTIdentity,
  type ResolvedChatGPTIdentity,
  type StoredChatGPTIdentitySummary,
} from '../credentials';
import { clickAny, clickIfPresent, typeIfPresent } from '../common/form-actions';
import { captureVirtualPasskeyStore, loadVirtualPasskeyStore, type VirtualAuthenticatorOptions, type VirtualPasskeyStore } from '../webauthn/virtual-authenticator';
import { toLocator } from '../../utils/selectors';
import type { SelectorTarget } from '../../types';
import { sleep } from '../../utils/wait';
import type { StateMachineController, StateMachineSnapshot } from '../../state-machine';

const CHATGPT_HOME_URL = 'https://chatgpt.com/';
const CHATGPT_ENTRY_LOGIN_URL = 'https://chatgpt.com/auth/login';
const CHATGPT_LOGIN_URL = 'https://auth.openai.com/log-in-or-create-account';
const CHATGPT_SECURITY_URL = 'https://chatgpt.com/#settings/Security';
const ADULT_AGE = '25';
const PROFILE_NAME = 'Codey Test';
const MIN_ONBOARDING_CLICKS = 3;
const DEFAULT_EVENT_TIMEOUT_MS = 5000;
const PASSWORD_INPUT_SELECTORS: SelectorTarget[] = ['input[type="password"]', 'input[name="password"]'];
const PASSWORD_SUBMIT_SELECTORS: SelectorTarget[] = [
  'button[type="submit"]',
  { role: 'button', options: { name: /继续|continue|注册|create/i } },
  { text: /继续|continue|注册|create/i },
];
const VERIFICATION_CODE_INPUT_SELECTORS: SelectorTarget[] = [
  'input#_r_5_-code',
  'input[autocomplete="one-time-code"]',
  'input[name="code"]',
  'input[name*="code"]',
  'input[id*="code"]',
];
const PASSWORD_TIMEOUT_ERROR_SELECTORS: SelectorTarget[] = [
  { text: /糟糕，出错了！|oops[,，]?\s*an error occurred/i },
  { text: /operation timed out/i },
  'div:has-text("Operation timed out")',
];
const PASSWORD_TIMEOUT_RETRY_SELECTORS: SelectorTarget[] = [
  { role: 'button', options: { name: /重试|try again/i } },
  { text: /重试|try again/i },
  'button[data-dd-action-name="Try again"]',
];
const LOGIN_EMAIL_SELECTORS: SelectorTarget[] = [
  'input[id$="-email"]',
  'input#email',
  'input[name="email"]',
  'input[type="email"]',
  { label: /电子邮件地址|email address|email/i },
  { placeholder: /电子邮件地址|email address|email/i },
];
const LOGIN_CONTINUE_SELECTORS: SelectorTarget[] = [
  'form[action="/log-in-or-create-account"] button[type="submit"]',
  'button[type="submit"]',
  { role: 'button', options: { name: /继续|continue|next|login|log in|sign in/i } },
  { text: /继续|continue|next|login|log in|sign in/i },
];
const PASSKEY_ENTRY_SELECTORS: SelectorTarget[] = [
  { role: 'button', options: { name: /passkey|sign in with passkey|use a passkey|使用 passkey|使用通行密钥|通行密钥|密钥/i } },
  { text: /passkey|使用 passkey|使用通行密钥|通行密钥|密钥/i },
];
const CHATGPT_AUTHENTICATED_SELECTORS: SelectorTarget[] = [
  '[data-testid="accounts-profile-button"]',
  '[data-testid="composer-root"]',
  'textarea',
  '[data-testid="conversation-turn-0"]',
];
const LOGIN_NEXT_STEP_SELECTORS: SelectorTarget[] = [
  ...PASSKEY_ENTRY_SELECTORS,
  ...CHATGPT_AUTHENTICATED_SELECTORS,
];

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

function logStep(step: string, details?: Record<string, unknown>): void {
  console.log(JSON.stringify({ scope: 'chatgpt-register', step, ...(details || {}) }));
}

function transitionChatGPTMachine<Result>(
  machine: ChatGPTAuthFlowMachine<Result> | undefined,
  state: 'idle' | 'opening-entry' | 'email-step' | 'password-step' | 'verification-polling' | 'verification-code-entry' | 'age-gate' | 'post-signup-home' | 'security-settings' | 'passkey-provisioning' | 'persisting-identity' | 'same-session-passkey-check' | 'login-surface' | 'passkey-login' | 'authenticated' | 'completed' | 'failed',
  options: {
    event:
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
    patch?: Record<string, unknown>;
  },
): void {
  (machine as ChatGPTAuthFlowMachine<Record<string, unknown>> | undefined)?.transition(state, {
    event: options.event,
    patch: options.patch as never,
  });
}

function isChatGPTHomeUrl(url: string): boolean {
  return /^https:\/\/chatgpt\.com\/?(#.*)?$/i.test(url) || url.startsWith('https://chatgpt.com/');
}

async function waitForAnySelectorState(
  page: Page,
  selectors: SelectorTarget[],
  state: 'visible' | 'hidden' | 'attached' | 'detached',
  timeoutMs = DEFAULT_EVENT_TIMEOUT_MS,
): Promise<boolean> {
  if (!selectors.length) return false;
  try {
    await Promise.any(
      selectors.map((selector) =>
        toLocator(page, selector).first().waitFor({ state, timeout: timeoutMs }),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

async function waitForUrlMatch(
  page: Page,
  predicate: (url: string) => boolean,
  timeoutMs = DEFAULT_EVENT_TIMEOUT_MS,
): Promise<boolean> {
  if (predicate(page.url())) return true;
  try {
    await page.waitForURL((url) => predicate(String(url)), { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function fillFirstAvailable(page: Page, selectors: SelectorTarget[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const locator = toLocator(page, selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    await locator.fill(value);
    await locator.blur().catch(() => undefined);
    return true;
  }
  return false;
}

async function isLocatorEnabled(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const candidate = element as HTMLElement & { disabled?: boolean };
    return !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true';
  }).catch(async () => locator.isEnabled().catch(() => false));
}

async function hasEnabledSelector(page: Page, selectors: SelectorTarget[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = toLocator(page, selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    if (await isLocatorEnabled(locator)) return true;
  }
  return false;
}

async function isAnySelectorVisible(page: Page, selectors: SelectorTarget[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = toLocator(page, selector).first();
    if (await locator.isVisible().catch(() => false)) return true;
  }
  return false;
}

async function clickEnabledIfPresent(page: Page, selectors: SelectorTarget[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = toLocator(page, selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    if (!(await isLocatorEnabled(locator))) continue;
    await locator.click();
    return true;
  }
  return false;
}

async function waitForEnabledSelector(page: Page, selectors: SelectorTarget[], timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    const visible = await waitForAnySelectorState(page, selectors, 'visible', remainingMs);
    if (!visible) break;

    for (const selector of selectors) {
      const locator = toLocator(page, selector).first();
      const isVisible = await locator.isVisible().catch(() => false);
      if (!isVisible) continue;
      const handle = await locator.elementHandle().catch(() => null);
      if (!handle) continue;
      try {
        const perSelectorTimeoutMs = Math.min(1000, Math.max(1, deadline - Date.now()));
        await page.waitForFunction(
          (element) => {
            const candidate = element as HTMLElement & { disabled?: boolean };
            const style = window.getComputedStyle(candidate);
            const rect = candidate.getBoundingClientRect();
            return (
              candidate.isConnected &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity || '1') > 0 &&
              rect.width > 0 &&
              rect.height > 0 &&
              !candidate.disabled &&
              candidate.getAttribute('aria-disabled') !== 'true'
            );
          },
          handle,
          { timeout: perSelectorTimeoutMs },
        );
        return true;
      } catch {
        // Try another matching selector if this node vanished or never became enabled.
      } finally {
        await handle.dispose().catch(() => undefined);
      }
    }
  }
  return hasEnabledSelector(page, selectors);
}

async function confirmAgeDialogIfPresent(page: Page): Promise<boolean> {
  const confirmSelectors: SelectorTarget[] = [
    { role: 'button', options: { name: /确定|confirm|ok/i } },
    { text: /确定|confirm|ok/i },
  ];
  const confirmed = await clickEnabledIfPresent(page, [
    ...confirmSelectors,
  ]);
  if (confirmed) {
    logStep('age_gate_confirmed');
    await Promise.any([
      page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_EVENT_TIMEOUT_MS }),
      waitForAnySelectorState(page, confirmSelectors, 'hidden', DEFAULT_EVENT_TIMEOUT_MS).then((ready) => {
        if (!ready) throw new Error('confirm dialog still visible');
      }),
      waitForAnySelectorState(
        page,
        ['input[name="name"]', 'input#_r_h_-name', 'input[name="age"]', 'input#_r_h_-age', 'input[id*="age"]'],
        'visible',
        DEFAULT_EVENT_TIMEOUT_MS,
      ).then((ready) => {
        if (!ready) throw new Error('age gate inputs not ready');
      }),
    ]).catch(() => undefined);
  }
  return confirmed;
}

async function clickCompleteAccountCreation(page: Page): Promise<boolean> {
  const selectors: SelectorTarget[] = [
    { role: 'button', options: { name: /完成帐户创建|完成账户创建|complete account creation|continue/i } },
    { text: /完成帐户创建|完成账户创建|complete account creation|continue/i },
    'form[action="/about-you"] button[type="submit"]',
    'button[type="submit"]',
  ];
  await waitForEnabledSelector(page, selectors, DEFAULT_EVENT_TIMEOUT_MS);
  const clicked = await clickEnabledIfPresent(page, selectors);
  if (clicked) {
    await Promise.any([
      page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_EVENT_TIMEOUT_MS }),
      waitForAnySelectorState(page, selectors, 'hidden', DEFAULT_EVENT_TIMEOUT_MS).then((ready) => {
        if (!ready) throw new Error('submit button still visible');
      }),
      waitForAnySelectorState(
        page,
        [
          { role: 'button', options: { name: /确定|confirm|ok/i } },
          { text: /确定|confirm|ok/i },
          'input[name="age"]',
          'input#_r_h_-age',
          'input[id*="age"]',
        ],
        'visible',
        DEFAULT_EVENT_TIMEOUT_MS,
      ).then((ready) => {
        if (!ready) throw new Error('post submit state not ready');
      }),
    ]).catch(() => undefined);
    await confirmAgeDialogIfPresent(page);
  }
  return clicked;
}

async function isProfileReady(page: Page): Promise<boolean> {
  const locator = page.locator('[data-testid="accounts-profile-button"]');
  const count = await locator.count().catch(() => 0);
  if (count === 0) return false;
  const visible = await locator.first().isVisible().catch(() => false);
  if (visible) return true;
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="accounts-profile-button"]') as HTMLElement | null;
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0 && rect.width > 0 && rect.height > 0;
  }).catch(() => false);
}

async function waitForProfileReady(page: Page, timeoutMs = DEFAULT_EVENT_TIMEOUT_MS): Promise<boolean> {
  if (await isProfileReady(page)) return true;
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="accounts-profile-button"]') as HTMLElement | null;
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || '1') > 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      },
      undefined,
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}

async function clickOnboardingAction(page: Page): Promise<string | null> {
  const candidates: Array<{ text: string; selectors: SelectorTarget[] }> = [
    {
      text: 'getting-started',
      selectors: [
        '[data-testid="getting-started-button"]',
        { role: 'button', options: { name: /^好的，开始吧$|^开始吧$|^get started$/i } },
        { text: /^好的，开始吧$|^开始吧$|^get started$/i },
      ],
    },
    {
      text: 'continue',
      selectors: [
        { role: 'button', options: { name: /^继续$|^continue$/i } },
        { text: /^继续$|^continue$/i },
      ],
    },
    {
      text: 'skip',
      selectors: [
        { role: 'button', options: { name: /^跳过$|^skip$|^not now$|^以后再说$|^稍后$/i } },
        { text: /^跳过$|^skip$|^not now$|^以后再说$|^稍后$/i },
      ],
    },
  ];

  for (const candidate of candidates) {
    const clicked = await clickIfPresent(page, candidate.selectors as never);
    if (clicked) return candidate.text;
  }
  return null;
}

async function waitForHomeInteractionSignal(page: Page, timeoutMs = 10000): Promise<boolean> {
  const waiters: Array<Promise<void>> = [];

  if (!isChatGPTHomeUrl(page.url())) {
    waiters.push(
      waitForUrlMatch(page, isChatGPTHomeUrl, timeoutMs).then((ready) => {
        if (!ready) throw new Error('chatgpt home url not ready');
      }),
    );
  }

  if (!(await isProfileReady(page))) {
    waiters.push(
      waitForProfileReady(page, timeoutMs).then((ready) => {
        if (!ready) throw new Error('profile not ready');
      }),
    );
  }

  waiters.push(
    waitForAnySelectorState(
      page,
      [
        '[data-testid="getting-started-button"]',
        { role: 'button', options: { name: /^好的，开始吧$|^开始吧$|^get started$/i } },
        { text: /^好的，开始吧$|^开始吧$|^get started$/i },
        { role: 'button', options: { name: /^继续$|^continue$/i } },
        { text: /^继续$|^continue$/i },
        { role: 'button', options: { name: /^跳过$|^skip$|^not now$|^以后再说$|^稍后$/i } },
        { text: /^跳过$|^skip$|^not now$|^以后再说$|^稍后$/i },
      ],
      'visible',
      timeoutMs,
    ).then((ready) => {
      if (!ready) throw new Error('onboarding action not ready');
    }),
  );

  if (!waiters.length) {
    await sleep(Math.min(timeoutMs, 250));
    return true;
  }

  return Promise.any(waiters).then(() => true).catch(() => false);
}

async function waitUntilChatGPTHomeReady(page: Page, rounds = 20): Promise<boolean> {
  let onboardingClicks = 0;
  let idleAfterMinimum = 0;
  for (let round = 0; round < rounds; round += 1) {
    const url = page.url();
    const onChatGPT = isChatGPTHomeUrl(url);
    const profileReady = await isProfileReady(page);

    if (!onChatGPT) {
      idleAfterMinimum = 0;
      logStep('chatgpt_home_not_ready', { round: round + 1, url, onboardingClicks });
      await waitForHomeInteractionSignal(page, 10000);
      continue;
    }

    const action = await clickOnboardingAction(page);
    if (action) {
      onboardingClicks += 1;
      idleAfterMinimum = 0;
      logStep('post_signup_prompt_clicked', { round: round + 1, url, action, onboardingClicks });
      await waitForHomeInteractionSignal(page, DEFAULT_EVENT_TIMEOUT_MS);
      continue;
    }

    if (profileReady && onboardingClicks >= MIN_ONBOARDING_CLICKS) {
      idleAfterMinimum += 1;
      logStep('chatgpt_home_stabilizing', {
        round: round + 1,
        url,
        profileReady,
        onboardingClicks,
        idleAfterMinimum,
      });
      if (idleAfterMinimum >= 2) {
        logStep('chatgpt_home_ready', { round: round + 1, url, profileReady: true, onboardingClicks });
        return true;
      }
      await waitForHomeInteractionSignal(page, DEFAULT_EVENT_TIMEOUT_MS);
      continue;
    }

    logStep('chatgpt_home_wait', { round: round + 1, url, profileReady, onboardingClicks, minOnboardingClicks: MIN_ONBOARDING_CLICKS });
    await waitForHomeInteractionSignal(page, DEFAULT_EVENT_TIMEOUT_MS);
  }
  return false;
}

async function navigateToSecuritySettings(page: Page): Promise<boolean> {
  logStep('security_navigation_start', { target: CHATGPT_SECURITY_URL });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto(CHATGPT_SECURITY_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const action = await clickOnboardingAction(page);
    if (action) {
      logStep('security_navigation_onboarding_click', { attempt: attempt + 1, action, url: page.url() });
      await waitForHomeInteractionSignal(page, DEFAULT_EVENT_TIMEOUT_MS);
      continue;
    }

    const addVisible = await page.locator('button').filter({ hasText: /安全密钥和通行密钥|security keys and passkeys/i }).first().isVisible().catch(() => false);
    const securityTabCount = await page.locator('[data-testid="security-tab"]').count().catch(() => 0);

    logStep('security_navigation_attempt', {
      attempt: attempt + 1,
      url: page.url(),
      securityTabCount,
      addVisible,
    });

    if (addVisible || securityTabCount > 0) return true;
    await Promise.any([
      waitForAnySelectorState(
        page,
        [
          '[data-testid="security-tab"]',
          { role: 'button', options: { name: /安全密钥和通行密钥|security keys and passkeys/i } },
          { text: /安全密钥和通行密钥|security keys and passkeys/i },
        ],
        'visible',
        DEFAULT_EVENT_TIMEOUT_MS,
      ).then((ready) => {
        if (!ready) throw new Error('security controls not ready');
      }),
      waitForHomeInteractionSignal(page, DEFAULT_EVENT_TIMEOUT_MS).then((ready) => {
        if (!ready) throw new Error('home interaction not ready');
      }),
    ]).catch(() => undefined);
  }
  return false;
}

export interface ChatGPTRegistrationFlowOptions {
  password?: string;
  verificationTimeoutMs?: number;
  pollIntervalMs?: number;
  createPasskey?: boolean;
  sameSessionPasskeyCheck?: boolean;
  virtualAuthenticator?: VirtualAuthenticatorOptions;
  passkeyStore?: VirtualPasskeyStore;
  machine?: ChatGPTAuthFlowMachine<ChatGPTRegistrationFlowResult>;
}

export interface SameSessionPasskeyCheckResult {
  attempted: boolean;
  authenticated: boolean;
  method?: 'passkey';
  error?: string;
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
  machine: ChatGPTAuthFlowSnapshot<ChatGPTRegistrationFlowResult>;
}

export interface ChatGPTLoginPasskeyFlowOptions {
  identityId?: string;
  email?: string;
  virtualAuthenticator?: VirtualAuthenticatorOptions;
  machine?: ChatGPTAuthFlowMachine<ChatGPTLoginPasskeyFlowResult>;
}

export interface ChatGPTLoginPasskeyFlowResult {
  pageName: 'chatgpt-login-passkey';
  url: string;
  title: string;
  email: string;
  method: 'passkey' | 'password';
  authenticated: boolean;
  storedIdentity: StoredChatGPTIdentitySummary;
  machine: ChatGPTAuthFlowSnapshot<ChatGPTLoginPasskeyFlowResult>;
}

interface PasskeyAssertionTracker {
  waitForAssertion(timeoutMs?: number): Promise<boolean>;
  dispose(): void;
}

function randomString(length = 8): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function buildExchangeEmail(): { email: string; prefix?: string } {
  const config = getRuntimeConfig();
  const mailbox = config.exchange?.mailbox;
  if (!mailbox) throw new Error('Exchange mailbox is required for ChatGPT registration flow.');
  const [localPart, domain] = mailbox.split('@');
  if (!localPart || !domain) throw new Error(`Invalid EXCHANGE_MAILBOX value: ${mailbox}`);
  const prefix = config.exchange?.mailFlow?.catchAll?.prefix?.trim();
  const unique = `${Date.now()}-${randomString(6)}`;
  return prefix ? { email: `${prefix}-${unique}@${domain}`, prefix } : { email: `${localPart}+${unique}@${domain}` };
}

function buildPassword(): string {
  return `Codey!${randomString(10)}A1`;
}

function createPasskeyAssertionTracker(
  session: CDPSession,
  authenticatorId: string,
  baselineStore?: VirtualPasskeyStore,
): PasskeyAssertionTracker {
  let asserted = false;
  const baselineCounts = new Map((baselineStore?.credentials || []).map((credential) => [credential.credentialId, credential.signCount]));
  const handler = () => {
    asserted = true;
  };

  session.on('WebAuthn.credentialAsserted', handler);

  return {
    async waitForAssertion(timeoutMs = 10000): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (asserted) return true;
        const currentStore = await captureVirtualPasskeyStore(session, authenticatorId);
        for (const credential of currentStore.credentials) {
          const previousSignCount = baselineCounts.get(credential.credentialId) ?? -1;
          if (credential.signCount > previousSignCount) {
            asserted = true;
            baselineCounts.set(credential.credentialId, credential.signCount);
            return true;
          }
        }
        await sleep(250);
      }
      return asserted;
    },
    dispose(): void {
      const eventEmitter = session as unknown as {
        off?: (event: string, listener: () => void) => void;
        removeListener?: (event: string, listener: () => void) => void;
      };
      eventEmitter.off?.('WebAuthn.credentialAsserted', handler);
      eventEmitter.removeListener?.('WebAuthn.credentialAsserted', handler);
    },
  };
}

async function openSignup(page: Page, machine?: ChatGPTAuthFlowMachine<ChatGPTRegistrationFlowResult>): Promise<void> {
  logStep('open_signup_start', { url: CHATGPT_HOME_URL });
  transitionChatGPTMachine(machine, 'opening-entry', {
    event: 'chatgpt.entry.opened',
    patch: {
      url: CHATGPT_HOME_URL,
      lastMessage: 'Opening ChatGPT sign-up entry',
    },
  });
  await page.goto(CHATGPT_HOME_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('body').waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await clickAny(page, [
    '[data-testid="signup-button"]',
    { role: 'button', options: { name: /免费注册|sign up|create account/i } },
    { text: /免费注册|sign up|create account/i },
  ]);
  logStep('signup_button_clicked');
  const emailReady = await waitForAnySelectorState(page, ['input#email', 'input[name="email"]'], 'visible', 10000);
  if (emailReady) {
    logStep('signup_popover_ready');
    transitionChatGPTMachine(machine, 'email-step', {
      event: 'chatgpt.email.started',
      patch: {
        url: page.url(),
        lastMessage: 'Sign-up email step ready',
      },
    });
    return;
  }
  throw new Error('Sign-up popover did not render the email input.');
}

async function openLogin<Result>(
  page: Page,
  machine?: ChatGPTAuthFlowMachine<Result>,
): Promise<void> {
  logStep('login_open_start', { url: CHATGPT_ENTRY_LOGIN_URL });
  transitionChatGPTMachine(machine, 'opening-entry', {
    event: 'chatgpt.entry.opened',
    patch: {
      url: CHATGPT_ENTRY_LOGIN_URL,
      lastMessage: 'Opening ChatGPT login entry',
    },
  });
  await page.goto(CHATGPT_ENTRY_LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('body').waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  if (await waitForAuthenticatedSession(page, 5000)) {
    logStep('login_surface_ready', { surface: 'authenticated', url: page.url() });
    transitionChatGPTMachine(machine, 'authenticated', {
      event: 'chatgpt.authenticated',
      patch: {
        url: page.url(),
        lastMessage: 'Already authenticated',
      },
    });
    return;
  }

  const clicked = await clickEnabledIfPresent(page, [
    '[data-testid="login-button"]',
    { role: 'button', options: { name: /^登录$|^log in$|^login$/i } },
    { text: /^登录$|^log in$|^login$/i },
  ]);
  if (clicked) {
    logStep('login_button_clicked');
  }

  const surface = await waitForLoginSurface(page, 15000);
  if (surface !== 'unknown') {
    logStep('login_surface_ready', { surface, url: page.url() });
    transitionChatGPTMachine(machine, 'login-surface', {
      event: 'chatgpt.login.surface.ready',
      patch: {
        url: page.url(),
        lastMessage: `Login surface ready: ${surface}`,
      },
    });
    return;
  }

  if (!clicked) {
    throw new Error('ChatGPT login entry page did not expose a clickable login button or alternate login surface.');
  }
}

async function waitForPasswordSubmissionOutcome(page: Page, timeoutMs = 15000): Promise<'verification' | 'timeout' | 'unknown'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isAnySelectorVisible(page, VERIFICATION_CODE_INPUT_SELECTORS)) return 'verification';
    if (
      (await isAnySelectorVisible(page, PASSWORD_TIMEOUT_ERROR_SELECTORS)) &&
      (await isAnySelectorVisible(page, PASSWORD_TIMEOUT_RETRY_SELECTORS))
    ) {
      return 'timeout';
    }
    await sleep(500);
  }
  return 'unknown';
}

async function waitForLoginEmailSubmissionOutcome(
  page: Page,
  timeoutMs = 15000,
): Promise<'next' | 'timeout' | 'unknown'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isAnySelectorVisible(page, LOGIN_NEXT_STEP_SELECTORS)) return 'next';
    if (
      (await isAnySelectorVisible(page, PASSWORD_TIMEOUT_ERROR_SELECTORS)) &&
      (await isAnySelectorVisible(page, PASSWORD_TIMEOUT_RETRY_SELECTORS))
    ) {
      return 'timeout';
    }
    await sleep(500);
  }
  return 'unknown';
}

async function submitEmailStep(
  page: Page,
  email: string,
  machine?: ChatGPTAuthFlowMachine<ChatGPTRegistrationFlowResult>,
): Promise<void> {
  logStep('email_step_start', { email });
  transitionChatGPTMachine(machine, 'email-step', {
    event: 'chatgpt.email.started',
    patch: {
      email,
      url: page.url(),
      lastMessage: 'Typing registration email',
    },
  });
  const typed = await typeIfPresent(page, ['input#email', 'input[name="email"]'], email);
  if (!typed) {
    throw new Error('ChatGPT sign-up email field was visible but could not be typed into.');
  }
  await waitForEnabledSelector(page, ['button[type="submit"]', { role: 'button', options: { name: /继续|continue/i } }, { text: /继续|continue/i }], 5000);
  await sleep(200);
  await clickAny(page, ['button[type="submit"]', { role: 'button', options: { name: /继续|continue/i } }, { text: /继续|continue/i }]);
  logStep('email_step_submitted');
  transitionChatGPTMachine(machine, 'password-step', {
    event: 'chatgpt.email.submitted',
    patch: {
      email,
      url: page.url(),
      lastMessage: 'Registration email submitted',
    },
  });
}

async function submitPasswordStep(
  page: Page,
  password: string,
  initialSurface: 'password' | 'verification' | 'age_gate' | 'authenticated' | 'unknown' = 'unknown',
  machine?: ChatGPTAuthFlowMachine<ChatGPTRegistrationFlowResult>,
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    logStep('password_step_waiting', { attempt });
    transitionChatGPTMachine(machine, 'password-step', {
      event: 'chatgpt.password.started',
      patch: {
        lastAttempt: attempt,
        url: page.url(),
        lastMessage: 'Waiting for password step',
      },
    });
    const passwordReady = await waitForAnySelectorState(
      page,
      PASSWORD_INPUT_SELECTORS,
      'visible',
      10000,
    );
    if (passwordReady) {
      logStep('password_step_ready', { attempt });
    }
    const typed = await typeIfPresent(page, PASSWORD_INPUT_SELECTORS, password);
    if (!typed) {
      throw new Error('ChatGPT password field was visible but could not be typed into.');
    }
    await waitForEnabledSelector(page, PASSWORD_SUBMIT_SELECTORS, 5000);
    await sleep(200);
    await clickAny(page, PASSWORD_SUBMIT_SELECTORS);
    logStep('password_step_submitted', { attempt });
    transitionChatGPTMachine(machine, 'password-step', {
      event: 'chatgpt.password.submitted',
      patch: {
        lastAttempt: attempt,
        url: page.url(),
        lastMessage: 'Registration password submitted',
      },
    });

    const outcome = await waitForPasswordSubmissionOutcome(page);
    if (outcome === 'verification' || outcome === 'unknown') {
      if (outcome === 'verification') logStep('password_step_verification_ready', { attempt });
      transitionChatGPTMachine(machine, 'verification-polling', {
        event: 'chatgpt.verification.polling',
        patch: {
          lastAttempt: attempt,
          url: page.url(),
          lastMessage: 'Waiting for verification email',
        },
      });
      return;
    }

    logStep('password_step_timeout', { attempt });
    const retried = await clickEnabledIfPresent(page, PASSWORD_TIMEOUT_RETRY_SELECTORS);
    if (!retried) {
      throw new Error('Password submission timed out and retry button was not clickable.');
    }
    logStep('password_step_retry_clicked', { attempt });
  }

  throw new Error('Password submission timed out repeatedly.');
}

function extractVerificationCode(body: string): string | null {
  const normalized = body.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  const contextualMatch = normalized.match(/(?:code|验证码|verification code|one-time code|security code)\D{0,20}(\d{6})/i);
  if (contextualMatch?.[1]) return contextualMatch[1];
  const strongMatch = normalized.match(/\b(\d{6})\b/);
  if (strongMatch?.[1]) return strongMatch[1];
  return null;
}

async function waitForVerificationCode(params: {
  exchangeClient: ExchangeClient;
  email: string;
  startedAt: string;
  timeoutMs: number;
  pollIntervalMs: number;
  machine?: ChatGPTAuthFlowMachine<ChatGPTRegistrationFlowResult>;
}): Promise<string> {
  const deadline = Date.now() + params.timeoutMs;
  let attempt = 0;
  logStep('verification_poll_start', { email: params.email, timeoutMs: params.timeoutMs, pollIntervalMs: params.pollIntervalMs, startedAt: params.startedAt });
  transitionChatGPTMachine(params.machine, 'verification-polling', {
    event: 'chatgpt.verification.polling',
    patch: {
      email: params.email,
      lastMessage: 'Polling Exchange for verification email',
    },
  });
  while (Date.now() < deadline) {
    attempt += 1;
    logStep('verification_poll_attempt', { attempt });
    transitionChatGPTMachine(params.machine, 'verification-polling', {
      event: 'context.updated',
      patch: {
        lastAttempt: attempt,
        lastMessage: 'Polling Exchange for verification email',
      },
    });
    const messages = await params.exchangeClient.findMessages({ maxItems: 50, unreadOnly: false, receivedAfter: params.startedAt, subjectIncludes: 'chatgpt' });
    const targetedMessages = messages.filter((message) => {
      const subject = (message.subject || '').toLowerCase();
      const toValues = (message.to || []).map((entry) => entry.toLowerCase());
      return subject.includes('chatgpt') || subject.includes('code') || toValues.some((entry) => entry.includes(params.email.toLowerCase()));
    });
    logStep('verification_poll_messages', { attempt, totalCount: messages.length, targetedCount: targetedMessages.length, subjects: messages.slice(0, 10).map((message) => message.subject), tos: messages.slice(0, 10).map((message) => message.to) });
    for (const message of targetedMessages.length ? targetedMessages : messages) {
      const detail = await params.exchangeClient.getMessage(message.id);
      const body = `${detail.body || ''}\n${detail.bodyPreview || ''}\n${detail.subject || ''}`;
      const code = extractVerificationCode(body);
      logStep('verification_message_checked', { attempt, messageId: message.id, subject: detail.subject, to: detail.to, receivedAt: detail.receivedAt, foundCode: Boolean(code) });
      if (code) {
        logStep('verification_code_found', { attempt, code, subject: detail.subject, to: detail.to });
        transitionChatGPTMachine(params.machine, 'verification-code-entry', {
          event: 'chatgpt.verification.code-found',
          patch: {
            verificationCode: code,
            lastAttempt: attempt,
            lastMessage: 'Verification code received',
          },
        });
        return code;
      }
    }
    await sleep(params.pollIntervalMs);
  }
  throw new Error(`Timed out waiting for a verification code sent to ${params.email}.`);
}

async function submitVerificationCode(
  page: Page,
  code: string,
  machine?: ChatGPTAuthFlowMachine<ChatGPTRegistrationFlowResult>,
): Promise<void> {
  logStep('verification_code_submit_start', { code });
  transitionChatGPTMachine(machine, 'verification-code-entry', {
    event: 'chatgpt.verification.code-found',
    patch: {
      verificationCode: code,
      url: page.url(),
      lastMessage: 'Submitting verification code',
    },
  });
  const codeReady = await waitForAnySelectorState(
    page,
    VERIFICATION_CODE_INPUT_SELECTORS,
    'visible',
    10000,
  );
  if (codeReady) {
    logStep('verification_code_input_ready');
  }
  const input = page.locator('input#_r_5_-code, input[autocomplete="one-time-code"], input[name="code"], input[name*="code"], input[id*="code"]').first();
  await input.fill(code);
  const submitted = await clickIfPresent(page, [{ role: 'button', options: { name: /继续|continue|verify|验证/i } }, { text: /继续|continue|verify|验证/i }, 'button[type="submit"]']);
  logStep('verification_code_submitted', { submitted });
  transitionChatGPTMachine(machine, 'age-gate', {
    event: 'chatgpt.verification.submitted',
    patch: {
      verificationCode: code,
      url: page.url(),
      lastMessage: 'Verification code submitted',
    },
  });
}

async function completeAgeGate(
  page: Page,
  machine?: ChatGPTAuthFlowMachine<ChatGPTRegistrationFlowResult>,
): Promise<void> {
  logStep('age_gate_waiting');
  transitionChatGPTMachine(machine, 'age-gate', {
    event: 'chatgpt.age-gate.started',
    patch: {
      url: page.url(),
      lastMessage: 'Completing age gate',
    },
  });
  const ageGateReady = await waitForAnySelectorState(
    page,
    ['input[name="name"]', 'input#_r_h_-name', 'input[name="age"]', 'input#_r_h_-age', 'input[id*="age"]'],
    'visible',
    20000,
  );
  if (ageGateReady) {
    logStep('age_gate_ready');
  }
  const nameFilled = await fillFirstAvailable(page, ['input[name="name"]', 'input#_r_h_-name'], PROFILE_NAME);
  if (nameFilled) logStep('age_gate_name_filled', { name: PROFILE_NAME });
  let ageFilled = await fillFirstAvailable(page, ['input[name="age"]', 'input#_r_h_-age', 'input[id*="age"]'], ADULT_AGE);
  if (ageFilled) logStep('age_gate_age_filled', { age: ADULT_AGE, mode: 'direct' });
  if (!ageFilled) {
    for (let i = 0; i < 3; i += 1) {
      const completed = await clickCompleteAccountCreation(page);
      logStep('age_gate_submit_without_birthday', { attempt: i + 1, completed });
      await waitForAnySelectorState(
        page,
        ['input[name="age"]', 'input#_r_h_-age', 'input[id*="age"]'],
        'visible',
        DEFAULT_EVENT_TIMEOUT_MS,
      );
      ageFilled = await fillFirstAvailable(page, ['input[name="age"]', 'input#_r_h_-age', 'input[id*="age"]'], ADULT_AGE);
      if (ageFilled) {
        logStep('age_gate_age_filled', { age: ADULT_AGE, mode: 'after_submit_prompt' });
        break;
      }
    }
  }
  await waitForEnabledSelector(page, [
    { role: 'button', options: { name: /完成帐户创建|完成账户创建|complete account creation|continue/i } },
    { text: /完成帐户创建|完成账户创建|complete account creation|continue/i },
    'form[action="/about-you"] button[type="submit"]',
    'button[type="submit"]',
  ], 5000);
  const completed = await clickCompleteAccountCreation(page);
  logStep('age_gate_submitted', { completed, ageFilled });
  transitionChatGPTMachine(machine, 'post-signup-home', {
    event: 'chatgpt.age-gate.completed',
    patch: {
      url: page.url(),
      lastMessage: 'Age gate completed',
    },
  });
}

async function waitForPasskeyCreation(
  page: Page,
  session: Awaited<ReturnType<typeof loadVirtualPasskeyStore>>['session'],
  authenticatorId: string,
  timeoutMs = 20000,
): Promise<VirtualPasskeyStore> {
  const deadline = Date.now() + timeoutMs;
  let pauseMs = 100;
  while (Date.now() < deadline) {
    const store = await captureVirtualPasskeyStore(session as never, authenticatorId);
    if (store.credentials.length > 0) return store;
    await Promise.any([
      page.waitForLoadState('domcontentloaded', { timeout: Math.min(pauseMs, Math.max(1, deadline - Date.now())) }),
      sleep(Math.min(pauseMs, Math.max(1, deadline - Date.now()))),
    ]).catch(() => undefined);
    pauseMs = Math.min(pauseMs * 2, 1000);
  }
  return captureVirtualPasskeyStore(session as never, authenticatorId);
}

async function waitForAuthenticatedSession(page: Page, timeoutMs = 30000): Promise<boolean> {
  const ready = await waitForAnySelectorState(page, CHATGPT_AUTHENTICATED_SELECTORS, 'visible', timeoutMs);
  if (ready) return true;
  return isChatGPTHomeUrl(page.url()) && (await isProfileReady(page));
}

async function clearOriginStorage(page: Page, originUrl: string): Promise<void> {
  await page.goto(originUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await page.evaluate(async () => {
    try {
      window.localStorage.clear();
    } catch {}
    try {
      window.sessionStorage.clear();
    } catch {}
    try {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    } catch {}
    try {
      const dbs = await indexedDB.databases?.();
      if (dbs?.length) {
        await Promise.all(
          dbs
            .map((db) => db.name)
            .filter((name): name is string => Boolean(name))
            .map(
              (name) =>
                new Promise<void>((resolve) => {
                  const request = indexedDB.deleteDatabase(name);
                  request.onsuccess = () => resolve();
                  request.onerror = () => resolve();
                  request.onblocked = () => resolve();
                }),
            ),
        );
      }
    } catch {}
  }).catch(() => undefined);
}

async function clearAuthenticatedSessionState(page: Page): Promise<void> {
  logStep('same_session_state_clear_start', { url: page.url() });
  await page.context().clearCookies().catch(() => undefined);
  await clearOriginStorage(page, CHATGPT_HOME_URL);
  await clearOriginStorage(page, CHATGPT_LOGIN_URL);
  await clearOriginStorage(page, CHATGPT_ENTRY_LOGIN_URL);
  logStep('same_session_state_clear_complete', { url: page.url() });
}

async function waitForLoginEmailFormReady(page: Page, timeoutMs = 15000): Promise<boolean> {
  const formSelectors: SelectorTarget[] = [
    'form[action="/log-in-or-create-account"]',
    ...LOGIN_EMAIL_SELECTORS,
    ...LOGIN_CONTINUE_SELECTORS,
  ];
  const visible = await waitForAnySelectorState(page, formSelectors, 'visible', timeoutMs);
  if (!visible) return false;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const onExpectedUrl = page.url().startsWith(CHATGPT_LOGIN_URL);
    const emailReady = await hasEnabledSelector(page, LOGIN_EMAIL_SELECTORS);
    const continueReady = await hasEnabledSelector(page, LOGIN_CONTINUE_SELECTORS);
    if (onExpectedUrl && emailReady && continueReady) {
      await sleep(500);
      return true;
    }
    await sleep(200);
  }

  return false;
}

async function waitForLoginSurface(
  page: Page,
  timeoutMs = 15000,
): Promise<'authenticated' | 'email' | 'passkey' | 'unknown'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await waitForAuthenticatedSession(page, 500)) return 'authenticated';
    if (await hasEnabledSelector(page, PASSKEY_ENTRY_SELECTORS)) return 'passkey';
    if (await hasEnabledSelector(page, LOGIN_EMAIL_SELECTORS)) return 'email';
    if (page.url().startsWith(CHATGPT_LOGIN_URL)) {
      if (await isAnySelectorVisible(page, PASSKEY_ENTRY_SELECTORS)) return 'passkey';
      if (await isAnySelectorVisible(page, LOGIN_EMAIL_SELECTORS)) return 'email';
    }
    await sleep(250);
  }

  return 'unknown';
}

async function submitEmailForLogin(page: Page, email: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    logStep('login_email_step_start', { email, attempt });
    const formReady = await waitForLoginEmailFormReady(page, 15000);
    if (!formReady) {
      throw new Error('ChatGPT login page did not finish rendering a stable email form.');
    }

    const filled = await typeIfPresent(page, LOGIN_EMAIL_SELECTORS, email);
    if (!filled) {
      throw new Error('ChatGPT login email field was visible but could not be filled.');
    }

    const submitted = await clickEnabledIfPresent(page, LOGIN_CONTINUE_SELECTORS);
    if (!submitted) {
      throw new Error('ChatGPT login page did not expose a clickable continue button.');
    }
    logStep('login_email_step_submitted', { attempt });

    const outcome = await waitForLoginEmailSubmissionOutcome(page);
    if (outcome === 'next' || outcome === 'unknown') {
      if (outcome === 'next') logStep('login_email_step_next_ready', { attempt });
      return;
    }

    logStep('login_email_step_timeout', { attempt });
    const retried = await clickEnabledIfPresent(page, PASSWORD_TIMEOUT_RETRY_SELECTORS);
    if (!retried) {
      throw new Error('Login email submission timed out and retry button was not clickable.');
    }
    logStep('login_email_step_retry_clicked', { attempt });
  }

  throw new Error('Login email submission timed out repeatedly.');
}

async function waitForPasskeyEntryReady(page: Page, timeoutMs = 20000): Promise<boolean> {
  const ready = await waitForAnySelectorState(page, PASSKEY_ENTRY_SELECTORS, 'visible', timeoutMs);
  if (!ready) return false;
  return waitForEnabledSelector(page, PASSKEY_ENTRY_SELECTORS, timeoutMs);
}

async function triggerPasskeyEntry(page: Page, timeoutMs = 20000): Promise<void> {
  const passkeyReady = await waitForPasskeyEntryReady(page, timeoutMs);
  if (!passkeyReady) {
    throw new Error('Passkey entry button did not appear on the login surface.');
  }

  const triggered = await clickEnabledIfPresent(page, PASSKEY_ENTRY_SELECTORS);
  if (!triggered) {
    throw new Error('Passkey entry button became visible but could not be clicked.');
  }
}

async function loginWithResidentPasskeyFirst(
  page: Page,
  email: string,
  tracker?: PasskeyAssertionTracker,
): Promise<{ usedEmailFallback: boolean; assertionObserved: boolean }> {
  if (await waitForAuthenticatedSession(page, 5000)) {
    logStep('login_passkey_authenticated', { email, stage: 'already-authenticated', url: page.url() });
    return { usedEmailFallback: false, assertionObserved: false };
  }

  if (await waitForPasskeyEntryReady(page, 5000)) {
    await triggerPasskeyEntry(page, 5000);
    const assertionObserved = tracker ? await tracker.waitForAssertion(10000) : false;
    logStep('login_passkey_triggered', { email, stage: 'resident', assertionObserved });
    return { usedEmailFallback: false, assertionObserved };
  }

  logStep('login_email_fallback_start', { email });
  await submitEmailForLogin(page, email);

  if (tracker) {
    const assertionObserved = await tracker.waitForAssertion(10000);
    if (assertionObserved) {
      logStep('login_passkey_assertion_detected', { email, stage: 'after-email-submit', url: page.url() });
      return { usedEmailFallback: true, assertionObserved };
    }
  }

  if (await waitForAuthenticatedSession(page, 5000)) {
    logStep('login_passkey_authenticated', { email, stage: 'after-email-submit', url: page.url() });
    return { usedEmailFallback: true, assertionObserved: false };
  }

  await triggerPasskeyEntry(page, 20000);
  const assertionObserved = tracker ? await tracker.waitForAssertion(10000) : false;
  logStep('login_passkey_triggered', { email, stage: 'email-fallback', assertionObserved });
  return { usedEmailFallback: true, assertionObserved };
}

function summarizePasskeyCredentials(store?: VirtualPasskeyStore): Array<Record<string, unknown>> {
  return (store?.credentials || []).map((credential) => ({
    credentialId: credential.credentialId,
    rpId: credential.rpId,
    userHandle: credential.userHandle,
    signCount: credential.signCount,
    isResidentCredential: credential.isResidentCredential,
    backupEligibility: credential.backupEligibility,
    backupState: credential.backupState,
    userName: credential.userName,
    userDisplayName: credential.userDisplayName,
    hasLargeBlob: Boolean(credential.largeBlob),
  }));
}

async function tryPasskeyLogin(page: Page, stored: ResolvedChatGPTIdentity, options: ChatGPTLoginPasskeyFlowOptions): Promise<'passkey'> {
  const hasPasskey = Boolean(stored.identity.passkeyStore?.credentials.length);
  if (!hasPasskey) {
    throw new Error(`Stored identity ${stored.identity.email} does not contain a passkey credential.`);
  }

  transitionChatGPTMachine(options.machine, 'passkey-login', {
    event: 'chatgpt.passkey.login.started',
    patch: {
      email: stored.identity.email,
      storedIdentity: stored.summary,
      url: page.url(),
      lastMessage: 'Starting passkey login',
    },
  });

  logStep('login_passkey_store_before_import', {
    email: stored.identity.email,
    credentials: summarizePasskeyCredentials(stored.identity.passkeyStore),
  });

  const virtualAuth = await loadVirtualPasskeyStore(page, stored.identity.passkeyStore, options.virtualAuthenticator);
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
    });
  });
  const importedStore = await captureVirtualPasskeyStore(virtualAuth.session, virtualAuth.authenticatorId);
  logStep('login_passkey_store_after_import', {
    email: stored.identity.email,
    credentials: summarizePasskeyCredentials(importedStore),
  });

  const tracker = createPasskeyAssertionTracker(
    virtualAuth.session,
    virtualAuth.authenticatorId,
    importedStore,
  );
  const { usedEmailFallback, assertionObserved } = await loginWithResidentPasskeyFirst(page, stored.identity.email, tracker);
  tracker.dispose();
  const postTriggerStore = await captureVirtualPasskeyStore(virtualAuth.session, virtualAuth.authenticatorId);
  logStep('login_passkey_store_after_trigger', {
    email: stored.identity.email,
    credentials: summarizePasskeyCredentials(postTriggerStore),
  });
  transitionChatGPTMachine(options.machine, 'passkey-login', {
    event: 'context.updated',
    patch: {
      email: stored.identity.email,
      method: 'passkey',
      usedEmailFallback,
      assertionObserved,
      passkeyStore: postTriggerStore,
      url: page.url(),
      lastMessage: 'Passkey login triggered',
    },
  });
  return 'passkey';
}

async function runSameSessionPasskeyCheck(
  page: Page,
  email: string,
  machine?: ChatGPTAuthFlowMachine<ChatGPTRegistrationFlowResult>,
): Promise<SameSessionPasskeyCheckResult> {
  logStep('same_session_passkey_check_start', { email });
  transitionChatGPTMachine(machine, 'same-session-passkey-check', {
    event: 'chatgpt.same-session-passkey-check.started',
    patch: {
      email,
      url: page.url(),
      lastMessage: 'Running same-session passkey check',
    },
  });

  try {
    await clearAuthenticatedSessionState(page);
    await openLogin(page, machine);
    const { usedEmailFallback } = await loginWithResidentPasskeyFirst(page, email);
    logStep('same_session_passkey_check_triggered', { email, usedEmailFallback });

    const authenticated = await waitForAuthenticatedSession(page, 30000);
    if (!authenticated) {
      throw new Error(`Same-session passkey check did not reach an authenticated session for ${email}.`);
    }

    logStep('same_session_passkey_check_complete', {
      email,
      authenticated: true,
      usedEmailFallback,
      url: page.url(),
      title: await page.title(),
    });
    transitionChatGPTMachine(machine, 'same-session-passkey-check', {
      event: 'chatgpt.same-session-passkey-check.completed',
      patch: {
        email,
        url: page.url(),
        usedEmailFallback,
        sameSessionPasskeyCheck: {
          attempted: true,
          authenticated: true,
          method: 'passkey',
        },
        lastMessage: 'Same-session passkey check completed',
      },
    });

    return {
      attempted: true,
      authenticated: true,
      method: 'passkey',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep('same_session_passkey_check_failed', { email, error: message, url: page.url() });
    transitionChatGPTMachine(machine, 'same-session-passkey-check', {
      event: 'chatgpt.same-session-passkey-check.completed',
      patch: {
        email,
        url: page.url(),
        sameSessionPasskeyCheck: {
          attempted: true,
          authenticated: false,
          method: 'passkey',
          error: message,
        },
        lastMessage: 'Same-session passkey check failed',
      },
    });
    return {
      attempted: true,
      authenticated: false,
      method: 'passkey',
      error: message,
    };
  }
}

async function provisionPasskey(
  page: Page,
  options: {
    passkeyStore?: VirtualPasskeyStore;
    virtualAuthenticator?: VirtualAuthenticatorOptions;
    machine?: ChatGPTAuthFlowMachine<ChatGPTRegistrationFlowResult>;
  } = {},
): Promise<{ passkeyCreated: boolean; passkeyStore?: VirtualPasskeyStore }> {
  logStep('passkey_provision_start');
  transitionChatGPTMachine(options.machine, 'passkey-provisioning', {
    event: 'chatgpt.passkey.provisioning',
    patch: {
      url: page.url(),
      lastMessage: 'Starting passkey provisioning',
    },
  });
  const virtualAuth = await loadVirtualPasskeyStore(page, options.passkeyStore, options.virtualAuthenticator);
  const homeReady = await waitUntilChatGPTHomeReady(page, 20);
  logStep('chatgpt_home_ready_result', { homeReady, url: page.url(), minOnboardingClicks: MIN_ONBOARDING_CLICKS });
  transitionChatGPTMachine(options.machine, 'post-signup-home', {
    event: 'chatgpt.home.waiting',
    patch: {
      url: page.url(),
      lastMessage: homeReady ? 'ChatGPT home ready' : 'ChatGPT home not ready yet',
    },
  });
  if (!homeReady) return { passkeyCreated: false };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    transitionChatGPTMachine(options.machine, 'security-settings', {
      event: 'chatgpt.security.started',
      patch: {
        lastAttempt: attempt + 1,
        url: page.url(),
        lastMessage: 'Opening security settings',
      },
    });
    const securityNavReady = await navigateToSecuritySettings(page);
    logStep('security_navigation_result', { attempt: attempt + 1, securityNavReady, url: page.url() });
    if (!securityNavReady) {
      continue;
    }
    for (let wait = 0; wait < 45; wait += 1) {
      const addVisible = await page.locator('button').filter({ hasText: /安全密钥和通行密钥|security keys and passkeys/i }).first().isVisible().catch(() => false);
      if (addVisible) break;
      const action = await clickOnboardingAction(page);
      if (action) logStep('passkey_onboarding_click', { attempt: attempt + 1, wait: wait + 1, action, url: page.url() });
      await Promise.any([
        waitForAnySelectorState(
          page,
          [
            { role: 'button', options: { name: /安全密钥和通行密钥|security keys and passkeys/i } },
            { text: /安全密钥和通行密钥|security keys and passkeys/i },
          ],
          'visible',
          DEFAULT_EVENT_TIMEOUT_MS,
        ).then((ready) => {
          if (!ready) throw new Error('passkey entry button not ready');
        }),
        waitForHomeInteractionSignal(page, DEFAULT_EVENT_TIMEOUT_MS).then((ready) => {
          if (!ready) throw new Error('home interaction not ready');
        }),
      ]).catch(() => undefined);
    }
    const addClicked = await clickIfPresent(page, [
      'button:has(div:has-text("添加"))',
      { text: /^添加$|^add$/i },
    ]);
    if (!addClicked) {
      logStep('passkey_add_not_ready', { attempt: attempt + 1 });
      continue;
    }
    logStep('passkey_add_clicked', { attempt: attempt + 1 });
    const passkeyStore = await waitForPasskeyCreation(page, virtualAuth.session, virtualAuth.authenticatorId);
    const passkeyCreated = passkeyStore.credentials.length > 0;
    logStep('passkey_provision_result', { passkeyCreated, credentialCount: passkeyStore.credentials.length });
    transitionChatGPTMachine(options.machine, 'passkey-provisioning', {
      event: 'chatgpt.passkey.provisioning',
      patch: {
        passkeyCreated,
        passkeyStore: passkeyCreated ? passkeyStore : undefined,
        lastAttempt: attempt + 1,
        url: page.url(),
        lastMessage: passkeyCreated ? 'Passkey provisioned' : 'Passkey not created yet',
      },
    });
    await clickIfPresent(page, [{ role: 'button', options: { name: /完成|done|close|关闭/i } }, { text: /完成|done|close|关闭/i }]);
    return { passkeyCreated, passkeyStore: passkeyCreated ? passkeyStore : undefined };
  }
  logStep('passkey_provision_timeout');
  return { passkeyCreated: false };
}

export async function registerChatGPTWithExchange(page: Page, options: ChatGPTRegistrationFlowOptions = {}): Promise<ChatGPTRegistrationFlowResult> {
  const config = getRuntimeConfig();
  if (!config.exchange) throw new Error('Exchange config is required for ChatGPT registration flow.');
  const exchangeClient = new ExchangeClient(config.exchange);
  const { email, prefix } = buildExchangeEmail();
  const password = options.password || buildPassword();
  const startedAt = new Date().toISOString();
  const machine = options.machine;
  if (!machine) throw new Error('ChatGPT registration flow requires a machine instance.');
  machine.start({
    email,
    prefix,
    mailbox: config.exchange.mailbox,
    createPasskey: options.createPasskey ?? true,
    passkeyCreated: false,
    url: CHATGPT_HOME_URL,
  }, {
    source: 'registerChatGPTWithExchange',
  });
  logStep('registration_start', { email, prefix, mailbox: config.exchange.mailbox });
  try {
    await exchangeClient.primeMessageDelta();
    logStep('verification_delta_primed');
    await openSignup(page, machine);
    await submitEmailStep(page, email, machine);
    await submitPasswordStep(page, password, 'unknown', machine);
    const registration: RegistrationResult = { module: 'registration', accountType: 'parent', email, organizationName: null, passkeyCreated: false };
    const verificationCode = await waitForVerificationCode({
      exchangeClient,
      email,
      startedAt,
      timeoutMs: options.verificationTimeoutMs ?? 180000,
      pollIntervalMs: options.pollIntervalMs ?? 5000,
      machine,
    });
    await submitVerificationCode(page, verificationCode, machine);
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await completeAgeGate(page, machine);
    const passkey = options.createPasskey === false
      ? { passkeyCreated: false as const, passkeyStore: undefined }
      : await provisionPasskey(page, {
          passkeyStore: options.passkeyStore,
          virtualAuthenticator: options.virtualAuthenticator,
          machine,
        });
    const sameSessionPasskeyCheck =
      options.sameSessionPasskeyCheck && passkey.passkeyCreated
        ? await runSameSessionPasskeyCheck(page, email, machine)
        : undefined;
    transitionChatGPTMachine(machine, 'persisting-identity', {
      event: 'chatgpt.identity.persisting',
      patch: {
        passkeyCreated: passkey.passkeyCreated,
        passkeyStore: passkey.passkeyStore,
        sameSessionPasskeyCheck,
        url: page.url(),
        lastMessage: 'Persisting ChatGPT identity',
      },
    });
    const storedIdentity = persistChatGPTIdentity({
      email,
      password,
      prefix,
      mailbox: config.exchange.mailbox,
      passkeyCreated: passkey.passkeyCreated,
      passkeyStore: passkey.passkeyStore,
    }).summary;
    const title = await page.title();
    logStep('registration_complete', { email, finalUrl: page.url(), title, passkeyCreated: passkey.passkeyCreated });
    const result = {
      pageName: 'chatgpt-register' as const,
      url: page.url(),
      title,
      email,
      prefix,
      verificationCode,
      verified: true,
      registration: { ...registration, passkeyCreated: passkey.passkeyCreated, passkeyStore: passkey.passkeyStore },
      passkeyCreated: passkey.passkeyCreated,
      passkeyStore: passkey.passkeyStore,
      storedIdentity,
      sameSessionPasskeyCheck,
      machine: undefined as unknown as ChatGPTAuthFlowSnapshot<ChatGPTRegistrationFlowResult>,
    };
    const snapshot = machine.succeed('completed', {
      event: 'chatgpt.completed',
      patch: {
        email,
        prefix,
        verificationCode,
        passkeyCreated: passkey.passkeyCreated,
        passkeyStore: passkey.passkeyStore,
        storedIdentity,
        registration: result.registration,
        sameSessionPasskeyCheck,
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

export async function loginChatGPTWithStoredPasskey(
  page: Page,
  options: ChatGPTLoginPasskeyFlowOptions = {},
): Promise<ChatGPTLoginPasskeyFlowResult> {
  const machine = options.machine;
  if (!machine) throw new Error('ChatGPT passkey login flow requires a machine instance.');
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
    await openLogin(page, machine);
    transitionChatGPTMachine(machine, 'email-step', {
      event: 'chatgpt.email.started',
      patch: {
        email: stored.identity.email,
        url: page.url(),
        lastMessage: 'Submitting login email',
      },
    });
    await submitEmailForLogin(page, stored.identity.email);
    transitionChatGPTMachine(machine, 'passkey-login', {
      event: 'chatgpt.email.submitted',
      patch: {
        email: stored.identity.email,
        url: page.url(),
        lastMessage: 'Login email submitted',
      },
    });

    const method = await tryPasskeyLogin(page, stored, { ...options, machine });

    const authenticated = await waitForAuthenticatedSession(page, 30000);
    if (!authenticated) {
      throw new Error(`ChatGPT login did not reach an authenticated session for ${stored.identity.email}.`);
    }

    const title = await page.title();
    logStep('login_complete', {
      email: stored.identity.email,
      method,
      url: page.url(),
      title,
    });

    const result = {
      pageName: 'chatgpt-login-passkey' as const,
      url: page.url(),
      title,
      email: stored.identity.email,
      method,
      authenticated: true,
      storedIdentity: stored.summary,
      machine: undefined as unknown as ChatGPTAuthFlowSnapshot<ChatGPTLoginPasskeyFlowResult>,
    };
    const snapshot = machine.succeed('completed', {
      event: 'chatgpt.completed',
      patch: {
        email: stored.identity.email,
        method,
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


