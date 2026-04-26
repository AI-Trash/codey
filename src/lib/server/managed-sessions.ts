import '@tanstack/react-start/server-only'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { type ManagedSessionJsonObject } from '../managed-session-export'
import { getDb } from './db/client'
import {
  managedIdentitySessions,
  type ManagedIdentitySessionStatus,
} from './db/schema'
import { createId } from './security'

export interface AdminManagedSessionSummary {
  id: string
  identityId: string
  identityLabel: string
  email: string
  clientId: string
  authMode: string
  flowType: string
  accountId: string | null
  sessionId: string | null
  status: string
  lastRefreshAt: string | null
  expiresAt: string | null
  lastSeenAt: string
  createdAt: string
  updatedAt: string
  sessionData: ManagedSessionJsonObject
}

function parseOptionalDate(value?: string | null): Date | null {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return null
  }

  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function mapSessionStatus(expiresAt?: Date | null): string {
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return 'expired'
  }

  return 'active'
}

function normalizeSessionData(value: unknown): ManagedSessionJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return JSON.parse(JSON.stringify(value)) as ManagedSessionJsonObject
}

function buildManagedSessionSummary(row: {
  id: string
  identityId: string
  email: string
  clientId: string
  authMode: string
  flowType: string
  accountId: string | null
  sessionId: string | null
  status: ManagedIdentitySessionStatus
  lastRefreshAt: Date | null
  expiresAt: Date | null
  lastSeenAt: Date
  createdAt: Date
  updatedAt: Date
  sessionData: unknown
  identity?: {
    label: string | null
    email: string | null
  } | null
}): AdminManagedSessionSummary {
  return {
    id: row.id,
    identityId: row.identityId,
    identityLabel: row.identity?.label || row.identity?.email || row.email,
    email: row.email,
    clientId: row.clientId,
    authMode: row.authMode,
    flowType: row.flowType,
    accountId: row.accountId,
    sessionId: row.sessionId,
    status: mapSessionStatus(row.expiresAt),
    lastRefreshAt: row.lastRefreshAt?.toISOString() || null,
    expiresAt: row.expiresAt?.toISOString() || null,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sessionData: normalizeSessionData(row.sessionData),
  } satisfies AdminManagedSessionSummary
}

export async function listAdminManagedSessionSummaries(): Promise<
  AdminManagedSessionSummary[]
> {
  const rows = await getDb().query.managedIdentitySessions.findMany({
    with: {
      identity: {
        columns: {
          label: true,
          email: true,
        },
      },
    },
    orderBy: [desc(managedIdentitySessions.lastSeenAt)],
  })

  return rows.map((row) => buildManagedSessionSummary(row))
}

export async function findAdminManagedSessionSummary(id: string) {
  const row = await getDb().query.managedIdentitySessions.findFirst({
    where: eq(managedIdentitySessions.id, id),
    with: {
      identity: {
        columns: {
          label: true,
          email: true,
        },
      },
    },
  })

  return row ? buildManagedSessionSummary(row) : null
}

export async function syncManagedSession(params: {
  identityId: string
  email: string
  clientId?: string | null
  authMode: string
  flowType: string
  workspaceId?: string | null
  accountId?: string | null
  sessionId?: string | null
  lastRefreshAt?: string | null
  expiresAt?: string | null
  sessionData: Record<string, unknown>
}) {
  const identityId = params.identityId.trim()
  const email = params.email.trim().toLowerCase()
  const sessionDataClientId =
    typeof params.sessionData.client_id === 'string'
      ? params.sessionData.client_id
      : ''
  const clientId =
    params.clientId?.trim() || sessionDataClientId.trim() || 'unknown'
  const authMode = params.authMode.trim() || 'chatgpt'
  const flowType = params.flowType.trim()
  const workspaceId = params.workspaceId?.trim() || null
  const accountId = params.accountId?.trim() || null
  const sessionId = params.sessionId?.trim() || null
  const lastRefreshAt = parseOptionalDate(params.lastRefreshAt)
  const expiresAt = parseOptionalDate(params.expiresAt)
  const seenAt = new Date()
  const existing = await getDb().query.managedIdentitySessions.findFirst({
    where: and(
      eq(managedIdentitySessions.identityId, identityId),
      eq(managedIdentitySessions.clientId, clientId),
      workspaceId
        ? eq(managedIdentitySessions.workspaceId, workspaceId)
        : isNull(managedIdentitySessions.workspaceId),
    ),
  })

  if (existing) {
    const [record] = await getDb()
      .update(managedIdentitySessions)
      .set({
        email,
        clientId,
        authMode,
        flowType,
        workspaceId,
        accountId,
        sessionId,
        sessionData: params.sessionData,
        status: 'ACTIVE',
        lastRefreshAt,
        expiresAt,
        lastSeenAt: seenAt,
        updatedAt: seenAt,
      })
      .where(
        and(
          eq(managedIdentitySessions.identityId, identityId),
          eq(managedIdentitySessions.clientId, clientId),
          workspaceId
            ? eq(managedIdentitySessions.workspaceId, workspaceId)
            : isNull(managedIdentitySessions.workspaceId),
        ),
      )
      .returning()

    if (record) {
      return record
    }
  }

  const [created] = await getDb()
    .insert(managedIdentitySessions)
    .values({
      id: createId(),
      identityId,
      email,
      clientId,
      authMode,
      flowType,
      workspaceId,
      accountId,
      sessionId,
      sessionData: params.sessionData,
      status: 'ACTIVE',
      lastRefreshAt,
      expiresAt,
      lastSeenAt: seenAt,
      createdAt: seenAt,
      updatedAt: seenAt,
    })
    .returning()

  if (!created) {
    throw new Error('Unable to sync managed session')
  }

  return created
}

export async function deleteManagedSession(id: string) {
  const [record] = await getDb()
    .delete(managedIdentitySessions)
    .where(eq(managedIdentitySessions.id, id))
    .returning()

  return record ?? null
}
