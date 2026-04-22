import '@tanstack/react-start/server-only'

import { and, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { getDb } from './db/client'
import { decryptSecret, encryptSecret } from './encrypted-secrets'
import { managedIdentities, verificationEmailReservations } from './db/schema'
import { createId } from './security'
import { normalizeManagedIdentityTags } from '../managed-identity-tags'
import { m } from '#/paraglide/messages'
import type { ManagedIdentityPlan, ManagedIdentityStatus } from './db/schema'

export interface AdminIdentitySummary {
  id: string
  label: string
  tags: string[]
  provider: string
  account: string
  flowCount: number
  lastSeenAt: string
  status: string
  plan: ManagedIdentityPlan
}

export interface ManagedIdentityCredentialMetadata {
  prefix?: string
  mailbox?: string
  source?: 'chatgpt-register'
  chatgptUrl?: string
}

export interface ManagedIdentityCredentialSummary {
  id: string
  email: string
  label: string | null
  tags: string[]
  credentialCount: number
  encrypted: boolean
  createdAt: string
  updatedAt: string
  status: string
  plan: ManagedIdentityPlan
  metadata?: ManagedIdentityCredentialMetadata
}

export interface ManagedIdentityCredentialRecord extends ManagedIdentityCredentialSummary {
  password: string
}

function mapManagedStatus(status?: string | null) {
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

function normalizeCredentialMetadata(
  metadata?: Record<string, unknown> | null,
): ManagedIdentityCredentialMetadata | undefined {
  if (!metadata) {
    return undefined
  }

  const normalized: ManagedIdentityCredentialMetadata = {}

  if (typeof metadata.prefix === 'string' && metadata.prefix.trim()) {
    normalized.prefix = metadata.prefix.trim()
  }
  if (typeof metadata.mailbox === 'string' && metadata.mailbox.trim()) {
    normalized.mailbox = metadata.mailbox.trim()
  }
  if (metadata.source === 'chatgpt-register') {
    normalized.source = 'chatgpt-register'
  }
  if (typeof metadata.chatgptUrl === 'string' && metadata.chatgptUrl.trim()) {
    normalized.chatgptUrl = metadata.chatgptUrl.trim()
  }

  return Object.keys(normalized).length ? normalized : undefined
}

function buildManagedIdentitySummary(row: {
  identityId: string
  email: string
  label: string | null
  tags: string[]
  credentialCount: number
  status: string
  plan: ManagedIdentityPlan
  lastSeenAt: Date
}): AdminIdentitySummary {
  return {
    id: row.identityId,
    label: row.label || row.email,
    tags: normalizeManagedIdentityTags(row.tags),
    provider: m.server_identity_provider(),
    account: row.email,
    flowCount: row.credentialCount,
    lastSeenAt: row.lastSeenAt.toISOString(),
    status: mapManagedStatus(row.status),
    plan: row.plan,
  } satisfies AdminIdentitySummary
}

function buildManagedIdentityCredentialSummary(row: {
  identityId: string
  email: string
  label: string | null
  tags: string[]
  credentialCount: number
  passwordCiphertext: string | null
  credentialMetadata: Record<string, unknown> | null
  status: string
  plan: ManagedIdentityPlan
  createdAt: Date
  updatedAt: Date
}): ManagedIdentityCredentialSummary {
  return {
    id: row.identityId,
    email: row.email,
    label: row.label,
    tags: normalizeManagedIdentityTags(row.tags),
    credentialCount: row.credentialCount,
    encrypted: Boolean(row.passwordCiphertext),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    status: mapManagedStatus(row.status),
    plan: row.plan,
    metadata: normalizeCredentialMetadata(row.credentialMetadata),
  }
}

function buildManagedIdentityCredentialRecord(row: {
  identityId: string
  email: string
  label: string | null
  tags: string[]
  credentialCount: number
  passwordCiphertext: string | null
  credentialMetadata: Record<string, unknown> | null
  status: string
  plan: ManagedIdentityPlan
  createdAt: Date
  updatedAt: Date
}): ManagedIdentityCredentialRecord {
  if (!row.passwordCiphertext) {
    throw new Error(
      `Managed identity ${row.identityId} does not have a shared password stored in Codey app.`,
    )
  }

  return {
    ...buildManagedIdentityCredentialSummary(row),
    password: decryptSecret(
      row.passwordCiphertext,
      'decrypt shared managed identity credentials',
    ),
  }
}

function normalizeCredentialCount(value?: number): number | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return undefined
  }

  const normalized = Math.floor(Number(value))
  return normalized >= 0 ? normalized : undefined
}

