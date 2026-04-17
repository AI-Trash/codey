import crypto from 'crypto'
import type { CDPSession } from 'patchright'
import type { SelectorTarget } from '../../types'
import {
  captureVirtualPasskeyStore,
  type VirtualPasskeyStore,
} from '../webauthn/virtual-authenticator'
import { sleep } from '../../utils/wait'

export const CHATGPT_HOME_URL = 'https://chatgpt.com/'
export const CHATGPT_ENTRY_LOGIN_URL = 'https://chatgpt.com/auth/login'
export const CHATGPT_LOGIN_URL =
  'https://auth.openai.com/log-in-or-create-account'
export const CHATGPT_LOGIN_V2_URL = 'https://auth.openai.com/log-in'
export const CHATGPT_OAUTH_LOGIN_URL =
  'https://auth.openai.com/api/accounts/login'
export const CHATGPT_OAUTH_AUTHORIZE_URL =
  'https://auth.openai.com/oauth/authorize'
export const CHATGPT_SECURITY_URL = 'https://chatgpt.com/#settings/Security'
export const ADULT_AGE = '25'
export const ADULT_BIRTHDAY = '1999-01-01'
export const ADULT_BIRTH_YEAR = '1999'
export const ADULT_BIRTH_MONTH = '01'
export const ADULT_BIRTH_DAY = '01'
export const PROFILE_NAME = 'Codey Test'
export const MIN_ONBOARDING_CLICKS = 3
export const DEFAULT_EVENT_TIMEOUT_MS = 5000

export function isChatGPTLoginUrl(url: string): boolean {
  return (
    url.startsWith(CHATGPT_ENTRY_LOGIN_URL) ||
    url.startsWith(CHATGPT_LOGIN_URL) ||
    url.startsWith(CHATGPT_LOGIN_V2_URL) ||
    url.startsWith(CHATGPT_OAUTH_LOGIN_URL) ||
    url.startsWith(CHATGPT_OAUTH_AUTHORIZE_URL)
  )
}

export const PASSWORD_INPUT_SELECTORS: SelectorTarget[] = [
  'input[type="password"]',
  'input[name="password"]',
]
export const PASSWORD_SUBMIT_SELECTORS: SelectorTarget[] = [
  'button[type="submit"]',
  { role: 'button', options: { name: /继续|continue|注册|create/i } },
  { text: /继续|continue|注册|create/i },
]
export const VERIFICATION_CODE_INPUT_SELECTORS: SelectorTarget[] = [
  'input#_r_5_-code',
  'input[autocomplete="one-time-code"]',
  'input[name="code"]',
  'input[name*="code"]',
  'input[id*="code"]',
]
export const PASSWORD_TIMEOUT_ERROR_SELECTORS: SelectorTarget[] = [
  {
    role: 'heading',
    options: { name: /糟糕，出错了！|oops[,，]?\s*an error occurred/i },
  },
  { text: /糟糕，出错了！|oops[,，]?\s*an error occurred/i },
  { text: /request id|请求\s*id|请求编号/i },
  { text: /operation timed out/i },
  'div:has-text("Operation timed out")',
]
export const PASSWORD_TIMEOUT_ERROR_TITLE_PATTERN =
  /糟糕，出错了！|oops[,，]?\s*an error occurred!?/i
