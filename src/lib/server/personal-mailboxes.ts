import '@tanstack/react-start/server-only'

import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { extractVerificationCodeFromText } from '../shared/verification-code'
import { getDb } from './db/client'
import {
  emailIngestRecords,
  personalMailboxCredentials,
  verificationCodes,
  verificationDomains,
  type PersonalMailboxCredentialRow,
  type VerificationDomainRow,
} from './db/schema'
import { decryptSecret, encryptSecret } from './encrypted-secrets'
import { createId } from './security'
import {
  getVerificationDomainSummaryById,
  listPersonalVerificationMailboxDomains,
} from './verification-domains'
import { publishVerificationCodeEvent } from './verification-events'
import type {
  VerificationCodeEvent,
  VerificationEmailPayload,
} from './verification'

type CsvRecord = Record<string, string>

type PersonalMailboxStatus = 'configured' | 'missing_credentials' | 'error'

interface ParsedPersonalMailboxInput {
  email: string
  password?: string
  graphClientId: string
  graphRefreshToken: string
  graphTenantId?: string
  graphScopes?: string
  mailboxPrefix?: string | null
  description?: string | null
  registrationEnabled?: boolean
}

interface GraphMessage {
  id: string
  subject?: string
  bodyPreview?: string
  receivedDateTime?: string
  from?: {
    emailAddress?: {
      address?: string
      name?: string
    }
  }
  toRecipients?: Array<{
    emailAddress?: {
      address?: string
      name?: string
    }
  }>
  body?: {
    contentType?: string
    content?: string
  }
}

interface GraphMailboxCandidate {
  domain: VerificationDomainRow
  credential: PersonalMailboxCredentialRow
}

export interface ManagedPersonalMailbox {
  id: string
  email: string
  provider: 'outlook'
  mailboxPrefix: string | null
  description: string | null
  registrationEnabled: boolean
  isDefault: boolean
  graphTenantId: string
  graphClientId: string
  graphScopes: string
  graphRefreshTokenPreview: string | null
  passwordPreview: string | null
  lastGraphReadAt: string | null
  lastGraphError: string | null
  status: PersonalMailboxStatus
  createdAt: string | Date
  updatedAt: string | Date
}

export interface PersonalMailboxImportResult {
  imported: ManagedPersonalMailbox[]
  failed: Array<{
    row: number
    error: string
  }>
}

export interface OutlookGraphCodeLookupResult {
  code?: string
  emails: VerificationEmailPayload[]
  source?: 'OUTLOOK_GRAPH'
  receivedAt?: string
}

export type PersonalMailboxCredentialInsert =
  typeof personalMailboxCredentials.$inferInsert

const DEFAULT_GRAPH_TENANT_ID = 'common'
const DEFAULT_GRAPH_SCOPES =
  'https://graph.microsoft.com/Mail.Read offline_access'
const MAX_GRAPH_MESSAGES_PER_LOOKUP = 25

function normalizeOptionalString(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized || undefined
}

function normalizeOptionalNullableString(value: string | null | undefined) {
  return normalizeOptionalString(value) || null
}

function normalizeEmailAddress(value: string): string {
  const normalized = value.trim().toLowerCase()
  const atIndex = normalized.lastIndexOf('@')
  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    throw new Error('Email address is required.')
  }

  const localPart = normalized.slice(0, atIndex)
  const domain = normalized.slice(atIndex + 1)
  if (
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart) ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      domain,
    )
  ) {
    throw new Error('Email address is invalid.')
  }

  return normalized
}

function createSecretPreview(value: string): string {
  const normalized = value.trim()
  if (normalized.length <= 8) {
    return '****'
  }

  return `****${normalized.slice(-6)}`
}

function normalizeMailboxPrefix(
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

function parseBoolean(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return undefined
  }

  if (['1', 'true', 'yes', 'y', 'on', 'enabled'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'n', 'off', 'disabled'].includes(normalized)) {
    return false
  }
  return undefined
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/[\s_-]+/g, '')
}

function splitDelimitedLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const next = line[index + 1]

    if ((character === '"' || character === "'") && !quote) {
      quote = character
      continue
    }

    if (quote && character === quote) {
      if (next === quote) {
        current += character
        index += 1
      } else {
        quote = null
      }
      continue
    }

    if (!quote && character === ',') {
      values.push(current.trim())
      current = ''
      continue
    }

    current += character
  }

  values.push(current.trim())
  return values
}

