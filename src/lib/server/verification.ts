import '@tanstack/react-start/server-only'
import crypto from 'node:crypto'
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
  isNotNull,
  isNull,
  lt,
  lte,
  notExists,
  or,
  sql,
} from 'drizzle-orm'
import { getAppEnv } from './env'
import {
  emailIngestRecords,
  flowTasks,
  managedIdentities,
  verificationCodes,
  verificationEmailReservations,
  whatsappNotificationIngestRecords,
  type EmailIngestRecordRow,
  type VerificationEmailReservationRow,
} from './db/schema'
import {
  hasAdminInboxEmailSubscribers,
  publishAdminInboxEmailEvent,
} from './admin-inbox-events'
import { sendAstrBotWorkspaceRemovalNotification } from './astrbot'
import { publishVerificationCodeEvent } from './verification-events'
import { resolveReservationVerificationDomain } from './verification-domains'
import { removeDisabledSub2ApiAccountsForWorkspace } from './sub2api-codex-oauth'
import {
  listAdminCliConnectionState,
  type AdminCliConnectionSummary,
} from './cli-connections'
import { dispatchCliFlowTasks } from './cli-tasks'
import {
  deleteManagedWorkspace,
  findAdminManagedWorkspaceSummaryByOwnerIdentity,
} from './workspaces'
import { getDb } from './db/client'
import { createId } from './security'
import { extractVerificationCodeFromText } from '../shared/verification-code'

export interface VerificationEmailPayload {
  messageId?: string | null
  subject?: string | null
  textBody?: string | null
  htmlBody?: string | null
  rawPayload?: string | null
  receivedAt: string
}

export interface WhatsAppNotificationPayload {
  reservationId?: string | null
  email?: string | null
  deviceId?: string | null
  notificationId?: string | null
  packageName?: string | null
  sender?: string | null
  chatName?: string | null
  title?: string | null
  body?: string | null
  rawPayload?: Record<string, unknown> | null
  extractedCode?: string | null
  receivedAt?: string | null
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
  managedIdentityId: string | null
  managedIdentityLabel: string | null
  managedIdentityAccount: string | null
  managedIdentityStatus: string | null
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

type AdminInboxManagedIdentitySummary = {
  identityId: string
  label: string | null
  email: string
  status: string
}

type ParsedEmailContent = {
  subject: string | null
  htmlBody: string | null
  textBody: string | null
}

type EmailIngestReservation = {
  identityId: string | null
}

type WhatsAppReservationMatch =
  | {
      status: 'matched'
      strategy: 'reservation_id' | 'email' | 'single_active_reservation'
      reservation: VerificationEmailReservationRow
    }
  | {
      status: 'unmatched'
      reason:
        | 'reservation_not_found'
        | 'email_not_found'
        | 'no_active_reservation'
        | 'multiple_active_reservations'
      reservation: null
    }

const CHATGPT_BUSINESS_TRIAL_ENDED_CLEANUP_REASON =
  'chatgpt_business_trial_ended'
const CHATGPT_PLUS_SUBSCRIPTION_CODEX_OAUTH_DEDUP_MS = 24 * 60 * 60 * 1000
const DEFAULT_ADMIN_INBOX_PAGE_SIZE = 25
const MAX_ADMIN_INBOX_PAGE_SIZE = 100
const RESERVATION_MAILBOX_ADJECTIVES = [
  'amber',
  'brisk',
  'calm',
  'cedar',
  'clear',
  'cozy',
  'dawn',
  'ember',
  'fern',
  'golden',
  'harbor',
  'jade',
  'lucky',
  'maple',
  'mellow',
  'misty',
  'nova',
  'olive',
  'pearl',
  'quiet',
  'river',
  'silver',
  'solar',
  'velvet',
] as const
const RESERVATION_MAILBOX_NOUNS = [
  'anchor',
  'brook',
  'cloud',
  'cove',
  'falcon',
  'forest',
  'garden',
  'glade',
  'harbor',
  'heron',
  'lantern',
  'meadow',
  'moon',
  'otter',
  'panda',
  'pine',
  'ridge',
  'robin',
  'shore',
  'spruce',
  'star',
  'stone',
  'willow',
  'wind',
] as const

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
      .where(
        eq(verificationCodes.reservationId, emailIngestRecords.reservationId),
      ),
  )
  const reservationHasNoCode = notExists(
    db
      .select({ id: verificationCodes.id })
      .from(verificationCodes)
      .where(
        eq(verificationCodes.reservationId, emailIngestRecords.reservationId),
      ),
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
          return buildAdminInboxReceivedAtFilter(filter as FilterModel<'date'>)
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

function mapManagedIdentityStatus(status?: string | null) {
  if (status === 'BANNED') {
    return 'banned'
  }

  if (status === 'ARCHIVED') {
    return 'archived'
  }

  if (status === 'REVIEW') {
    return 'review'
  }

  return 'active'
}

async function getManagedIdentitySummaryByIdentityId(
  identityIds: string[],
): Promise<Map<string, AdminInboxManagedIdentitySummary>> {
  if (!identityIds.length) {
    return new Map()
  }

  const rows = await getDb().query.managedIdentities.findMany({
    where: inArray(managedIdentities.identityId, identityIds),
  })

  return new Map(
    rows.map((row) => [
      row.identityId,
      {
        identityId: row.identityId,
        label: row.label,
        email: row.email,
        status: mapManagedIdentityStatus(row.status),
      },
    ]),
  )
}

function serializeAdminInboxEmail(
  email: EmailIngestRecordRow & {
    reservation?: {
      id: string
      email: string
      mailbox: string | null
      identityId: string | null
      expiresAt: Date
    } | null
  },
  latestCode?: AdminInboxCodeSummary,
  managedIdentity?: AdminInboxManagedIdentitySummary,
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
    managedIdentityId: managedIdentity?.identityId || null,
    managedIdentityLabel: managedIdentity?.label || null,
    managedIdentityAccount: managedIdentity?.email || null,
    managedIdentityStatus: managedIdentity?.status || null,
    latestCode: latestCode?.code || null,
    latestCodeSource: latestCode?.source || null,
    latestCodeReceivedAt: latestCode?.receivedAt || null,
  }
}