export const PASSWORD_TIMEOUT_RETRY_SELECTORS: SelectorTarget[] = [
  {
    role: 'button',
    options: { name: /重试|再次提交|重新提交|try again|retry|resubmit/i },
  },
  { text: /重试|再次提交|重新提交|try again|retry|resubmit/i },
  'button[data-dd-action-name="Try again"]',
]
export const REGISTRATION_EMAIL_SELECTORS: SelectorTarget[] = [
  'input[id$="-email"]',
  'input#email',
  'input[name="email"]',
  'input[type="email"]',
  { label: /电子邮件地址|email address|email/i },
  { placeholder: /电子邮件地址|email address|email/i },
]
export const REGISTRATION_CONTINUE_SELECTORS: SelectorTarget[] = [
  'button[type="submit"]',
  { role: 'button', options: { name: /继续|continue/i } },
  { text: /继续|continue/i },
]
export const LOGIN_EMAIL_SELECTORS: SelectorTarget[] = [
  'input[id$="-email"]',
  'input#email',
  'input[name="email"]',
  'input[type="email"]',
  { label: /电子邮件地址|email address|email/i },
  { placeholder: /电子邮件地址|email address|email/i },
]
export const LOGIN_CONTINUE_SELECTORS: SelectorTarget[] = [
  'form[action="/log-in-or-create-account"] button[type="submit"]',
  'button[type="submit"]',
  {
    role: 'button',
    options: { name: /继续|continue|next|login|log in|sign in/i },
  },
  { text: /继续|continue|next|login|log in|sign in/i },
]
export const PASSKEY_ENTRY_SELECTORS: SelectorTarget[] = [
  {
    role: 'button',
    options: {
      name: /passkey|sign in with passkey|use a passkey|使用 passkey|使用通行密钥|通行密钥|密钥/i,
    },
  },
  { text: /passkey|使用 passkey|使用通行密钥|通行密钥|密钥/i },
]
export const CHATGPT_AUTHENTICATED_SELECTORS: SelectorTarget[] = [
  '[data-testid="accounts-profile-button"]',
  '[data-testid="composer-root"]',
  'textarea',
  '[data-testid="conversation-turn-0"]',
]
export const LOGIN_NEXT_STEP_SELECTORS: SelectorTarget[] = [
  ...PASSKEY_ENTRY_SELECTORS,
  ...CHATGPT_AUTHENTICATED_SELECTORS,
]
export const AGE_GATE_INPUT_SELECTORS: SelectorTarget[] = [
  'input[name="name"]',
  'input#_r_h_-name',
  'input#_r_v_-name',
  'input[id*="name"]',
  'input[name="age"]',
  'input#_r_h_-age',
  'input[id*="age"]',
  '[role="group"][id$="-birthday"]',
  '[role="spinbutton"][data-type="year"]',
  '[role="spinbutton"][data-type="month"]',
  '[role="spinbutton"][data-type="day"]',
]
export const AGE_GATE_NAME_SELECTORS: SelectorTarget[] = [
  'input[name="name"]',
  'input#_r_h_-name',
  'input#_r_v_-name',
  'input[id*="name"]',
]
export const AGE_GATE_AGE_SELECTORS: SelectorTarget[] = [
  'input[name="age"]',
  'input#_r_h_-age',
  'input[id*="age"]',
]
export const AGE_GATE_BIRTHDAY_GROUP_SELECTORS: SelectorTarget[] = [
  '[role="group"][id$="-birthday"]',
]
export const AGE_GATE_BIRTHDAY_TRIGGER_SELECTORS: SelectorTarget[] = [
  '[role="group"][id$="-birthday"]',
  { text: /生日日期|birth date|birthday/i },
  { text: /年\s*\/\s*月\s*\/\s*日|year\s*\/\s*month\s*\/\s*day/i },
]
export const AGE_GATE_BIRTHDAY_HIDDEN_INPUT_SELECTORS: SelectorTarget[] = [
  'input[name="birthday"]',
]
export const AGE_GATE_BIRTH_YEAR_SELECTORS: SelectorTarget[] = [
  '[role="spinbutton"][data-type="year"]',
  '[role="spinbutton"][aria-label*="年"]',
  '[role="spinbutton"][aria-label*="year" i]',
]
export const AGE_GATE_BIRTH_MONTH_SELECTORS: SelectorTarget[] = [
  '[role="spinbutton"][data-type="month"]',
  '[role="spinbutton"][aria-label*="月"]',
  '[role="spinbutton"][aria-label*="month" i]',
]
export const AGE_GATE_BIRTH_DAY_SELECTORS: SelectorTarget[] = [
  '[role="spinbutton"][data-type="day"]',
  '[role="spinbutton"][aria-label*="日"]',
  '[role="spinbutton"][aria-label*="day" i]',
]
export const COMPLETE_ACCOUNT_SELECTORS: SelectorTarget[] = [
  {
    role: 'button',
    options: {
      name: /完成帐户创建|完成账户创建|complete account creation|continue/i,
    },
  },
  { text: /完成帐户创建|完成账户创建|complete account creation|continue/i },
  'form[action="/about-you"] button[type="submit"]',
  'button[type="submit"]',
]
export const AGE_CONFIRM_SELECTORS: SelectorTarget[] = [
  { role: 'button', options: { name: /确定|confirm|ok/i } },
  { text: /确定|confirm|ok/i },
]
export const SIGNUP_ENTRY_SELECTORS: SelectorTarget[] = [
  '[data-testid="signup-button"]',
  { role: 'button', options: { name: /免费注册|sign up|create account/i } },
  { text: /免费注册|sign up|create account/i },
]
export const LOGIN_ENTRY_SELECTORS: SelectorTarget[] = [
  '[data-testid="login-button"]',
  { role: 'button', options: { name: /^登录$|^log in$|^login$/i } },
  { text: /^登录$|^log in$|^login$/i },
]
export const ONBOARDING_ACTION_CANDIDATES: Array<{
  text: string
  selectors: SelectorTarget[]
}> = [
  {
    text: 'getting-started',
    selectors: [
      '[data-testid="getting-started-button"]',
      {
        role: 'button',
        options: { name: /^好的，开始吧$|^开始吧$|^get started$/i },
      },
      { text: /^好的，开始吧$|^开始吧$|^get started$/i },
    ],
  },
  {
    text: 'continue',
    selectors: [
      {
        role: 'button',
        options: {
          name: /^继续$|^continue$|^下一步$|^next$|^改为使用个人帐户继续$|^continue with personal account$/i,
        },
      },
      {
        text: /^继续$|^continue$|^下一步$|^next$|^改为使用个人帐户继续$|^continue with personal account$/i,
      },
    ],
  },
  {
    text: 'continue-free',
    selectors: [
      {
        role: 'button',
        options: {
          name: /继续使用免费版|continue with free|continue using the free/i,
        },
      },
      {
        text: /继续使用免费版|continue with free|continue using the free/i,
      },
    ],
  },
  {
    text: 'skip',
    selectors: [
      {
        role: 'button',
        options: {
          name: /^跳过$|^跳过导览$|^skip$|^skip tour$|^not now$|^以后再说$|^稍后$|^稍后再说$|^暂时跳过$/i,
        },
      },
      {
        text: /^跳过$|^跳过导览$|^skip$|^skip tour$|^not now$|^以后再说$|^稍后$|^稍后再说$|^暂时跳过$/i,
      },
    ],
  },
]
export const ONBOARDING_SIGNAL_SELECTORS: SelectorTarget[] = [
  '[data-testid="getting-started-button"]',
  {
    role: 'button',
    options: { name: /^好的，开始吧$|^开始吧$|^get started$/i },
  },
  { text: /^好的，开始吧$|^开始吧$|^get started$/i },
  {
    role: 'button',
    options: {
      name: /^继续$|^continue$|^下一步$|^next$|^改为使用个人帐户继续$|^continue with personal account$/i,
    },
  },
  {
    text: /^继续$|^continue$|^下一步$|^next$|^改为使用个人帐户继续$|^continue with personal account$/i,
  },
  {
    role: 'button',
    options: {
      name: /继续使用免费版|continue with free|continue using the free/i,
    },
  },
  {
    text: /继续使用免费版|continue with free|continue using the free/i,
  },
  {
    role: 'button',
    options: {
      name: /^跳过$|^跳过导览$|^skip$|^skip tour$|^not now$|^以后再说$|^稍后$|^稍后再说$|^暂时跳过$/i,
    },
  },
  {
    text: /^跳过$|^跳过导览$|^skip$|^skip tour$|^not now$|^以后再说$|^稍后$|^稍后再说$|^暂时跳过$/i,
  },
]
export const SECURITY_READY_SELECTORS: SelectorTarget[] = [
  '[data-testid="security-tab"]',
  {
    role: 'button',
    options: { name: /安全密钥和通行密钥|security keys and passkeys/i },
  },
  { text: /安全密钥和通行密钥|security keys and passkeys/i },
]
export const SECURITY_ADD_SELECTORS: SelectorTarget[] = [
  'button:has(div:has-text("添加"))',
  { text: /^添加$|^add$/i },
]
export const PASSKEY_DONE_SELECTORS: SelectorTarget[] = [
  { role: 'button', options: { name: /完成|done|close|关闭/i } },
  { text: /完成|done|close|关闭/i },
]