function parseCsvRecords(csvText: string): CsvRecord[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim())

  if (!lines.length) {
    return []
  }

  const headers = splitDelimitedLine(lines[0])
  return lines.slice(1).map((line) => {
    const values = splitDelimitedLine(line)
    const record: CsvRecord = {}
    headers.forEach((header, index) => {
      record[header] = values[index] || ''
    })
    record.__raw = line
    return record
  })
}

function readField(record: CsvRecord, names: string[]): string | undefined {
  const wanted = new Set(names.map(normalizeHeader))
  for (const [key, value] of Object.entries(record)) {
    if (key === '__raw') {
      continue
    }
    if (wanted.has(normalizeHeader(key))) {
      return normalizeOptionalString(value)
    }
  }

  return undefined
}

function readSingleColumnPayload(record: CsvRecord): string | undefined {
  const entries = Object.entries(record).filter(([key]) => key !== '__raw')
  if (entries.length === 1) {
    return normalizeOptionalString(entries[0]?.[1])
  }

  return undefined
}

function parseSingleColumnPayload(
  payload: string,
): Partial<ParsedPersonalMailboxInput> {
  const parts = payload.split('----').map((part) => part.trim())

  if (parts.length >= 4) {
    return {
      email: parts[0] || '',
      password: parts[1],
      graphClientId: parts[2] || '',
      graphRefreshToken: parts.slice(3).join('----').trim(),
    }
  }

  const email = payload.match(
    /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z0-9-]+/i,
  )?.[0]
  const uuid = payload.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  )?.[0]

  return {
    email: email || '',
    graphClientId: uuid || '',
    graphRefreshToken: parts.at(-1) || '',
  }
}

function parsePersonalMailboxRecord(
  record: CsvRecord,
): ParsedPersonalMailboxInput {
  const singleColumnPayload = readSingleColumnPayload(record)
  const compact = singleColumnPayload
    ? parseSingleColumnPayload(singleColumnPayload)
    : {}

  const email = readField(record, [
    'email',
    'mail',
    'mailbox',
    'account',
    '账号',
    '邮箱',
    '邮箱账号',
    '邮件',
  ])
  const password = readField(record, [
    'password',
    'pass',
    'pwd',
    '密码',
    '邮箱密码',
  ])
  const graphClientId = readField(record, [
    'client_id',
    'clientid',
    'graph_client_id',
    '应用id',
    '客户端id',
  ])
  const graphRefreshToken = readField(record, [
    'refresh_token',
    'refreshtoken',
    'graph_refresh_token',
    '令牌',
    '刷新令牌',
    'token',
  ])
  const graphTenantId = readField(record, [
    'tenant_id',
    'tenantid',
    'graph_tenant_id',
    '租户id',
  ])
  const graphScopes = readField(record, ['scopes', 'scope', 'graph_scopes'])
  const mailboxPrefix = readField(record, [
    'prefix',
    'mailbox_prefix',
    '邮箱前缀',
    '前缀',
  ])
  const description = readField(record, [
    'description',
    'note',
    'notes',
    '备注',
    '描述',
  ])
  const registrationEnabled = parseBoolean(
    readField(record, [
      'registration_enabled',
      'enabled',
      'use_for_registration',
      '用于新注册',
      '启用',
    ]),
  )

  const parsed = {
    email: email || compact.email || '',
    password: password || compact.password,
    graphClientId: graphClientId || compact.graphClientId || '',
    graphRefreshToken: graphRefreshToken || compact.graphRefreshToken || '',
    graphTenantId: graphTenantId || compact.graphTenantId,
    graphScopes: graphScopes || compact.graphScopes,
    mailboxPrefix:
      mailboxPrefix === undefined ? compact.mailboxPrefix : mailboxPrefix,
    description: description ?? compact.description,
    registrationEnabled: registrationEnabled ?? compact.registrationEnabled,
  }

  parsed.email = normalizeEmailAddress(parsed.email)
  parsed.graphClientId = normalizeOptionalString(parsed.graphClientId) || ''
  parsed.graphRefreshToken =
    normalizeOptionalString(parsed.graphRefreshToken) || ''

  if (!parsed.graphClientId) {
    throw new Error('Graph client id is required.')
  }
  if (!parsed.graphRefreshToken) {
    throw new Error('Graph refresh token is required.')
  }

  return parsed
}

