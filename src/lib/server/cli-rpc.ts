import '@tanstack/react-start/server-only'

import {
  claimNextFlowTaskForConnection,
  completeFlowTask,
  refreshFlowTaskLease,
  retryFlowTask,
} from './flow-tasks'
import {
  getAdminCliConnectionSummaryById,
  updateCliConnectionRuntimeState,
} from './cli-connections'

type FlowTaskLeaseStatus = 'LEASED' | 'RUNNING'
type FinalFlowTaskStatus = 'SUCCEEDED' | 'FAILED' | 'CANCELED'

export class CliRpcError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'CliRpcError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseOptionalString(value: unknown): string | null | undefined {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || null
}

function parseOptionalTimestamp(value: unknown): string | null | undefined {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  return Number.isNaN(Date.parse(normalized)) ? undefined : normalized
}

function parseOptionalStringArray(value: unknown): string[] | null | undefined {
  if (value === null) {
    return null
  }

  if (!Array.isArray(value)) {
    return undefined
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)

  return Array.from(new Set(normalized))
}

function parseOptionalRecord(
  value: unknown,
): Record<string, unknown> | null | undefined {
  if (value === null) {
    return null
  }

  if (!isRecord(value)) {
    return undefined
  }

  return value
}

function parseOptionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return undefined
  }

  return value
}

function parseOptionalConfigPatch(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  return parseOptionalRecord(value) || undefined
}

function parseOptionalRetryRequest(value: unknown):
  | {
      reason: string
      message?: string | null
      maxAttempts?: number
      configPatch?: Record<string, unknown>
    }
  | null
  | undefined {
  if (value === undefined || value === null) {
    return null
  }

  const retry = parseOptionalRecord(value)
  if (!retry) {
    return undefined
  }

  const reason = parseOptionalString(retry.reason)
  if (!reason) {
    return undefined
  }

  const message = parseOptionalString(retry.message)
  if ('message' in retry && message === undefined) {
    return undefined
  }

  const maxAttempts = parseOptionalPositiveInteger(retry.maxAttempts)
  if ('maxAttempts' in retry && maxAttempts === undefined) {
    return undefined
  }

  const configPatch = parseOptionalConfigPatch(retry.configPatch)
  if ('configPatch' in retry && configPatch === undefined) {
    return undefined
  }

  return {
    reason,
    ...(message !== undefined ? { message } : {}),
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
    ...(configPatch !== undefined ? { configPatch } : {}),
  }
}

export function parseCliConnectionRuntimeState(input: unknown) {
  if (!isRecord(input)) {
    throw new CliRpcError('Invalid JSON body', 400)
  }

  const runtimeFlowStatus = parseOptionalString(input.runtimeFlowStatus)
  if ('runtimeFlowStatus' in input && runtimeFlowStatus === undefined) {
    throw new CliRpcError('runtimeFlowStatus must be a string or null', 400)
  }

  const runtimeFlowId = parseOptionalString(input.runtimeFlowId)
  if ('runtimeFlowId' in input && runtimeFlowId === undefined) {
    throw new CliRpcError('runtimeFlowId must be a string or null', 400)
  }

  const runtimeTaskId = parseOptionalString(input.runtimeTaskId)
  if ('runtimeTaskId' in input && runtimeTaskId === undefined) {
    throw new CliRpcError('runtimeTaskId must be a string or null', 400)
  }

  const runtimeFlowMessage = parseOptionalString(input.runtimeFlowMessage)
  if ('runtimeFlowMessage' in input && runtimeFlowMessage === undefined) {
    throw new CliRpcError('runtimeFlowMessage must be a string or null', 400)
  }

  const runtimeFlowStartedAt = parseOptionalTimestamp(
    input.runtimeFlowStartedAt,
  )
  if ('runtimeFlowStartedAt' in input && runtimeFlowStartedAt === undefined) {
    throw new CliRpcError(
      'runtimeFlowStartedAt must be an ISO timestamp or null',
      400,
    )
  }

  const runtimeFlowCompletedAt = parseOptionalTimestamp(
    input.runtimeFlowCompletedAt,
  )
  if (
    'runtimeFlowCompletedAt' in input &&
    runtimeFlowCompletedAt === undefined
  ) {
    throw new CliRpcError(
      'runtimeFlowCompletedAt must be an ISO timestamp or null',
      400,
    )
  }

  const storageStateIdentityIds = parseOptionalStringArray(
    input.storageStateIdentityIds,
  )
  if (
    'storageStateIdentityIds' in input &&
    storageStateIdentityIds === undefined
  ) {
    throw new CliRpcError(
      'storageStateIdentityIds must be a string array or null',
      400,
    )
  }

  const storageStateEmails = parseOptionalStringArray(input.storageStateEmails)
  if ('storageStateEmails' in input && storageStateEmails === undefined) {
    throw new CliRpcError('storageStateEmails must be a string array or null')
  }

  return {
    runtimeFlowId,
    runtimeTaskId,
    runtimeFlowStatus,
    runtimeFlowMessage,
    runtimeFlowStartedAt,
    runtimeFlowCompletedAt,
    storageStateIdentityIds,
    storageStateEmails,
  }
}