function sanitizeReservationLocalPartSegment(
  value: string | null | undefined,
): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')

  return normalized || null
}

function getReservationAliasPrefix(): string | null {
  const env = getAppEnv()
  return sanitizeReservationLocalPartSegment(env.verificationEmailPrefix)
}

function createMemorableReservationMailboxName(): string {
  const adjective =
    RESERVATION_MAILBOX_ADJECTIVES[
      crypto.randomInt(0, RESERVATION_MAILBOX_ADJECTIVES.length)
    ]
  const noun =
    RESERVATION_MAILBOX_NOUNS[
      crypto.randomInt(0, RESERVATION_MAILBOX_NOUNS.length)
    ]
  const suffix = crypto.randomInt(10, 100)

  return `${adjective}-${noun}-${suffix}`
}

function buildReservationEmail(
  mailboxName: string,
  domain: string,
): {
  email: string
  prefix?: string
  mailbox?: string
} {
  const prefix = getReservationAliasPrefix()
  const localPart = prefix ? `${prefix}-${mailboxName}` : mailboxName
  return {
    email: `${localPart}@${domain}`,
    prefix: prefix || undefined,
    mailbox: `${localPart}@${domain}`,
  }
}

function normalizeStoredEmailContent(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function decodeMimeEncodedWords(value: string) {
  const compacted = value.replace(
    /(=\?[^?]+\?[bq]\?[^?]*\?=)\s+(?==\?[^?]+\?[bq]\?)/gi,
    '$1',
  )

  return compacted.replace(
    /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
    (encodedWord, charset: string, encoding: string, encodedText: string) => {
      let bytes: Buffer
      if (encoding.toLowerCase() === 'b') {
        bytes = Buffer.from(encodedText.replace(/\s+/g, ''), 'base64')
      } else {
        const byteValues: number[] = []
        const text = encodedText.replace(/_/g, ' ')
        for (let index = 0; index < text.length; index += 1) {
          const character = text[index]
          if (
            character === '=' &&
            /^[0-9a-f]{2}$/i.test(text.slice(index + 1, index + 3))
          ) {
            byteValues.push(
              Number.parseInt(text.slice(index + 1, index + 3), 16),
            )
            index += 2
          } else {
            byteValues.push(character.charCodeAt(0))
          }
        }
        bytes = Buffer.from(byteValues)
      }

      try {
        return new TextDecoder(charset).decode(bytes)
      } catch {
        try {
          return new TextDecoder('utf-8').decode(bytes)
        } catch {
          return encodedWord
        }
      }
    },
  )
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

function normalizeOptionalString(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized || undefined
}

function normalizeOptionalEmail(value: string | null | undefined) {
  return normalizeOptionalString(value)?.toLowerCase()
}

function normalizeOptionalVerificationCode(value: string | null | undefined) {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    return null
  }

  try {
    return normalizeManualVerificationCodeInput(normalized)
  } catch {
    return null
  }
}

function normalizeJsonPayload(
  value: Record<string, unknown> | null | undefined,
) {
  if (!value) {
    return undefined
  }

  try {
    const serialized = JSON.stringify(value)
    if (!serialized) {
      return undefined
    }

    const parsed = JSON.parse(serialized) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed }
  } catch {
    return { value: String(value) }
  }
}

