import '@tanstack/react-start/server-only'

import crypto from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { getDb } from './db/client'
import {
  verificationDomains,
  type VerificationDomainRow,
  type VerificationMailboxType,
} from './db/schema'
import { getAppEnv } from './env'
import { createId } from './security'

export interface VerificationDomainSummary {
  id: string
  domain: string
  mailboxType: VerificationMailboxType
  mailboxPrefix: string | null
  description: string | null
  registrationEnabled: boolean
  isDefault: boolean
  appCount: number
  createdAt: Date
  updatedAt: Date
}

export interface VerificationDomainOption {
  id: string
  domain: string
  mailboxType: VerificationMailboxType
  isDefault: boolean
}

export interface CreateVerificationDomainInput {
  domain: string
  mailboxType?: VerificationMailboxType
  mailboxPrefix?: string | null
  description?: string
  registrationEnabled?: boolean
  isDefault?: boolean
}

export interface UpdateVerificationDomainInput {
  domain?: string
  mailboxType?: VerificationMailboxType
  mailboxPrefix?: string | null
  description?: string | null
  registrationEnabled?: boolean
  isDefault?: boolean
}

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase()
  const withoutMailbox =
    trimmed.lastIndexOf('@') === -1
      ? trimmed
      : trimmed.slice(trimmed.lastIndexOf('@') + 1)
  const normalized = withoutMailbox.replace(/^\.+|\.+$/g, '')

  if (!normalized) {
    throw new Error('domain is required')
  }

  const domainPattern =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
  if (!domainPattern.test(normalized)) {
    throw new Error('domain must be a valid hostname')
  }

  return normalized
}

function normalizeEmailAddress(value: string): string {
  const normalized = value.trim().toLowerCase()
  const atIndex = normalized.lastIndexOf('@')
  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    throw new Error('Outlook mailbox must be a valid email address')
  }

  const localPart = normalized.slice(0, atIndex)
  const domain = normalizeDomain(normalized.slice(atIndex + 1))
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)) {
    throw new Error('Outlook mailbox must be a valid email address')
  }

  return `${localPart}@${domain}`
}

function normalizeMailboxAddress(
  value: string,
  mailboxType: VerificationMailboxType,
): string {
  return mailboxType === 'outlook'
    ? normalizeEmailAddress(value)
    : normalizeDomain(value)
}

function normalizeMailboxType(
  value: VerificationMailboxType | string | null | undefined,
): VerificationMailboxType {
  return value === 'outlook' ? 'outlook' : 'cloudflare'
}

