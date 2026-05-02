import '@tanstack/react-start/server-only'

import { and, asc, eq, gt, lt, or, sql } from 'drizzle-orm'

import {
  createCliFlowTaskPayload,
  type CliFlowTaskMetadata,
} from '../../../packages/cli/src/modules/flow-cli/flow-registry'
import { sanitizeSummaryString } from '../../../packages/cli/src/utils/redaction'
import { sendAstrBotPayPalNotification } from './astrbot'
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
import {
  cancelBlockingIdentityMaintenanceTasksForWorker,
  cancelQueuedIdentityMaintenanceTasksForWorkers,
  nonIdentityMaintenanceTaskFilter,
  syncIdentityMaintenanceRunFromFlowTask,
} from './identity-maintenance'
import {
  normalizeTeamTrialPaypalUrl,
  recordWorkspaceInvitesFromFlowTask,
  recordWorkspaceTeamTrialPaypalUrlFromFlowTask,
} from './workspaces'

export const DEFAULT_FLOW_TASK_LEASE_MS = 30_000
const DEFAULT_FLOW_TASK_RETRY_MAX_ATTEMPTS = 2
const UNLIMITED_FLOW_TASK_RETRY_MAX_ATTEMPTS = 'unlimited'
const CHATGPT_REGISTER_AUTO_RETRY_REASON =
  'chatgpt-register:auto-retry-after-failure'

type ActiveFlowTaskStatus = Extract<FlowTaskStatus, 'LEASED' | 'RUNNING'>
type FinalFlowTaskStatus = Extract<
  FlowTaskStatus,
  'SUCCEEDED' | 'FAILED' | 'CANCELED'
>
type FlowTaskRetryMaxAttempts =
  | number
  | typeof UNLIMITED_FLOW_TASK_RETRY_MAX_ATTEMPTS

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

function readNormalizedPaymentRedirectUrl(
  result: Record<string, unknown> | null | undefined,
): string | null {
  return normalizeTeamTrialPaypalUrl(
    typeof result?.paymentRedirectUrl === 'string'
      ? result.paymentRedirectUrl
      : typeof result?.paypalApprovalUrl === 'string'
        ? result.paypalApprovalUrl
        : null,
  )
}

function hostnameMatches(
  value: string,
  matches: (hostname: string) => boolean,
): boolean {
  try {
    return matches(new URL(value).hostname.toLowerCase())
  } catch {
    return false
  }
}

function readPayPalApprovalUrl(
  result: Record<string, unknown> | null | undefined,
): string | null {
  const normalized = readNormalizedPaymentRedirectUrl(result)
  if (
    !normalized ||
    !hostnameMatches(
      normalized,
      (hostname) => hostname === 'paypal.com' || hostname.endsWith('.paypal.com'),
    )
  ) {
    return null
  }

  return normalized
}

function readGoPayPaymentRedirectUrl(
  result: Record<string, unknown> | null | undefined,
): string | null {
  const normalized = readNormalizedPaymentRedirectUrl(result)
  if (
    !normalized ||
    !hostnameMatches(
      normalized,
      (hostname) => hostname === 'app.midtrans.com',
    )
  ) {
    return null
  }

  return normalized
}

function readTaskMetadata(
  task: Pick<FlowTaskRow, 'payload'>,
): CliFlowTaskMetadata | undefined {
  const payload = task.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }

  const metadata = (payload as Record<string, unknown>).metadata
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as CliFlowTaskMetadata)
    : undefined
}

async function queueGoPayContinuationFromFlowTask(input: {
  task: FlowTaskRow
  connection: CliConnectionRow
  paymentRedirectUrl: string
  capturedAt: Date
}) {
  const flowId = 'chatgpt-team-trial-gopay'
  const cliName = input.connection.cliName?.trim() || 'CLI'
  const body = `Continue GoPay trial authorization on ${cliName} with captured Midtrans payment link.`
  const [task] = await getDb()
    .insert(flowTasks)
    .values({
      id: createId(),
      workerId: getCliConnectionTaskWorkerId(input.connection),
      title: `Dispatch ${flowId}`,
      body,
      flowType: flowId,
      target: input.connection.target,
      payload: createCliFlowTaskPayload(
        flowId,
        {
          paymentRedirectUrl: input.paymentRedirectUrl,
        },
        undefined,
        undefined,
        readTaskMetadata(input.task),
      ),
      status: 'QUEUED' as const,
      lastMessage: body,
    })
    .returning()

  if (!task) {
    throw new Error('Unable to queue GoPay continuation task.')
  }

  await appendFlowTaskEvent({
    taskId: task.id,
    type: 'QUEUED',
    status: 'QUEUED',
    message: body,
  })

  await appendFlowTaskEvent({
    taskId: input.task.id,
    cliConnectionId: input.connection.id,
    type: 'LOG',
    status: input.task.status,
    message:
      `Queued GoPay trial continuation task ${task.id || ''}`.trim(),
    payload: {
      gopayContinuation: {
        queuedCount: 1,
        assignedCliCount: 1,
        flowId,
        taskId: task.id,
        capturedAt: input.capturedAt.toISOString(),
      },
    },
  })
}

