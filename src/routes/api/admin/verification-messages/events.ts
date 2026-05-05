import { createFileRoute } from '@tanstack/react-router'

import { requireAdminPermission } from '../../../../lib/server/auth'
import { text } from '../../../../lib/server/http'
import { subscribeAdminVerificationMessageEvents } from '../../../../lib/server/admin-inbox-events'
import { createSubscriptionSseResponse } from '../../../../lib/server/sse'
import { listAdminVerificationMessagesAfterCursor } from '../../../../lib/server/verification'

const ADMIN_INBOX_BACKLOG_BATCH_SIZE = 100

function compareVerificationMessageCursor(left: string, right: string) {
  const [leftCreatedAt, leftId = ''] = left.split('|')
  const [rightCreatedAt, rightId = ''] = right.split('|')

  if (leftCreatedAt < rightCreatedAt) {
    return -1
  }

  if (leftCreatedAt > rightCreatedAt) {
    return 1
  }

  return leftId.localeCompare(rightId)
}

export const Route = createFileRoute('/api/admin/verification-messages/events')(
  {
    server: {
      handlers: {
        GET: async ({ request }) => {
          try {
            await requireAdminPermission(request, 'VERIFICATION_MESSAGES')
          } catch (error) {
            return text(
              error instanceof Error ? error.message : 'Unauthorized',
              401,
            )
          }

          const url = new URL(request.url)
          let cursor =
            request.headers.get('last-event-id') ||
            url.searchParams.get('after') ||
            null

          return createSubscriptionSseResponse({
            request,
            subscribe: async ({ send }) => {
              const pendingMessages = [] as Awaited<
                ReturnType<typeof listAdminVerificationMessagesAfterCursor>
              >
              let backlogReady = false

              const sendMessage = (
                message: Awaited<
                  ReturnType<typeof listAdminVerificationMessagesAfterCursor>
                >[number],
              ) => {
                if (
                  cursor &&
                  compareVerificationMessageCursor(message.cursor, cursor) <= 0
                ) {
                  return
                }

                cursor = message.cursor

                send({
                  id: message.cursor,
                  event: 'message',
                  data: message,
                })
              }

              const flushPendingMessages = () => {
                pendingMessages
                  .sort((left, right) =>
                    compareVerificationMessageCursor(left.cursor, right.cursor),
                  )
                  .forEach(sendMessage)

                pendingMessages.length = 0
              }

              const unsubscribe = subscribeAdminVerificationMessageEvents(
                (message) => {
                  if (!backlogReady) {
                    pendingMessages.push(message)
                    return
                  }

                  sendMessage(message)
                },
              )

              try {
                while (true) {
                  const backlogMessages =
                    await listAdminVerificationMessagesAfterCursor({
                      cursor,
                      limit: ADMIN_INBOX_BACKLOG_BATCH_SIZE,
                    })

                  if (!backlogMessages.length) {
                    break
                  }

                  for (const message of backlogMessages) {
                    sendMessage(message)
                  }

                  if (backlogMessages.length < ADMIN_INBOX_BACKLOG_BATCH_SIZE) {
                    break
                  }
                }
              } catch (error) {
                unsubscribe()
                throw error
              }

              backlogReady = true
              flushPendingMessages()

              return () => {
                backlogReady = true
                pendingMessages.length = 0
                unsubscribe()
              }
            },
          })
        },
      },
    },
  },
)