function normalizeDescription(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
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

function getLegacyVerificationDomain(): string | null {
  const env = getAppEnv()
  const mailbox = env.verificationMailbox?.trim()
  if (mailbox) {
    const atIndex = mailbox.lastIndexOf('@')
    if (atIndex !== -1) {
      const domain = mailbox
        .slice(atIndex + 1)
        .trim()
        .toLowerCase()
      if (domain) {
        return domain
      }
    }
  }

  const domain = env.verificationDomain?.trim().toLowerCase()
  return domain || null
}

async function ensureLegacyVerificationDomainSeeded(): Promise<void> {
  const legacyDomain = getLegacyVerificationDomain()
  if (!legacyDomain) {
    return
  }

  const db = getDb()
  const existing = await db.query.verificationDomains.findFirst({
    columns: { id: true },
  })
  if (existing) {
    return
  }

  const now = new Date()
  await db
    .insert(verificationDomains)
    .values({
      id: createId(),
      domain: legacyDomain,
      mailboxType: 'cloudflare',
      mailboxPrefix: null,
      description: null,
      registrationEnabled: true,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: verificationDomains.domain })
}

async function setDefaultVerificationDomain(
  id: string,
  tx: ReturnType<typeof getDb>,
  now: Date,
) {
  await tx
    .update(verificationDomains)
    .set({
      isDefault: false,
      updatedAt: now,
    })
    .where(eq(verificationDomains.isDefault, true))

  await tx
    .update(verificationDomains)
    .set({
      isDefault: true,
      updatedAt: now,
    })
    .where(eq(verificationDomains.id, id))
}

function toSummary(
  row: VerificationDomainRow,
  appCount: number,
): VerificationDomainSummary {
  return {
    id: row.id,
    domain: row.domain,
    mailboxType: row.mailboxType,
    mailboxPrefix: row.mailboxPrefix,
    description: row.description,
    registrationEnabled: row.registrationEnabled,
    isDefault: row.isDefault,
    appCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function getAppCountsByDomainId(): Promise<Map<string, number>> {
  return new Map<string, number>()
}

async function listVerificationDomainRows(): Promise<VerificationDomainRow[]> {
  await ensureLegacyVerificationDomainSeeded()

  return getDb().query.verificationDomains.findMany({
    orderBy: [
      asc(verificationDomains.domain),
      asc(verificationDomains.createdAt),
    ],
  })
}

export async function listVerificationDomains(): Promise<
  VerificationDomainSummary[]
> {
  const [rows, appCounts] = await Promise.all([
    listVerificationDomainRows(),
    getAppCountsByDomainId(),
  ])

  return rows
    .map((row) => toSummary(row, appCounts.get(row.id) || 0))
    .sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1
      }

      if (left.registrationEnabled !== right.registrationEnabled) {
        return left.registrationEnabled ? -1 : 1
      }

      return left.domain.localeCompare(right.domain)
    })
}

export async function listRegistrationEnabledVerificationDomains(): Promise<
  VerificationDomainOption[]
> {
  const rows = await listVerificationDomainRows()

  return rows
    .filter((row) => row.registrationEnabled)
    .sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1
      }

      return left.domain.localeCompare(right.domain)
    })
    .map((row) => ({
      id: row.id,
      domain: row.domain,
      mailboxType: row.mailboxType,
      isDefault: row.isDefault,
    }))
}

export async function getVerificationDomainSummaryById(
  id: string,
): Promise<VerificationDomainSummary | null> {
  const domains = await listVerificationDomains()
  return domains.find((domain) => domain.id === id) || null
}

async function getFallbackVerificationDomain(): Promise<VerificationDomainRow | null> {
  await ensureLegacyVerificationDomainSeeded()

  const defaultDomain = await getDb().query.verificationDomains.findFirst({
    where: eq(verificationDomains.isDefault, true),
  })
  if (defaultDomain?.registrationEnabled) {
    return defaultDomain
  }

  return getDb().query.verificationDomains.findFirst({
    where: eq(verificationDomains.registrationEnabled, true),
    orderBy: [asc(verificationDomains.domain)],
  })
}

export async function resolveVerificationDomainById(
  id: string,
): Promise<VerificationDomainRow> {
  await ensureLegacyVerificationDomainSeeded()

  const row = await getDb().query.verificationDomains.findFirst({
    where: eq(verificationDomains.id, id),
  })

  if (!row) {
    throw new Error('Verification mailbox not found')
  }

  if (!row.registrationEnabled) {
    throw new Error(
      'Selected verification mailbox is not marked for new registrations',
    )
  }

  return row
}

export async function resolveOAuthClientVerificationDomainId(
  verificationDomainId?: string,
): Promise<string> {
  if (verificationDomainId) {
    const domain = await resolveVerificationDomainById(verificationDomainId)
    return domain.id
  }

  const fallback = await getFallbackVerificationDomain()
  if (!fallback) {
    throw new Error(
      'No verification mailboxes are marked for new registrations. Update one from the admin mailbox settings page.',
    )
  }

  return fallback.id
}

