import '@tanstack/react-start/server-only'

import { desc, eq, inArray, or } from 'drizzle-orm'

import type {
  CliFlowTaskBatchMetadata,
} from '../../../packages/cli/src/modules/flow-cli/flow-registry'
import { normalizeCliFlowTaskPayload } from '../../../packages/cli/src/modules/flow-cli/flow-registry'
import { redactForOutput } from '../../../packages/cli/src/utils/redaction'
import {
  listRecentVisibleCliConnectionsForActor,
  type AdminCliConnectionSummary,
  type CliConnectionActorScope,
} from './cli-connections'
import { getDb } from './db/client'
import {
  flowTaskEvents,
  flowTasks,
  type FlowTaskRow,
} from './db/schema'

type FlowRunConnectionSummary = {
  id: string
  cliName: string | null
  userLabel: string
  target: string | null
  status: 'active' | 'offline'
  authClientId: string | null
  connectionPath: string
  runtimeTaskId: string | null
  runtimeFlowId: string | null
  runtimeFlowStatus: string | null
  runtimeFlowMessage: string | null
  runtimeFlowUpdatedAt: string | null
}

export type AdminFlowTaskSummary = {
  id: string
  title: string
  body: string
  flowType: string
  target: string | null
  workerId: string
  cliConnectionId: string | null
  status: string
  attemptCount: number
  lastMessage: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
  leaseClaimedAt: string | null
  leaseExpiresAt: string | null
  startedAt: string | null
  completedAt: string | null
  batch: CliFlowTaskBatchMetadata | null
  config: Record<string, unknown>
  externalServices: Record<string, unknown> | null
  connection: FlowRunConnectionSummary | null
  isLive: boolean
}

export type AdminFlowTaskEventSummary = {
  id: string
  type: string
  status: string | null
  message: string | null
  createdAt: string
  connection: FlowRunConnectionSummary | null
}

export type AdminFlowTaskDetail = AdminFlowTaskSummary & {
  events: AdminFlowTaskEventSummary[]
}

export type AdminFlowRunSnapshot = {
  snapshotAt: string
  tasks: AdminFlowTaskSummary[]
  selectedTask: AdminFlowTaskDetail | null
}

export type ClearAdminFlowRunsResult = {
  deletedCount: number
  preservedCount: number
  totalVisibleCount: number
}

export type ClearAdminFlowRunsMode = 'completed' | 'all'

const CLEARABLE_FLOW_TASK_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELED'])

type VisibleConnectionMaps = {
  connections: AdminCliConnectionSummary[]
  byId: Map<string, FlowRunConnectionSummary>
  byWorkerId: Map<string, FlowRunConnectionSummary>
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized || null
}

function mapConnectionSummary(
  connection: AdminCliConnectionSummary,
): FlowRunConnectionSummary {
  return {
    id: connection.id,
    cliName: connection.cliName,
    userLabel: connection.userLabel,
    target: connection.target,
    status: connection.status,
    authClientId: connection.authClientId,
    connectionPath: connection.connectionPath,
    runtimeTaskId: connection.runtimeTaskId,
    runtimeFlowId: connection.runtimeFlowId,
    runtimeFlowStatus: connection.runtimeFlowStatus,
    runtimeFlowMessage: connection.runtimeFlowMessage,
    runtimeFlowUpdatedAt: connection.runtimeFlowUpdatedAt,
  }
}

function buildVisibleConnectionMaps(
  connections: AdminCliConnectionSummary[],
): VisibleConnectionMaps {
  const byId = new Map<string, FlowRunConnectionSummary>()
  const byWorkerId = new Map<string, FlowRunConnectionSummary>()

  for (const connection of connections) {
    const summary = mapConnectionSummary(connection)
    byId.set(summary.id, summary)
    byWorkerId.set(connection.workerId || connection.id, summary)
  }

  return {
    connections,
    byId,
    byWorkerId,
  }
}

function getTaskConnection(
  task: Pick<FlowTaskRow, 'cliConnectionId' | 'workerId' | 'id'>,
  connections: VisibleConnectionMaps,
) {
  const byConnectionId =
    task.cliConnectionId && connections.byId.get(task.cliConnectionId)
  if (byConnectionId) {
    return byConnectionId
  }

  return connections.byWorkerId.get(task.workerId) || null
}

function isVisibleTask(
  task: Pick<FlowTaskRow, 'cliConnectionId' | 'workerId'>,
  connections: VisibleConnectionMaps,
) {
  return Boolean(
    (task.cliConnectionId && connections.byId.has(task.cliConnectionId)) ||
      connections.byWorkerId.has(task.workerId),
  )
}

function getSanitizedTaskPayload(
  payload: Record<string, unknown> | null | undefined,
): {
  batch: CliFlowTaskBatchMetadata | null
  config: Record<string, unknown>
  externalServices: Record<string, unknown> | null
} {
  const normalized = normalizeCliFlowTaskPayload(payload)

  return {
    batch: normalized?.batch || null,
    config: redactForOutput<Record<string, unknown>>(normalized?.config || {}),
    externalServices: normalized?.externalServices
      ? redactForOutput<Record<string, unknown>>(normalized.externalServices)
      : null,
  }
}