export function logStep(step: string, details?: Record<string, unknown>): void {
  console.log(JSON.stringify({ scope: 'chatgpt-register', step, ...details }))
}

function randomString(length = 8): string {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length)
}

export function buildPassword(): string {
  return `Codey!${randomString(10)}A1`
}

export interface PasskeyAssertionTracker {
  waitForAssertion(timeoutMs?: number): Promise<boolean>
  dispose(): void
}

export function createPasskeyAssertionTracker(
  session: CDPSession,
  authenticatorId: string,
  baselineStore?: VirtualPasskeyStore,
): PasskeyAssertionTracker {
  let asserted = false
  const baselineCounts = new Map(
    (baselineStore?.credentials || []).map((credential) => [
      credential.credentialId,
      credential.signCount,
    ]),
  )
  const handler = () => {
    asserted = true
  }

  session.on('WebAuthn.credentialAsserted', handler)

  return {
    async waitForAssertion(timeoutMs = 10000): Promise<boolean> {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (asserted) return true
        const currentStore = await captureVirtualPasskeyStore(
          session,
          authenticatorId,
        )
        for (const credential of currentStore.credentials) {
          const previousSignCount =
            baselineCounts.get(credential.credentialId) ?? -1
          if (credential.signCount > previousSignCount) {
            asserted = true
            baselineCounts.set(credential.credentialId, credential.signCount)
            return true
          }
        }
        await sleep(250)
      }
      return asserted
    },
    dispose(): void {
      const eventEmitter = session as unknown as {
        off?: (event: string, listener: () => void) => void
        removeListener?: (event: string, listener: () => void) => void
      }
      eventEmitter.off?.('WebAuthn.credentialAsserted', handler)
      eventEmitter.removeListener?.('WebAuthn.credentialAsserted', handler)
    },
  }
}

