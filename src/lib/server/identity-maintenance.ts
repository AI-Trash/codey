import '@tanstack/react-start/server-only'

import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'

import { createCliFlowTaskPayload } from '../../../packages/cli/src/modules/flow-cli/flow-registry'
import {
  listAdminCliConnectionState,
  type AdminCliConnectionSummary,
} from './cli-connections'
import { getDb } from './db/client'
import {
  flowTaskEvents,
  flowTasks,
  identityMaintenanceRuns,
  managedIdentities,
  managedWorkspaces,
  type FlowTaskRow,
  type FlowTaskStatus,
} from './db/schema'
import { getAppEnv } from './env'
import { createId } from './security'

const IDENTITY_MAINTENANCE_KIND = 'identity-maintenance'
const ACTIVE_FLOW_TASK_STATUSES: FlowTaskStatus[] = [
  'QUEUED',
  'LEASED',
  'RUNNING',
]
const ACTIVE_BROWSER_FLOW_TASK_STATUSES: FlowTaskStatus[] = [
  'LEASED',
  'RUNNING',
]
const FINAL_FLOW_TASK_STATUSES = new Set<FlowTaskStatus>([
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
])

type MaintenanceDispatchTarget = {
  connection: AdminCliConnectionSummary
  workerId: string
  assignedTaskCount: number
  capacity: number
}

type MaintenanceCandidateIdentity = {
  identityId: string
  email: string
}

type MaintenanceTaskTarget = {
  workerId: string
  browserLimit: number
}

let schedulerRunning = false
let lastSchedulerRunAt = 0

