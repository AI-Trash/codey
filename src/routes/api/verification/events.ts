import { createFileRoute } from '@tanstack/react-router'
import { text } from '../../../lib/server/http'
import { VERIFICATION_READ_SCOPE } from '../../../lib/server/oauth-scopes'
import { requireVerificationAccess } from '../../../lib/server/request'
import { createSubscriptionSseResponse } from '../../../lib/server/sse'
import { subscribeVerificationCodeEvents } from '../../../lib/server/verification-events'
import { listVerificationCodeEventsAfterCursor } from '../../../lib/server/verification'

const VERIFICATION_CODE_BACKLOG_BATCH_SIZE = 100

function compareVerificationCodeCursor(left: string, right: string) {
  const [leftReceivedAt, leftId = ''] = left.split('|')
  const [rightReceivedAt, rightId = ''] = right.split('|')

  if (leftReceivedAt < rightReceivedAt) {
    return -1
  }

  if (leftReceivedAt > rightReceivedAt) {
    return 1
  }

  return leftId.localeCompare(rightId)
}

export const Route = createFileRoute('/api/verification/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authError = await requireVerificationAccess(request, [
          VERIFICATION_READ_SCOPE,
        ])
        if (authError) return authError

        const url = new URL(request.url)
        const email = url.searchParams.get('email')
        const startedAt = url.searchParams.get('startedAt')
        if (!email || !startedAt) {
          return text('email and startedAt are required', 400)
        }
        const normalizedEmail = email.toLowerCase()
        const startedAtDate = new Date(startedAt)
        const normalizedStartedAt = Number.isNaN(startedAtDate.getTime())
          ? new Date(0).toISOString()
          : startedAtDate.toISOString()
        let cursor =
          request.headers.get('last-event-id') ||
          url.searchParams.get('after') ||
          null

        return createSubscriptionSseResponse({
          request,
          subscribe: async ({ send }) => {
            const pendingEvents = [] as Awaited<
              ReturnType<typeof listVerificationCodeEventsAfterCursor>
            >
            let backlogReady = false

            const sendVerificationCode = (
              event: Awaited<
                ReturnType<typeof listVerificationCodeEventsAfterCursor>
              >[number],
            ) => {
              if (
                cursor &&
                compareVerificationCodeCursor(event.cursor, cursor) <= 0
              ) {
                return
              }

              cursor = event.cursor

              send({
                id: event.cursor,
                event: 'verification_code',
                data: event,
              })
            }

            const flushPendingEvents = () => {
              pendingEvents
                .sort((left, right) =>
                  compareVerificationCodeCursor(left.cursor, right.cursor),
                )
                .forEach(sendVerificationCode)

              pendingEvents.length = 0
            }

            const unsubscribe = subscribeVerificationCodeEvents((event) => {
              if (event.email.toLowerCase() !== normalizedEmail) {
                return
              }

              if (event.receivedAt < normalizedStartedAt) {
                return
              }

              if (!backlogReady) {
                pendingEvents.push(event)
                return
              }

              sendVerificationCode(event)
            })

            try {
              while (true) {
                const backlogEvents =
                  await listVerificationCodeEventsAfterCursor({
                    email,
                    startedAt: normalizedStartedAt,
                    cursor,
                    limit: VERIFICATION_CODE_BACKLOG_BATCH_SIZE,
                  })

                if (!backlogEvents.length) {
                  break
                }

                for (const event of backlogEvents) {
                  sendVerificationCode(event)
                }

                if (
                  backlogEvents.length < VERIFICATION_CODE_BACKLOG_BATCH_SIZE
                ) {
                  break
                }
              }
            } catch (error) {
              unsubscribe()
              throw error
            }

            backlogReady = true
            flushPendingEvents()

            return () => {
              backlogReady = true
              pendingEvents.length = 0
              unsubscribe()
            }
          },
        })
      },
    },
  },
})
