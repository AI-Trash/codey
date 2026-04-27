import '@tanstack/react-start/server-only'

import { and, desc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm'
import { DEFAULT_CLI_BROWSER_LIMIT } from '../../../packages/cli/src/modules/flow-cli/flow-registry'
import { getDb } from './db/client'
import { cliConnections } from './db/schema'
import { createId } from './security'

const ACTIVE_CONNECTION_STALE_MS = 30_000
const ACTIVE_CONNECTION_LIMIT = 50

export interface AdminCliConnectionSummary {
  id: string
  workerId: string | null
  sessionRef: string | null
  userId: string | null
  authClientId: string | null
  cliName: string | null
  target: string | null
  userAgent: string | null
  registeredFlows: string[]
  storageStateIdentityIds: string[]
  storageStateEmails: string[]
  browserLimit: number
  connectionPath: string
  status: 'active' | 'offline'
  connectedAt: string
  lastSeenAt: string
  disconnectedAt: string | null
  githubLogin: string | null
  email: string | null
  userLabel: string
  runtimeFlowId: string | null
  runtimeTaskId: string | null
  runtimeFlowStatus: string | null
  runtimeFlowMessage: string | null
  runtimeFlowStartedAt: string | null
  runtimeFlowCompletedAt: string | null
  runtimeFlowUpdatedAt: string | null
}

export interface CliConnectionActorScope {
  userId?: string | null
  githubLogin?: string | null
  email?: string | null
}

function toOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

function getActiveCutoff(now = Date.now()) {
  return new Date(now - ACTIVE_CONNECTION_STALE_MS)
}

function getCliConnectionStatus(input: {
  lastSeenAt: Date
  disconnectedAt?: Date | null
}): 'active' | 'offline' {
  if (input.disconnectedAt) {
    return 'offline'
  }

  return input.lastSeenAt.getTime() >= getActiveCutoff().getTime()
    ? 'active'
    : 'offline'
}

function getUserLabel(
  user: {
    githubLogin?: string | null
    email?: string | null
    name?: string | null
  } | null,
): string {
  if (!user) {
    return 'Unknown user'
  }

  return (
    user.name?.trim() ||
    user.githubLogin?.trim() ||
    user.email?.trim() ||
    'Unknown user'
  )
}

function toComparableString(value: string | null | undefined): string | null {
  const normalized = toOptionalString(value)
  return normalized ? normalized.toLowerCase() : null
}

function getActorTargetValues(actor: CliConnectionActorScope): string[] {
  return Array.from(
    new Set(
      [actor.githubLogin, actor.email]
        .map((value) => toOptionalString(value))
        .filter((value): value is string => Boolean(value)),
    ),
  )
}

function normalizeStringList(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .map((entry) => toOptionalString(entry))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  )
}

function normalizeEmailList(value: string[] | null | undefined): string[] {
  return normalizeStringList(value).map((entry) => entry.toLowerCase())
}

function normalizeCliBrowserLimitValue(
  value: number | null | undefined,
  fallback = DEFAULT_CLI_BROWSER_LIMIT,
): number {
  return Number.isInteger(value) && value && value > 0 ? value : fallback
}

export function isCliConnectionOwnedByActor(
  connection: Pick<AdminCliConnectionSummary, 'userId' | 'target'>,
  actor: CliConnectionActorScope,
): boolean {
  const actorUserId = toOptionalString(actor.userId)
  if (connection.userId) {
    return Boolean(actorUserId && connection.userId === actorUserId)
  }

  const connectionTarget = toComparableString(connection.target)
  if (!connectionTarget) {
    return false
  }

  const actorTargets = new Set(
    [actor.githubLogin, actor.email]
      .map((value) => toComparableString(value))
      .filter((value): value is string => Boolean(value)),
  )

  return actorTargets.has(connectionTarget)
}

export function isSharedCliConnection(
  connection: Pick<
    AdminCliConnectionSummary,
    'userId' | 'target' | 'authClientId'
  >,
): boolean {
  return (
    !toOptionalString(connection.userId) &&
    !toOptionalString(connection.target) &&
    Boolean(toOptionalString(connection.authClientId))
  )
}

