import '@tanstack/react-start/server-only'

import { listCliNotifications } from './admin'
import {
  markCliConnectionDisconnected,
  registerCliConnection,
  touchCliConnection,
} from './cli-connections'
import {
  isCliNotificationAfterCursor,
  toCliNotificationCursor,
  type CliNotificationCursor,
} from './cli-notification-cursor'

export const CLI_EVENT_POLL_INTERVAL_MS = 2000
export const CLI_EVENT_TIMEOUT_MS = 10 * 60 * 1000
export const CLI_CONNECTION_TOUCH_INTERVAL_MS = 10_000
export const CLI_NOTIFICATION_BATCH_SIZE = 50

export interface CliEventStreamContext {
  sessionRef?: string | null
  userId?: string | null
  authClientId?: string | null
  target?: string
  cliName?: string
  workerId?: string
  userAgent?: string
  registeredFlows?: string[]
  connectionPath: string
  after?: string | null
}

export interface SerializedCliEvent {
  event: 'cli_connection' | 'admin_notification'
  data: Record<string, unknown>
}

export function buildInitialCliCursor(after?: string | null): CliNotificationCursor {
  return {
    createdAt: after ? new Date(after) : new Date(),
    id: undefined,
  }
}

export async function registerCliEventConnection(input: CliEventStreamContext) {
  const connection = await registerCliConnection({
    sessionRef: input.sessionRef || null,
    userId: input.userId || null,
    authClientId: input.authClientId || null,
    workerId: input.workerId,
    cliName: input.cliName || 'codey',
    target: input.target,
    userAgent: input.userAgent,
    registeredFlows: input.registeredFlows,
    connectionPath: input.connectionPath,
  })

  return {
    connection,
    event: {
      event: 'cli_connection' as const,
      data: {
        connectionId: connection.id,
        workerId: connection.workerId || undefined,
        cliName: connection.cliName || undefined,
        target: connection.target || undefined,
        connectedAt: connection.connectedAt.toISOString(),
      },
    },
  }
}

export async function listPendingCliEvents(input: {
  cursor: CliNotificationCursor
  target?: string
  workerId?: string
}) {
  let offset = 0
  let next: Awaited<ReturnType<typeof listCliNotifications>>[number] | undefined

  while (!next) {
    const notifications = await listCliNotifications({
      after: input.cursor.createdAt,
      target: input.target,
      workerId: input.workerId,
      limit: CLI_NOTIFICATION_BATCH_SIZE,
      offset,
    })

    if (!notifications.length) {
      break
    }

    for (const notification of notifications) {
      if (isCliNotificationAfterCursor(notification, input.cursor)) {
        next = notification
        break
      }
    }

    if (notifications.length < CLI_NOTIFICATION_BATCH_SIZE) {
      break
    }

    offset += notifications.length
  }

  if (!next) {
    return null
  }

  return {
    cursor: toCliNotificationCursor(next),
    event: {
      event: 'admin_notification' as const,
      data: {
        id: next.id,
        title: next.title,
        body: next.body,
        kind: next.kind || undefined,
        flowType: next.flowType || undefined,
        target: next.target || undefined,
        cliConnectionId: next.cliConnectionId || undefined,
        payload: next.payload || undefined,
        createdAt: next.createdAt.toISOString(),
      },
    },
  }
}

export async function markCliEventConnectionDisconnected(connectionId: string) {
  await markCliConnectionDisconnected(connectionId)
}

export async function touchCliEventConnection(connectionId: string) {
  await touchCliConnection(connectionId)
}