function toManagedPersonalMailbox(
  domain: VerificationDomainRow,
  credential?: PersonalMailboxCredentialRow | null,
): ManagedPersonalMailbox {
  return {
    id: domain.id,
    email: domain.domain,
    provider: 'outlook',
    mailboxPrefix: domain.mailboxPrefix,
    description: domain.description,
    registrationEnabled: domain.registrationEnabled,
    isDefault: domain.isDefault,
    graphTenantId: credential?.graphTenantId || DEFAULT_GRAPH_TENANT_ID,
    graphClientId: credential?.graphClientId || '',
    graphScopes: credential?.graphScopes || DEFAULT_GRAPH_SCOPES,
    graphRefreshTokenPreview: credential?.graphRefreshTokenPreview || null,
    passwordPreview: credential?.passwordPreview || null,
    lastGraphReadAt: credential?.lastGraphReadAt?.toISOString() || null,
    lastGraphError: credential?.lastGraphError || null,
    status: credential?.lastGraphError
      ? 'error'
      : credential
        ? 'configured'
        : 'missing_credentials',
    createdAt: domain.createdAt,
    updatedAt: domain.updatedAt,
  }
}

function encodeVerificationCodeCursor(params: {
  receivedAt: Date | string
  id: string
}) {
  const receivedAt =
    params.receivedAt instanceof Date
      ? params.receivedAt
      : new Date(params.receivedAt)

  return `${receivedAt.toISOString()}|${params.id}`
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

function getMessageRecipientAddresses(message: GraphMessage): string[] {
  return (message.toRecipients || [])
    .map(
      (recipient) =>
        recipient.emailAddress?.address || recipient.emailAddress?.name,
    )
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase())
}

function getGraphMessageBodyFields(message: GraphMessage) {
  const bodyContent = message.body?.content || null
  const bodyType = message.body?.contentType?.toLowerCase()

  return {
    textBody: bodyType === 'text' ? bodyContent : message.bodyPreview || null,
    htmlBody: bodyType === 'html' ? bodyContent : null,
  }
}

async function syncOutlookGraphVerificationEmail(params: {
  reservationId: string
  email: string
  message: GraphMessage
  code: string
  receivedAt: Date
}) {
  const existing = await getDb().query.emailIngestRecords.findFirst({
    where: and(
      eq(emailIngestRecords.reservationId, params.reservationId),
      eq(emailIngestRecords.messageId, params.message.id),
    ),
  })

  if (existing) {
    return existing
  }

  const bodies = getGraphMessageBodyFields(params.message)
  const [emailRecord] = await getDb()
    .insert(emailIngestRecords)
    .values({
      id: createId(),
      reservationId: params.reservationId,
      messageId: params.message.id,
      recipient: params.email,
      subject: params.message.subject || null,
      textBody: bodies.textBody,
      htmlBody: bodies.htmlBody,
      rawPayload: null,
      verificationCode: params.code,
      receivedAt: params.receivedAt,
    })
    .returning()

  return emailRecord || null
}

async function acquireOutlookGraphAccessToken(
  credential: PersonalMailboxCredentialRow,
): Promise<string> {
  const refreshToken = decryptSecret(
    credential.graphRefreshTokenCiphertext,
    'decrypt an Outlook Graph refresh token',
  )
  const body = new URLSearchParams({
    client_id: credential.graphClientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: credential.graphScopes || DEFAULT_GRAPH_SCOPES,
  })
  const tenantId = credential.graphTenantId || DEFAULT_GRAPH_TENANT_ID
  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    },
  )
  const token = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    error?: string
    error_description?: string
  }

  if (!response.ok || !token.access_token) {
    throw new Error(
      `Microsoft Graph token refresh failed: ${token.error || response.status} ${token.error_description || ''}`.trim(),
    )
  }

  if (token.refresh_token && token.refresh_token !== refreshToken) {
    await getDb()
      .update(personalMailboxCredentials)
      .set({
        graphRefreshTokenCiphertext: encryptSecret(
          token.refresh_token,
          'rotate an Outlook Graph refresh token',
        ),
        graphRefreshTokenPreview: createSecretPreview(token.refresh_token),
        updatedAt: new Date(),
      })
      .where(eq(personalMailboxCredentials.id, credential.id))
  }

  return token.access_token
}

