import crypto from 'crypto';
import type { Page } from 'patchright';
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
const ADULT_BIRTHDAY = '1995-01-01';
const PROFILE_NAME = 'Codey Test';
const MIN_ONBOARDING_CLICKS = 3;

function logStep(step: string, details?: Record<string, unknown>): void {
  console.log(JSON.stringify({ scope: 'chatgpt-register', step, ...(details || {}) }));
}

async function fillFirstAvailable(page: Page, selectors: SelectorTarget[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const locator = toLocator(page, selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    await locator.fill(value);
    return true;
  }
  return false;
}

async function setBirthdayViaJs(page: Page, birthday: string): Promise<boolean> {
  return page.evaluate((value) => {
    const hidden = document.querySelector('input[name="birthday"]') as HTMLInputElement | null;
    if (!hidden) return false;
    hidden.value = value;
    hidden.setAttribute('value', value);
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
    const [year, month, day] = value.split('-');
    const container = hidden.closest('div')?.querySelector('[role="group"]') || document.querySelector('[role="group"]');
    if (container) {
      const segments = Array.from(container.querySelectorAll('[data-type]')) as HTMLElement[];
      for (const segment of segments) {
        const type = segment.getAttribute('data-type');
        if (type === 'year') { segment.textContent = year; segment.setAttribute('aria-valuetext', year); segment.setAttribute('aria-valuenow', String(Number(year))); }
        if (type === 'month') { segment.textContent = month; segment.setAttribute('aria-valuetext', month); segment.setAttribute('aria-valuenow', String(Number(month))); }
        if (type === 'day') { segment.textContent = day; segment.setAttribute('aria-valuetext', day); segment.setAttribute('aria-valuenow', String(Number(day))); }
        segment.dispatchEvent(new Event('input', { bubbles: true }));
        segment.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    return true;
  }, birthday);
}

async function confirmAgeDialogIfPresent(page: Page): Promise<boolean> {
  const confirmed = await clickIfPresent(page, [
    { role: 'button', options: { name: /确定|confirm|ok/i } },
    { text: /确定|confirm|ok/i },
    'form[action="/about-you"] button[type="submit"]',
  ]);
  if (confirmed) {
    logStep('age_gate_confirmed');
    await sleep(1000);
  }
  return confirmed;
}

async function clickCompleteAccountCreation(page: Page): Promise<boolean> {
  const clicked = await clickIfPresent(page, [
    { role: 'button', options: { name: /完成帐户创建|完成账户创建|complete account creation|continue/i } },
    { text: /完成帐户创建|完成账户创建|complete account creation|continue/i },
    'button[type="submit"]',
  ]);
  if (clicked) {
    await sleep(500);
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

async function waitUntilChatGPTHomeReady(page: Page, rounds = 20): Promise<boolean> {
  let onboardingClicks = 0;
  let idleAfterMinimum = 0;
  for (let round = 0; round < rounds; round += 1) {
    const url = page.url();
    const onChatGPT = /^https:\/\/chatgpt\.com\/?(#.*)?$/i.test(url) || url.startsWith('https://chatgpt.com/');
    const profileReady = await isProfileReady(page);

    if (!onChatGPT) {
      idleAfterMinimum = 0;
      logStep('chatgpt_home_not_ready', { round: round + 1, url, onboardingClicks });
      await sleep(1000);
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      continue;
    }

    const action = await clickOnboardingAction(page);
    if (action) {
      onboardingClicks += 1;
      idleAfterMinimum = 0;
      logStep('post_signup_prompt_clicked', { round: round + 1, url, action, onboardingClicks });
      await sleep(800);
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
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
      await sleep(1000);
      continue;
    }

    logStep('chatgpt_home_wait', { round: round + 1, url, profileReady, onboardingClicks, minOnboardingClicks: MIN_ONBOARDING_CLICKS });
    await sleep(1000);
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
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
      await sleep(1000);
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
    await sleep(1000);
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
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const emailVisible = await page.locator('input#email, input[name="email"]').first().isVisible().catch(() => false);
    if (emailVisible) {
      logStep('signup_popover_ready', { attempt: attempt + 1 });
      return;
    }
    await sleep(500);
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
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const passwordVisible = await page.locator('input[type="password"], input[name="password"]').first().isVisible().catch(() => false);
    if (passwordVisible) {
      logStep('password_step_ready', { attempt: attempt + 1 });
      break;
    }
    await sleep(500);
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
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const visible = await page.locator('input#_r_5_-code, input[autocomplete="one-time-code"], input[name="code"], input[name*="code"], input[id*="code"]').first().isVisible().catch(() => false);
    if (visible) {
      logStep('verification_code_input_ready', { attempt: attempt + 1 });
      break;
    }
    await sleep(500);
  }
  const input = page.locator('input#_r_5_-code, input[autocomplete="one-time-code"], input[name="code"], input[name*="code"], input[id*="code"]').first();
  await input.fill(code);
  const submitted = await clickIfPresent(page, [{ role: 'button', options: { name: /继续|continue|verify|验证/i } }, { text: /继续|continue|verify|验证/i }, 'button[type="submit"]']);
  logStep('verification_code_submitted', { submitted });
}

async function completeAgeGate(page: Page): Promise<void> {
  logStep('age_gate_waiting');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const nameVisible = await page.locator('input[name="name"], input#_r_h_-name').first().isVisible().catch(() => false);
    const ageVisible = await page.locator('input[name="age"], input#_r_h_-age, input[id*="age"]').first().isVisible().catch(() => false);
    const birthdayVisible = await page.locator('input[name="birthday"], input[id*="birthday"], input[type="date"], [role="group"] [data-type="year"]').first().isVisible().catch(() => false);
    const hiddenBirthday = await page.locator('input[type="hidden"][name="birthday"]').count().catch(() => 0);
    if (nameVisible || ageVisible || birthdayVisible || hiddenBirthday > 0) {
      logStep('age_gate_ready', { attempt: attempt + 1, nameVisible, ageVisible, birthdayVisible, hiddenBirthday });
      break;
    }
    await sleep(500);
  }
  const nameFilled = await fillFirstAvailable(page, ['input[name="name"]', 'input#_r_h_-name'], PROFILE_NAME);
  if (nameFilled) logStep('age_gate_name_filled', { name: PROFILE_NAME });
  let ageFilled = await fillFirstAvailable(page, ['input[name="age"]', 'input#_r_h_-age', 'input[id*="age"]'], ADULT_AGE);
  if (ageFilled) logStep('age_gate_age_filled', { age: ADULT_AGE, mode: 'direct' });
  let birthdayFilled = false;
  if (!ageFilled) {
    for (let i = 0; i < 3; i += 1) {
      const completed = await clickCompleteAccountCreation(page);
      logStep('age_gate_submit_without_birthday', { attempt: i + 1, completed });
      await sleep(1000);
      ageFilled = await fillFirstAvailable(page, ['input[name="age"]', 'input#_r_h_-age', 'input[id*="age"]'], ADULT_AGE);
      if (ageFilled) {
        logStep('age_gate_age_filled', { age: ADULT_AGE, mode: 'after_submit_prompt' });
        break;
      }
    }
  }
  if (!ageFilled) {
    const birthdayFilledVisible = await fillFirstAvailable(page, ['input[name="birthday"]', 'input[id*="birthday"]', 'input[type="date"]'], ADULT_BIRTHDAY);
    if (birthdayFilledVisible) {
      birthdayFilled = true;
      logStep('age_gate_birthday_filled_visible', { birthday: ADULT_BIRTHDAY });
    }
    const birthdayFilledJs = await setBirthdayViaJs(page, ADULT_BIRTHDAY).catch(() => false);
    if (birthdayFilledJs) {
      birthdayFilled = true;
      logStep('age_gate_birthday_filled_js', { birthday: ADULT_BIRTHDAY });
    }
  }
  const completed = await clickCompleteAccountCreation(page);
  logStep('age_gate_submitted', { completed, ageFilled, birthdayFilled });
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
      await sleep(2000);
      continue;
    }
    for (let wait = 0; wait < 45; wait += 1) {
      const addVisible = await page.locator('button').filter({ hasText: /安全密钥和通行密钥|security keys and passkeys/i }).first().isVisible().catch(() => false);
      if (addVisible) break;
      await sleep(1000);
      const action = await clickOnboardingAction(page);
      if (action) logStep('passkey_onboarding_click', { attempt: attempt + 1, wait: wait + 1, action, url: page.url() });
    }
    const addClicked = await clickIfPresent(page, [
      'button:has(div:has-text("添加"))',
      { text: /^添加$|^add$/i },
    ]);
    if (!addClicked) {
      logStep('passkey_add_not_ready', { attempt: attempt + 1 });
      await sleep(2000);
      continue;
    }
    logStep('passkey_add_clicked', { attempt: attempt + 1 });
    await sleep(4000);
    const passkeyStore = await captureVirtualPasskeyStore(virtualAuth.session as never, virtualAuth.authenticatorId);
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

