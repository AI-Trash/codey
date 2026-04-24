import { createFileRoute } from '@tanstack/react-router'

import { requireAdminPermission } from '../../../../lib/server/auth'
import { text } from '../../../../lib/server/http'
import { subscribeAdminInboxEmailEvents } from '../../../../lib/server/admin-inbox-events'
import { createSubscriptionSseResponse } from '../../../../lib/server/sse'
import { listAdminInboxEmailsAfterCursor } from '../../../../lib/server/verification'

const ADMIN_INBOX_BACKLOG_BATCH_SIZE = 100

function compareAdminInboxCursor(left: string, right: string) {
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

export const Route = createFileRoute('/api/admin/emails/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdminPermission(request, 'MAIL_INBOX')
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
            const pendingEmails = [] as Awaited<
              ReturnType<typeof listAdminInboxEmailsAfterCursor>
            >
            let backlogReady = false

            const sendEmail = (
              email: Awaited<
                ReturnType<typeof listAdminInboxEmailsAfterCursor>
              >[number],
            ) => {
              if (
                cursor &&
                compareAdminInboxCursor(email.cursor, cursor) <= 0
              ) {
                return
              }

              cursor = email.cursor

              send({
                id: email.cursor,
                event: 'email',
                data: email,
              })
            }

            const flushPendingEmails = () => {
              pendingEmails
                .sort((left, right) =>
                  compareAdminInboxCursor(left.cursor, right.cursor),
                )
                .forEach(sendEmail)

              pendingEmails.length = 0
            }

            const unsubscribe = subscribeAdminInboxEmailEvents((email) => {
              if (!backlogReady) {
                pendingEmails.push(email)
                return
              }

              sendEmail(email)
            })

            try {
              while (true) {
                const backlogEmails = await listAdminInboxEmailsAfterCursor({
                  cursor,
                  limit: ADMIN_INBOX_BACKLOG_BATCH_SIZE,
                })

                if (!backlogEmails.length) {
                  break
                }

                for (const email of backlogEmails) {
                  sendEmail(email)
                }

                if (backlogEmails.length < ADMIN_INBOX_BACKLOG_BATCH_SIZE) {
                  break
                }
              }
            } catch (error) {
              unsubscribe()
              throw error
            }

            backlogReady = true
            flushPendingEmails()

            return () => {
              backlogReady = true
              pendingEmails.length = 0
              unsubscribe()
            }
          },
        })
      },
    },
  },
})