async function fetchOutlookInboxMessages(
  mailbox: string,
  credential: PersonalMailboxCredentialRow,
  startedAt: Date,
): Promise<GraphMessage[]> {
  const accessToken = await acquireOutlookGraphAccessToken(credential)
  const url = new URL(
    'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages',
  )
  url.searchParams.set('$top', String(MAX_GRAPH_MESSAGES_PER_LOOKUP))
  url.searchParams.set(
    '$select',
    'id,subject,bodyPreview,receivedDateTime,from,toRecipients,body',
  )
  url.searchParams.set('$orderby', 'receivedDateTime desc')
  url.searchParams.set(
    '$filter',
    `receivedDateTime ge ${startedAt.toISOString()}`,
  )

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      Prefer: 'outlook.body-content-type="html"',
    },
  })
  const result = (await response.json()) as {
    value?: GraphMessage[]
    error?: {
      message?: string
    }
  }

  if (!response.ok) {
    throw new Error(
      result.error?.message ||
        `Microsoft Graph inbox request failed for ${mailbox}: ${response.status}`,
    )
  }

  return result.value || []
}

async function findGraphMailboxCandidates(reservation: {
  mailbox: string | null
}): Promise<GraphMailboxCandidate[]> {
  if (reservation.mailbox) {
    const domain = await getDb().query.verificationDomains.findFirst({
      where: eq(verificationDomains.domain, reservation.mailbox.toLowerCase()),
    })
    if (domain?.mailboxType === 'outlook') {
      const credential =
        await getDb().query.personalMailboxCredentials.findFirst({
          where: eq(personalMailboxCredentials.verificationDomainId, domain.id),
        })
      return credential ? [{ domain, credential }] : []
    }

    return []
  }

  const rows = await listPersonalVerificationMailboxDomains()
  if (!rows.length) {
    return []
  }

  const credentials = await getDb().query.personalMailboxCredentials.findMany({
    where: inArray(
      personalMailboxCredentials.verificationDomainId,
      rows.map((row) => row.id),
    ),
  })
  const credentialsByDomainId = new Map(
    credentials.map((credential) => [
      credential.verificationDomainId,
      credential,
    ]),
  )

  return rows
    .map((domain) => {
      const credential = credentialsByDomainId.get(domain.id)
      return credential ? { domain, credential } : null
    })
    .filter((entry): entry is GraphMailboxCandidate => Boolean(entry))
}

export async function listPersonalMailboxes(): Promise<
  ManagedPersonalMailbox[]
> {
  const domains = await listPersonalVerificationMailboxDomains()
  if (!domains.length) {
    return []
  }

  const credentials = await getDb().query.personalMailboxCredentials.findMany({
    where: inArray(
      personalMailboxCredentials.verificationDomainId,
      domains.map((domain) => domain.id),
    ),
  })
  const credentialsByDomainId = new Map(
    credentials.map((credential) => [
      credential.verificationDomainId,
      credential,
    ]),
  )

  return domains.map((domain) =>
    toManagedPersonalMailbox(domain, credentialsByDomainId.get(domain.id)),
  )
}

