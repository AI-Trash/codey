import '@tanstack/react-start/server-only'
import { endOfDay, startOfDay } from 'date-fns'
import { extract as extractLetterMail } from 'letterparser'
import type {
  FilterModel,
  FiltersState,
} from '#/components/data-table-filter/core/types'
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  or,
} from 'drizzle-orm'
import { getAppEnv } from './env'
import {
  emailIngestRecords,
  verificationCodes,
  verificationEmailReservations,
  type EmailIngestRecordRow,
} from './db/schema'
import {
  hasAdminInboxEmailSubscribers,
  publishAdminInboxEmailEvent,
} from './admin-inbox-events'
import { publishVerificationCodeEvent } from './verification-events'
import { getDb } from './db/client'
import { createId, randomCode } from './security'
import { extractVerificationCodeFromText } from '../shared/verification-code'

export interface VerificationEmailPayload {
  messageId?: string | null
  subject?: string | null
  textBody?: string | null
  htmlBody?: string | null
  rawPayload?: string | null
  receivedAt: string
}

export interface AdminInboxEmail {
  id: string
  cursor: string
  messageId: string | null
  recipient: string
  subject: string | null
  textBody: string | null
  htmlBody: string | null
  rawPayload: string | null
  receivedAt: string
  createdAt: string
  reservationId: string | null
  reservationEmail: string | null
  reservationMailbox: string | null
  reservationExpiresAt: string | null
  latestCode: string | null
  latestCodeSource: string | null
  latestCodeReceivedAt: string | null
}

export interface AdminInboxPage {
  emails: AdminInboxEmail[]
  page: number
  pageSize: number
  totalCount: number
  pageCount: number
  hasNextPage: boolean
  hasPreviousPage: boolean
  search: string
}

export interface VerificationCodeEvent {
  id: string
  cursor: string
  reservationId: string
  email: string
  code: string
  source: string
  receivedAt: string
}

type AdminInboxCursor = {
  createdAt: Date
  id: string
}

type VerificationCodeCursor = {
  receivedAt: Date
  id: string
}

type AdminInboxCodeSummary = {
  code: string
  source: string
  receivedAt: string
}

const DEFAULT_ADMIN_INBOX_PAGE_SIZE = 25
const MAX_ADMIN_INBOX_PAGE_SIZE = 100

function normalizeAdminInboxPageParams(params?: {
  page?: number
  pageSize?: number
  search?: string | null
  filters?: FiltersState
}) {
  const requestedPage =
    typeof params?.page === 'number' && Number.isFinite(params.page)
      ? Math.floor(params.page)
      : 1
  const requestedPageSize =
    typeof params?.pageSize === 'number' && Number.isFinite(params.pageSize)
      ? Math.floor(params.pageSize)
      : DEFAULT_ADMIN_INBOX_PAGE_SIZE

  return {
    page: Math.max(1, requestedPage),
    pageSize: Math.min(
      MAX_ADMIN_INBOX_PAGE_SIZE,
      Math.max(1, requestedPageSize),
    ),
    search: params?.search?.trim() || '',
    filters: params?.filters ?? [],
  }
}

function buildAdminInboxSearchFilter(search: string) {
  if (!search) {
    return undefined
  }

  const pattern = `%${search}%`
  return or(
    ilike(emailIngestRecords.recipient, pattern),
    ilike(emailIngestRecords.subject, pattern),
    ilike(emailIngestRecords.textBody, pattern),
    ilike(emailIngestRecords.htmlBody, pattern),
    ilike(emailIngestRecords.rawPayload, pattern),
    ilike(emailIngestRecords.messageId, pattern),
  )
}

function combineConditions(conditions: Array<unknown>) {
  const active = conditions.filter(Boolean)

  if (active.length === 0) {
    return undefined
  }

  if (active.length === 1) {
    return active[0]
  }

  return and(...active)
}

