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
export const CHATGPT_SECURITY_URL = 'https://chatgpt.com/#settings/Security'
export const ADULT_AGE = '25'
export const PROFILE_NAME = 'Codey Test'
export const MIN_ONBOARDING_CLICKS = 3
export const DEFAULT_EVENT_TIMEOUT_MS = 5000

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
  { text: /糟糕，出错了！|oops[,，]?\s*an error occurred/i },
  { text: /operation timed out/i },
  'div:has-text("Operation timed out")',
]
export const PASSWORD_TIMEOUT_RETRY_SELECTORS: SelectorTarget[] = [
  { role: 'button', options: { name: /重试|try again/i } },
  { text: /重试|try again/i },
  'button[data-dd-action-name="Try again"]',
]
export const REGISTRATION_EMAIL_SELECTORS: SelectorTarget[] = [
  'input#email',
  'input[name="email"]',
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
  'input[name="age"]',
  'input#_r_h_-age',
  'input[id*="age"]',
]
export const AGE_GATE_NAME_SELECTORS: SelectorTarget[] = [
  'input[name="name"]',
  'input#_r_h_-name',
]
export const AGE_GATE_AGE_SELECTORS: SelectorTarget[] = [
  'input[name="age"]',
  'input#_r_h_-age',
  'input[id*="age"]',
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
      { role: 'button', options: { name: /^继续$|^continue$/i } },
      { text: /^继续$|^continue$/i },
    ],
  },
  {
    text: 'skip',
    selectors: [
      {
        role: 'button',
        options: { name: /^跳过$|^skip$|^not now$|^以后再说$|^稍后$/i },
      },
      { text: /^跳过$|^skip$|^not now$|^以后再说$|^稍后$/i },
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
  { role: 'button', options: { name: /^继续$|^continue$/i } },
  { text: /^继续$|^continue$/i },
  {
    role: 'button',
    options: { name: /^跳过$|^skip$|^not now$|^以后再说$|^稍后$/i },
  },
  { text: /^跳过$|^skip$|^not now$|^以后再说$|^稍后$/i },
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

const VERIFICATION_CODE_TOKEN = '(\\d(?:[\\s-]?\\d){5})'
const VERIFICATION_CONTEXT_HINT =
  /(?:verification|one[- ]time|security|login|email)\s*code|验证码|校验码|驗證碼|otp|passcode/i
const VERIFICATION_INLINE_PATTERNS = [
  new RegExp(
    `(?:verification|one[- ]time|security|login|email)\\s*code(?:\\s+is|\\s*[:：-])?\\s*${VERIFICATION_CODE_TOKEN}`,
    'i',
  ),
  new RegExp(
    `(?:code|otp|passcode)(?:\\s+is|\\s*[:：-])?\\s*${VERIFICATION_CODE_TOKEN}`,
    'i',
  ),
  new RegExp(
    `(?:验证码|校验码|驗證碼)(?:\\s*[:：-])?\\s*${VERIFICATION_CODE_TOKEN}`,
    'i',
  ),
  new RegExp(
    `${VERIFICATION_CODE_TOKEN}(?=\\s*(?:is\\s+(?:your\\s+)?)?(?:verification|one[- ]time|security|login|email)\\s*code\\b)`,
    'i',
  ),
]
const VERIFICATION_BLOCK_PATTERNS = [
  new RegExp(
    `(?:verification code|one[- ]time code|security code|login code|email code|验证码|校验码|驗證碼|otp|passcode)\\D{0,120}${VERIFICATION_CODE_TOKEN}`,
    'i',
  ),
  new RegExp(
    `${VERIFICATION_CODE_TOKEN}\\D{0,120}(?:verification code|one[- ]time code|security code|login code|email code|验证码|校验码|驗證碼|otp|passcode)`,
    'i',
  ),
]

export interface VerificationEmailMessage {
  subject?: string
  textBody?: string
  htmlBody?: string
  rawPayload?: string
}

function decodeHtmlEntities(body: string): string {
  return body
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, digits: string) =>
      String.fromCodePoint(Number(digits)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits: string) =>
      String.fromCodePoint(parseInt(digits, 16)),
    )
}