export async function importPersonalMailboxesFromCsv(
  csvText: string,
): Promise<PersonalMailboxImportResult> {
  const records = parseCsvRecords(csvText)
  const imported: ManagedPersonalMailbox[] = []
  const failed: PersonalMailboxImportResult['failed'] = []

  for (const [index, record] of records.entries()) {
    try {
      const parsed = parsePersonalMailboxRecord(record)
      const now = new Date()
      const db = getDb()
      const domainRows = await db
        .insert(verificationDomains)
        .values({
          id: createId(),
          domain: parsed.email,
          mailboxType: 'outlook',
          mailboxPrefix: normalizeMailboxPrefix(parsed.mailboxPrefix),
          description: normalizeOptionalNullableString(parsed.description),
          registrationEnabled: parsed.registrationEnabled ?? true,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: verificationDomains.domain })
        .returning()

      const domain =
        domainRows[0] ||
        (await db.query.verificationDomains.findFirst({
          where: eq(verificationDomains.domain, parsed.email),
        }))

      if (!domain) {
        throw new Error('Unable to save mailbox.')
      }
      if (domain.mailboxType !== 'outlook') {
        throw new Error(
          'A domain mailbox with this address already exists. Remove that route before importing it as a personal mailbox.',
        )
      }

      const nextDomainValues = {
        mailboxPrefix: normalizeMailboxPrefix(parsed.mailboxPrefix),
        description: normalizeOptionalNullableString(parsed.description),
        registrationEnabled: parsed.registrationEnabled ?? true,
        updatedAt: now,
      }
      await db
        .update(verificationDomains)
        .set(nextDomainValues)
        .where(eq(verificationDomains.id, domain.id))
      const updatedDomain = {
        ...domain,
        ...nextDomainValues,
      }

      const password = normalizeOptionalString(parsed.password)
      const passwordFields = password
        ? {
            passwordCiphertext: encryptSecret(
              password,
              'encrypt Outlook mailbox passwords',
            ),
            passwordPreview: createSecretPreview(password),
          }
        : {}
      const refreshToken = parsed.graphRefreshToken.trim()

      const credentialValues: PersonalMailboxCredentialInsert = {
        id: createId(),
        verificationDomainId: domain.id,
        provider: 'outlook',
        graphTenantId:
          normalizeOptionalString(parsed.graphTenantId) ||
          DEFAULT_GRAPH_TENANT_ID,
        graphClientId: parsed.graphClientId.trim(),
        graphScopes:
          normalizeOptionalString(parsed.graphScopes) || DEFAULT_GRAPH_SCOPES,
        graphRefreshTokenCiphertext: encryptSecret(
          refreshToken,
          'encrypt Outlook Graph refresh tokens',
        ),
        graphRefreshTokenPreview: createSecretPreview(refreshToken),
        ...(passwordFields.passwordCiphertext !== undefined
          ? { passwordCiphertext: passwordFields.passwordCiphertext }
          : {}),
        ...(passwordFields.passwordPreview !== undefined
          ? { passwordPreview: passwordFields.passwordPreview }
          : {}),
        lastGraphError: null,
        createdAt: now,
        updatedAt: now,
      }

      await db
        .insert(personalMailboxCredentials)
        .values(credentialValues)
        .onConflictDoUpdate({
          target: personalMailboxCredentials.verificationDomainId,
          set: {
            provider: 'outlook',
            graphTenantId:
              normalizeOptionalString(parsed.graphTenantId) ||
              DEFAULT_GRAPH_TENANT_ID,
            graphClientId: parsed.graphClientId.trim(),
            graphScopes:
              normalizeOptionalString(parsed.graphScopes) ||
              DEFAULT_GRAPH_SCOPES,
            graphRefreshTokenCiphertext: encryptSecret(
              refreshToken,
              'encrypt Outlook Graph refresh tokens',
            ),
            graphRefreshTokenPreview: createSecretPreview(refreshToken),
            ...(passwordFields.passwordCiphertext !== undefined
              ? { passwordCiphertext: passwordFields.passwordCiphertext }
              : {}),
            ...(passwordFields.passwordPreview !== undefined
              ? { passwordPreview: passwordFields.passwordPreview }
              : {}),
            lastGraphError: null,
            updatedAt: now,
          },
        })

      const summary = await getVerificationDomainSummaryById(domain.id)
      const credential = await db.query.personalMailboxCredentials.findFirst({
        where: eq(personalMailboxCredentials.verificationDomainId, domain.id),
      })
      if (summary && credential) {
        imported.push(
          toManagedPersonalMailbox(
            {
              ...updatedDomain,
              isDefault: summary.isDefault,
            },
            credential,
          ),
        )
      }
    } catch (error) {
      failed.push({
        row: index + 2,
        error: error instanceof Error ? error.message : 'Unable to import row.',
      })
    }
  }

  return { imported, failed }
}