function mapSummary(
  row: Awaited<ReturnType<typeof listRecentCliConnectionRows>>[number],
): AdminCliConnectionSummary {
  return {
    id: row.id,
    workerId: row.workerId,
    sessionRef: row.sessionRef,
    userId: row.userId,
    authClientId: row.authClientId,
    cliName: row.cliName,
    target: row.target,
    userAgent: row.userAgent,
    registeredFlows: normalizeStringList(row.registeredFlows),
    storageStateIdentityIds: normalizeStringList(row.storageStateIdentityIds),
    storageStateEmails: normalizeEmailList(row.storageStateEmails),
    browserLimit: normalizeCliBrowserLimitValue(row.browserLimit),
    connectionPath: row.connectionPath,
    status: getCliConnectionStatus(row),
    connectedAt: row.connectedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    disconnectedAt: row.disconnectedAt?.toISOString() || null,
    githubLogin: row.user?.githubLogin || null,
    email: row.user?.email || null,
    userLabel: getUserLabel(row.user),
    runtimeFlowId: row.runtimeFlowId || null,
    runtimeTaskId: row.runtimeTaskId || null,
    runtimeFlowStatus: row.runtimeFlowStatus || null,
    runtimeFlowMessage: row.runtimeFlowMessage || null,
    runtimeFlowStartedAt: row.runtimeFlowStartedAt?.toISOString() || null,
    runtimeFlowCompletedAt: row.runtimeFlowCompletedAt?.toISOString() || null,
    runtimeFlowUpdatedAt: row.runtimeFlowUpdatedAt?.toISOString() || null,
  }
}

async function listRecentCliConnectionRows(limit = 100) {
  return getDb().query.cliConnections.findMany({
    with: {
      user: true,
    },
    orderBy: [desc(cliConnections.lastSeenAt)],
    limit,
  })
}

async function getLatestBrowserLimitForWorker(workerId: string | null) {
  if (!workerId) {
    return DEFAULT_CLI_BROWSER_LIMIT
  }

  const latestConnection = await getDb().query.cliConnections.findFirst({
    columns: {
      browserLimit: true,
    },
    where: eq(cliConnections.workerId, workerId),
    orderBy: [
      desc(cliConnections.lastSeenAt),
      desc(cliConnections.connectedAt),
    ],
  })

  return normalizeCliBrowserLimitValue(latestConnection?.browserLimit)
}

export async function registerCliConnection(input: {
  workerId?: string | null
  sessionRef?: string | null
  userId?: string | null
  authClientId?: string | null
  cliName?: string | null
  target?: string | null
  userAgent?: string | null
  registeredFlows?: string[] | null
  storageStateIdentityIds?: string[] | null
  storageStateEmails?: string[] | null
  connectionPath: string
}) {
  const workerId = toOptionalString(input.workerId)
  const browserLimit = await getLatestBrowserLimitForWorker(workerId)
  const [connection] = await getDb()
    .insert(cliConnections)
    .values({
      id: createId(),
      workerId,
      sessionRef: toOptionalString(input.sessionRef),
      userId: toOptionalString(input.userId),
      authClientId: toOptionalString(input.authClientId),
      cliName: toOptionalString(input.cliName),
      target: toOptionalString(input.target),
      userAgent: toOptionalString(input.userAgent),
      registeredFlows: normalizeStringList(input.registeredFlows),
      storageStateIdentityIds: normalizeStringList(
        input.storageStateIdentityIds,
      ),
      storageStateEmails: normalizeEmailList(input.storageStateEmails),
      browserLimit,
      connectionPath: input.connectionPath,
    })
    .returning()

  return connection
}

export async function touchCliConnection(connectionId: string) {
  await getDb()
    .update(cliConnections)
    .set({
      lastSeenAt: new Date(),
    })
    .where(
      and(
        eq(cliConnections.id, connectionId),
        isNull(cliConnections.disconnectedAt),
      ),
    )
}

export async function markCliConnectionDisconnected(connectionId: string) {
  await getDb()
    .update(cliConnections)
    .set({
      lastSeenAt: new Date(),
      disconnectedAt: new Date(),
      runtimeFlowId: null,
      runtimeTaskId: null,
      runtimeFlowStatus: null,
      runtimeFlowMessage: null,
      runtimeFlowStartedAt: null,
      runtimeFlowCompletedAt: null,
      runtimeFlowUpdatedAt: null,
    })
    .where(
      and(
        eq(cliConnections.id, connectionId),
        isNull(cliConnections.disconnectedAt),
      ),
    )
}