function normalizePassword(value?: string): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export async function listAdminIdentitySummaries(): Promise<
  AdminIdentitySummary[]
> {
  const managedIdentityRows = await getDb().query.managedIdentities.findMany({
    orderBy: [desc(managedIdentities.lastSeenAt)],
  })

  return managedIdentityRows.map((row) => buildManagedIdentitySummary(row))
}

export async function findAdminIdentitySummary(identityId: string) {
  const summaries = await listAdminIdentitySummaries()
  return summaries.find((summary) => summary.id === identityId) || null
}

export async function listManagedIdentityCredentialSummaries(): Promise<
  ManagedIdentityCredentialSummary[]
> {
  const rows = await getDb().query.managedIdentities.findMany({
    where: isNotNull(managedIdentities.passwordCiphertext),
    orderBy: [desc(managedIdentities.updatedAt)],
  })

  return rows.map((row) => buildManagedIdentityCredentialSummary(row))
}

export async function resolveManagedIdentityCredential(params: {
  identityId?: string
  email?: string
}): Promise<ManagedIdentityCredentialRecord | null> {
  const identityId = params.identityId?.trim() || undefined
  const email = params.email ? normalizeEmail(params.email) : undefined

  const row = identityId
    ? await getDb().query.managedIdentities.findFirst({
        where: and(
          eq(managedIdentities.identityId, identityId),
          isNotNull(managedIdentities.passwordCiphertext),
        ),
      })
    : email
      ? await getDb().query.managedIdentities.findFirst({
          where: and(
            eq(managedIdentities.email, email),
            isNotNull(managedIdentities.passwordCiphertext),
          ),
          orderBy: [desc(managedIdentities.updatedAt)],
        })
      : await getDb().query.managedIdentities.findFirst({
          where: and(
            isNotNull(managedIdentities.passwordCiphertext),
            ne(managedIdentities.status, 'BANNED'),
          ),
          orderBy: [desc(managedIdentities.updatedAt)],
        })

  return row ? buildManagedIdentityCredentialRecord(row) : null
}