export async function updateCliConnectionRuntimeStateForRpc(input: {
  connectionId: string
  body: unknown
  fallbackBrowserLimit?: number
}) {
  const state = parseCliConnectionRuntimeState(input.body)
  const result = await updateCliConnectionRuntimeState(
    input.connectionId,
    state,
  )

  return {
    ok: true,
    browserLimit: result?.browserLimit ?? input.fallbackBrowserLimit,
  }
}

function parseCliFlowTaskStatusUpdate(input: unknown) {
  if (!isRecord(input)) {
    throw new CliRpcError('Invalid JSON body', 400)
  }

  const status = parseOptionalString(input.status)
  if (
    status !== 'LEASED' &&
    status !== 'RUNNING' &&
    status !== 'SUCCEEDED' &&
    status !== 'FAILED' &&
    status !== 'CANCELED'
  ) {
    throw new CliRpcError(
      'status must be one of LEASED, RUNNING, SUCCEEDED, FAILED, or CANCELED',
      400,
    )
  }

  const error = parseOptionalString(input.error)
  if ('error' in input && error === undefined) {
    throw new CliRpcError('error must be a string or null', 400)
  }

  const message = parseOptionalString(input.message)
  if ('message' in input && message === undefined) {
    throw new CliRpcError('message must be a string or null', 400)
  }

  const result = parseOptionalRecord(input.result)
  if ('result' in input && result === undefined) {
    throw new CliRpcError('result must be an object or null', 400)
  }

  const retry = parseOptionalRetryRequest(input.retry)
  if ('retry' in input && retry === undefined) {
    throw new CliRpcError(
      'retry must include reason and optional message/maxAttempts/configPatch',
      400,
    )
  }

  if (retry && status !== 'FAILED') {
    throw new CliRpcError('retry can only be provided with FAILED status', 400)
  }

  return {
    status,
    error,
    message,
    result,
    retry,
  }
}

export async function claimCliFlowTaskForRpc(connectionId: string) {
  const connection = await getAdminCliConnectionSummaryById(connectionId)
  if (!connection) {
    throw new CliRpcError('CLI connection not found', 404)
  }

  const claimResult = await claimNextFlowTaskForConnection({
    connectionId,
  })
  const task = claimResult.task

  return {
    ok: true,
    browserLimit: connection.browserLimit,
    task: task
      ? {
          id: task.id,
          title: task.title,
          body: task.body,
          flowType: task.flowType,
          target: task.target,
          payload: task.payload,
          createdAt: task.createdAt.toISOString(),
        }
      : null,
  }
}

export async function updateCliFlowTaskStatusForRpc(input: {
  connectionId: string
  taskId: string
  body: unknown
}) {
  const parsed = parseCliFlowTaskStatusUpdate(input.body)

  if (parsed.status === 'LEASED' || parsed.status === 'RUNNING') {
    const updateResult = await refreshFlowTaskLease({
      connectionId: input.connectionId,
      taskId: input.taskId,
      status: parsed.status as FlowTaskLeaseStatus,
      message: parsed.message,
    })

    if (!updateResult) {
      throw new CliRpcError('Flow task lease is no longer active.', 409)
    }

    return {
      ok: true,
      stopRequested: updateResult.stopRequested,
      stopReason: updateResult.stopReason,
    }
  }

  const updateResult = parsed.retry
    ? await retryFlowTask({
        connectionId: input.connectionId,
        taskId: input.taskId,
        error: parsed.error,
        message: parsed.message,
        retryReason: parsed.retry.reason,
        retryMessage: parsed.retry.message,
        maxAttempts: parsed.retry.maxAttempts,
        configPatch: parsed.retry.configPatch,
      })
    : await completeFlowTask({
        connectionId: input.connectionId,
        taskId: input.taskId,
        status: parsed.status as FinalFlowTaskStatus,
        error: parsed.error,
        message: parsed.message,
        ...(parsed.result !== undefined ? { result: parsed.result } : {}),
      })

  if (!updateResult) {
    throw new CliRpcError('Flow task lease is no longer active.', 409)
  }

  return { ok: true }
}