export async function findOutlookGraphVerificationCode(params: {
  reservationId: string
  email: string
  mailbox: string | null
  startedAt: Date
}): Promise<OutlookGraphCodeLookupResult> {
  const candidates = await findGraphMailboxCandidates({
    mailbox: params.mailbox,
  })
  if (!candidates.length) {
    return { emails: [] }
  }

  for (const candidate of candidates) {
    try {
      const messages = await fetchOutlookInboxMessages(
        candidate.domain.domain,
        candidate.credential,
        params.startedAt,
      )
      await getDb()
        .update(personalMailboxCredentials)
        .set({
          lastGraphReadAt: new Date(),
          lastGraphError: null,
          updatedAt: new Date(),
        })
        .where(eq(personalMailboxCredentials.id, candidate.credential.id))

      const matchingMessages = messages.filter((message) =>
        getMessageRecipientAddresses(message).some(
          (recipient) => recipient === params.email.toLowerCase(),
        ),
      )
      const scopedMessages = matchingMessages.length
        ? matchingMessages
        : messages.filter((message) =>
            `${message.subject || ''} ${message.bodyPreview || ''}`
              .toLowerCase()
              .includes('chatgpt'),
          )

      const emails: VerificationEmailPayload[] = scopedMessages.map(
        (message) => {
          const bodies = getGraphMessageBodyFields(message)
          return {
            messageId: message.id,
            subject: message.subject || null,
            textBody: bodies.textBody,
            htmlBody: bodies.htmlBody,
            rawPayload: null,
            receivedAt: message.receivedDateTime || new Date().toISOString(),
          }
        },
      )

      for (const message of scopedMessages) {
        const bodies = getGraphMessageBodyFields(message)
        const code =
          extractVerificationCodeFromText(message.subject) ||
          extractVerificationCodeFromText(bodies.htmlBody) ||
          extractVerificationCodeFromText(bodies.textBody) ||
          extractVerificationCodeFromText(message.bodyPreview)
        if (!code) {
          continue
        }

        const receivedAt = message.receivedDateTime
          ? new Date(message.receivedDateTime)
          : new Date()
        await syncOutlookGraphVerificationEmail({
          reservationId: params.reservationId,
          email: params.email,
          message,
          code,
          receivedAt,
        })
        const codeRows = await getDb()
          .insert(verificationCodes)
          .values({
            id: createId(),
            reservationId: params.reservationId,
            code,
            source: 'OUTLOOK_GRAPH',
            messageId: message.id,
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
        const codeRecord =
          codeRows[0] ||
          (await getDb().query.verificationCodes.findFirst({
            where: and(
              eq(verificationCodes.reservationId, params.reservationId),
              eq(verificationCodes.code, code),
              gte(verificationCodes.receivedAt, params.startedAt),
            ),
            orderBy: [desc(verificationCodes.receivedAt)],
          }))

        if (codeRecord) {
          publishVerificationCodeEvent(
            serializeVerificationCodeEvent({
              id: codeRecord.id,
              reservationId: params.reservationId,
              email: params.email,
              code: codeRecord.code,
              source: codeRecord.source,
              receivedAt: codeRecord.receivedAt,
            }),
          )
        }

        return {
          code,
          source: 'OUTLOOK_GRAPH',
          receivedAt: receivedAt.toISOString(),
          emails,
        }
      }

      return { emails }
    } catch (error) {
      await getDb()
        .update(personalMailboxCredentials)
        .set({
          lastGraphError:
            error instanceof Error
              ? error.message.slice(0, 500)
              : 'Microsoft Graph read failed.',
          updatedAt: new Date(),
        })
        .where(eq(personalMailboxCredentials.id, candidate.credential.id))
    }
  }

  const emailRows = await getDb().query.emailIngestRecords.findMany({
    where: and(
      eq(emailIngestRecords.recipient, params.email),
      gte(emailIngestRecords.receivedAt, params.startedAt),
    ),
    orderBy: [desc(emailIngestRecords.receivedAt)],
    limit: 5,
  })

  return {
    emails: emailRows.map((email) => ({
      messageId: email.messageId,
      subject: email.subject,
      textBody: email.textBody,
      htmlBody: email.htmlBody,
      rawPayload: email.rawPayload,
      receivedAt: email.receivedAt.toISOString(),
    })),
  }
}