export async function upsertManagedIdentity(params: {
  identityId: string
  email: string
  label?: string
  tags?: string[]
  status?: ManagedIdentityStatus
  plan?: ManagedIdentityPlan
}) {
  const label = params.label?.trim() || undefined
  const tags =
    params.tags === undefined
      ? undefined
      : normalizeManagedIdentityTags(params.tags)
  const status = params.status || 'ACTIVE'
  const plan = params.plan || 'free'

  const [record] = await getDb()
    .insert(managedIdentities)
    .values({
      id: createId(),
      identityId: params.identityId,
      email: normalizeEmail(params.email),
      ...(label !== undefined ? { label } : {}),
      ...(tags !== undefined ? { tags } : {}),
      status,
      plan,
    })
    .onConflictDoUpdate({
      target: managedIdentities.identityId,
      set: {
        email: normalizeEmail(params.email),
        ...(label !== undefined ? { label } : {}),
        ...(tags !== undefined ? { tags } : {}),
        status,
        plan,
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!record) {
    const existing = await getDb().query.managedIdentities.findFirst({
      where: eq(managedIdentities.identityId, params.identityId),
    })
    if (!existing) {
      throw new Error('Unable to persist managed identity')
    }
    return existing
  }

  return record
}

export async function updateManagedIdentity(params: {
  identityId: string
  label?: string | null
  tags?: string[]
  status?: ManagedIdentityStatus
  plan?: ManagedIdentityPlan
}) {
  const existing = await getDb().query.managedIdentities.findFirst({
    where: eq(managedIdentities.identityId, params.identityId),
  })
  if (!existing) {
    return null
  }

  const label =
    params.label === undefined ? existing.label : params.label?.trim() || null
  const tags =
    params.tags === undefined
      ? normalizeManagedIdentityTags(existing.tags)
      : normalizeManagedIdentityTags(params.tags)
  const status = params.status ?? existing.status
  const plan = params.plan ?? existing.plan
  const [record] = await getDb()
    .update(managedIdentities)
    .set({
      label,
      tags,
      status,
      plan,
      updatedAt: new Date(),
    })
    .where(eq(managedIdentities.identityId, params.identityId))
    .returning()

  return record ?? existing
}

export async function deleteManagedIdentity(identityId: string) {
  const [record] = await getDb()
    .delete(managedIdentities)
    .where(eq(managedIdentities.identityId, identityId))
    .returning()

  return record ?? null
}

export async function deleteManagedIdentities(identityIds: string[]) {
  const normalizedIdentityIds = Array.from(
    new Set(identityIds.map((identityId) => identityId.trim()).filter(Boolean)),
  )

  if (!normalizedIdentityIds.length) {
    return []
  }

  return getDb()
    .delete(managedIdentities)
    .where(inArray(managedIdentities.identityId, normalizedIdentityIds))
    .returning()
}

export async function syncManagedIdentity(params: {
  identityId: string
  email: string
  credentialCount?: number
  label?: string
  tags?: string[]
  status?: ManagedIdentityStatus
  plan?: ManagedIdentityPlan
  password?: string
  metadata?: Record<string, unknown>
  reservationId?: string
}) {
  const identityId = params.identityId.trim()
  const email = normalizeEmail(params.email)
  const reservationId = params.reservationId?.trim() || null
  const credentialCount = normalizeCredentialCount(params.credentialCount)
  const label = params.label?.trim() || null
  const tags =
    params.tags === undefined
      ? undefined
      : normalizeManagedIdentityTags(params.tags)
  const status = params.status
  const plan = params.plan
  const password = normalizePassword(params.password)
  const passwordCiphertext = password
    ? encryptSecret(
        password,
        'store shared managed identity credentials in Codey app',
      )
    : undefined
  const metadata = normalizeCredentialMetadata(params.metadata)
  const seenAt = new Date()
  const existing = await getDb().query.managedIdentities.findFirst({
    where: eq(managedIdentities.identityId, identityId),
  })

  const attachReservation = async () => {
    if (!reservationId) {
      return
    }

    await getDb()
      .update(verificationEmailReservations)
      .set({
        identityId,
        updatedAt: seenAt,
      })
      .where(eq(verificationEmailReservations.id, reservationId))
  }

  if (existing) {
    const [record] = await getDb()
      .update(managedIdentities)
      .set({
        email,
        label: label ?? existing.label,
        tags: tags ?? existing.tags,
        passwordCiphertext: passwordCiphertext ?? existing.passwordCiphertext,
        credentialMetadata: metadata
          ? { ...metadata }
          : existing.credentialMetadata,
        credentialCount: credentialCount ?? existing.credentialCount,
        status: status ?? existing.status,
        plan: plan ?? existing.plan,
        lastSeenAt: seenAt,
        updatedAt: seenAt,
      })
      .where(eq(managedIdentities.identityId, identityId))
      .returning()

    if (record) {
      await attachReservation()
      return record
    }
  }

  const [created] = await getDb()
    .insert(managedIdentities)
    .values({
      id: createId(),
      identityId,
      email,
      label,
      tags: tags ?? [],
      passwordCiphertext,
      credentialMetadata: metadata ? { ...metadata } : null,
      credentialCount: credentialCount ?? 0,
      status: status ?? 'ACTIVE',
      plan: plan ?? 'free',
      lastSeenAt: seenAt,
    })
    .returning()

  if (!created) {
    throw new Error('Unable to sync managed identity')
  }

  await attachReservation()
  return created
}
