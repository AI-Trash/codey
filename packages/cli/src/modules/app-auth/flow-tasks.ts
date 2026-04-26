import { sanitizeErrorForOutput } from '../flow-cli/helpers'
import type { CliNotificationsAuthState } from './device-login'
import { ensureJson, resolveAppUrl } from './http'

export interface ClaimedCliFlowTask {
  id: string
  title: string
  body: string
  flowType?: string | null
  target?: string | null
  payload?: Record<string, unknown> | null
  createdAt: string
}

type FlowTaskLeaseStatus = 'LEASED' | 'RUNNING'
type FinalFlowTaskStatus = 'SUCCEEDED' | 'FAILED' | 'CANCELED'

const FLOW_TASK_HEARTBEAT_MS = 10_000

export interface FlowTaskRetryRequest {
  reason: string
  message?: string | null
  maxAttempts?: number
}

interface FlowTaskStatusPayload {
  status: FlowTaskLeaseStatus | FinalFlowTaskStatus
  error?: string | null
  message?: string | null
  result?: Record<string, unknown> | null
  retry?: FlowTaskRetryRequest | null
}

async function postJson<T>(input: {
  authState: CliNotificationsAuthState
  path: string
  body?: Record<string, unknown>
}): Promise<T> {
  const response = await fetch(resolveAppUrl(input.path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${input.authState.accessToken}`,
    },
    body: JSON.stringify(input.body || {}),
  })

  return ensureJson<T>(response)
}

export async function claimCliFlowTask(input: {
  connectionId: string
  authState: CliNotificationsAuthState
}): Promise<ClaimedCliFlowTask | null> {
  const result = await postJson<{
    ok: boolean
    task?: ClaimedCliFlowTask | null
  }>({
    authState: input.authState,
    path: `/api/cli/connections/${encodeURIComponent(input.connectionId)}/tasks/claim`,
  })

  return result.task || null
}

export async function updateCliFlowTaskStatus(input: {
  connectionId: string
  taskId: string
  authState: CliNotificationsAuthState
  status: FlowTaskLeaseStatus | FinalFlowTaskStatus
  error?: string | null
  message?: string | null
  result?: Record<string, unknown> | null
  retry?: FlowTaskRetryRequest | null
}): Promise<void> {
  await postJson<{ ok: boolean }>({
    authState: input.authState,
    path: `/api/cli/connections/${encodeURIComponent(input.connectionId)}/tasks/${encodeURIComponent(input.taskId)}/status`,
    body: {
      status: input.status,
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.result !== undefined ? { result: input.result } : {}),
      ...(input.retry !== undefined ? { retry: input.retry } : {}),
    },
  })
}

export class CliFlowTaskLeaseReporter {
  private readonly connectionId: string
  private readonly taskId: string
  private readonly authState: CliNotificationsAuthState
  private readonly onError?: (error: Error) => void
  private heartbeat?: ReturnType<typeof setInterval>
  private currentStatus: FlowTaskLeaseStatus = 'LEASED'
  private currentMessage?: string | null
  private completed = false
  private requestChain: Promise<void> = Promise.resolve()

  constructor(input: {
    connectionId: string
    taskId: string
    authState: CliNotificationsAuthState
    onError?: (error: Error) => void
  }) {
    this.connectionId = input.connectionId
    this.taskId = input.taskId
    this.authState = input.authState
    this.onError = input.onError
  }

  start(): void {
    if (this.heartbeat || this.completed) {
      return
    }

    this.queueStatus({ status: this.currentStatus }, true)
    this.heartbeat = setInterval(() => {
      this.queueStatus({ status: this.currentStatus }, true)
    }, FLOW_TASK_HEARTBEAT_MS)
  }

  markRunning(message?: string | null): void {
    if (this.completed) {
      return
    }

    this.currentStatus = 'RUNNING'
    const normalizedMessage = normalizeTaskMessage(message)
    if (normalizedMessage !== undefined) {
      this.currentMessage = normalizedMessage
    }

    this.queueStatus(
      {
        status: 'RUNNING',
        ...(normalizedMessage !== undefined
          ? { message: normalizedMessage }
          : {}),
      },
      true,
    )
  }

  reportProgress(message?: string | null): void {
    if (this.completed) {
      return
    }

    const normalizedMessage = normalizeTaskMessage(message)
    if (
      normalizedMessage === undefined ||
      normalizedMessage === this.currentMessage
    ) {
      return
    }

    this.currentMessage = normalizedMessage
    this.queueStatus(
      {
        status: this.currentStatus,
        message: normalizedMessage,
      },
      true,
    )
  }

  async complete(input: {
    status: FinalFlowTaskStatus
    error?: string | null
    message?: string | null
    result?: Record<string, unknown> | null
    retry?: FlowTaskRetryRequest | null
  }): Promise<void> {
    if (this.completed) {
      return
    }

    this.completed = true
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = undefined
    }

    await this.queueStatus(
      {
        status: input.status,
        ...(input.error !== undefined ? { error: input.error } : {}),
        ...(input.message !== undefined
          ? { message: normalizeTaskMessage(input.message) ?? null }
          : this.currentMessage !== undefined
            ? { message: this.currentMessage }
            : {}),
        ...(input.result !== undefined ? { result: input.result } : {}),
        ...(input.retry !== undefined ? { retry: input.retry } : {}),
      },
      false,
    )
  }

  private queueStatus(
    payload: FlowTaskStatusPayload,
    swallowError: boolean,
  ): Promise<void> {
    this.requestChain = this.requestChain
      .catch(() => undefined)
      .then(async () => {
        try {
          await updateCliFlowTaskStatus({
            connectionId: this.connectionId,
            taskId: this.taskId,
            authState: this.authState,
            status: payload.status,
            error: payload.error,
            message: payload.message,
            ...(payload.result !== undefined ? { result: payload.result } : {}),
            ...(payload.retry !== undefined ? { retry: payload.retry } : {}),
          })
        } catch (error) {
          const sanitized = sanitizeErrorForOutput(error)
          this.onError?.(sanitized)
          if (!swallowError) {
            throw sanitized
          }
        }
      })

    return this.requestChain
  }
}

function normalizeTaskMessage(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || null
}
