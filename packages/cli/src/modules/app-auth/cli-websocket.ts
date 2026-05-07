import { listLocalChatGPTStorageStateAffinities } from '../chatgpt/storage-state'
import { listCliFlowCommandIds } from '../flow-cli/flow-registry'
import type {
  CliConnectionRuntimeState,
  CliConnectionRuntimeTransport,
} from './cli-connection'
import type { CliNotificationsAuthState } from './device-login'
import { resolveAppWebSocketUrl } from './http'
import type { AdminNotificationEvent, CliConnectionEvent } from './types'
import type {
  ClaimCliFlowTaskResult,
  ClaimedCliFlowTask,
  CliFlowTaskTransport,
  FlowTaskRetryRequest,
  FlowTaskStatusResponse,
} from './flow-tasks'

type CliWsServerMessage =
  | {
      type: 'cli_connection'
      data: CliConnectionEvent
    }
  | {
      id?: string
      type: 'admin_notification'
      data: AdminNotificationEvent
    }
  | {
      type: 'keepalive'
      data?: Record<string, unknown>
    }
  | {
      type: 'response'
      requestId: string
      ok: true
      data: unknown
    }
  | {
      type: 'response'
      requestId: string
      ok: false
      error?: {
        status?: number
        message?: string
      }
    }
  | {
      type: 'error'
      error?: {
        status?: number
        message?: string
      }
    }

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const CLI_WS_REQUEST_TIMEOUT_MS = 30_000

function resolveCliWebSocketUrl(input: {
  path?: string
  accessToken: string
  target?: string
  cliName?: string
  workerId?: string
}): string {
  const url = new URL(resolveAppWebSocketUrl(input.path || '/api/cli/ws'))
  url.searchParams.set('access_token', input.accessToken)
  if (input.target) {
    url.searchParams.set('target', input.target)
  }
  if (input.cliName) {
    url.searchParams.set('cliName', input.cliName)
  }
  if (input.workerId) {
    url.searchParams.set('workerId', input.workerId)
  }

  url.searchParams.set('registeredFlows', listCliFlowCommandIds().join(','))
  const storageStateAffinities = listLocalChatGPTStorageStateAffinities()
  if (storageStateAffinities.identityIds.length) {
    url.searchParams.set(
      'storageStateIdentityIds',
      storageStateAffinities.identityIds.join(','),
    )
  }
  if (storageStateAffinities.emails.length) {
    url.searchParams.set(
      'storageStateEmails',
      storageStateAffinities.emails.join(','),
    )
  }

  return url.toString()
}

function parseServerMessage(event: MessageEvent): CliWsServerMessage {
  const raw = typeof event.data === 'string' ? event.data : String(event.data)
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Codey WebSocket returned a malformed message.')
  }

  return parsed as CliWsServerMessage
}

function normalizeErrorMessage(message: CliWsServerMessage): string {
  if ('error' in message && message.error?.message) {
    return message.error.message
  }

  return 'Codey WebSocket request failed.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeClaimResult(value: unknown): ClaimCliFlowTaskResult {
  if (!isRecord(value)) {
    throw new Error('Codey WebSocket returned a malformed task claim result.')
  }

  const task = isRecord(value.task)
    ? ({
        id: String(value.task.id || ''),
        title: String(value.task.title || ''),
        body: String(value.task.body || ''),
        flowType:
          typeof value.task.flowType === 'string' ? value.task.flowType : null,
        target:
          typeof value.task.target === 'string' ? value.task.target : null,
        payload: isRecord(value.task.payload) ? value.task.payload : null,
        createdAt: String(value.task.createdAt || ''),
      } satisfies ClaimedCliFlowTask)
    : null

  return {
    task: task?.id ? task : null,
    browserLimit:
      typeof value.browserLimit === 'number' ? value.browserLimit : undefined,
  }
}

function normalizeBrowserLimitResult(value: unknown): {
  browserLimit?: number
} {
  return isRecord(value) && typeof value.browserLimit === 'number'
    ? { browserLimit: value.browserLimit }
    : {}
}

function normalizeTaskStatusResult(value: unknown): FlowTaskStatusResponse {
  if (!isRecord(value)) {
    return { ok: true }
  }

  return {
    ok: value.ok !== false,
    stopRequested:
      typeof value.stopRequested === 'boolean'
        ? value.stopRequested
        : undefined,
    stopReason:
      typeof value.stopReason === 'string' || value.stopReason === null
        ? value.stopReason
        : undefined,
  }
}