function stringifyJsonPayloadForExtraction(
  value: Record<string, unknown> | null | undefined,
) {
  if (!value) {
    return null
  }

  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function isLikelyRawEmailSource(value: string | null | undefined) {
  if (!value) {
    return false
  }

  const headerBlock = value.split(/\r?\n\r?\n/, 1)[0]
  const headerCount = headerBlock.match(/^[A-Za-z0-9-]+:\s.*$/gm)?.length ?? 0

  return headerCount >= 2
}

function parseEmailContentFromRawPayload(
  rawPayload: string | null | undefined,
): ParsedEmailContent | null {
  const rawSource = normalizeStoredEmailContent(rawPayload)
  if (!rawSource || !isLikelyRawEmailSource(rawSource)) {
    return null
  }

  try {
    const parsedMail = extractLetterMail(rawSource)
    return {
      subject: normalizeStoredEmailContent(parsedMail.subject),
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
  parsedEmail?: ParsedEmailContent | null
}) {
  const parsedEmail =
    params.parsedEmail ?? parseEmailContentFromRawPayload(params.rawPayload)
  const normalizedHtml = normalizeStoredEmailContent(params.htmlBody)
  const normalizedText = normalizeStoredEmailContent(params.textBody)

  return {
    htmlBody: normalizedHtml || parsedEmail?.htmlBody,
    textBody:
      normalizedText && !isLikelyRawEmailSource(normalizedText)
        ? normalizedText
        : parsedEmail?.textBody,
  }
}

function isMimeEncodedSubject(value: string) {
  return /=\?[^?]+\?[bq]\?[^?]+\?=/i.test(value)
}

function resolveVerificationEmailSubject(params: {
  subject?: string | null
  parsedEmail?: ParsedEmailContent | null
}) {
  const subject = normalizeStoredEmailContent(params.subject)
  if (subject && !isMimeEncodedSubject(subject)) {
    return subject
  }

  const decodedSubject = subject
    ? normalizeStoredEmailContent(decodeMimeEncodedWords(subject))
    : undefined

  return params.parsedEmail?.subject || decodedSubject || subject || null
}

function normalizeSubjectForMatching(subject: string) {
  let normalized = decodeMimeEncodedWords(subject)
    .normalize('NFKC')
    .toLowerCase()
  normalized = normalized.replace(/\s+/g, ' ').trim()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const withoutPrefix = normalized
      .replace(/^(?:re|fw|fwd|回复|答复|转发)\s*[:：]\s*/i, '')
      .trim()
    if (withoutPrefix === normalized) {
      break
    }
    normalized = withoutPrefix
  }

  return normalized
}

export function isChatGptBusinessTrialEndedSubject(
  subject?: string | null,
): boolean {
  if (!subject) {
    return false
  }

  const normalized = normalizeSubjectForMatching(subject)
  const hasChatGptBusinessProduct = /chatgpt\s*(?:business|team)\b/.test(
    normalized,
  )
  if (!hasChatGptBusinessProduct) {
    return false
  }

  const englishTrialEnded =
    /\btrial\b.{0,80}\b(?:has\s+)?(?:ended|expired)\b/.test(normalized) ||
    /\btrial\b.{0,80}\bis\s+over\b/.test(normalized)
  const chineseTrialEnded =
    /(?:免费)?试用期?\s*(?:现已|已|已经)?\s*(?:结束|到期|过期)了?/.test(
      normalized,
    )

  return englishTrialEnded || chineseTrialEnded
}

function normalizeEmailTextForMatching(value?: string | null): string {
  return (value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function isChatGptPlusSubscriptionSuccessEmail(params: {
  subject?: string | null
  textBody?: string | null
  htmlBody?: string | null
}): boolean {
  const subject = params.subject
    ? normalizeSubjectForMatching(params.subject)
    : ''
  if (
    /\bchatgpt\b/.test(subject) &&
    (/[你您]\s*的\s*新\s*套餐/.test(subject) ||
      /\byour\s+new\s+(?:chatgpt\s+)?plan\b/.test(subject))
  ) {
    return true
  }

  const body = [
    normalizeEmailTextForMatching(params.textBody),
    normalizeEmailTextForMatching(params.htmlBody),
  ]
    .filter(Boolean)
    .join(' ')

  return /[你您]\s*已\s*成功\s*订阅\s*(?:了\s*)?chatgpt\s*plus/.test(body)
}

async function resolveCodexOAuthEmailForSubscriptionSuccess(params: {
  recipient: string
  reservation?: EmailIngestReservation | null
}): Promise<string | null> {
  const reservationIdentityId = params.reservation?.identityId?.trim()
  if (reservationIdentityId) {
    const identity = await getDb().query.managedIdentities.findFirst({
      where: eq(managedIdentities.identityId, reservationIdentityId),
      columns: {
        email: true,
      },
    })
    const identityEmail = normalizeOptionalEmail(identity?.email)
    if (identityEmail) {
      return identityEmail
    }
  }

  const recipient = normalizeOptionalEmail(params.recipient)
  if (!recipient) {
    return null
  }

  const identity = await getDb().query.managedIdentities.findFirst({
    where: eq(managedIdentities.email, recipient),
    columns: {
      email: true,
    },
  })

  return normalizeOptionalEmail(identity?.email) || recipient
}

function isCliConnectionRunningFlow(connection: AdminCliConnectionSummary) {
  return Boolean(
    connection.runtimeFlowId &&
    !connection.runtimeFlowCompletedAt &&
    connection.runtimeFlowStatus !== 'completed',
  )
}

function selectCodexOAuthConnection(
  connections: AdminCliConnectionSummary[],
  targetEmail: string,
): AdminCliConnectionSummary | null {
  const normalizedTargetEmail = targetEmail.trim().toLowerCase()
  const capableConnections = connections.filter(
    (connection) =>
      connection.status === 'active' &&
      connection.registeredFlows.includes('codex-oauth'),
  )

  return (
    [...capableConnections].sort((left, right) => {
      const affinityDelta =
        Number(right.storageStateEmails.includes(normalizedTargetEmail)) -
        Number(left.storageStateEmails.includes(normalizedTargetEmail))
      if (affinityDelta) {
        return affinityDelta
      }

      const busyDelta =
        Number(isCliConnectionRunningFlow(left)) -
        Number(isCliConnectionRunningFlow(right))
      if (busyDelta) {
        return busyDelta
      }

      return (
        new Date(right.lastSeenAt).getTime() -
        new Date(left.lastSeenAt).getTime()
      )
    })[0] || null
  )
}

async function dispatchCodexOAuthForChatGptSubscriptionSuccess(input: {
  recipient: string
  subject?: string | null
  textBody?: string | null
  htmlBody?: string | null
  reservation?: EmailIngestReservation | null
}) {
  if (
    !isChatGptPlusSubscriptionSuccessEmail({
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
    })
  ) {
    return null
  }

  const targetEmail = await resolveCodexOAuthEmailForSubscriptionSuccess({
    recipient: input.recipient,
    reservation: input.reservation,
  })
  if (!targetEmail) {
    return {
      status: 'skipped' as const,
      reason: 'target_email_not_found' as const,
    }
  }

  try {
    const existingTask = await getDb().query.flowTasks.findFirst({
      where: and(
        eq(flowTasks.flowType, 'codex-oauth'),
        sql`${flowTasks.payload} #>> '{config,email}' = ${targetEmail}`,
        gte(
          flowTasks.createdAt,
          new Date(Date.now() - CHATGPT_PLUS_SUBSCRIPTION_CODEX_OAUTH_DEDUP_MS),
        ),
        or(
          eq(flowTasks.status, 'QUEUED'),
          eq(flowTasks.status, 'LEASED'),
          eq(flowTasks.status, 'RUNNING'),
          eq(flowTasks.status, 'SUCCEEDED'),
        ),
      ),
      orderBy: [desc(flowTasks.createdAt)],
      columns: {
        id: true,
      },
    })
    if (existingTask) {
      return {
        status: 'skipped' as const,
        reason: 'existing_codex_oauth_task' as const,
        targetEmail,
        taskId: existingTask.id,
      }
    }

    const connection = selectCodexOAuthConnection(
      (await listAdminCliConnectionState()).activeConnections,
      targetEmail,
    )
    if (!connection) {
      return {
        status: 'skipped' as const,
        reason: 'no_codex_oauth_connection' as const,
        targetEmail,
      }
    }

    const result = await dispatchCliFlowTasks({
      connectionId: connection.id,
      flowId: 'codex-oauth',
      config: {
        email: targetEmail,
      },
    })

    return {
      status: 'queued' as const,
      targetEmail,
      connectionId: result.connection.id,
      queuedCount: result.tasks.length,
      assignedCliCount: result.assignedCliCount,
      taskIds: result.tasks.map((task) => task.id),
    }
  } catch (error) {
    console.error(
      'Unable to dispatch Codex OAuth after ChatGPT subscription email',
      error,
    )
    return {
      status: 'failed' as const,
      targetEmail,
      error:
        error instanceof Error
          ? error.message
          : 'Unable to dispatch Codex OAuth task',
    }
  }
}

async function resolveManagedIdentityIdForIngestedRecipient(params: {
  recipient: string
  reservation?: EmailIngestReservation | null
}) {
  const reservationIdentityId = params.reservation?.identityId?.trim()
  if (reservationIdentityId) {
    return reservationIdentityId
  }

  const recipient = params.recipient.trim().toLowerCase()
  if (!recipient) {
    return null
  }

  const managedIdentity = await getDb().query.managedIdentities.findFirst({
    where: eq(managedIdentities.email, recipient),
    columns: {
      identityId: true,
    },
  })

  return managedIdentity?.identityId || null
}

async function cleanupExpiredChatGptBusinessTrialWorkspace(params: {
  recipient: string
  subject?: string | null
  reservation?: EmailIngestReservation | null
}) {
  if (!isChatGptBusinessTrialEndedSubject(params.subject)) {
    return null
  }

  const ownerIdentityId = await resolveManagedIdentityIdForIngestedRecipient({
    recipient: params.recipient,
    reservation: params.reservation,
  })

  if (!ownerIdentityId) {
    return null
  }

  const reasonMessage = params.subject?.trim()
    ? `Received ChatGPT Business trial-ended email: ${params.subject.trim()}`
    : 'Received ChatGPT Business trial-ended email'
  const workspace =
    await findAdminManagedWorkspaceSummaryByOwnerIdentity(ownerIdentityId)

  if (!workspace) {
    return {
      reason: CHATGPT_BUSINESS_TRIAL_ENDED_CLEANUP_REASON,
      reasonMessage,
      ownerIdentityId,
      workspaceId: null,
      deletedWorkspaceId: null,
      sub2ApiCleanup: null,
      sub2ApiCleanupError: null,
      astrbotNotification: null,
      astrbotNotificationError: null,
    }
  }

  const deletedWorkspace = await deleteManagedWorkspace(workspace.id)
  if (!deletedWorkspace) {
    return {
      reason: CHATGPT_BUSINESS_TRIAL_ENDED_CLEANUP_REASON,
      reasonMessage,
      ownerIdentityId,
      workspaceId: workspace.workspaceId,
      deletedWorkspaceId: null,
      sub2ApiCleanup: null,
      sub2ApiCleanupError: null,
      astrbotNotification: null,
      astrbotNotificationError: null,
    }
  }

  let sub2ApiCleanup: Awaited<
    ReturnType<typeof removeDisabledSub2ApiAccountsForWorkspace>
  > = null
  let sub2ApiCleanupError: string | null = null

  try {
    sub2ApiCleanup = await removeDisabledSub2ApiAccountsForWorkspace({
      workspaceId: workspace.workspaceId,
    })
  } catch (error) {
    sub2ApiCleanupError =
      error instanceof Error ? error.message : 'Unknown Sub2API cleanup error'
    console.error(
      'Unable to remove disabled Sub2API accounts for deleted workspace',
      error,
    )
  }

  let astrbotNotification: Awaited<
    ReturnType<typeof sendAstrBotWorkspaceRemovalNotification>
  > = null
  let astrbotNotificationError: string | null = null

  try {
    astrbotNotification = await sendAstrBotWorkspaceRemovalNotification({
      workspace,
      reason: reasonMessage,
      sub2ApiCleanup,
      sub2ApiCleanupError,
    })
  } catch (error) {
    astrbotNotificationError =
      error instanceof Error
        ? error.message
        : 'Unknown AstrBot notification error'
    console.error(
      'Unable to send deleted workspace notification to AstrBot',
      error,
    )
  }

  return {
    reason: CHATGPT_BUSINESS_TRIAL_ENDED_CLEANUP_REASON,
    reasonMessage,
    ownerIdentityId,
    workspaceId: workspace.workspaceId,
    deletedWorkspaceId: deletedWorkspace.id,
    sub2ApiCleanup,
    sub2ApiCleanupError,
    astrbotNotification,
    astrbotNotificationError,
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

export async function reserveVerificationEmailTarget(options?: {
  clientId?: string | null
}) {
  const env = getAppEnv()
  const expiresAt = new Date(
    Date.now() + env.verificationReservationTtlMinutes * 60 * 1000,
  )
  const verificationDomain = await resolveReservationVerificationDomain(options)

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const target = buildReservationEmail(
      createMemorableReservationMailboxName(),
      verificationDomain.domain,
    )

    const [reservation] = await getDb()
      .insert(verificationEmailReservations)
      .values({
        id: createId(),
        email: target.email,
        prefix: target.prefix,
        mailbox: target.mailbox,
        expiresAt,
      })
      .onConflictDoNothing({ target: verificationEmailReservations.email })
      .returning()

    if (!reservation) {
      continue
    }

    return {
      reservationId: reservation.id,
      email: reservation.email,
      prefix: reservation.prefix || undefined,
      mailbox: reservation.mailbox || undefined,
      expiresAt: reservation.expiresAt.toISOString(),
    }
  }

  throw new Error('Unable to create a unique verification reservation')
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

export async function findWhatsAppVerificationCode(params: {
  startedAt: string
  reservationId?: string | null
  email?: string | null
}) {
  const startedAt = new Date(params.startedAt)
  const since = Number.isNaN(startedAt.getTime()) ? new Date(0) : startedAt
  const reservationId = normalizeOptionalString(params.reservationId)
  const email = normalizeOptionalEmail(params.email)
  let resolvedReservationId = reservationId

  if (!resolvedReservationId && email) {
    const reservation =
      await getDb().query.verificationEmailReservations.findFirst({
        where: eq(verificationEmailReservations.email, email),
      })
    resolvedReservationId = reservation?.id
    if (!resolvedReservationId) {
      return {
        status: 'pending' as const,
        notifications: [] as WhatsAppNotificationPayload[],
      }
    }
  }

  const rows = await getDb().query.whatsappNotificationIngestRecords.findMany({
    where: combineConditions([
      isNotNull(whatsappNotificationIngestRecords.verificationCode),
      gte(whatsappNotificationIngestRecords.receivedAt, since),
      resolvedReservationId
        ? eq(
            whatsappNotificationIngestRecords.reservationId,
            resolvedReservationId,
          )
        : undefined,
    ]),
    orderBy: [desc(whatsappNotificationIngestRecords.receivedAt)],
    limit: 1,
  })

  const notification = rows[0]
  if (!notification?.verificationCode) {
    return {
      status: 'pending' as const,
      notifications: [] as WhatsAppNotificationPayload[],
    }
  }

  return {
    status: 'resolved' as const,
    code: notification.verificationCode,
    source: 'WHATSAPP_NOTIFICATION',
    receivedAt: notification.receivedAt.toISOString(),
    notificationRecordId: notification.id,
    reservationId: notification.reservationId ?? undefined,
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

async function resolveWhatsAppNotificationReservation(params: {
  reservationId?: string | null
  email?: string | null
}): Promise<WhatsAppReservationMatch> {
  const db = getDb()
  const reservationId = normalizeOptionalString(params.reservationId)
  if (reservationId) {
    const reservation = await db.query.verificationEmailReservations.findFirst({
      where: eq(verificationEmailReservations.id, reservationId),
    })

    return reservation
      ? {
          status: 'matched',
          strategy: 'reservation_id',
          reservation,
        }
      : {
          status: 'unmatched',
          reason: 'reservation_not_found',
          reservation: null,
        }
  }

  const email = normalizeOptionalEmail(params.email)
  if (email) {
    const reservation = await db.query.verificationEmailReservations.findFirst({
      where: eq(verificationEmailReservations.email, email),
    })

    return reservation
      ? {
          status: 'matched',
          strategy: 'email',
          reservation,
        }
      : {
          status: 'unmatched',
          reason: 'email_not_found',
          reservation: null,
        }
  }

  const activeReservations =
    await db.query.verificationEmailReservations.findMany({
      where: and(
        gt(verificationEmailReservations.expiresAt, new Date()),
        isNotNull(verificationEmailReservations.mailbox),
      ),
      orderBy: [desc(verificationEmailReservations.createdAt)],
      limit: 2,
    })

  if (activeReservations.length === 1) {
    return {
      status: 'matched',
      strategy: 'single_active_reservation',
      reservation: activeReservations[0],
    }
  }

  return {
    status: 'unmatched',
    reason:
      activeReservations.length > 1
        ? 'multiple_active_reservations'
        : 'no_active_reservation',
    reservation: null,
  }
}

function extractWhatsAppNotificationCode(params: {
  title?: string | null
  body?: string | null
  rawPayload?: Record<string, unknown> | null
  extractedCode?: string | null
}) {
  return (
    normalizeOptionalVerificationCode(params.extractedCode) ||
    extractVerificationCodeFromText(params.body) ||
    extractVerificationCodeFromText(params.title) ||
    extractVerificationCodeFromText(
      stringifyJsonPayloadForExtraction(params.rawPayload),
    )
  )
}

export async function ingestWhatsAppNotification(
  params: WhatsAppNotificationPayload,
) {
  const db = getDb()
  const reservationMatch = await resolveWhatsAppNotificationReservation({
    reservationId: params.reservationId,
    email: params.email,
  })
  const reservation =
    reservationMatch.status === 'matched' ? reservationMatch.reservation : null
  const receivedAt = params.receivedAt
    ? new Date(params.receivedAt)
    : new Date()
  const normalizedReceivedAt = Number.isNaN(receivedAt.getTime())
    ? new Date()
    : receivedAt
  const title = normalizeOptionalString(params.title)
  const body = normalizeOptionalString(params.body)
  const rawPayload = normalizeJsonPayload(params.rawPayload)
  const extractedCode = extractWhatsAppNotificationCode({
    title,
    body,
    rawPayload,
    extractedCode: params.extractedCode,
  })

  const [notificationRecord] = await db
    .insert(whatsappNotificationIngestRecords)
    .values({
      id: createId(),
      reservationId: reservation?.id,
      deviceId: normalizeOptionalString(params.deviceId),
      notificationId: normalizeOptionalString(params.notificationId),
      packageName: normalizeOptionalString(params.packageName),
      sender: normalizeOptionalString(params.sender),
      chatName: normalizeOptionalString(params.chatName),
      title,
      body,
      rawPayload,
      verificationCode: extractedCode,
      receivedAt: normalizedReceivedAt,
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
        source: 'WHATSAPP_NOTIFICATION',
        messageId: notificationRecord.id,
        receivedAt: normalizedReceivedAt,
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

  return {
    notificationRecord,
    codeRecord,
    match:
      reservationMatch.status === 'matched'
        ? {
            status: reservationMatch.status,
            strategy: reservationMatch.strategy,
            reservationId: reservationMatch.reservation.id,
            email: reservationMatch.reservation.email,
          }
        : {
            status: reservationMatch.status,
            reason: reservationMatch.reason,
          },
  }
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
  const parsedEmail = parseEmailContentFromRawPayload(params.rawPayload)
  const subject = resolveVerificationEmailSubject({
    subject: params.subject,
    parsedEmail,
  })
  const resolvedBodies = resolveVerificationEmailBodies({
    textBody: params.textBody,
    htmlBody: params.htmlBody,
    rawPayload: params.rawPayload,
    parsedEmail,
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
      subject,
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

  const workspaceCleanup = await cleanupExpiredChatGptBusinessTrialWorkspace({
    recipient: params.recipient,
    subject,
    reservation,
  })
  const subscriptionCodexOAuth =
    await dispatchCodexOAuthForChatGptSubscriptionSuccess({
      recipient: params.recipient,
      subject,
      textBody: resolvedBodies.textBody,
      htmlBody: resolvedBodies.htmlBody,
      reservation,
    })

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
    const managedIdentity = reservation?.identityId
      ? (
          await getManagedIdentitySummaryByIdentityId([reservation.identityId])
        ).get(reservation.identityId)
      : undefined

    publishAdminInboxEmailEvent(
      serializeAdminInboxEmail(
        {
          ...emailRecord,
          reservation,
        },
        latestCode,
        managedIdentity,
      ),
    )
  }

  return {
    emailRecord,
    codeRecord,
    workspaceCleanup,
    subscriptionCodexOAuth,
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
  const identityIds = Array.from(
    new Set(
      emails
        .map((email) => email.reservation?.identityId)
        .filter((identityId): identityId is string => Boolean(identityId)),
    ),
  )
  const managedIdentityById =
    await getManagedIdentitySummaryByIdentityId(identityIds)

  return {
    emails: emails.map((email) =>
      serializeAdminInboxEmail(
        email,
        email.reservationId ? latestCodes.get(email.reservationId) : undefined,
        email.reservation?.identityId
          ? managedIdentityById.get(email.reservation.identityId)
          : undefined,
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
  const identityIds = Array.from(
    new Set(
      emails
        .map((email) => email.reservation?.identityId)
        .filter((identityId): identityId is string => Boolean(identityId)),
    ),
  )
  const managedIdentityById =
    await getManagedIdentitySummaryByIdentityId(identityIds)

  return emails.map((email) =>
    serializeAdminInboxEmail(
      email,
      email.reservationId ? latestCodes.get(email.reservationId) : undefined,
      email.reservation?.identityId
        ? managedIdentityById.get(email.reservation.identityId)
        : undefined,
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