function canQueueGoPayContinuationFromFlowType(flowType: string): boolean {
  return flowType === 'chatgpt-team-trial' || flowType === 'chatgpt-register'
}

function normalizeRetryMaxAttempts(value?: number | null): number {
  if (!Number.isInteger(value) || !value || value < 1) {
    return DEFAULT_FLOW_TASK_RETRY_MAX_ATTEMPTS
  }

  return Math.min(value, 10)
}

function formatRetryAttemptLabel(input: {
  nextAttempt: number
  maxAttempts: FlowTaskRetryMaxAttempts
}): string {
  if (input.maxAttempts === UNLIMITED_FLOW_TASK_RETRY_MAX_ATTEMPTS) {
    return `attempt ${input.nextAttempt}`
  }

  return `attempt ${input.nextAttempt} of ${input.maxAttempts}`
}

function formatDefaultRetryMessage(input: {
  retryReason: string
  nextAttempt: number
  maxAttempts: FlowTaskRetryMaxAttempts
}): string {
  const attemptLabel = formatRetryAttemptLabel(input)
  if (input.retryReason === CHATGPT_REGISTER_AUTO_RETRY_REASON) {
    return `ChatGPT registration failed; Codey Web is re-queuing the same flow task until it succeeds (${attemptLabel}).`
  }

  return `Retrying flow task after ${input.retryReason} (${attemptLabel})`
}

