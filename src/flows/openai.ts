import crypto from 'crypto';
import type { Locator, Page } from 'patchright';
import type { RegistrationResult } from '../modules/registration';
import { ExchangeClient } from '../modules/exchange';
import { getRuntimeConfig } from '../config';
import { clickAny, clickIfPresent, fillIfPresent } from '../modules/common/form-actions';
import { captureVirtualPasskeyStore, loadVirtualPasskeyStore, type VirtualAuthenticatorOptions, type VirtualPasskeyStore } from '../modules/webauthn/virtual-authenticator';
import { toLocator } from '../utils/selectors';
import type { SelectorTarget } from '../types';
import { sleep } from '../utils/wait';
import type { FlowResult } from '../types';

const CHATGPT_HOME_URL = 'https://chatgpt.com/';
const CHATGPT_SECURITY_URL = 'https://chatgpt.com/#settings/Security';
const ADULT_AGE = '25';
const PROFILE_NAME = 'Codey Test';
const MIN_ONBOARDING_CLICKS = 3;
const DEFAULT_EVENT_TIMEOUT_MS = 5000;

function logStep(step: string, details?: Record<string, unknown>): void {
  console.log(JSON.stringify({ scope: 'chatgpt-register', step, ...(details || {}) }));
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

export async function verifyOpenAIHome(page: Page): Promise<FlowResult> {
  const config = getRuntimeConfig();
  await page.goto(config.openai.baseUrl, { waitUntil: 'domcontentloaded' });
  const body = page.locator('body');
  await body.waitFor({ state: 'visible' });
  const title = await page.title();
  const text = await body.innerText();
  const normalized = `${title}\n${text}`.toLowerCase();
  const signals = ['openai', 'chatgpt', 'api', 'research', 'developers', 'sora'];
  const matchedSignals = signals.filter((item) => normalized.includes(item));
  if (!matchedSignals.length) throw new Error('OpenAI homepage did not expose expected business keywords');
  return { pageName: 'openai-home', url: page.url(), title, matchedSignals };
}

export async function verifyChatGPTEntry(page: Page): Promise<FlowResult> {
  const config = getRuntimeConfig();
  await page.goto(config.openai.chatgptUrl, { waitUntil: 'domcontentloaded' });
  const body = page.locator('body');
  await body.waitFor({ state: 'visible' });
  const title = await page.title();
  const text = await body.innerText();
  const normalized = `${title}\n${text}`.toLowerCase();
  const signals = ['chatgpt', 'log in', 'sign up', 'openai', 'try'];
  const matchedSignals = signals.filter((item) => normalized.includes(item));
  if (!matchedSignals.length) throw new Error('ChatGPT entry page did not expose expected entry keywords');
  return { pageName: 'chatgpt-entry', url: page.url(), title, matchedSignals };
}

export interface ChatGPTRegistrationFlowOptions {
  password?: string;
  verificationTimeoutMs?: number;
  pollIntervalMs?: number;
  createPasskey?: boolean;
  virtualAuthenticator?: VirtualAuthenticatorOptions;
  passkeyStore?: VirtualPasskeyStore;
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

async function openSignup(page: Page): Promise<void> {
  logStep('open_signup_start', { url: CHATGPT_HOME_URL });
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
    return;
  }
  throw new Error('Sign-up popover did not render the email input.');
}

async function submitEmailStep(page: Page, email: string): Promise<void> {
  logStep('email_step_start', { email });
  await fillIfPresent(page, ['input#email', 'input[name="email"]'], email);
  await clickAny(page, ['button[type="submit"]', { role: 'button', options: { name: /继续|continue/i } }, { text: /继续|continue/i }]);
  logStep('email_step_submitted');
}

async function submitPasswordStep(page: Page, password: string): Promise<void> {
  logStep('password_step_waiting');
  const passwordReady = await waitForAnySelectorState(
    page,
    ['input[type="password"]', 'input[name="password"]'],
    'visible',
    10000,
  );
  if (passwordReady) {
    logStep('password_step_ready');
  }
  await fillIfPresent(page, ['input[type="password"]', 'input[name="password"]'], password);
  await clickAny(page, ['button[type="submit"]', { role: 'button', options: { name: /继续|continue|注册|create/i } }, { text: /继续|continue|注册|create/i }]);
  logStep('password_step_submitted');
}

function extractVerificationCode(body: string): string | null {
  const normalized = body.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  const contextualMatch = normalized.match(/(?:code|验证码|verification code|one-time code|security code)\D{0,20}(\d{6})/i);
  if (contextualMatch?.[1]) return contextualMatch[1];
  const strongMatch = normalized.match(/\b(\d{6})\b/);
  if (strongMatch?.[1]) return strongMatch[1];
  return null;
}

async function waitForVerificationCode(params: { exchangeClient: ExchangeClient; email: string; startedAt: string; timeoutMs: number; pollIntervalMs: number; }): Promise<string> {
  const deadline = Date.now() + params.timeoutMs;
  let attempt = 0;
  logStep('verification_poll_start', { email: params.email, timeoutMs: params.timeoutMs, pollIntervalMs: params.pollIntervalMs, startedAt: params.startedAt });
  while (Date.now() < deadline) {
    attempt += 1;
    logStep('verification_poll_attempt', { attempt });
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
        return code;
      }
    }
    await sleep(params.pollIntervalMs);
  }
  throw new Error(`Timed out waiting for a verification code sent to ${params.email}.`);
}

