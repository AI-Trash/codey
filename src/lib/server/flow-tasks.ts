import '@tanstack/react-start/server-only'

import { and, asc, eq, lt, or, sql } from 'drizzle-orm'

import { sanitizeSummaryString } from '../../../packages/cli/src/utils/redaction'
import { getDb } from './db/client'
import {
  cliConnections,
  flowTaskEvents,
  flowTasks,
  type CliConnectionRow,
  type FlowTaskEventType,
  type FlowTaskRow,
  type FlowTaskStatus,
} from './db/schema'
import { createId } from './security'
import { recordWorkspaceTeamTrialPaypalUrlFromFlowTask } from './workspaces'

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

function normalizeTaskText(value: string | null | undefined): string | null {
  const normalized = normalizeWorkerId(value)
  return normalized ? sanitizeSummaryString(normalized) : null
}

async function appendFlowTaskEvent(input: {
  taskId: string
  cliConnectionId?: string | null
  type: FlowTaskEventType
  status?: FlowTaskStatus | null
  message?: string | null
  payload?: Record<string, unknown> | null
}) {
  await getDb().insert(flowTaskEvents).values({
    id: createId(),
    taskId: input.taskId,
    cliConnectionId: normalizeWorkerId(input.cliConnectionId),
    type: input.type,
    status: input.status || null,
    message: normalizeTaskText(input.message),
    payload: input.payload || null,
  })
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
        lastMessage: 'Task claimed by CLI',
        lastError: null,
        updatedAt: now,
      })
      .where(and(eq(flowTasks.id, candidate.id), buildClaimableTaskFilter({ workerId, now })))
      .returning()

    if (claimed) {
      await appendFlowTaskEvent({
        taskId: claimed.id,
        cliConnectionId: connection.id,
        type: 'LEASED',
        status: 'LEASED',
        message: 'Task claimed by CLI',
      })
      return claimed
    }
  }

  return null
}

export async function refreshFlowTaskLease(input: {
  connectionId: string
  taskId: string
  status: ActiveFlowTaskStatus
  message?: string | null
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
  const normalizedMessage = normalizeTaskText(input.message)
  const current = await getDb().query.flowTasks.findFirst({
    where: eq(flowTasks.id, input.taskId),
  })
  const patch =
    input.status === 'RUNNING'
      ? {
          status: input.status,
          cliConnectionId: connection.id,
          leaseExpiresAt,
          startedAt: sql`coalesce(${flowTasks.startedAt}, ${now.toISOString()}::timestamptz)`,
          ...(normalizedMessage !== null
            ? { lastMessage: normalizedMessage }
            : {}),
          updatedAt: now,
        }
      : {
          status: input.status,
          cliConnectionId: connection.id,
          leaseExpiresAt,
          ...(normalizedMessage !== null
            ? { lastMessage: normalizedMessage }
            : {}),
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

  if (!updated) {
    return null
  }

  if (input.status === 'LEASED' && current?.status !== 'LEASED') {
    await appendFlowTaskEvent({
      taskId: updated.id,
      cliConnectionId: connection.id,
      type: 'LEASED',
      status: 'LEASED',
      message: normalizedMessage || 'Task claimed by CLI',
    })
  } else if (input.status === 'RUNNING' && current?.status !== 'RUNNING') {
    await appendFlowTaskEvent({
      taskId: updated.id,
      cliConnectionId: connection.id,
      type: 'RUNNING',
      status: 'RUNNING',
      message: normalizedMessage || current?.lastMessage || 'Task started',
    })
  } else if (
    normalizedMessage &&
    normalizedMessage !== normalizeTaskText(current?.lastMessage)
  ) {
    await appendFlowTaskEvent({
      taskId: updated.id,
      cliConnectionId: connection.id,
      type: 'LOG',
      status: updated.status,
      message: normalizedMessage,
    })
  }

  return updated
}

export async function completeFlowTask(input: {
  connectionId: string
  taskId: string
  status: FinalFlowTaskStatus
  error?: string | null
  message?: string | null
  result?: Record<string, unknown> | null
}): Promise<FlowTaskRow | null> {
  const connection = await getCliConnectionRow(input.connectionId)
  if (!connection) {
    throw new Error('CLI connection not found.')
  }

  const now = new Date()
  const workerId = getCliConnectionTaskWorkerId(connection)
  const normalizedError = normalizeTaskText(input.error)
  const normalizedMessage = normalizeTaskText(input.message)

  const [updated] = await getDb()
    .update(flowTasks)
    .set({
      status: input.status,
      cliConnectionId: connection.id,
      leaseExpiresAt: null,
      completedAt: now,
      lastMessage: normalizedMessage || normalizedError,
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

  if (!updated) {
    return null
  }

  await appendFlowTaskEvent({
    taskId: updated.id,
    cliConnectionId: connection.id,
    type: input.status,
    status: input.status,
    message:
      normalizedMessage ||
      normalizedError ||
      (input.status === 'SUCCEEDED'
        ? 'Flow completed'
        : input.status === 'CANCELED'
          ? 'Flow canceled'
          : 'Flow failed'),
    ...(input.result ? { payload: { result: input.result } } : {}),
  })

  if (input.status === 'SUCCEEDED' && input.result) {
    try {
      await recordWorkspaceTeamTrialPaypalUrlFromFlowTask({
        payload: updated.payload,
        result: input.result,
        capturedAt: now,
      })
    } catch (error) {
      console.error('Unable to persist flow task completion result', error)
    }
  }

  return updated
}