function decodeQuotedPrintable(body: string): string {
  if (!/=([0-9A-F]{2}|\r?\n)/i.test(body)) {
    return body
  }

  const normalized = body.replace(/=\r?\n/g, '')
  const bytes: number[] = []

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    if (
      char === '=' &&
      /^[0-9A-F]{2}$/i.test(normalized.slice(index + 1, index + 3))
    ) {
      bytes.push(parseInt(normalized.slice(index + 1, index + 3), 16))
      index += 2
      continue
    }

    bytes.push(...Buffer.from(char, 'utf8'))
  }

  return Buffer.from(bytes).toString('utf8')
}

function stripHtml(body: string): string {
  return decodeHtmlEntities(
    body
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/td|\/th|\/h\d)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
}

function normalizeVerificationText(body: string): string {
  return body
    .replace(/\r/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function sanitizeCodeToken(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  return digits.length === 6 ? digits : null
}

function collectUniqueCodes(body: string): string[] {
  const codes = new Set<string>()
  for (const match of body.matchAll(/\b\d{6}\b/g)) {
    if (match[0]) {
      codes.add(match[0])
    }
  }
  return Array.from(codes)
}

function extractVerificationCodeFromText(
  body: string,
  options: {
    allowLooseFallback?: boolean
  } = {},
): string | null {
  const normalized = normalizeVerificationText(body)
  if (!normalized) {
    return null
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    for (const pattern of VERIFICATION_INLINE_PATTERNS) {
      const match = line.match(pattern)
      const code = sanitizeCodeToken(match?.[1] || '')
      if (code) {
        return code
      }
    }
  }

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!VERIFICATION_CONTEXT_HINT.test(lines[index] || '')) {
      continue
    }

    const code = sanitizeCodeToken(lines[index + 1] || '')
    if (code) {
      return code
    }
  }

  const collapsed = lines.join(' ')
  for (const pattern of VERIFICATION_BLOCK_PATTERNS) {
    const match = collapsed.match(pattern)
    const code = sanitizeCodeToken(match?.[1] || '')
    if (code) {
      return code
    }
  }

  if (!options.allowLooseFallback) {
    return null
  }

  const standaloneCodes = new Set<string>()
  for (const line of lines) {
    if (!/^\D*\d(?:[\s-]?\d){5}\D*$/.test(line)) {
      continue
    }

    const code = sanitizeCodeToken(line)
    if (code) {
      standaloneCodes.add(code)
    }
  }
  if (standaloneCodes.size === 1) {
    return Array.from(standaloneCodes)[0] || null
  }

  const uniqueCodes = collectUniqueCodes(collapsed)
  return uniqueCodes.length === 1 ? uniqueCodes[0] || null : null
}

function uniqueBodies(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeVerificationText(value || ''))
        .filter(Boolean),
    ),
  )
}

export function extractVerificationCode(body: string): string | null {
  const decoded = decodeQuotedPrintable(body)
  if (/<[a-z!/][^>]*>/i.test(decoded)) {
    const htmlTextCode = extractVerificationCodeFromText(stripHtml(decoded), {
      allowLooseFallback: true,
    })
    if (htmlTextCode) {
      return htmlTextCode
    }
  }

  return extractVerificationCodeFromText(
    normalizeVerificationText(decodeHtmlEntities(decoded)),
    {
      allowLooseFallback: true,
    },
  )
}

export function extractVerificationCodeFromMessage(
  message: VerificationEmailMessage,
): string | null {
  const trustedBodies = uniqueBodies([
    message.subject || '',
    decodeQuotedPrintable(message.textBody || ''),
    stripHtml(decodeQuotedPrintable(message.htmlBody || '')),
    stripHtml(decodeQuotedPrintable(message.rawPayload || '')),
  ])

  for (const body of trustedBodies) {
    const code = extractVerificationCodeFromText(body)
    if (code) {
      return code
    }
  }

  const trustedFallback = extractVerificationCodeFromText(
    trustedBodies.join('\n'),
    {
      allowLooseFallback: true,
    },
  )
  if (trustedFallback) {
    return trustedFallback
  }

  const rawBodies = uniqueBodies([
    decodeQuotedPrintable(message.htmlBody || ''),
    decodeQuotedPrintable(message.rawPayload || ''),
  ])

  for (const body of rawBodies) {
    const code = extractVerificationCodeFromText(body)
    if (code) {
      return code
    }
  }

  return extractVerificationCodeFromText(rawBodies.join('\n'), {
    allowLooseFallback: true,
  })
}