function mapTaskSummary(
  task: FlowTaskRow,
  connections: VisibleConnectionMaps,
): AdminFlowTaskSummary {
  const connection = getTaskConnection(task, connections)
  const payload = getSanitizedTaskPayload(task.payload)

  return {
    id: task.id,
    title: task.title,
    body: task.body,
    flowType: task.flowType,
    target: task.target || null,
    workerId: task.workerId,
    cliConnectionId: task.cliConnectionId || null,
    status: task.status,
    attemptCount: task.attemptCount,
    lastMessage: task.lastMessage || null,
    lastError: task.lastError || null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    leaseClaimedAt: task.leaseClaimedAt?.toISOString() || null,
    leaseExpiresAt: task.leaseExpiresAt?.toISOString() || null,
    startedAt: task.startedAt?.toISOString() || null,
    completedAt: task.completedAt?.toISOString() || null,
    batch: payload.batch,
    config: payload.config,
    externalServices: payload.externalServices,
    connection,
    isLive: connection?.runtimeTaskId === task.id,
  }
}

async function getVisibleConnections(actor: CliConnectionActorScope) {
  const connections = await listRecentVisibleCliConnectionsForActor(actor, {
    limit: 200,
  })

  return buildVisibleConnectionMaps(connections)
}

export async function getAdminFlowTaskDetailForActor(input: {
  actor: CliConnectionActorScope
  taskId: string
  visibleConnections?: AdminCliConnectionSummary[]
}): Promise<AdminFlowTaskDetail | null> {
  const taskId = normalizeOptionalText(input.taskId)
  if (!taskId) {
    return null
  }

  const visibleConnections = input.visibleConnections
    ? buildVisibleConnectionMaps(input.visibleConnections)
    : await getVisibleConnections(input.actor)
  const task = await getDb().query.flowTasks.findFirst({
    where: eq(flowTasks.id, taskId),
  })

  if (!task || !isVisibleTask(task, visibleConnections)) {
    return null
  }

  const summary = mapTaskSummary(task, visibleConnections)
  const eventRows = await getDb().query.flowTaskEvents.findMany({
    where: eq(flowTaskEvents.taskId, taskId),
    orderBy: [desc(flowTaskEvents.createdAt)],
    limit: 200,
  })

  return {
    ...summary,
    events: eventRows.reverse().map((event) => ({
      id: event.id,
      type: event.type,
      status: event.status || null,
      message: event.message || null,
      createdAt: event.createdAt.toISOString(),
      connection:
        (event.cliConnectionId && visibleConnections.byId.get(event.cliConnectionId)) ||
        summary.connection,
    })),
  }
}

export async function getAdminFlowRunSnapshotForActor(input: {
  actor: CliConnectionActorScope
  taskId?: string | null
}): Promise<AdminFlowRunSnapshot> {
  const visibleConnections = await listRecentVisibleCliConnectionsForActor(
    input.actor,
    {
      limit: 200,
    },
  )
  const connectionMaps = buildVisibleConnectionMaps(visibleConnections)
  const taskRows = await getDb().query.flowTasks.findMany({
    orderBy: [desc(flowTasks.createdAt)],
    limit: 200,
  })
  const tasks = taskRows
    .filter((task) => isVisibleTask(task, connectionMaps))
    .map((task) => mapTaskSummary(task, connectionMaps))
  const selectedTaskId = normalizeOptionalText(input.taskId)

  return {
    snapshotAt: new Date().toISOString(),
    tasks,
    selectedTask: selectedTaskId
      ? await getAdminFlowTaskDetailForActor({
          actor: input.actor,
          taskId: selectedTaskId,
          visibleConnections,
        })
      : null,
  }
}

export async function clearAdminFlowRunsForActor(input: {
  actor: CliConnectionActorScope
  mode?: ClearAdminFlowRunsMode
}): Promise<ClearAdminFlowRunsResult> {
  const mode = input.mode || 'completed'
  const visibleConnections = await getVisibleConnections(input.actor)
  const visibleConnectionIds = Array.from(visibleConnections.byId.keys())
  const visibleWorkerIds = Array.from(visibleConnections.byWorkerId.keys())
  const connectionFilter = visibleConnectionIds.length
    ? inArray(flowTasks.cliConnectionId, visibleConnectionIds)
    : null
  const workerFilter = visibleWorkerIds.length
    ? inArray(flowTasks.workerId, visibleWorkerIds)
    : null
  const where =
    connectionFilter && workerFilter
      ? or(connectionFilter, workerFilter)
      : connectionFilter || workerFilter

  if (!where) {
    return {
      deletedCount: 0,
      preservedCount: 0,
      totalVisibleCount: 0,
    }
  }

  const visibleTasks = await getDb().query.flowTasks.findMany({
    where,
  })
  const deletableTaskIds =
    mode === 'all'
      ? visibleTasks.map((task) => task.id)
      : visibleTasks
          .filter((task) => CLEARABLE_FLOW_TASK_STATUSES.has(task.status))
          .map((task) => task.id)

  if (!deletableTaskIds.length) {
    return {
      deletedCount: 0,
      preservedCount: visibleTasks.length,
      totalVisibleCount: visibleTasks.length,
    }
  }

  const deletedTasks = await getDb()
    .delete(flowTasks)
    .where(inArray(flowTasks.id, deletableTaskIds))
    .returning()

  return {
    deletedCount: deletedTasks.length,
    preservedCount: Math.max(visibleTasks.length - deletedTasks.length, 0),
    totalVisibleCount: visibleTasks.length,
  }
}