function toOptionalDate(
  value: string | Date | null | undefined,
): Date | null | undefined {
  if (value == null) {
    return value === null ? null : undefined
  }

  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export async function updateCliConnectionRuntimeState(
  connectionId: string,
  input: {
    runtimeFlowId?: string | null
    runtimeTaskId?: string | null
    runtimeFlowStatus?: string | null
    runtimeFlowMessage?: string | null
    runtimeFlowStartedAt?: string | Date | null
    runtimeFlowCompletedAt?: string | Date | null
    storageStateIdentityIds?: string[] | null
    storageStateEmails?: string[] | null
  },
) {
  const patch = {
    runtimeFlowId:
      input.runtimeFlowId === undefined
        ? undefined
        : toOptionalString(input.runtimeFlowId),
    runtimeTaskId:
      input.runtimeTaskId === undefined
        ? undefined
        : toOptionalString(input.runtimeTaskId),
    runtimeFlowStatus:
      input.runtimeFlowStatus === undefined
        ? undefined
        : toOptionalString(input.runtimeFlowStatus),
    runtimeFlowMessage:
      input.runtimeFlowMessage === undefined
        ? undefined
        : toOptionalString(input.runtimeFlowMessage),
    runtimeFlowStartedAt: toOptionalDate(input.runtimeFlowStartedAt),
    runtimeFlowCompletedAt: toOptionalDate(input.runtimeFlowCompletedAt),
    storageStateIdentityIds:
      input.storageStateIdentityIds === undefined
        ? undefined
        : normalizeStringList(input.storageStateIdentityIds),
    storageStateEmails:
      input.storageStateEmails === undefined
        ? undefined
        : normalizeEmailList(input.storageStateEmails),
    runtimeFlowUpdatedAt: new Date(),
  }

  const [updated] = await getDb()
    .update(cliConnections)
    .set(patch)
    .where(
      and(
        eq(cliConnections.id, connectionId),
        isNull(cliConnections.disconnectedAt),
      ),
    )
    .returning({
      browserLimit: cliConnections.browserLimit,
    })

  return updated
    ? {
        browserLimit: normalizeCliBrowserLimitValue(updated.browserLimit),
      }
    : null
}

export async function updateCliConnectionSettings(
  connectionId: string,
  input: {
    browserLimit: number
  },
) {
  const connection = await getDb().query.cliConnections.findFirst({
    where: eq(cliConnections.id, connectionId),
  })
  if (!connection) {
    throw new Error('CLI connection not found.')
  }

  const browserLimit = normalizeCliBrowserLimitValue(input.browserLimit)
  const connectionFilter = connection.workerId
    ? eq(cliConnections.workerId, connection.workerId)
    : eq(cliConnections.id, connection.id)

  const [updated] = await getDb()
    .update(cliConnections)
    .set({
      browserLimit,
    })
    .where(connectionFilter)
    .returning()

  return updated || null
}

export async function listAdminCliConnectionState() {
  const activeCutoff = getActiveCutoff()
  const activeRows = await getDb().query.cliConnections.findMany({
    with: {
      user: true,
    },
    where: and(
      isNull(cliConnections.disconnectedAt),
      gt(cliConnections.lastSeenAt, activeCutoff),
    ),
    orderBy: [desc(cliConnections.lastSeenAt)],
    limit: ACTIVE_CONNECTION_LIMIT,
  })

  const activeConnections = activeRows.map(mapSummary)

  return {
    snapshotAt: new Date().toISOString(),
    activeConnections,
  }
}

export async function listAdminCliConnectionStateForActor(
  actor: CliConnectionActorScope,
) {
  const activeCutoff = getActiveCutoff()
  const actorUserId = toOptionalString(actor.userId)
  const actorTargets = getActorTargetValues(actor)
  const targetFilter = actorTargets.length
    ? or(...actorTargets.map((target) => eq(cliConnections.target, target)))
    : null
  const ownershipFilter =
    actorUserId && targetFilter
      ? or(
          eq(cliConnections.userId, actorUserId),
          and(isNull(cliConnections.userId), targetFilter),
        )
      : actorUserId
        ? eq(cliConnections.userId, actorUserId)
        : targetFilter
          ? and(isNull(cliConnections.userId), targetFilter)
          : null
  const sharedConnectionFilter = and(
    isNull(cliConnections.userId),
    isNull(cliConnections.target),
    isNotNull(cliConnections.authClientId),
  )
  const visibilityFilter = ownershipFilter
    ? or(ownershipFilter, sharedConnectionFilter)
    : sharedConnectionFilter

  const activeRows = await getDb().query.cliConnections.findMany({
    with: {
      user: true,
    },
    where: and(
      isNull(cliConnections.disconnectedAt),
      gt(cliConnections.lastSeenAt, activeCutoff),
      visibilityFilter,
    ),
    orderBy: [desc(cliConnections.lastSeenAt)],
    limit: ACTIVE_CONNECTION_LIMIT,
  })

  return {
    snapshotAt: new Date().toISOString(),
    activeConnections: activeRows
      .map(mapSummary)
      .filter(
        (connection) =>
          isCliConnectionOwnedByActor(connection, actor) ||
          isSharedCliConnection(connection),
      ),
  }
}

export async function getAdminCliConnectionSummaryById(
  connectionId: string,
): Promise<AdminCliConnectionSummary | null> {
  const row = await getDb().query.cliConnections.findFirst({
    with: {
      user: true,
    },
    where: eq(cliConnections.id, connectionId),
  })

  return row ? mapSummary(row) : null
}

export async function listRecentVisibleCliConnectionsForActor(
  actor: CliConnectionActorScope,
  input: {
    limit?: number
  } = {},
) {
  const rows = await listRecentCliConnectionRows(input.limit || 200)

  return rows
    .map(mapSummary)
    .filter(
      (connection) =>
        isCliConnectionOwnedByActor(connection, actor) ||
        isSharedCliConnection(connection),
    )
}
