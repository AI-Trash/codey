import '@tanstack/react-start/server-only'

import {
  createCliFlowTaskPayload,
  type CliFlowCommandId,
  type CliFlowTaskMetadata,
  getCliFlowDefinition,
  MAX_CLI_FLOW_TASK_BATCH_SIZE,
  normalizeCliFlowConfig,
} from '../../../packages/cli/src/modules/flow-cli/flow-registry'
import {
  type AdminCliConnectionSummary,
  getAdminCliConnectionSummaryById,
  listAdminCliConnectionState,
  listAdminCliConnectionStateForActor,
  type CliConnectionActorScope,
  isCliConnectionOwnedByActor,
  isSharedCliConnection,
} from './cli-connections'
import { getDb } from './db/client'
import { flowTaskEvents, flowTasks } from './db/schema'
import { getCliConnectionTaskWorkerId } from './flow-tasks'
import { createId } from './security'

export { MAX_CLI_FLOW_TASK_BATCH_SIZE }

interface CliDispatchTarget {
  connection: AdminCliConnectionSummary
  workerId: string
}

function buildTaskTitle(input: {
  flowId: string
  sequence: number
  total: number
  email?: string | null
}) {
  const emailSuffix = input.email?.trim() ? ` - ${input.email.trim()}` : ''

  if (input.total <= 1) {
    return `Dispatch ${input.flowId}${emailSuffix}`
  }

  return `Dispatch ${input.flowId} (${input.sequence}/${input.total})${emailSuffix}`
}

function buildTaskBody(input: {
  flowId: string
  cliName?: string | null
  configCount: number
  sequence: number
  total: number
  email?: string | null
}) {
  const target = input.cliName?.trim() || 'CLI'
  const configLabel = input.configCount === 1 ? 'override' : 'overrides'
  const emailDetail = input.email?.trim()
    ? ` Target email ${input.email.trim()}.`
    : ''
  const base = `Run ${input.flowId} on ${target} with ${input.configCount} ${configLabel}.${emailDetail}`

  if (input.total <= 1) {
    return base
  }

  return `${base} Batch item ${input.sequence} of ${input.total}.`
}