async function appendFlowTaskEvent(input: {
  taskId: string
  cliConnectionId?: string | null
  type: FlowTaskEventType
  status?: FlowTaskStatus | null
  message?: string | null
  payload?: Record<string, unknown> | null
}) {
  await getDb()
    .insert(flowTaskEvents)
    .values({
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

function buildActiveTaskFilter(input: { workerId: string; now: Date }) {
  return and(
    eq(flowTasks.workerId, input.workerId),
    or(eq(flowTasks.status, 'LEASED'), eq(flowTasks.status, 'RUNNING')),
    gt(flowTasks.leaseExpiresAt, input.now),
  )
}

function buildNonMaintenanceClaimableTaskFilter(input: {
  workerId: string
  now: Date
}) {
  return and(
    buildClaimableTaskFilter(input),
    nonIdentityMaintenanceTaskFilter(),
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
}): Promise<{
  task: FlowTaskRow | null
  canceledTaskIds: string[]
}> {
  const connection = await getCliConnectionRow(input.connectionId)
  if (!connection) {
    throw new Error('CLI connection not found.')
  }

  const workerId = getCliConnectionTaskWorkerId(connection)
  const leaseMs = Math.max(input.leaseMs || DEFAULT_FLOW_TASK_LEASE_MS, 5_000)
  const canceledTaskIds = new Set<string>()

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date()
    const nonMaintenanceCandidate = await getDb().query.flowTasks.findFirst({
      where: buildNonMaintenanceClaimableTaskFilter({ workerId, now }),
      orderBy: [asc(flowTasks.createdAt), asc(flowTasks.id)],
    })

    if (nonMaintenanceCandidate) {
      const queuedCanceled =
        await cancelQueuedIdentityMaintenanceTasksForWorkers({
          workerIds: [workerId],
          reason:
            'Identity maintenance canceled because normal flow work needs browser capacity.',
        })
      for (const taskId of queuedCanceled) {
        canceledTaskIds.add(taskId)
      }
    }

    const [activeTaskCount] = await getDb()
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(flowTasks)
      .where(buildActiveTaskFilter({ workerId, now }))

    if ((activeTaskCount?.count || 0) >= connection.browserLimit) {
      if (nonMaintenanceCandidate) {
        const activeCanceled =
          await cancelBlockingIdentityMaintenanceTasksForWorker({
            workerId,
            browserLimit: connection.browserLimit,
            reason:
              'Identity maintenance canceled because normal flow work needs browser capacity.',
          })
        for (const taskId of activeCanceled) {
          canceledTaskIds.add(taskId)
        }

        if (activeCanceled.length) {
          continue
        }
      }

      return {
        task: null,
        canceledTaskIds: [...canceledTaskIds],
      }
    }

    const candidate =
      nonMaintenanceCandidate ||
      (await getDb().query.flowTasks.findFirst({
        where: buildClaimableTaskFilter({ workerId, now }),
        orderBy: [asc(flowTasks.createdAt), asc(flowTasks.id)],
      }))

    if (!candidate) {
      return {
        task: null,
        canceledTaskIds: [...canceledTaskIds],
      }
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
      .where(
        and(
          eq(flowTasks.id, candidate.id),
          buildClaimableTaskFilter({ workerId, now }),
        ),
      )
      .returning()

    if (claimed) {
      await appendFlowTaskEvent({
        taskId: claimed.id,
        cliConnectionId: connection.id,
        type: 'LEASED',
        status: 'LEASED',
        message: 'Task claimed by CLI',
      })
      await syncIdentityMaintenanceRunFromFlowTask({
        task: claimed,
        status: 'LEASED',
        message: 'Task claimed by CLI',
      })
      return {
        task: claimed,
        canceledTaskIds: [...canceledTaskIds],
      }
    }
  }

  return {
    task: null,
    canceledTaskIds: [...canceledTaskIds],
  }
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

  await syncIdentityMaintenanceRunFromFlowTask({
    task: updated,
    status: input.status,
    message: normalizedMessage,
  })

  return updated
}

async function getActiveFlowTaskForWorker(input: {
  taskId: string
  workerId: string
}): Promise<FlowTaskRow | null> {
  const current = await getDb().query.flowTasks.findFirst({
    where: and(
      eq(flowTasks.id, input.taskId),
      eq(flowTasks.workerId, input.workerId),
      or(eq(flowTasks.status, 'LEASED'), eq(flowTasks.status, 'RUNNING')),
    ),
  })

  return current || null
}

function shouldAutoRetryFailedFlowTask(
  task: Pick<FlowTaskRow, 'flowType'>,
): boolean {
  return task.flowType === 'chatgpt-register'
}

async function requeueActiveFlowTask(input: {
  connection: CliConnectionRow
  current: FlowTaskRow
  error?: string | null
  retryReason: string
  retryMessage?: string | null
  maxAttempts: FlowTaskRetryMaxAttempts
}): Promise<FlowTaskRow | null> {
  const now = new Date()
  const workerId = getCliConnectionTaskWorkerId(input.connection)
  const retryReason =
    normalizeTaskText(input.retryReason) || 'Recoverable flow failure'
  const normalizedError = normalizeTaskText(input.error)
  const nextAttempt = input.current.attemptCount + 1
  const retryMessage =
    normalizeTaskText(input.retryMessage) ||
    formatDefaultRetryMessage({
      retryReason,
      nextAttempt,
      maxAttempts: input.maxAttempts,
    })

  const [updated] = await getDb()
    .update(flowTasks)
    .set({
      status: 'QUEUED',
      cliConnectionId: null,
      leaseClaimedAt: null,
      leaseExpiresAt: null,
      startedAt: null,
      completedAt: null,
      lastMessage: retryMessage,
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(flowTasks.id, input.current.id),
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
    cliConnectionId: input.connection.id,
    type: 'QUEUED',
    status: 'QUEUED',
    message: retryMessage,
    payload: {
      retry: {
        reason: retryReason,
        previousStatus: input.current.status,
        previousAttempt: input.current.attemptCount,
        nextAttempt,
        maxAttempts: input.maxAttempts,
        ...(normalizedError ? { error: normalizedError } : {}),
      },
    },
  })
  await syncIdentityMaintenanceRunFromFlowTask({
    task: updated,
    status: 'QUEUED',
    message: retryMessage,
    error: normalizedError,
  })

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

  if (input.status === 'FAILED') {
    const current = await getActiveFlowTaskForWorker({
      taskId: input.taskId,
      workerId,
    })

    if (current && shouldAutoRetryFailedFlowTask(current)) {
      return requeueActiveFlowTask({
        connection,
        current,
        error: input.error,
        retryReason: CHATGPT_REGISTER_AUTO_RETRY_REASON,
        maxAttempts: UNLIMITED_FLOW_TASK_RETRY_MAX_ATTEMPTS,
      })
    }
  }

  const [updated] = await getDb()
    .update(flowTasks)
    .set({
      status: input.status,
      cliConnectionId: connection.id,
      leaseExpiresAt: null,
      completedAt: now,
      lastMessage: normalizedMessage || normalizedError,
      lastError:
        input.status === 'FAILED'
          ? normalizedError || 'Flow task failed.'
          : null,
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
  await syncIdentityMaintenanceRunFromFlowTask({
    task: updated,
    status: input.status,
    message: normalizedMessage,
    error: normalizedError,
  })

  if (input.status === 'SUCCEEDED' && input.result) {
    let teamTrialWorkspace: Awaited<
      ReturnType<typeof recordWorkspaceTeamTrialPaypalUrlFromFlowTask>
    > = null

    try {
      teamTrialWorkspace = await recordWorkspaceTeamTrialPaypalUrlFromFlowTask({
        payload: updated.payload,
        result: input.result,
        capturedAt: now,
      })
      await recordWorkspaceInvitesFromFlowTask({
        payload: updated.payload,
        result: input.result,
        capturedAt: now,
      })
    } catch (error) {
      console.error('Unable to persist flow task completion result', error)
      await appendFlowTaskEvent({
        taskId: updated.id,
        cliConnectionId: connection.id,
        type: 'LOG',
        status: updated.status,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to persist flow task completion result',
      })
    }

    const gopayPaymentRedirectUrl =
      canQueueGoPayContinuationFromFlowType(updated.flowType)
        ? readGoPayPaymentRedirectUrl(input.result)
        : null
    if (gopayPaymentRedirectUrl) {
      try {
        await queueGoPayContinuationFromFlowTask({
          task: updated,
          connection,
          paymentRedirectUrl: gopayPaymentRedirectUrl,
          capturedAt: now,
        })
      } catch (error) {
        console.error('Unable to queue GoPay continuation task', error)
        await appendFlowTaskEvent({
          taskId: updated.id,
          cliConnectionId: connection.id,
          type: 'LOG',
          status: updated.status,
          message:
            error instanceof Error
              ? error.message
              : 'Unable to queue GoPay continuation task',
        })
      }
    }

    const paypalUrl = readPayPalApprovalUrl(input.result)
    if (
      (updated.flowType === 'chatgpt-team-trial' ||
        updated.flowType === 'chatgpt-register') &&
      paypalUrl
    ) {
      try {
        const notification = await sendAstrBotPayPalNotification({
          paypalUrl,
          workspace: teamTrialWorkspace,
          capturedAt: now,
        })
        if (notification) {
          await appendFlowTaskEvent({
            taskId: updated.id,
            cliConnectionId: connection.id,
            type: 'LOG',
            status: updated.status,
            message: `Sent PayPal link to AstrBot target ${notification.umo}`,
            payload: {
              astrbot: {
                endpoint: notification.endpoint,
                umo: notification.umo,
              },
            },
          })
        }
      } catch (error) {
        console.error('Unable to send PayPal link to AstrBot', error)
        await appendFlowTaskEvent({
          taskId: updated.id,
          cliConnectionId: connection.id,
          type: 'LOG',
          status: updated.status,
          message:
            error instanceof Error
              ? error.message
              : 'Unable to send PayPal link to AstrBot',
        })
      }
    }
  }

  try {
    const { advanceWorkspaceInviteAuthorizeWorkflowFromFlowTask } =
      await import('./workspace-invite-authorize')
    await advanceWorkspaceInviteAuthorizeWorkflowFromFlowTask({
      task: updated,
      status: input.status,
      error: normalizedError,
      ...(input.result ? { result: input.result } : {}),
    })
  } catch (error) {
    console.error(
      'Unable to advance workspace invite and authorize workflow',
      error,
    )
  }

  return updated
}

export async function retryFlowTask(input: {
  connectionId: string
  taskId: string
  error?: string | null
  message?: string | null
  retryReason: string
  retryMessage?: string | null
  maxAttempts?: number | null
}): Promise<FlowTaskRow | null> {
  const connection = await getCliConnectionRow(input.connectionId)
  if (!connection) {
    throw new Error('CLI connection not found.')
  }

  const workerId = getCliConnectionTaskWorkerId(connection)
  const current = await getActiveFlowTaskForWorker({
    taskId: input.taskId,
    workerId,
  })

  if (!current) {
    return null
  }

  const maxAttempts = normalizeRetryMaxAttempts(input.maxAttempts)
  if (current.attemptCount >= maxAttempts) {
    return completeFlowTask({
      connectionId: input.connectionId,
      taskId: input.taskId,
      status: 'FAILED',
      error: input.error,
      message: input.message,
    })
  }

  return requeueActiveFlowTask({
    connection,
    current,
    error: input.error,
    retryReason: input.retryReason,
    retryMessage: input.retryMessage,
    maxAttempts,
  })
}
