import { createFileRoute } from '@tanstack/react-router'
import { listCliNotifications } from '../../../lib/server/admin'
import { text } from '../../../lib/server/http'
import {
  isCliNotificationAfterCursor,
  toCliNotificationCursor,
  type CliNotificationCursor,
} from '../../../lib/server/cli-notification-cursor'
import { NOTIFICATIONS_READ_SCOPE } from '../../../lib/server/oauth-scopes'
import { getBearerTokenContext } from '../../../lib/server/oauth-resource'
import { getCliSessionUser } from '../../../lib/server/auth'
import {
  markCliConnectionDisconnected,
  registerCliConnection,
  touchCliConnection,
} from '../../../lib/server/cli-connections'
import { createSubscriptionSseResponse } from '../../../lib/server/sse'

const CLI_EVENT_POLL_INTERVAL_MS = 2000
const CLI_EVENT_TIMEOUT_MS = 10 * 60 * 1000
const CLI_CONNECTION_TOUCH_INTERVAL_MS = 10_000
const CLI_NOTIFICATION_BATCH_SIZE = 50

function readOptionalHeader(
  request: Request,
  name: string,
): string | undefined {
  const value = request.headers.get(name)
  const normalized = value?.trim()
  return normalized || undefined
}

function readListHeader(request: Request, name: string): string[] {
  const value = readOptionalHeader(request, name)
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

export const Route = createFileRoute('/api/cli/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const sessionUser = await getCliSessionUser(request)
        const bearerContext = await getBearerTokenContext(request)
        const serviceClientAuthorized =
          bearerContext?.kind === 'client_credentials' &&
          bearerContext.scope.includes(NOTIFICATIONS_READ_SCOPE)

        if (!sessionUser && !serviceClientAuthorized) {
          return text('CLI authentication required', 401)
        }

        const url = new URL(request.url)
        const target =
          url.searchParams.get('target') ||
          sessionUser?.user.githubLogin ||
          sessionUser?.user.email ||
          undefined
        const cliName =
          url.searchParams.get('cliName') ||
          readOptionalHeader(request, 'x-codey-cli-name') ||
          'codey'
        let cursor: CliNotificationCursor = {
          createdAt: url.searchParams.get('after')
            ? new Date(url.searchParams.get('after') as string)
            : new Date(),
          id: undefined,
        }

        return createSubscriptionSseResponse({
          request,
          subscribe: async ({ send, close }) => {
            const connection = await registerCliConnection({
              sessionRef:
                sessionUser?.session.id ||
                (serviceClientAuthorized && bearerContext?.clientId
                  ? `client_credentials:${bearerContext.clientId}`
                  : null),
              userId: sessionUser?.user.id || null,
              authClientId:
                bearerContext?.clientId ||
                (sessionUser?.session.id.startsWith('oidc:')
                  ? sessionUser.session.id.slice('oidc:'.length)
                  : null),
              cliName,
              target,
              userAgent: readOptionalHeader(request, 'user-agent'),
              registeredFlows: readListHeader(
                request,
                'x-codey-registered-flows',
              ),
              connectionPath: '/api/cli/events',
            })

            send({
              event: 'cli_connection',
              data: {
                connectionId: connection.id,
                cliName,
                target,
                connectedAt: connection.connectedAt.toISOString(),
              },
            })

            let closed = false
            let ticking = false
            let lastTouchedAt = 0

            const touchConnection = async (force = false) => {
              const now = Date.now()
              if (
                !force &&
                now - lastTouchedAt < CLI_CONNECTION_TOUCH_INTERVAL_MS
              ) {
                return
              }

              lastTouchedAt = now
              await touchCliConnection(connection.id)
            }

            const runTick = async () => {
              if (closed || ticking) {
                return
              }

              ticking = true
              try {
                await touchConnection()

                let offset = 0
                let next:
                  | Awaited<ReturnType<typeof listCliNotifications>>[number]
                  | undefined

                while (!next) {
                  const notifications = await listCliNotifications({
                    target,
                    connectionId: connection.id,
                    after: cursor.createdAt,
                    limit: CLI_NOTIFICATION_BATCH_SIZE,
                    offset,
                  })

                  next = notifications.find((notification) =>
                    isCliNotificationAfterCursor(notification, cursor),
                  )
                  if (
                    next ||
                    notifications.length < CLI_NOTIFICATION_BATCH_SIZE
                  ) {
                    break
                  }

                  offset += notifications.length
                }

                if (!next) {
                  return
                }

                cursor = toCliNotificationCursor(next)
                await touchConnection(true)
                send({
                  id: next.id,
                  event: 'admin_notification',
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
                ticking = false
              }
            }

            const interval = setInterval(() => {
              void runTick().catch(() => {
                close()
              })
            }, CLI_EVENT_POLL_INTERVAL_MS)

            const timeout = setTimeout(() => {
              if (closed) {
                return
              }

              send({
                event: 'timeout',
                data: { status: 'timeout' },
              })
              close()
            }, CLI_EVENT_TIMEOUT_MS)

            try {
              await touchConnection(true)
              await runTick()
            } catch (error) {
              closed = true
              clearInterval(interval)
              clearTimeout(timeout)
              await markCliConnectionDisconnected(connection.id)
              throw error
            }

            return () => {
              if (closed) {
                return
              }

              closed = true
              clearInterval(interval)
              clearTimeout(timeout)
              void markCliConnectionDisconnected(connection.id)
            }
          },
        })
      },
    },
  },
})
