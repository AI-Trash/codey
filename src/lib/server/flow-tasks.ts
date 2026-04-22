import '@tanstack/react-start/server-only'

import { and, asc, eq, lt, or, sql } from 'drizzle-orm'

import { getDb } from './db/client'
import {
  cliConnections,
  flowTasks,
  type CliConnectionRow,
  type FlowTaskRow,
  type FlowTaskStatus,
} from './db/schema'

export const DEFAULT_FLOW_TASK_LEASE_MS = 30_000

type ActiveFlowTaskStatus = Extract<FlowTaskStatus, 'LEASED' | 'RUNNING'>
type FinalFlowTaskStatus = Extract<
  FlowTaskStatus,
  'SUCCEEDED' | 'FAILED' | 'CANCELED'
>

function normalizeWorkerId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized || null
}

export function getCliConnectionTaskWorkerId(
  connection: Pick<CliConnectionRow, 'id' | 'workerId'>,
): string {
  return normalizeWorkerId(connection.workerId) || connection.id
}

function buildClaimableTaskFilter(input: { workerId: string; now: Date }) {
  return and(
    eq(flowTasks.workerId, input.workerId),
    or(
      eq(flowTasks.status, 'QUEUED'),
      and(
        or(eq(flowTasks.status, 'LEASED'), eq(flowTasks.status, 'RUNNING')),
        lt(flowTasks.leaseExpiresAt, input.now),
      ),
    ),
  )
}

async function getCliConnectionRow(
  connectionId: string,
): Promise<CliConnectionRow | null> {
  const row = await getDb().query.cliConnections.findFirst({
    where: eq(cliConnections.id, connectionId),
  })

  return row || null
}

export async function claimNextFlowTaskForConnection(input: {
  connectionId: string
  leaseMs?: number
}): Promise<FlowTaskRow | null> {
  const connection = await getCliConnectionRow(input.connectionId)
  if (!connection) {
    throw new Error('CLI connection not found.')
  }

  const workerId = getCliConnectionTaskWorkerId(connection)
  const leaseMs = Math.max(input.leaseMs || DEFAULT_FLOW_TASK_LEASE_MS, 5_000)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date()
    const candidate = await getDb().query.flowTasks.findFirst({
      where: buildClaimableTaskFilter({ workerId, now }),
      orderBy: [asc(flowTasks.createdAt), asc(flowTasks.id)],
    })

    if (!candidate) {
      return null
    }

    const leaseExpiresAt = new Date(now.getTime() + leaseMs)
    const [claimed] = await getDb()
      .update(flowTasks)
      .set({
        status: 'LEASED',
        cliConnectionId: connection.id,
        leaseClaimedAt: now,
        leaseExpiresAt,
        attemptCount: sql`${flowTasks.attemptCount} + 1`,
        startedAt: null,
        completedAt: null,
        lastError: null,
        updatedAt: now,
      })
      .where(and(eq(flowTasks.id, candidate.id), buildClaimableTaskFilter({ workerId, now })))
      .returning()

    if (claimed) {
      return claimed
    }
  }

  return null
}

export async function refreshFlowTaskLease(input: {
  connectionId: string
  taskId: string
  status: ActiveFlowTaskStatus
  leaseMs?: number
}): Promise<FlowTaskRow | null> {
  const connection = await getCliConnectionRow(input.connectionId)
  if (!connection) {
    throw new Error('CLI connection not found.')
  }

  const now = new Date()
  const leaseMs = Math.max(input.leaseMs || DEFAULT_FLOW_TASK_LEASE_MS, 5_000)
  const leaseExpiresAt = new Date(now.getTime() + leaseMs)
  const workerId = getCliConnectionTaskWorkerId(connection)
  const patch =
    input.status === 'RUNNING'
      ? {
          status: input.status,
          cliConnectionId: connection.id,
          leaseExpiresAt,
          startedAt: sql`coalesce(${flowTasks.startedAt}, ${now})`,
          updatedAt: now,
        }
      : {
          status: input.status,
          cliConnectionId: connection.id,
          leaseExpiresAt,
          updatedAt: now,
        }

  const [updated] = await getDb()
    .update(flowTasks)
    .set(patch)
    .where(
      and(
        eq(flowTasks.id, input.taskId),
        eq(flowTasks.workerId, workerId),
        or(eq(flowTasks.status, 'LEASED'), eq(flowTasks.status, 'RUNNING')),
      ),
    )
    .returning()

  return updated || null
}

export async function completeFlowTask(input: {
  connectionId: string
  taskId: string
  status: FinalFlowTaskStatus
  error?: string | null
}): Promise<FlowTaskRow | null> {
  const connection = await getCliConnectionRow(input.connectionId)
  if (!connection) {
    throw new Error('CLI connection not found.')
  }

  const now = new Date()
  const workerId = getCliConnectionTaskWorkerId(connection)
  const normalizedError = normalizeWorkerId(input.error)

  const [updated] = await getDb()
    .update(flowTasks)
    .set({
      status: input.status,
      cliConnectionId: connection.id,
      leaseExpiresAt: null,
      completedAt: now,
      lastError: input.status === 'FAILED' ? normalizedError || 'Flow task failed.' : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(flowTasks.id, input.taskId),
        eq(flowTasks.workerId, workerId),
        or(eq(flowTasks.status, 'LEASED'), eq(flowTasks.status, 'RUNNING')),
      ),
    )
    .returning()

  return updated || null
}