export function summarizePasskeyCredentials(
  store?: VirtualPasskeyStore,
): Array<Record<string, unknown>> {
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
  }))
}

const CHATGPT_SUBJECT_CODE_PATTERN = /(\d(?:[\s-]?\d){5})\s*$/
const CHATGPT_BODY_CODE_PATTERNS = [
  /(?:verification\s*code|one(?:-| )?time\s*code|security\s*code|passcode|验证码|驗證碼|校验码|校驗碼|code)\D{0,24}(\d(?:[\s-]?\d){5})/i,
  /(\d(?:[\s-]?\d){5})\D{0,24}(?:verification\s*code|one(?:-| )?time\s*code|security\s*code|passcode|验证码|驗證碼|校验码|校驗碼|is\s+your\s+code|is\s+your\s+verification\s*code)/i,
]
const CHATGPT_TRAILING_CODE_PATTERN = /(\d(?:[\s-]?\d){5})\D*$/
const CHATGPT_ISOLATED_CODE_PATTERN = /\b(\d(?:[\s-]?\d){5})\b/g

function normalizeVerificationDigits(value: string): string {
  return value.replace(/[０-９]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0),
  )
}

function normalizeVerificationCandidate(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null
  }

  const digits = normalizeVerificationDigits(value).replace(/\D/g, '')
  return digits.length === 6 ? digits : null
}

function normalizeVerificationBody(value: string): string {
  return normalizeVerificationDigits(value)
    .replace(/=\r?\n/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|td|th|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
}

function extractTrailingCodeFromTail(value: string): string | null {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .reverse()

  for (const line of lines) {
    const isolatedCode = normalizeVerificationCandidate(
      line.match(/^\D*(\d(?:[\s-]?\d){5})\D*$/)?.[1],
    )
    if (isolatedCode) {
      return isolatedCode
    }

    const trailingCode = normalizeVerificationCandidate(
      line.match(/(\d(?:[\s-]?\d){5})(?!.*\d)/)?.[1],
    )
    if (trailingCode) {
      return trailingCode
    }
  }

  return null
}

export function extractChatGPTVerificationCodeFromSubject(
  subject: string | null | undefined,
): string | null {
  const normalized = subject?.trim()
  if (!normalized) {
    return null
  }

  const match = normalized.match(CHATGPT_SUBJECT_CODE_PATTERN)
  if (!match?.[1]) {
    return null
  }

  const digits = match[1].replace(/\D/g, '')
  return digits.length === 6 ? digits : null
}

export function extractChatGPTVerificationCodeFromBody(
  body: string | null | undefined,
): string | null {
  const normalized = body?.trim()
  if (!normalized) {
    return null
  }

  const cleaned = normalizeVerificationBody(normalized)
  const compact = cleaned.replace(/\s+/g, ' ').trim()

  for (const pattern of CHATGPT_BODY_CODE_PATTERNS) {
    const code = normalizeVerificationCandidate(compact.match(pattern)?.[1])
    if (code) {
      return code
    }
  }

  const tailCode = extractTrailingCodeFromTail(cleaned)
  if (tailCode) {
    return tailCode
  }

  const trailingCode = normalizeVerificationCandidate(
    compact.match(CHATGPT_TRAILING_CODE_PATTERN)?.[1],
  )
  if (trailingCode) {
    return trailingCode
  }

  const uniqueCodes = Array.from(
    compact.matchAll(CHATGPT_ISOLATED_CODE_PATTERN),
  )
    .map((match) => normalizeVerificationCandidate(match[1]))
    .filter((code): code is string => Boolean(code))
  const deduplicatedCodes = Array.from(new Set(uniqueCodes))

  return deduplicatedCodes.length === 1 ? deduplicatedCodes[0] : null
}

export function extractChatGPTVerificationCodeFromEmail(message: {
  subject?: string | null
  textBody?: string | null
  htmlBody?: string | null
  rawBody?: string | null
}): string | null {
  return (
    extractChatGPTVerificationCodeFromSubject(message.subject) ||
    extractChatGPTVerificationCodeFromBody(message.htmlBody) ||
    extractChatGPTVerificationCodeFromBody(message.textBody)
  )
}
