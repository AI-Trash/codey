import { defineWebSocketHandler } from 'nitro/h3'
import type { WebSocketMessage, WebSocketPeer } from 'nitro/h3'

import { listCliNotifications } from '../../src/lib/server/admin'
import {
  isCliNotificationAfterCursor,
  toCliNotificationCursor,
  type CliNotificationCursor,
} from '../../src/lib/server/cli-notification-cursor'
import {
  markCliConnectionDisconnected,
  registerCliConnection,
  touchCliConnection,
} from '../../src/lib/server/cli-connections'
import {
  claimCliFlowTaskForRpc,
  CliRpcError,
  updateCliConnectionRuntimeStateForRpc,
  updateCliFlowTaskStatusForRpc,
} from '../../src/lib/server/cli-rpc'
import { getCliSessionUser, type SessionUser } from '../../src/lib/server/auth'
import { NOTIFICATIONS_READ_SCOPE } from '../../src/lib/server/oauth-scopes'
import {
  getBearerTokenContext,
  type BearerTokenContext,
} from '../../src/lib/server/oauth-resource'

const CLI_EVENT_POLL_INTERVAL_MS = 2000
const CLI_CONNECTION_TOUCH_INTERVAL_MS = 10_000
const CLI_KEEPALIVE_MS = 15_000
const CLI_NOTIFICATION_BATCH_SIZE = 50

interface CliWsAuthContext {
  sessionUser: SessionUser | null
  bearerContext: BearerTokenContext | null
  serviceClientAuthorized: boolean
}

interface CliWsPeerState {
  auth: CliWsAuthContext
  target?: string
  cliName: string
  workerId?: string
  registeredFlows: string[]
  storageStateIdentityIds: string[]
  storageStateEmails: string[]
  cursor: CliNotificationCursor
  connectionId?: string
  browserLimit?: number
  closed: boolean
  ticking: boolean
  lastTouchedAt: number
  pollInterval?: ReturnType<typeof setInterval>
  keepaliveInterval?: ReturnType<typeof setInterval>
}

type CliWsPeer = WebSocketPeer & {
  context: {
    cliWs?: CliWsPeerState
  }
}

function readOptionalHeader(
  request: Request,
  name: string,
): string | undefined {
  const value = request.headers.get(name)
  const normalized = value?.trim()
  return normalized || undefined
}

function readCommaList(value: string | null | undefined): string[] {
  if (!value) {
    return []
  }

  return Array.from(
    new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  )
}

function readListValue(
  request: Request,
  url: URL,
  headerName: string,
  queryName: string,
): string[] {
  return readCommaList(
    readOptionalHeader(request, headerName) || url.searchParams.get(queryName),
  )
}

function buildRequestWithQueryBearer(request: Request): Request {
  const url = new URL(request.url)
  const accessToken = url.searchParams.get('access_token')?.trim()
  if (!accessToken || request.headers.get('authorization')) {
    return request
  }

  url.searchParams.delete('access_token')
  const headers = new Headers(request.headers)
  headers.set('authorization', `Bearer ${accessToken}`)
  return new Request(url, {
    method: request.method,
    headers,
  })
}

async function authenticateCliWsRequest(
  request: Request,
): Promise<CliWsAuthContext> {
  const authRequest = buildRequestWithQueryBearer(request)
  const sessionUser = await getCliSessionUser(authRequest)
  const bearerContext = await getBearerTokenContext(authRequest)
  const serviceClientAuthorized =
    bearerContext?.kind === 'client_credentials' &&
    bearerContext.scope.includes(NOTIFICATIONS_READ_SCOPE)

  if (!sessionUser && !serviceClientAuthorized) {
    throw new Response('CLI authentication required', { status: 401 })
  }

  return {
    sessionUser,
    bearerContext,
    serviceClientAuthorized,
  }
}