export class CliWebSocketConnection
  implements CliConnectionRuntimeTransport, CliFlowTaskTransport
{
  private socket?: WebSocket
  private readonly pending = new Map<string, PendingRequest>()
  private opened = false
  private closed = false
  private nextRequestId = 1

  constructor(
    private readonly input: {
      path?: string
      target?: string
      cliName?: string
      workerId?: string
      authState: CliNotificationsAuthState
      onConnection?: (connection: CliConnectionEvent) => void
      onNotification?: (notification: AdminNotificationEvent) => void
      signal?: AbortSignal
    },
  ) {}

  async run(): Promise<void> {
    const url = resolveCliWebSocketUrl({
      path: this.input.path,
      accessToken: this.input.authState.accessToken,
      target: this.input.target,
      cliName: this.input.cliName,
      workerId: this.input.workerId,
    })

    const socket = new WebSocket(url)
    this.socket = socket

    const abortListener = () => {
      this.close()
    }
    this.input.signal?.addEventListener('abort', abortListener, { once: true })

    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener(
          'open',
          () => {
            this.opened = true
            resolve()
          },
          { once: true },
        )
        socket.addEventListener(
          'error',
          () => {
            reject(new Error('Unable to open Codey WebSocket connection.'))
          },
          { once: true },
        )
      })

      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('message', (event) => {
          try {
            this.handleMessage(parseServerMessage(event))
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)))
            this.close()
          }
        })
        socket.addEventListener('error', () => {
          reject(new Error('Codey WebSocket connection failed.'))
        })
        socket.addEventListener('close', () => {
          this.closed = true
          resolve()
        })
      })
    } finally {
      this.input.signal?.removeEventListener('abort', abortListener)
      this.rejectAllPending(new Error('Codey WebSocket connection closed.'))
    }
  }

  close(): void {
    if (this.closed) {
      return
    }

    this.closed = true
    this.socket?.close()
    this.rejectAllPending(new Error('Codey WebSocket connection closed.'))
  }

  claimTask(input: {
    connectionId: string
    authState: CliNotificationsAuthState
  }): Promise<ClaimCliFlowTaskResult> {
    void input
    return this.request('claim_task').then(normalizeClaimResult)
  }

  updateRuntimeState(input: {
    connectionId: string
    authState: CliNotificationsAuthState
    state: CliConnectionRuntimeState
  }): Promise<{
    browserLimit?: number
  }> {
    void input.connectionId
    void input.authState
    return this.request('update_runtime_state', input.state).then(
      normalizeBrowserLimitResult,
    )
  }

  updateTaskStatus(input: {
    connectionId: string
    taskId: string
    authState: CliNotificationsAuthState
    status: 'LEASED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED'
    error?: string | null
    message?: string | null
    result?: Record<string, unknown> | null
    retry?: FlowTaskRetryRequest | null
  }): Promise<FlowTaskStatusResponse> {
    void input.connectionId
    void input.authState
    return this.request('update_task_status', {
      taskId: input.taskId,
      status: input.status,
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.result !== undefined ? { result: input.result } : {}),
      ...(input.retry !== undefined ? { retry: input.retry } : {}),
    }).then(normalizeTaskStatusResult)
  }

  private request(action: string, data?: unknown): Promise<unknown> {
    if (!this.socket || !this.opened || this.closed) {
      return Promise.reject(new Error('Codey WebSocket is not connected.'))
    }

    const requestId = String(this.nextRequestId++)
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Codey WebSocket request timed out: ${action}`))
      }, CLI_WS_REQUEST_TIMEOUT_MS)
      this.pending.set(requestId, {
        resolve,
        reject,
        timeout,
      })
      this.socket?.send(
        JSON.stringify({
          type: 'request',
          requestId,
          action,
          ...(data !== undefined ? { data } : {}),
        }),
      )
    })
  }

  private handleMessage(message: CliWsServerMessage): void {
    if (message.type === 'cli_connection') {
      this.input.onConnection?.(message.data)
      return
    }

    if (message.type === 'admin_notification') {
      this.input.onNotification?.(message.data)
      return
    }

    if (message.type === 'keepalive') {
      return
    }

    if (message.type === 'error') {
      throw new Error(normalizeErrorMessage(message))
    }

    if (message.type === 'response') {
      const pending = this.pending.get(message.requestId)
      if (!pending) {
        return
      }

      this.pending.delete(message.requestId)
      clearTimeout(pending.timeout)
      if (message.ok) {
        pending.resolve(message.data)
      } else {
        pending.reject(new Error(normalizeErrorMessage(message)))
      }
    }
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