function buildAdminInboxDeliveryFilter(
  db: ReturnType<typeof getDb>,
  filter: FilterModel<'option'>,
) {
  const values = Array.from(
    new Set(
      filter.values.filter(
        (value): value is 'ready' | 'received' =>
          value === 'ready' || value === 'received',
      ),
    ),
  )

  if (values.length === 0) {
    return undefined
  }

  const reservationHasCode = exists(
    db
      .select({ id: verificationCodes.id })
      .from(verificationCodes)
      .where(eq(verificationCodes.reservationId, emailIngestRecords.reservationId)),
  )
  const reservationHasNoCode = notExists(
    db
      .select({ id: verificationCodes.id })
      .from(verificationCodes)
      .where(eq(verificationCodes.reservationId, emailIngestRecords.reservationId)),
  )
  const positiveOperator =
    filter.operator === 'is' || filter.operator === 'is any of'
  const includeReady = values.includes('ready')
  const includeReceived = values.includes('received')

  if (positiveOperator) {
    if (includeReady && includeReceived) {
      return undefined
    }

    if (includeReady) {
      return reservationHasCode
    }

    if (includeReceived) {
      return reservationHasNoCode
    }

    return undefined
  }

  if (includeReady && includeReceived) {
    return eq(emailIngestRecords.id, '__no_admin_inbox_match__')
  }

  if (includeReady) {
    return reservationHasNoCode
  }

  if (includeReceived) {
    return reservationHasCode
  }

  return undefined
}

function buildAdminInboxReceivedAtFilter(filter: FilterModel<'date'>) {
  const start = filter.values[0]
  if (!start) {
    return undefined
  }

  const startDate = startOfDay(start)
  const endDate = endOfDay(filter.values[1] ?? start)

  switch (filter.operator) {
    case 'is':
      return and(
        gte(emailIngestRecords.receivedAt, startDate),
        lte(emailIngestRecords.receivedAt, endDate),
      )
    case 'is not':
      return or(
        lt(emailIngestRecords.receivedAt, startDate),
        gt(emailIngestRecords.receivedAt, endDate),
      )
    case 'is before':
      return lt(emailIngestRecords.receivedAt, startDate)
    case 'is on or after':
      return gte(emailIngestRecords.receivedAt, startDate)
    case 'is after':
      return gt(emailIngestRecords.receivedAt, startDate)
    case 'is on or before':
      return lte(emailIngestRecords.receivedAt, endDate)
    case 'is between':
      return and(
        gte(emailIngestRecords.receivedAt, startDate),
        lte(emailIngestRecords.receivedAt, endDate),
      )
    case 'is not between':
      return or(
        lt(emailIngestRecords.receivedAt, startDate),
        gt(emailIngestRecords.receivedAt, endDate),
      )
    default:
      return undefined
  }
}

function buildAdminInboxFilters(
  db: ReturnType<typeof getDb>,
  filters: FiltersState,
) {
  return combineConditions(
    filters.map((filter) => {
      switch (filter.columnId) {
        case 'delivery':
          return buildAdminInboxDeliveryFilter(
            db,
            filter as FilterModel<'option'>,
          )
        case 'receivedAt':
          return buildAdminInboxReceivedAtFilter(
            filter as FilterModel<'date'>,
          )
        default:
          return undefined
      }
    }),
  )
}

export function encodeAdminInboxCursor(params: {
  createdAt: Date | string
  id?: string | null
}) {
  const createdAt =
    params.createdAt instanceof Date
      ? params.createdAt
      : new Date(params.createdAt)

  return `${createdAt.toISOString()}|${params.id || ''}`
}

function decodeAdminInboxCursor(
  cursor?: string | null,
): AdminInboxCursor | null {
  if (!cursor) return null

  const separatorIndex = cursor.indexOf('|')
  const createdAtValue =
    separatorIndex === -1 ? cursor : cursor.slice(0, separatorIndex)
  const createdAt = new Date(createdAtValue)
  if (Number.isNaN(createdAt.getTime())) {
    return null
  }

  return {
    createdAt,
    id: separatorIndex === -1 ? '' : cursor.slice(separatorIndex + 1),
  }
}

async function getLatestCodeByReservationId(
  reservationIds: string[],
): Promise<Map<string, AdminInboxCodeSummary>> {
  if (!reservationIds.length) {
    return new Map()
  }

  const rows = await getDb().query.verificationCodes.findMany({
    where: inArray(verificationCodes.reservationId, reservationIds),
    orderBy: [desc(verificationCodes.receivedAt)],
  })

  const latestCodes = new Map<string, AdminInboxCodeSummary>()
  for (const row of rows) {
    if (latestCodes.has(row.reservationId)) {
      continue
    }

    latestCodes.set(row.reservationId, {
      code: row.code,
      source: row.source,
      receivedAt: row.receivedAt.toISOString(),
    })
  }

  return latestCodes
}