async function buildPeerState(request: Request): Promise<CliWsPeerState> {
  const auth = await authenticateCliWsRequest(request)
  const url = new URL(request.url)
  const target =
    url.searchParams.get('target') ||
    auth.sessionUser?.user.githubLogin ||
    auth.sessionUser?.user.email ||
    undefined

  return {
    auth,
    target,
    cliName:
      url.searchParams.get('cliName') ||
      readOptionalHeader(request, 'x-codey-cli-name') ||
      'codey',
    workerId:
      url.searchParams.get('workerId') ||
      readOptionalHeader(request, 'x-codey-worker-id'),
    registeredFlows: readListValue(
      request,
      url,
      'x-codey-registered-flows',
      'registeredFlows',
    ),
    storageStateIdentityIds: readListValue(
      request,
      url,
      'x-codey-storage-state-identity-ids',
      'storageStateIdentityIds',
    ),
    storageStateEmails: readListValue(
      request,
      url,
      'x-codey-storage-state-emails',
      'storageStateEmails',
    ),
    cursor: {
      createdAt: url.searchParams.get('after')
        ? new Date(url.searchParams.get('after') as string)
        : new Date(),
      id: undefined,
    },
    closed: false,
    ticking: false,
    lastTouchedAt: 0,
  }
}

function getPeerState(peer: WebSocketPeer): CliWsPeerState | undefined {
  return (peer as CliWsPeer).context.cliWs
}

function sendJson(peer: WebSocketPeer, payload: Record<string, unknown>): void {
  peer.send(JSON.stringify(payload))
}

function closePeerState(state: CliWsPeerState): void {
  if (state.closed) {
    return
  }

  state.closed = true
  if (state.pollInterval) {
    clearInterval(state.pollInterval)
    state.pollInterval = undefined
  }
  if (state.keepaliveInterval) {
    clearInterval(state.keepaliveInterval)
    state.keepaliveInterval = undefined
  }
  if (state.connectionId) {
    void markCliConnectionDisconnected(state.connectionId)
  }
}

async function touchWsConnection(
  state: CliWsPeerState,
  force = false,
): Promise<void> {
  if (!state.connectionId) {
    return
  }

  const now = Date.now()
  if (!force && now - state.lastTouchedAt < CLI_CONNECTION_TOUCH_INTERVAL_MS) {
    return
  }

  state.lastTouchedAt = now
  await touchCliConnection(state.connectionId)
}

async function pollCliNotifications(peer: WebSocketPeer): Promise<void> {
  const state = getPeerState(peer)
  if (!state || state.closed || state.ticking || !state.connectionId) {
    return
  }

  state.ticking = true
  try {
    await touchWsConnection(state)

    let offset = 0
    let next:
      | Awaited<ReturnType<typeof listCliNotifications>>[number]
      | undefined

    while (!next) {
      const notifications = await listCliNotifications({
        target: state.target,
        connectionId: state.connectionId,
        after: state.cursor.createdAt,
        limit: CLI_NOTIFICATION_BATCH_SIZE,
        offset,
      })

      next = notifications.find((notification) =>
        isCliNotificationAfterCursor(notification, state.cursor),
      )
      if (next || notifications.length < CLI_NOTIFICATION_BATCH_SIZE) {
        break
      }

      offset += notifications.length
    }

    if (!next) {
      return
    }

    state.cursor = toCliNotificationCursor(next)
    await touchWsConnection(state, true)
    sendJson(peer, {
      id: next.id,
      type: 'admin_notification',
      data: {
        id: next.id,
        title: next.title,
        body: next.body,
        kind: next.kind,
        flowType: next.flowType,
        target: next.target,
        cliConnectionId: next.cliConnectionId,
        payload: next.payload,
        createdAt: next.createdAt.toISOString(),
      },
    })
  } finally {
    state.ticking = false
  }
}

function parseClientMessage(
  message: WebSocketMessage,
): Record<string, unknown> {
  const parsed = JSON.parse(message.text()) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliRpcError('WebSocket message must be a JSON object.', 400)
  }

  return parsed as Record<string, unknown>
}

