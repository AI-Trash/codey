import '@tanstack/react-start/server-only'
import { and, desc, eq, gte } from 'drizzle-orm'
import { getAppEnv } from './env'
import {
  emailIngestRecords,
  verificationCodes,
  verificationEmailReservations,
} from './db/schema'
import { getDb } from './db/client'
import { createId, randomCode } from './security'

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

export interface VerificationEmailPayload {
  messageId?: string | null
  subject?: string | null
  textBody?: string | null
  htmlBody?: string | null
  rawPayload?: string | null
  receivedAt: string
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

export function extractVerificationCodeFromEmail(
  message: Pick<
    VerificationEmailPayload,
    'subject' | 'textBody' | 'htmlBody' | 'rawPayload'
  >,
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

function buildReservationEmail(id: string): {
  email: string
  prefix?: string
  mailbox?: string
} {
  const env = getAppEnv()
  if (env.verificationMailbox) {
    const [localPart, domain] = env.verificationMailbox.split('@')
    if (!localPart || !domain) {
      throw new Error(
        `Invalid VERIFICATION_MAILBOX value: ${env.verificationMailbox}`,
      )
    }

    return {
      email: `${localPart}+${id}@${domain}`,
      mailbox: env.verificationMailbox,
    }
  }

  const domain = env.verificationDomain || 'example.invalid'
  return {
    email: `${env.verificationEmailPrefix || 'codey'}+${id}@${domain}`,
  }
}

export async function reserveVerificationEmailTarget() {
  const env = getAppEnv()
  const expiresAt = new Date(
    Date.now() + env.verificationReservationTtlMinutes * 60 * 1000,
  )
  const tempId = randomCode(12)
  const target = buildReservationEmail(tempId)

  const [reservation] = await getDb()
    .insert(verificationEmailReservations)
    .values({
      id: createId(),
      email: target.email,
      prefix: target.prefix,
      mailbox: target.mailbox,
      expiresAt,
    })
    .returning()

  return {
    reservationId: reservation.id,
    email: reservation.email,
    prefix: reservation.prefix || undefined,
    mailbox: reservation.mailbox || undefined,
    expiresAt: reservation.expiresAt.toISOString(),
  }
}

export async function findVerificationCode(params: {
  email: string
  startedAt: string
}) {
  const reservation =
    await getDb().query.verificationEmailReservations.findFirst({
      where: eq(verificationEmailReservations.email, params.email),
    })

  if (!reservation) {
    return {
      status: 'pending' as const,
      emails: [] as VerificationEmailPayload[],
    }
  }

  const startedAt = new Date(params.startedAt)
  const since = Number.isNaN(startedAt.getTime()) ? new Date(0) : startedAt
  const [codeRows, emailRows] = await Promise.all([
    getDb().query.verificationCodes.findMany({
      where: and(
        eq(verificationCodes.reservationId, reservation.id),
        gte(verificationCodes.receivedAt, since),
      ),
      orderBy: [desc(verificationCodes.receivedAt)],
      limit: 20,
    }),
    getDb().query.emailIngestRecords.findMany({
      where: and(
        eq(emailIngestRecords.recipient, params.email),
        gte(emailIngestRecords.receivedAt, since),
      ),
      orderBy: [desc(emailIngestRecords.receivedAt)],
      limit: 5,
    }),
  ])

  const emails = emailRows.map((email) => ({
    messageId: email.messageId,
    subject: email.subject,
    textBody: email.textBody,
    htmlBody: email.htmlBody,
    rawPayload: email.rawPayload,
    receivedAt: email.receivedAt.toISOString(),
  }))

  const rankedCandidates = [
    ...codeRows.map((codeRow) => ({
      code: codeRow.code,
      receivedAt: codeRow.receivedAt.toISOString(),
      priority: codeRow.source === 'MANUAL' ? 30 : 10,
    })),
    ...emails
      .map((email) => {
        const code = extractVerificationCodeFromEmail(email)
        if (!code) {
          return null
        }
        return {
          code,
          receivedAt: email.receivedAt,
          priority: 20,
        }
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> =>
        Boolean(candidate),
      ),
  ].sort((left, right) => {
    const timeDelta =
      new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime()
    if (timeDelta !== 0) {
      return timeDelta
    }
    return right.priority - left.priority
  })

  const matchingCode = rankedCandidates[0]
  if (!matchingCode) {
    return {
      reservationId: reservation.id,
      status: 'pending' as const,
      emails,
    }
  }

  return {
    reservationId: reservation.id,
    status: 'resolved' as const,
    code: matchingCode.code,
    receivedAt: matchingCode.receivedAt,
    emails,
  }
}

export async function createManualVerificationCode(params: {
  email: string
  code: string
}) {
  const db = getDb()
  const inserted = await db
    .insert(verificationEmailReservations)
    .values({
      id: createId(),
      email: params.email,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .onConflictDoNothing({ target: verificationEmailReservations.email })
    .returning()

  const reservation =
    inserted[0] ||
    (await db.query.verificationEmailReservations.findFirst({
      where: eq(verificationEmailReservations.email, params.email),
    }))

  if (!reservation) {
    throw new Error('Unable to create verification reservation')
  }

  const [record] = await db
    .insert(verificationCodes)
    .values({
      id: createId(),
      reservationId: reservation.id,
      code: params.code,
      source: 'MANUAL',
    })
    .returning()

  return record
}

export async function ingestCloudflareEmail(params: {
  recipient: string
  subject?: string
  textBody?: string
  htmlBody?: string
  rawPayload?: string
  messageId?: string
  receivedAt?: string
}) {
  const db = getDb()
  const reservation = await db.query.verificationEmailReservations.findFirst({
    where: eq(verificationEmailReservations.email, params.recipient),
  })

  const receivedAt = params.receivedAt
    ? new Date(params.receivedAt)
    : new Date()

  const [emailRecord] = await db
    .insert(emailIngestRecords)
    .values({
      id: createId(),
      reservationId: reservation?.id,
      messageId: params.messageId,
      recipient: params.recipient,
      subject: params.subject,
      textBody: params.textBody,
      htmlBody: params.htmlBody,
      rawPayload: params.rawPayload,
      verificationCode: null,
      receivedAt,
    })
    .returning()

  return {
    emailRecord,
    codeRecord: null,
  }
}

export async function listRecentVerificationActivity() {
  const db = getDb()
  const [reservations, codes, emails] = await Promise.all([
    db.query.verificationEmailReservations.findMany({
      orderBy: [desc(verificationEmailReservations.createdAt)],
      limit: 20,
    }),
    db.query.verificationCodes.findMany({
      with: { reservation: true },
      orderBy: [desc(verificationCodes.receivedAt)],
      limit: 20,
    }),
    db.query.emailIngestRecords.findMany({
      orderBy: [desc(emailIngestRecords.receivedAt)],
      limit: 20,
    }),
  ])

  return { reservations, codes, emails }
}