function resolveRequestedTaskCount(input: {
  count?: number | null
  maxTaskCount?: number | null
}) {
  if (input.count == null) {
    return 1
  }

  if (!Number.isInteger(input.count) || input.count < 1) {
    throw new Error('Task count must be a whole number greater than 0.')
  }

  if (input.maxTaskCount && input.count > input.maxTaskCount) {
    throw new Error(`Task count cannot exceed ${input.maxTaskCount}.`)
  }

  return input.count
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeEmailKey(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  return normalized || undefined
}

function normalizeIdentityKey(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function getConfigAffinity(input: Record<string, unknown> | null | undefined): {
  identityId?: string
  email?: string
} {
  return {
    identityId: normalizeIdentityKey(input?.identityId),
    email: normalizeEmailKey(input?.email),
  }
}

function connectionHasStorageStateAffinity(
  connection: Pick<
    AdminCliConnectionSummary,
    'storageStateIdentityIds' | 'storageStateEmails'
  >,
  affinity: {
    identityId?: string
    email?: string
  },
) {
  return Boolean(
    (affinity.identityId &&
      connection.storageStateIdentityIds.includes(affinity.identityId)) ||
    (affinity.email && connection.storageStateEmails.includes(affinity.email)),
  )
}

function connectionStorageStateAffinityScore(
  connection: Pick<
    AdminCliConnectionSummary,
    'storageStateIdentityIds' | 'storageStateEmails'
  >,
  affinities: Array<{
    identityId?: string
    email?: string
  }>,
) {
  return affinities.reduce(
    (score, affinity) =>
      score + Number(connectionHasStorageStateAffinity(connection, affinity)),
    0,
  )
}

function isConnectionBusy(
  connection: Pick<
    AdminCliConnectionSummary,
    'runtimeFlowId' | 'runtimeFlowCompletedAt' | 'runtimeFlowStatus'
  >,
) {
  return Boolean(
    connection.runtimeFlowId &&
    !connection.runtimeFlowCompletedAt &&
    connection.runtimeFlowStatus !== 'completed',
  )
}

function compareDispatchConnections(
  left: AdminCliConnectionSummary,
  right: AdminCliConnectionSummary,
  preferredConnectionId: string,
  affinities: Array<{
    identityId?: string
    email?: string
  }> = [],
) {
  const affinityDelta =
    connectionStorageStateAffinityScore(right, affinities) -
    connectionStorageStateAffinityScore(left, affinities)
  if (affinityDelta) {
    return affinityDelta
  }

  const preferredDelta =
    Number(right.id === preferredConnectionId) -
    Number(left.id === preferredConnectionId)
  if (preferredDelta) {
    return preferredDelta
  }

  const sharedDelta =
    Number(isSharedCliConnection(right)) - Number(isSharedCliConnection(left))
  if (sharedDelta) {
    return sharedDelta
  }

  const busyDelta =
    Number(isConnectionBusy(left)) - Number(isConnectionBusy(right))
  if (busyDelta) {
    return busyDelta
  }

  const lastSeenDelta =
    new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime()
  if (lastSeenDelta) {
    return lastSeenDelta
  }

  return left.id.localeCompare(right.id)
}

function buildCliDispatchTargets(input: {
  connection: AdminCliConnectionSummary
  eligibleConnections: AdminCliConnectionSummary[]
  count: number
  configs: Array<Record<string, unknown>>
}): CliDispatchTarget[] {
  const uniqueTargets = new Map<string, AdminCliConnectionSummary>()
  const dispatchAffinities = input.configs
    .map((config) => getConfigAffinity(config))
    .filter((affinity) => affinity.identityId || affinity.email)
  const sortedConnections = [...input.eligibleConnections].sort((left, right) =>
    compareDispatchConnections(
      left,
      right,
      input.connection.id,
      dispatchAffinities,
    ),
  )

  for (const connection of sortedConnections) {
    const workerId = getCliConnectionTaskWorkerId(connection)
    if (!uniqueTargets.has(workerId)) {
      uniqueTargets.set(workerId, connection)
    }
  }

  const selectedTargets = [...uniqueTargets.entries()]
    .slice(0, Math.max(1, Math.min(input.count, uniqueTargets.size)))
    .map(([workerId, connection]) => ({
      connection,
      workerId,
    }))

  if (selectedTargets.length <= 1) {
    const [singleTarget] = selectedTargets
    if (!singleTarget) {
      throw new Error('No eligible CLI worker is available for dispatch.')
    }

    return [singleTarget]
  }

  return selectedTargets
}

function selectDispatchTargetForConfig(input: {
  dispatchTargets: CliDispatchTarget[]
  config: Record<string, unknown>
  index: number
}): CliDispatchTarget | undefined {
  const affinity = getConfigAffinity(input.config)
  const affineTargets = input.dispatchTargets.filter((target) =>
    connectionHasStorageStateAffinity(target.connection, affinity),
  )
  const targets = affineTargets.length ? affineTargets : input.dispatchTargets
  return targets[input.index % targets.length]
}

function supportsEmailBatchDispatch(
  flowId: CliFlowCommandId,
): flowId is 'chatgpt-invite' | 'codex-oauth' {
  return flowId === 'chatgpt-invite' || flowId === 'codex-oauth'
}

function inferActorScopeFromConnection(
  connection: AdminCliConnectionSummary,
): CliConnectionActorScope | undefined {
  if (connection.userId) {
    return {
      userId: connection.userId,
      githubLogin: connection.githubLogin,
      email: connection.email,
    }
  }

  if (connection.target) {
    return {
      githubLogin: connection.target,
      email: connection.target,
    }
  }

  return undefined
}

async function listEligibleConnectionsForDispatch(input: {
  connection: AdminCliConnectionSummary
  flowId: string
  actor?: CliConnectionActorScope
}) {
  const actor = input.actor || inferActorScopeFromConnection(input.connection)
  if (actor) {
    return (
      await listAdminCliConnectionStateForActor(actor)
    ).activeConnections.filter(
      (candidate) =>
        candidate.status === 'active' &&
        candidate.registeredFlows.includes(input.flowId),
    )
  }

  if (isSharedCliConnection(input.connection)) {
    return (
      await listAdminCliConnectionState()
    ).activeConnections.filter(
      (candidate) =>
        candidate.status === 'active' &&
        candidate.authClientId === input.connection.authClientId &&
        isSharedCliConnection(candidate) &&
        candidate.registeredFlows.includes(input.flowId),
    )
  }

  return [input.connection]
}

function validateBatchedCliFlowConfigs<
  TFlowId extends CliFlowCommandId,
>(input: {
  flowId: TFlowId
  configs: ReturnType<typeof normalizeCliFlowConfig<TFlowId>>[]
  requestedCount?: number | null
}) {
  if (!supportsEmailBatchDispatch(input.flowId)) {
    return
  }

  if (input.configs.length <= 1) {
    if ((input.requestedCount || 1) > 1) {
      throw new Error(
        'Email batch dispatch requires one unique email address per task.',
      )
    }
    return
  }

  const seenEmails = new Set<string>()
  for (const config of input.configs) {
    if (typeof config.identityId === 'string' && config.identityId.trim()) {
      throw new Error(
        'Email batch dispatch cannot include identityId overrides.',
      )
    }

    const email = normalizeEmailKey(config.email)
    if (!email) {
      throw new Error('Each email batch item must include an email address.')
    }

    if (seenEmails.has(email)) {
      throw new Error(`Duplicate email batch address detected: ${email}.`)
    }

    seenEmails.add(email)
  }
}

function resolveRequestedTaskConfigs<TFlowId extends CliFlowCommandId>(input: {
  flowId: TFlowId
  config?: Record<string, unknown> | null
  configs?: Array<Record<string, unknown>> | null
  count?: number | null
  maxTaskCount?: number | null
}) {
  const requestedConfigs = Array.isArray(input.configs)
    ? input.configs.filter(isRecord)
    : []

  if (!requestedConfigs.length) {
    return [normalizeCliFlowConfig(input.flowId, input.config)]
  }

  if (input.maxTaskCount && requestedConfigs.length > input.maxTaskCount) {
    throw new Error(`Task count cannot exceed ${input.maxTaskCount}.`)
  }

  if (input.count != null && input.count !== requestedConfigs.length) {
    throw new Error('Task count must match the provided config count.')
  }

  const normalizedConfigs = requestedConfigs.map((config) =>
    normalizeCliFlowConfig(input.flowId, config),
  )
  validateBatchedCliFlowConfigs({
    flowId: input.flowId,
    configs: normalizedConfigs,
    requestedCount: input.count,
  })
  return normalizedConfigs
}

async function resolveDispatchableCliFlow(input: {
  connectionId: string
  flowId: string
  actor?: CliConnectionActorScope
}) {
  const connection = await getAdminCliConnectionSummaryById(input.connectionId)
  if (!connection) {
    throw new Error('CLI connection not found.')
  }

  if (
    input.actor &&
    !isCliConnectionOwnedByActor(connection, input.actor) &&
    !isSharedCliConnection(connection)
  ) {
    throw new Error(
      'You can only dispatch tasks to your own CLI connection or a shared service-client connection.',
    )
  }

  if (connection.status !== 'active') {
    throw new Error('CLI connection is no longer active.')
  }

  if (!connection.registeredFlows.length) {
    throw new Error(
      'This CLI has not reported any dispatchable flows yet. Reconnect the daemon and try again.',
    )
  }

  if (!connection.registeredFlows.includes(input.flowId)) {
    throw new Error('The selected flow is not registered on this CLI.')
  }

  const flowDefinition = getCliFlowDefinition(input.flowId)
  if (!flowDefinition) {
    throw new Error('Unsupported flow type.')
  }

  const eligibleConnections = await listEligibleConnectionsForDispatch({
    connection,
    flowId: input.flowId,
    actor: input.actor,
  })

  if (
    !eligibleConnections.some((candidate) => candidate.id === connection.id)
  ) {
    eligibleConnections.unshift(connection)
  }

  return {
    connection,
    eligibleConnections,
    flowDefinition,
  }
}

function resolveCliFlowTaskExternalServices(_flowId?: string) {
  return undefined
}

export async function dispatchCliFlowTasks(input: {
  connectionId: string
  flowId: string
  config?: Record<string, unknown> | null
  configs?: Array<Record<string, unknown>> | null
  count?: number | null
  parallelism?: number | null
  maxTaskCount?: number | null
  actor?: CliConnectionActorScope
  metadata?: CliFlowTaskMetadata
}) {
  const { connection, eligibleConnections, flowDefinition } =
    await resolveDispatchableCliFlow(input)
  const taskConfigs = resolveRequestedTaskConfigs({
    flowId: flowDefinition.id,
    config: input.config,
    configs: input.configs,
    count: input.count,
    maxTaskCount: input.maxTaskCount,
  })
  const count =
    taskConfigs.length > 1
      ? taskConfigs.length
      : resolveRequestedTaskCount({
          count: input.count,
          maxTaskCount: input.maxTaskCount,
        })
  const externalServices = await resolveCliFlowTaskExternalServices(
    flowDefinition.id,
  )
  const batchId = count > 1 ? createId() : undefined
  const queuedConfigs =
    taskConfigs.length > 1
      ? taskConfigs
      : Array.from({ length: count }, () => taskConfigs[0] || {})
  const dispatchTargets = buildCliDispatchTargets({
    connection,
    eligibleConnections,
    count,
    configs: queuedConfigs,
  })
  const queuedTaskRows = queuedConfigs.map((config, index) => {
    const sequence = index + 1
    const email =
      typeof config.email === 'string' ? config.email.trim() : undefined
    const target = selectDispatchTargetForConfig({
      dispatchTargets,
      config,
      index,
    })
    if (!target) {
      throw new Error('No eligible CLI worker is available for dispatch.')
    }
    const body = buildTaskBody({
      flowId: flowDefinition.id,
      cliName: target.connection.cliName,
      configCount: Object.keys(config).length,
      sequence,
      total: count,
      email,
    })

    return {
      id: createId(),
      workerId: target.workerId,
      title: buildTaskTitle({
        flowId: flowDefinition.id,
        sequence,
        total: count,
        email,
      }),
      body,
      flowType: flowDefinition.id,
      target: target.connection.target,
      lastMessage: body,
      payload: createCliFlowTaskPayload(
        flowDefinition.id,
        config,
        {
          ...(batchId ? { batchId } : {}),
          ...(count > 1 ? { sequence, total: count } : {}),
        },
        externalServices,
        input.metadata,
      ),
    }
  })
  const tasks = await getDb().transaction(async (tx) => {
    const insertedTasks = await tx
      .insert(flowTasks)
      .values(queuedTaskRows)
      .returning()

    if (insertedTasks.length > 0) {
      await tx.insert(flowTaskEvents).values(
        insertedTasks.map((task) => ({
          id: createId(),
          taskId: task.id,
          type: 'QUEUED' as const,
          status: 'QUEUED' as const,
          message: task.body,
        })),
      )
    }

    return insertedTasks
  })

  return {
    tasks,
    connection,
    config: queuedConfigs[0] || {},
    configs: queuedConfigs,
    batchId,
    assignedCliCount: dispatchTargets.length,
    assignedConnections: dispatchTargets.map((target) => target.connection),
    externalServices,
  }
}

export async function dispatchCliFlowTask(input: {
  connectionId: string
  flowId: string
  config?: Record<string, unknown> | null
  actor?: CliConnectionActorScope
}) {
  const result = await dispatchCliFlowTasks({
    ...input,
    count: 1,
  })
  const [task] = result.tasks

  if (!task) {
    throw new Error('Unable to dispatch flow task.')
  }

  return {
    task,
    connection: result.connection,
    config: result.config,
  }
}