function serializeAdminInboxEmail(
  email: EmailIngestRecordRow & {
    reservation?: {
      id: string
      email: string
      mailbox: string | null
      expiresAt: Date
    } | null
  },
  latestCode?: AdminInboxCodeSummary,
): AdminInboxEmail {
  return {
    id: email.id,
    cursor: encodeAdminInboxCursor({
      createdAt: email.createdAt,
      id: email.id,
    }),
    messageId: email.messageId,
    recipient: email.recipient,
    subject: email.subject,
    textBody: email.textBody,
    htmlBody: email.htmlBody,
    rawPayload: email.rawPayload,
    receivedAt: email.receivedAt.toISOString(),
    createdAt: email.createdAt.toISOString(),
    reservationId: email.reservationId,
    reservationEmail: email.reservation?.email || null,
    reservationMailbox: email.reservation?.mailbox || null,
    reservationExpiresAt: email.reservation?.expiresAt.toISOString() || null,
    latestCode: latestCode?.code || null,
    latestCodeSource: latestCode?.source || null,
    latestCodeReceivedAt: latestCode?.receivedAt || null,
  }
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

function normalizeStoredEmailContent(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function normalizeManualVerificationCodeInput(value: string) {
  const normalized = value.replace(/[０-９]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0),
  )
  const digits = normalized.replace(/\D/g, '')

  if (digits.length !== 6) {
    throw new Error('Verification code must contain exactly 6 digits.')
  }

  return digits
}

function isLikelyRawEmailSource(value: string | null | undefined) {
  if (!value) {
    return false
  }

  const headerBlock = value.split(/\r?\n\r?\n/, 1)[0]
  const headerCount =
    headerBlock.match(/^[A-Za-z0-9-]+:\s.*$/gm)?.length ?? 0

  return headerCount >= 2
}

function parseEmailBodiesFromRawPayload(rawPayload: string | null | undefined) {
  const rawSource = normalizeStoredEmailContent(rawPayload)
  if (!rawSource || !isLikelyRawEmailSource(rawSource)) {
    return null
  }

  try {
    const parsedMail = extractLetterMail(rawSource)
    return {
      htmlBody: normalizeStoredEmailContent(parsedMail.html),
      textBody: normalizeStoredEmailContent(parsedMail.text),
    }
  } catch {
    return null
  }
}

function resolveVerificationEmailBodies(params: {
  textBody?: string | null
  htmlBody?: string | null
  rawPayload?: string | null
}) {
  const parsedBodies = parseEmailBodiesFromRawPayload(params.rawPayload)
  const normalizedHtml = normalizeStoredEmailContent(params.htmlBody)
  const normalizedText = normalizeStoredEmailContent(params.textBody)

  return {
    htmlBody: normalizedHtml || parsedBodies?.htmlBody,
    textBody:
      normalizedText && !isLikelyRawEmailSource(normalizedText)
        ? normalizedText
        : parsedBodies?.textBody,
  }
}

export function encodeVerificationCodeCursor(params: {
  receivedAt: Date | string
  id: string
}) {
  const receivedAt =
    params.receivedAt instanceof Date
      ? params.receivedAt
      : new Date(params.receivedAt)

  return `${receivedAt.toISOString()}|${params.id}`
}

function decodeVerificationCodeCursor(
  cursor?: string | null,
): VerificationCodeCursor | null {
  if (!cursor) {
    return null
  }

  const separatorIndex = cursor.indexOf('|')
  const receivedAtValue =
    separatorIndex === -1 ? cursor : cursor.slice(0, separatorIndex)
  const receivedAt = new Date(receivedAtValue)
  if (Number.isNaN(receivedAt.getTime())) {
    return null
  }

  return {
    receivedAt,
    id: separatorIndex === -1 ? '' : cursor.slice(separatorIndex + 1),
  }
}

function serializeVerificationCodeEvent(params: {
  id: string
  reservationId: string
  email: string
  code: string
  source: string
  receivedAt: Date | string
}): VerificationCodeEvent {
  const receivedAt =
    params.receivedAt instanceof Date
      ? params.receivedAt
      : new Date(params.receivedAt)

  return {
    id: params.id,
    cursor: encodeVerificationCodeCursor({
      receivedAt,
      id: params.id,
    }),
    reservationId: params.reservationId,
    email: params.email,
    code: params.code,
    source: params.source,
    receivedAt: receivedAt.toISOString(),
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
    source: manualCode.source,
    receivedAt: manualCode.receivedAt.toISOString(),
    emails,
  }
}

export async function createManualVerificationCode(params: {
  email: string
  code: string
}) {
  const db = getDb()
  const normalizedEmail = params.email.trim()
  const normalizedCode = normalizeManualVerificationCodeInput(params.code)
  const inserted = await db
    .insert(verificationEmailReservations)
    .values({
      id: createId(),
      email: normalizedEmail,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .onConflictDoNothing({ target: verificationEmailReservations.email })
    .returning()

  const reservation =
    inserted[0] ||
    (await db.query.verificationEmailReservations.findFirst({
      where: eq(verificationEmailReservations.email, normalizedEmail),
    }))

  if (!reservation) {
    throw new Error('Unable to create verification reservation')
  }

  await db
    .update(emailIngestRecords)
    .set({
      reservationId: reservation.id,
    })
    .where(
      and(
        eq(emailIngestRecords.recipient, reservation.email),
        isNull(emailIngestRecords.reservationId),
      ),
    )

  const [record] = await db
    .insert(verificationCodes)
    .values({
      id: createId(),
      reservationId: reservation.id,
      code: normalizedCode,
      source: 'MANUAL',
    })
    .returning()

  publishVerificationCodeEvent(
    serializeVerificationCodeEvent({
      id: record.id,
      reservationId: reservation.id,
      email: reservation.email,
      code: record.code,
      source: record.source,
      receivedAt: record.receivedAt,
    }),
  )

  return record
}

export async function ingestCloudflareEmail(params: {
  recipient: string
  subject?: string
  textBody?: string
  htmlBody?: string
  rawPayload?: string
  extractedCode?: string
  messageId?: string
  receivedAt?: string
}) {
  const db = getDb()
  const reservation = await db.query.verificationEmailReservations.findFirst({
    where: eq(verificationEmailReservations.email, params.recipient),
  })
  const resolvedBodies = resolveVerificationEmailBodies({
    textBody: params.textBody,
    htmlBody: params.htmlBody,
    rawPayload: params.rawPayload,
  })

  const receivedAt = params.receivedAt
    ? new Date(params.receivedAt)
    : new Date()
  const extractedCode =
    extractVerificationCodeFromText(resolvedBodies.htmlBody) ||
    extractVerificationCodeFromText(resolvedBodies.textBody) ||
    params.extractedCode

  const [emailRecord] = await db
    .insert(emailIngestRecords)
    .values({
      id: createId(),
      reservationId: reservation?.id,
      messageId: params.messageId,
      recipient: params.recipient,
      subject: params.subject,
      textBody: resolvedBodies.textBody,
      htmlBody: resolvedBodies.htmlBody,
      rawPayload: params.rawPayload,
      verificationCode: extractedCode,
      receivedAt,
    })
    .returning()

  let codeRecord = null
  if (reservation?.id && extractedCode) {
    const insertedCode = await db
      .insert(verificationCodes)
      .values({
        id: createId(),
        reservationId: reservation.id,
        code: extractedCode,
        source: 'CLOUDFLARE_EMAIL',
        messageId: params.messageId,
        receivedAt,
      })
      .onConflictDoNothing({
        target: [
          verificationCodes.reservationId,
          verificationCodes.code,
          verificationCodes.receivedAt,
        ],
      })
      .returning()

    codeRecord = insertedCode[0] || null
  }

  if (codeRecord && reservation) {
    publishVerificationCodeEvent(
      serializeVerificationCodeEvent({
        id: codeRecord.id,
        reservationId: reservation.id,
        email: reservation.email,
        code: codeRecord.code,
        source: codeRecord.source,
        receivedAt: codeRecord.receivedAt,
      }),
    )
  }

  if (hasAdminInboxEmailSubscribers()) {
    const latestCode = reservation?.id
      ? (await getLatestCodeByReservationId([reservation.id])).get(
          reservation.id,
        )
      : undefined

    publishAdminInboxEmailEvent(
      serializeAdminInboxEmail(
        {
          ...emailRecord,
          reservation,
        },
        latestCode,
      ),
    )
  }

  return {
    emailRecord,
    codeRecord,
  }
}

export async function listAdminInboxEmails(options?: { limit?: number }) {
  return (
    await listAdminInboxEmailsPage({
      page: 1,
      pageSize: options?.limit ?? 100,
    })
  ).emails
}

export async function listAdminInboxEmailsPage(options?: {
  page?: number
  pageSize?: number
  search?: string | null
  filters?: FiltersState
}): Promise<AdminInboxPage> {
  const params = normalizeAdminInboxPageParams(options)
  const db = getDb()
  const filter = combineConditions([
    buildAdminInboxSearchFilter(params.search),
    buildAdminInboxFilters(db, params.filters),
  ])

  const totalCountResult = filter
    ? await db.select({ count: count() }).from(emailIngestRecords).where(filter)
    : await db.select({ count: count() }).from(emailIngestRecords)
  const totalCount = Number(totalCountResult[0]?.count ?? 0)
  const pageCount = totalCount ? Math.ceil(totalCount / params.pageSize) : 0
  const page = Math.min(params.page, Math.max(1, pageCount || 1))
  const offset = (page - 1) * params.pageSize

  const emails = await db.query.emailIngestRecords.findMany({
    with: {
      reservation: true,
    },
    where: filter,
    orderBy: [desc(emailIngestRecords.createdAt), desc(emailIngestRecords.id)],
    limit: params.pageSize,
    offset,
  })

  const reservationIds = Array.from(
    new Set(
      emails
        .map((email) => email.reservationId)
        .filter((reservationId): reservationId is string =>
          Boolean(reservationId),
        ),
    ),
  )
  const latestCodes = await getLatestCodeByReservationId(reservationIds)

  return {
    emails: emails.map((email) =>
      serializeAdminInboxEmail(
        email,
        email.reservationId ? latestCodes.get(email.reservationId) : undefined,
      ),
    ),
    page,
    pageSize: params.pageSize,
    totalCount,
    pageCount,
    hasNextPage: pageCount > 0 && page < pageCount,
    hasPreviousPage: page > 1,
    search: params.search,
  }
}

export async function listAdminInboxEmailsAfterCursor(options?: {
  cursor?: string | null
  limit?: number
}) {
  const cursor = decodeAdminInboxCursor(options?.cursor)
  const emails = await getDb().query.emailIngestRecords.findMany({
    with: {
      reservation: true,
    },
    where: cursor
      ? or(
          gt(emailIngestRecords.createdAt, cursor.createdAt),
          and(
            eq(emailIngestRecords.createdAt, cursor.createdAt),
            gt(emailIngestRecords.id, cursor.id),
          ),
        )
      : undefined,
    orderBy: [asc(emailIngestRecords.createdAt), asc(emailIngestRecords.id)],
    limit: options?.limit ?? 20,
  })

  const reservationIds = Array.from(
    new Set(
      emails
        .map((email) => email.reservationId)
        .filter((reservationId): reservationId is string =>
          Boolean(reservationId),
        ),
    ),
  )
  const latestCodes = await getLatestCodeByReservationId(reservationIds)

  return emails.map((email) =>
    serializeAdminInboxEmail(
      email,
      email.reservationId ? latestCodes.get(email.reservationId) : undefined,
    ),
  )
}

export async function listVerificationCodeEventsAfterCursor(options: {
  email: string
  startedAt: string
  cursor?: string | null
  limit?: number
}) {
  const reservation =
    await getDb().query.verificationEmailReservations.findFirst({
      where: eq(verificationEmailReservations.email, options.email),
    })
  if (!reservation) {
    return [] as VerificationCodeEvent[]
  }

  const startedAt = new Date(options.startedAt)
  const since = Number.isNaN(startedAt.getTime()) ? new Date(0) : startedAt
  const cursor = decodeVerificationCodeCursor(options.cursor)
  const rows = await getDb().query.verificationCodes.findMany({
    where: combineConditions([
      eq(verificationCodes.reservationId, reservation.id),
      gte(verificationCodes.receivedAt, since),
      cursor
        ? or(
            gt(verificationCodes.receivedAt, cursor.receivedAt),
            and(
              eq(verificationCodes.receivedAt, cursor.receivedAt),
              gt(verificationCodes.id, cursor.id),
            ),
          )
        : undefined,
    ]),
    orderBy: [asc(verificationCodes.receivedAt), asc(verificationCodes.id)],
    limit: options.limit ?? 20,
  })

  return rows.map((row) =>
    serializeVerificationCodeEvent({
      id: row.id,
      reservationId: reservation.id,
      email: reservation.email,
      code: row.code,
      source: row.source,
      receivedAt: row.receivedAt,
    }),
  )
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