async function submitVerificationCode(page: Page, code: string): Promise<void> {
  logStep('verification_code_submit_start', { code });
  const codeReady = await waitForAnySelectorState(
    page,
    ['input#_r_5_-code', 'input[autocomplete="one-time-code"]', 'input[name="code"]', 'input[name*="code"]', 'input[id*="code"]'],
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
}

async function completeAgeGate(page: Page): Promise<void> {
  logStep('age_gate_waiting');
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

async function provisionPasskey(page: Page, options: { passkeyStore?: VirtualPasskeyStore; virtualAuthenticator?: VirtualAuthenticatorOptions } = {}): Promise<{ passkeyCreated: boolean; passkeyStore?: VirtualPasskeyStore }> {
  logStep('passkey_provision_start');
  const virtualAuth = await loadVirtualPasskeyStore(page, options.passkeyStore, options.virtualAuthenticator);
  const homeReady = await waitUntilChatGPTHomeReady(page, 20);
  logStep('chatgpt_home_ready_result', { homeReady, url: page.url(), minOnboardingClicks: MIN_ONBOARDING_CLICKS });
  if (!homeReady) return { passkeyCreated: false };

  for (let attempt = 0; attempt < 10; attempt += 1) {
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
  logStep('registration_start', { email, prefix, mailbox: config.exchange.mailbox });
  await exchangeClient.primeMessageDelta();
  logStep('verification_delta_primed');
  await openSignup(page);
  await submitEmailStep(page, email);
  await submitPasswordStep(page, password);
  const registration: RegistrationResult = { module: 'registration', accountType: 'parent', email, organizationName: null, passkeyCreated: false };
  const verificationCode = await waitForVerificationCode({ exchangeClient, email, startedAt, timeoutMs: options.verificationTimeoutMs ?? 180000, pollIntervalMs: options.pollIntervalMs ?? 5000 });
  await submitVerificationCode(page, verificationCode);
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await completeAgeGate(page);
  const passkey = options.createPasskey === false ? { passkeyCreated: false as const, passkeyStore: undefined } : await provisionPasskey(page, { passkeyStore: options.passkeyStore, virtualAuthenticator: options.virtualAuthenticator });
  logStep('registration_complete', { email, finalUrl: page.url(), title: await page.title(), passkeyCreated: passkey.passkeyCreated });
  return {
    pageName: 'chatgpt-register',
    url: page.url(),
    title: await page.title(),
    email,
    prefix,
    verificationCode,
    verified: true,
    registration: { ...registration, passkeyCreated: passkey.passkeyCreated, passkeyStore: passkey.passkeyStore },
    passkeyCreated: passkey.passkeyCreated,
    passkeyStore: passkey.passkeyStore,
  };
}