export async function resolveReservationVerificationDomain(options?: {
  clientId?: string | null
}): Promise<VerificationDomainRow> {
  void options

  const registrationDomains = (await listVerificationDomainRows()).filter(
    (domain) => domain.registrationEnabled,
  )
  if (!registrationDomains.length) {
    throw new Error(
      'No verification mailboxes are marked for new registrations. Update one from the admin mailbox settings page.',
    )
  }

  return registrationDomains[crypto.randomInt(0, registrationDomains.length)]
}

export async function createVerificationDomain(
  input: CreateVerificationDomainInput,
): Promise<VerificationDomainSummary> {
  await ensureLegacyVerificationDomainSeeded()

  const mailboxType = normalizeMailboxType(input.mailboxType)
  const domain = normalizeMailboxAddress(input.domain, mailboxType)
  const mailboxPrefix = normalizeMailboxPrefix(input.mailboxPrefix)
  const description = normalizeDescription(input.description)
  const registrationEnabled = input.registrationEnabled ?? true
  const now = new Date()

  const duplicate = await getDb().query.verificationDomains.findFirst({
    where: eq(verificationDomains.domain, domain),
  })
  if (duplicate) {
    throw new Error('Verification mailbox already exists')
  }

  const existingDefault = await getDb().query.verificationDomains.findFirst({
    where: eq(verificationDomains.isDefault, true),
  })
  const shouldBeDefault = input.isDefault === true || !existingDefault

  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(verificationDomains)
      .values({
        id: createId(),
        domain,
        mailboxType,
        mailboxPrefix,
        description,
        registrationEnabled,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!row) {
      throw new Error('Unable to create verification mailbox')
    }

    if (shouldBeDefault) {
      await setDefaultVerificationDomain(row.id, tx, now)
    }
  })

  const created = await getDb().query.verificationDomains.findFirst({
    where: eq(verificationDomains.domain, domain),
  })
  if (!created) {
    throw new Error('Unable to load verification mailbox')
  }

  return toSummary(created, 0)
}

export async function updateVerificationDomain(
  id: string,
  input: UpdateVerificationDomainInput,
): Promise<VerificationDomainSummary> {
  await ensureLegacyVerificationDomainSeeded()

  const existing = await getDb().query.verificationDomains.findFirst({
    where: eq(verificationDomains.id, id),
  })
  if (!existing) {
    throw new Error('Verification mailbox not found')
  }

  if (input.isDefault === false && existing.isDefault) {
    throw new Error(
      'Set another mailbox as default before clearing the current default.',
    )
  }

  const mailboxType =
    input.mailboxType === undefined
      ? existing.mailboxType
      : normalizeMailboxType(input.mailboxType)
  const domain = normalizeMailboxAddress(
    input.domain === undefined ? existing.domain : input.domain,
    mailboxType,
  )
  const mailboxPrefix =
    input.mailboxPrefix === undefined
      ? existing.mailboxPrefix
      : normalizeMailboxPrefix(input.mailboxPrefix)
  const description =
    input.description === undefined
      ? existing.description
      : normalizeDescription(input.description)
  const registrationEnabled =
    input.registrationEnabled ?? existing.registrationEnabled

  const duplicate = await getDb().query.verificationDomains.findFirst({
    where: eq(verificationDomains.domain, domain),
  })
  if (duplicate && duplicate.id !== existing.id) {
    throw new Error('Verification mailbox already exists')
  }

  const now = new Date()
  await getDb().transaction(async (tx) => {
    await tx
      .update(verificationDomains)
      .set({
        domain,
        mailboxType,
        mailboxPrefix,
        description,
        registrationEnabled,
        isDefault: existing.isDefault,
        updatedAt: now,
      })
      .where(eq(verificationDomains.id, id))

    if (input.isDefault === true && !existing.isDefault) {
      await setDefaultVerificationDomain(id, tx, now)
    }
  })

  const summary = await getVerificationDomainSummaryById(id)
  if (!summary) {
    throw new Error('Unable to load verification mailbox')
  }

  return summary
}