function normalizeWorkerId(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized || null
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function getConnectionWorkerId(connection: {
  id: string
  workerId?: string | null
}) {
  return normalizeWorkerId(connection.workerId) || connection.id
}

function identityMaintenanceKindExpr() {
  return sql<
    string | null
  >`${flowTasks.payload} #>> '{metadata,identityMaintenance,kind}'`
}

export function identityMaintenanceTaskFilter(): SQL {
  return sql`${identityMaintenanceKindExpr()} = ${IDENTITY_MAINTENANCE_KIND}`
}

export function nonIdentityMaintenanceTaskFilter(): SQL {
  return sql`coalesce(${identityMaintenanceKindExpr()}, '') <> ${IDENTITY_MAINTENANCE_KIND}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readIdentityMaintenanceMetadata(payload: unknown): {
  runId?: string
  identityId?: string
  email?: string
} | null {
  if (!isRecord(payload)) {
    return null
  }

  const metadata = isRecord(payload.metadata) ? payload.metadata : null
  const maintenance =
    metadata && isRecord(metadata.identityMaintenance)
      ? metadata.identityMaintenance
      : null

  if (maintenance?.kind !== IDENTITY_MAINTENANCE_KIND) {
    return null
  }

  return {
    runId:
      typeof maintenance.runId === 'string' && maintenance.runId.trim()
        ? maintenance.runId.trim()
        : undefined,
    identityId:
      typeof maintenance.identityId === 'string' &&
      maintenance.identityId.trim()
        ? maintenance.identityId.trim()
        : undefined,
    email:
      typeof maintenance.email === 'string' && maintenance.email.trim()
        ? normalizeEmail(maintenance.email)
        : undefined,
  }
}

export function isIdentityMaintenanceFlowTask(
  task: Pick<FlowTaskRow, 'payload'>,
): boolean {
  return Boolean(readIdentityMaintenanceMetadata(task.payload))
}

async function appendMaintenanceTaskEvents(input: {
  tasks: FlowTaskRow[]
  type: 'QUEUED' | 'CANCELED'
  status: FlowTaskStatus
  message: string
  now: Date
}) {
  if (!input.tasks.length) {
    return
  }

  await getDb()
    .insert(flowTaskEvents)
    .values(
      input.tasks.map((task) => ({
        id: createId(),
        taskId: task.id,
        cliConnectionId: task.cliConnectionId || null,
        type: input.type,
        status: input.status,
        message: input.message,
        createdAt: input.now,
      })),
    )
}

async function countAssignedTasks(workerId: string): Promise<number> {
  const [row] = await getDb()
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(flowTasks)
    .where(
      and(
        eq(flowTasks.workerId, workerId),
        inArray(flowTasks.status, ACTIVE_FLOW_TASK_STATUSES),
      ),
    )

  return row?.count || 0
}

async function countActiveBrowserTasks(workerId: string): Promise<number> {
  const [row] = await getDb()
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(flowTasks)
    .where(
      and(
        eq(flowTasks.workerId, workerId),
        inArray(flowTasks.status, ACTIVE_BROWSER_FLOW_TASK_STATUSES),
      ),
    )

  return row?.count || 0
}

async function listMaintenanceDispatchTargets(): Promise<
  MaintenanceDispatchTarget[]
> {
  const env = getAppEnv()
  const state = await listAdminCliConnectionState()
  const targets: MaintenanceDispatchTarget[] = []

  for (const connection of state.activeConnections) {
    if (
      connection.status !== 'active' ||
      !connection.registeredFlows.includes('chatgpt-login')
    ) {
      continue
    }

    const workerId = getConnectionWorkerId(connection)
    const assignedTaskCount = await countAssignedTasks(workerId)
    if (assignedTaskCount > env.identityMaintenanceMaxAssignedTasksPerCli) {
      continue
    }

    const availableSlots =
      connection.browserLimit -
      assignedTaskCount -
      env.identityMaintenanceMinIdleBrowserSlots
    const capacity = Math.min(
      env.identityMaintenanceMaxTasksPerCli,
      Math.max(availableSlots, 0),
    )

    if (capacity < 1) {
      continue
    }

    targets.push({
      connection,
      workerId,
      assignedTaskCount,
      capacity,
    })
  }

  return targets.sort((left, right) => {
    const assignedDelta = left.assignedTaskCount - right.assignedTaskCount
    if (assignedDelta) {
      return assignedDelta
    }

    const capacityDelta = right.capacity - left.capacity
    if (capacityDelta) {
      return capacityDelta
    }

    return (
      new Date(right.connection.lastSeenAt).getTime() -
      new Date(left.connection.lastSeenAt).getTime()
    )
  })
}

async function listExcludedIdentityIds(cutoff: Date): Promise<Set<string>> {
  const [ownerRows, maintenanceRows] = await Promise.all([
    getDb().query.managedWorkspaces.findMany({
      where: isNotNull(managedWorkspaces.ownerIdentityId),
      columns: {
        ownerIdentityId: true,
      },
    }),
    getDb().query.identityMaintenanceRuns.findMany({
      where: or(
        inArray(identityMaintenanceRuns.status, ACTIVE_FLOW_TASK_STATUSES),
        gt(identityMaintenanceRuns.createdAt, cutoff),
      ),
      columns: {
        identityId: true,
      },
    }),
  ])

  return new Set(
    [...ownerRows, ...maintenanceRows]
      .map((row) => row.identityId?.trim())
      .filter((identityId): identityId is string => Boolean(identityId)),
  )
}

async function listCandidateIdentities(input: {
  excludedIdentityIds: Set<string>
  limit: number
}): Promise<MaintenanceCandidateIdentity[]> {
  const excludedIdentityIds = [...input.excludedIdentityIds]
  const rows = await getDb().query.managedIdentities.findMany({
    where: and(
      eq(managedIdentities.status, 'ACTIVE'),
      isNotNull(managedIdentities.passwordCiphertext),
      ne(managedIdentities.email, ''),
      ...(excludedIdentityIds.length
        ? [notInArray(managedIdentities.identityId, excludedIdentityIds)]
        : []),
    ),
    columns: {
      identityId: true,
      email: true,
    },
    orderBy: [asc(managedIdentities.lastSeenAt), asc(managedIdentities.email)],
    limit: input.limit,
  })

  return rows.map((row) => ({
    identityId: row.identityId,
    email: normalizeEmail(row.email),
  }))
}

function buildMaintenanceTask(input: {
  runId: string
  taskId: string
  identity: MaintenanceCandidateIdentity
  target: MaintenanceDispatchTarget
}) {
  const label = input.identity.email || input.identity.identityId
  const body = `Maintain ChatGPT identity availability for ${label}.`

  return {
    id: input.taskId,
    workerId: input.target.workerId,
    title: `Maintain identity - ${label}`,
    body,
    flowType: 'chatgpt-login',
    target: input.target.connection.target,
    lastMessage: body,
    payload: createCliFlowTaskPayload(
      'chatgpt-login',
      {
        identityId: input.identity.identityId,
        email: input.identity.email,
        restoreStorageState: true,
      },
      undefined,
      undefined,
      {
        identityMaintenance: {
          kind: IDENTITY_MAINTENANCE_KIND,
          runId: input.runId,
          identityId: input.identity.identityId,
          email: input.identity.email,
        },
      },
    ),
  }
}

async function insertMaintenanceTasks(
  assignments: Array<{
    runId: string
    taskId: string
    identity: MaintenanceCandidateIdentity
    target: MaintenanceDispatchTarget
  }>,
) {
  if (!assignments.length) {
    return []
  }

  const now = new Date()
  const taskRows = assignments.map((assignment) =>
    buildMaintenanceTask(assignment),
  )

  return getDb().transaction(async (tx) => {
    const insertedTasks = await tx
      .insert(flowTasks)
      .values(taskRows)
      .returning()

    if (insertedTasks.length) {
      await tx.insert(flowTaskEvents).values(
        insertedTasks.map((task) => ({
          id: createId(),
          taskId: task.id,
          type: 'QUEUED' as const,
          status: 'QUEUED' as const,
          message: task.body,
          createdAt: now,
        })),
      )
    }

    await tx.insert(identityMaintenanceRuns).values(
      assignments.map((assignment) => ({
        id: assignment.runId,
        identityId: assignment.identity.identityId,
        email: assignment.identity.email,
        flowTaskId: assignment.taskId,
        cliConnectionId: assignment.target.connection.id,
        workerId: assignment.target.workerId,
        status: 'QUEUED' as const,
        lastMessage: `Queued identity maintenance for ${assignment.identity.email}.`,
        createdAt: now,
        updatedAt: now,
      })),
    )

    return insertedTasks
  })
}

export async function runIdentityMaintenanceScheduler(): Promise<{
  queuedCount: number
}> {
  const env = getAppEnv()
  if (!env.identityMaintenanceEnabled) {
    return { queuedCount: 0 }
  }

  const nowMs = Date.now()
  if (
    schedulerRunning ||
    nowMs - lastSchedulerRunAt < env.identityMaintenanceSchedulerIntervalMs
  ) {
    return { queuedCount: 0 }
  }

  schedulerRunning = true
  lastSchedulerRunAt = nowMs

  try {
    const targets = await listMaintenanceDispatchTargets()
    if (!targets.length) {
      return { queuedCount: 0 }
    }

    const cutoff = new Date(nowMs - env.identityMaintenanceMinIntervalMs)
    const excludedIdentityIds = await listExcludedIdentityIds(cutoff)
    const candidates = await listCandidateIdentities({
      excludedIdentityIds,
      limit: env.identityMaintenanceMaxTasksPerTick,
    })
    const assignments: Array<{
      runId: string
      taskId: string
      identity: MaintenanceCandidateIdentity
      target: MaintenanceDispatchTarget
    }> = []

    for (const target of targets) {
      while (
        target.capacity > 0 &&
        assignments.length < env.identityMaintenanceMaxTasksPerTick &&
        candidates.length
      ) {
        const identity = candidates.shift()
        if (!identity || excludedIdentityIds.has(identity.identityId)) {
          continue
        }

        assignments.push({
          runId: createId(),
          taskId: createId(),
          identity,
          target,
        })
        excludedIdentityIds.add(identity.identityId)
        target.capacity -= 1
      }

      if (assignments.length >= env.identityMaintenanceMaxTasksPerTick) {
        break
      }
    }

    const tasks = await insertMaintenanceTasks(assignments)
    return { queuedCount: tasks.length }
  } finally {
    schedulerRunning = false
  }
}

async function cancelMaintenanceTasks(input: {
  tasks: FlowTaskRow[]
  reason: string
}): Promise<string[]> {
  const taskIds = Array.from(new Set(input.tasks.map((task) => task.id)))
  if (!taskIds.length) {
    return []
  }

  const now = new Date()
  const updatedTasks = await getDb()
    .update(flowTasks)
    .set({
      status: 'CANCELED',
      leaseExpiresAt: null,
      completedAt: now,
      lastMessage: input.reason,
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        inArray(flowTasks.id, taskIds),
        inArray(flowTasks.status, ACTIVE_FLOW_TASK_STATUSES),
        identityMaintenanceTaskFilter(),
      ),
    )
    .returning()

  if (!updatedTasks.length) {
    return []
  }

  await appendMaintenanceTaskEvents({
    tasks: updatedTasks,
    type: 'CANCELED',
    status: 'CANCELED',
    message: input.reason,
    now,
  })

  await getDb()
    .update(identityMaintenanceRuns)
    .set({
      status: 'CANCELED',
      lastMessage: input.reason,
      lastError: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(
      inArray(
        identityMaintenanceRuns.flowTaskId,
        updatedTasks.map((task) => task.id),
      ),
    )

  return updatedTasks.map((task) => task.id)
}

export async function cancelIdentityMaintenanceTasksByIds(input: {
  taskIds: string[]
  reason: string
}): Promise<string[]> {
  const taskIds = Array.from(
    new Set(input.taskIds.map((taskId) => taskId.trim()).filter(Boolean)),
  )
  if (!taskIds.length) {
    return []
  }

  const tasks = await getDb().query.flowTasks.findMany({
    where: and(
      inArray(flowTasks.id, taskIds),
      inArray(flowTasks.status, ACTIVE_FLOW_TASK_STATUSES),
      identityMaintenanceTaskFilter(),
    ),
  })

  return cancelMaintenanceTasks({ tasks, reason: input.reason })
}

export async function cancelQueuedIdentityMaintenanceTasksForWorkers(input: {
  workerIds: string[]
  reason: string
}): Promise<string[]> {
  const workerIds = Array.from(
    new Set(input.workerIds.map((workerId) => workerId.trim()).filter(Boolean)),
  )
  if (!workerIds.length) {
    return []
  }

  const tasks = await getDb().query.flowTasks.findMany({
    where: and(
      inArray(flowTasks.workerId, workerIds),
      eq(flowTasks.status, 'QUEUED'),
      identityMaintenanceTaskFilter(),
    ),
  })

  return cancelMaintenanceTasks({ tasks, reason: input.reason })
}

export async function cancelBlockingIdentityMaintenanceTasksForWorker(input: {
  workerId: string
  browserLimit: number
  reason: string
}): Promise<string[]> {
  const workerId = input.workerId.trim()
  if (!workerId || input.browserLimit < 1) {
    return []
  }

  const activeTaskCount = await countActiveBrowserTasks(workerId)
  if (activeTaskCount < input.browserLimit) {
    return []
  }

  const tasks = await getDb().query.flowTasks.findMany({
    where: and(
      eq(flowTasks.workerId, workerId),
      inArray(flowTasks.status, ACTIVE_BROWSER_FLOW_TASK_STATUSES),
      identityMaintenanceTaskFilter(),
    ),
    orderBy: [asc(flowTasks.startedAt), asc(flowTasks.createdAt)],
  })

  return cancelMaintenanceTasks({ tasks, reason: input.reason })
}

export async function cancelIdentityMaintenanceForNormalDispatch(
  targets: MaintenanceTaskTarget[],
): Promise<string[]> {
  const normalizedTargets = Array.from(
    new Map(
      targets
        .map((target) => ({
          workerId: target.workerId.trim(),
          browserLimit: target.browserLimit,
        }))
        .filter((target) => target.workerId && target.browserLimit > 0)
        .map((target) => [target.workerId, target]),
    ).values(),
  )

  if (!normalizedTargets.length) {
    return []
  }

  const canceledTaskIds = new Set<string>()
  const reason =
    'Identity maintenance canceled because normal flow work needs browser capacity.'
  const queuedCanceled = await cancelQueuedIdentityMaintenanceTasksForWorkers({
    workerIds: normalizedTargets.map((target) => target.workerId),
    reason,
  })
  for (const taskId of queuedCanceled) {
    canceledTaskIds.add(taskId)
  }

  for (const target of normalizedTargets) {
    const activeCanceled =
      await cancelBlockingIdentityMaintenanceTasksForWorker({
        workerId: target.workerId,
        browserLimit: target.browserLimit,
        reason,
      })
    for (const taskId of activeCanceled) {
      canceledTaskIds.add(taskId)
    }
  }

  return [...canceledTaskIds]
}

export async function syncIdentityMaintenanceRunFromFlowTask(input: {
  task: FlowTaskRow
  status: FlowTaskStatus
  message?: string | null
  error?: string | null
}): Promise<void> {
  const metadata = readIdentityMaintenanceMetadata(input.task.payload)
  if (!metadata) {
    return
  }

  const now = new Date()
  const completedAt = FINAL_FLOW_TASK_STATUSES.has(input.status) ? now : null
  const patch = {
    status: input.status,
    cliConnectionId: input.task.cliConnectionId || null,
    workerId: input.task.workerId,
    lastMessage: input.message || input.task.lastMessage || null,
    lastError: input.error || input.task.lastError || null,
    updatedAt: now,
    ...(completedAt ? { completedAt } : {}),
  }
  const runFilter = metadata.runId
    ? eq(identityMaintenanceRuns.id, metadata.runId)
    : eq(identityMaintenanceRuns.flowTaskId, input.task.id)

  await getDb().update(identityMaintenanceRuns).set(patch).where(runFilter)
}
