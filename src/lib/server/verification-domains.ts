import '@tanstack/react-start/server-only'

import crypto from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { getDb } from './db/client'
import { verificationDomains, type VerificationDomainRow } from './db/schema'
import { getAppEnv } from './env'
import { createId } from './security'

export interface VerificationDomainSummary {
  id: string
  domain: string
  description: string | null
  enabled: boolean
  isDefault: boolean
  appCount: number
  createdAt: Date
  updatedAt: Date
}

export interface VerificationDomainOption {
  id: string
  domain: string
  isDefault: boolean
}

export interface CreateVerificationDomainInput {
  domain: string
  description?: string
  enabled?: boolean
  isDefault?: boolean
}

export interface UpdateVerificationDomainInput {
  domain?: string
  description?: string | null
  enabled?: boolean
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

function normalizeDescription(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
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
      description: null,
      enabled: true,
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
      enabled: true,
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
    description: row.description,
    enabled: row.enabled,
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

      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1
      }

      return left.domain.localeCompare(right.domain)
    })
}

export async function listEnabledVerificationDomains(): Promise<
  VerificationDomainOption[]
> {
  const rows = await listVerificationDomainRows()

  return rows
    .filter((row) => row.enabled)
    .sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1
      }

      return left.domain.localeCompare(right.domain)
    })
    .map((row) => ({
      id: row.id,
      domain: row.domain,
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
  if (defaultDomain?.enabled) {
    return defaultDomain
  }

  return getDb().query.verificationDomains.findFirst({
    where: eq(verificationDomains.enabled, true),
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
    throw new Error('Verification domain not found')
  }

  if (!row.enabled) {
    throw new Error('Selected verification domain is disabled')
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
      'No verification domains are configured. Add one from the admin domains page.',
    )
  }

  return fallback.id
}

export async function resolveReservationVerificationDomain(options?: {
  clientId?: string | null
}): Promise<VerificationDomainRow> {
  void options

  const enabledDomains = (await listVerificationDomainRows()).filter(
    (domain) => domain.enabled,
  )
  if (!enabledDomains.length) {
    throw new Error(
      'No verification domains are configured. Add one from the admin domains page.',
    )
  }

  return enabledDomains[crypto.randomInt(0, enabledDomains.length)]
}

export async function createVerificationDomain(
  input: CreateVerificationDomainInput,
): Promise<VerificationDomainSummary> {
  await ensureLegacyVerificationDomainSeeded()

  const domain = normalizeDomain(input.domain)
  const description = normalizeDescription(input.description)
  const enabled = input.enabled ?? true
  const now = new Date()

  const duplicate = await getDb().query.verificationDomains.findFirst({
    where: eq(verificationDomains.domain, domain),
  })
  if (duplicate) {
    throw new Error('Verification domain already exists')
  }

  const existingDefault = await getDb().query.verificationDomains.findFirst({
    where: eq(verificationDomains.isDefault, true),
  })
  const shouldBeDefault = input.isDefault === true || !existingDefault

  if (shouldBeDefault && !enabled) {
    throw new Error('Default verification domain must be enabled')
  }

  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(verificationDomains)
      .values({
        id: createId(),
        domain,
        description,
        enabled,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!row) {
      throw new Error('Unable to create verification domain')
    }

    if (shouldBeDefault) {
      await setDefaultVerificationDomain(row.id, tx, now)
    }
  })

  const created = await getDb().query.verificationDomains.findFirst({
    where: eq(verificationDomains.domain, domain),
  })
  if (!created) {
    throw new Error('Unable to load verification domain')
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
    throw new Error('Verification domain not found')
  }

  if (input.isDefault === false && existing.isDefault) {
    throw new Error(
      'Set another domain as default before clearing the current default.',
    )
  }

  const domain =
    input.domain === undefined ? existing.domain : normalizeDomain(input.domain)
  const description =
    input.description === undefined
      ? existing.description
      : normalizeDescription(input.description)
  const enabled = input.enabled ?? existing.enabled
  const shouldBeDefault = input.isDefault === true || existing.isDefault

  if (existing.isDefault && !enabled) {
    throw new Error(
      'Set another domain as default before disabling the current default.',
    )
  }

  if (shouldBeDefault && !enabled) {
    throw new Error('Default verification domain must be enabled')
  }

  const duplicate = await getDb().query.verificationDomains.findFirst({
    where: eq(verificationDomains.domain, domain),
  })
  if (duplicate && duplicate.id !== existing.id) {
    throw new Error('Verification domain already exists')
  }

  const now = new Date()
  await getDb().transaction(async (tx) => {
    await tx
      .update(verificationDomains)
      .set({
        domain,
        description,
        enabled,
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
    throw new Error('Unable to load verification domain')
  }

  return summary
}