function readRequestId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function readAction(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

async function handleRpcRequest(
  peer: WebSocketPeer,
  request: Record<string, unknown>,
): Promise<void> {
  const state = getPeerState(peer)
  const requestId = readRequestId(request.requestId)
  if (!requestId) {
    throw new CliRpcError('requestId is required.', 400)
  }
  if (!state?.connectionId) {
    throw new CliRpcError('CLI connection is not registered yet.', 409)
  }

  const action = readAction(request.action)
  let data: unknown

  if (action === 'claim_task') {
    data = await claimCliFlowTaskForRpc(state.connectionId)
  } else if (action === 'update_runtime_state') {
    data = await updateCliConnectionRuntimeStateForRpc({
      connectionId: state.connectionId,
      body: request.data,
      fallbackBrowserLimit: state.browserLimit,
    })
  } else if (action === 'update_task_status') {
    const payload = request.data
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new CliRpcError('Task status payload must be an object.', 400)
    }

    const { taskId, ...body } = payload as Record<string, unknown>
    if (typeof taskId !== 'string' || !taskId.trim()) {
      throw new CliRpcError('taskId is required.', 400)
    }

    data = await updateCliFlowTaskStatusForRpc({
      connectionId: state.connectionId,
      taskId: taskId.trim(),
      body,
    })
  } else {
    throw new CliRpcError(`Unsupported CLI WebSocket action: ${action}`, 400)
  }

  sendJson(peer, {
    type: 'response',
    requestId,
    ok: true,
    data,
  })
}

function sendRpcError(
  peer: WebSocketPeer,
  requestId: string | undefined,
  error: unknown,
): void {
  const status = error instanceof CliRpcError ? error.status : 500
  const message =
    error instanceof Error ? error.message : 'Unable to process CLI request.'

  sendJson(peer, {
    type: requestId ? 'response' : 'error',
    ...(requestId ? { requestId } : {}),
    ok: false,
    error: {
      status,
      message,
    },
  })
}

export default defineWebSocketHandler({
  async upgrade(request) {
    return {
      context: {
        cliWs: await buildPeerState(request),
      },
    }
  },
  async open(peer) {
    const state = getPeerState(peer)
    if (!state) {
      peer.close(1011, 'Missing CLI WebSocket state.')
      return
    }

    const { auth } = state
    const connection = await registerCliConnection({
      sessionRef:
        auth.sessionUser?.session.id ||
        (auth.serviceClientAuthorized && auth.bearerContext?.clientId
          ? `client_credentials:${auth.bearerContext.clientId}`
          : null),
      userId: auth.sessionUser?.user.id || null,
      authClientId:
        auth.bearerContext?.clientId ||
        (auth.sessionUser?.session.id.startsWith('oidc:')
          ? auth.sessionUser.session.id.slice('oidc:'.length)
          : null),
      workerId: state.workerId,
      cliName: state.cliName,
      target: state.target,
      userAgent: readOptionalHeader(peer.request, 'user-agent'),
      registeredFlows: state.registeredFlows,
      storageStateIdentityIds: state.storageStateIdentityIds,
      storageStateEmails: state.storageStateEmails,
      connectionPath: '/api/cli/ws',
    })

    state.connectionId = connection.id
    state.browserLimit = connection.browserLimit

    sendJson(peer, {
      type: 'cli_connection',
      data: {
        connectionId: connection.id,
        workerId: connection.workerId || undefined,
        cliName: state.cliName,
        target: state.target,
        browserLimit: connection.browserLimit,
        connectedAt: connection.connectedAt.toISOString(),
      },
    })

    state.pollInterval = setInterval(() => {
      void pollCliNotifications(peer).catch(() => {
        closePeerState(state)
        peer.close(1011, 'Unable to poll CLI notifications.')
      })
    }, CLI_EVENT_POLL_INTERVAL_MS)
    state.keepaliveInterval = setInterval(() => {
      sendJson(peer, {
        type: 'keepalive',
        data: { ok: true },
      })
    }, CLI_KEEPALIVE_MS)

    await touchWsConnection(state, true)
    await pollCliNotifications(peer)
  },
  async message(peer, message) {
    let requestId: string | undefined
    try {
      const request = parseClientMessage(message)
      requestId = readRequestId(request.requestId) || undefined
      if (request.type === 'pong') {
        return
      }
      if (request.type !== 'request') {
        throw new CliRpcError('Unsupported CLI WebSocket message type.', 400)
      }
      await handleRpcRequest(peer, request)
    } catch (error) {
      sendRpcError(peer, requestId, error)
    }
  },
  close(peer) {
    const state = getPeerState(peer)
    if (state) {
      closePeerState(state)
    }
  },
  error(peer) {
    const state = getPeerState(peer)
    if (state) {
      closePeerState(state)
    }
  },
})
