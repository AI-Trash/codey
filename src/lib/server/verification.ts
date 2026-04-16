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

export interface VerificationEmailPayload {
  messageId?: string | null
  subject?: string | null
  textBody?: string | null
  htmlBody?: string | null
  rawPayload?: string | null
  receivedAt: string
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

  const manualCode = codeRows[0]
  if (!manualCode) {
    return {
      reservationId: reservation.id,
      status: 'pending' as const,
      emails,
    }
  }

  return {
    reservationId: reservation.id,
    status: 'resolved' as const,
    code: manualCode.code,
    receivedAt: manualCode.receivedAt.toISOString(),
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
