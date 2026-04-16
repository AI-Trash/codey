import { createFileRoute } from '@tanstack/react-router'

import { requireAdmin } from '../../../../lib/server/auth'
import { text } from '../../../../lib/server/http'
import { createPollingSseResponse } from '../../../../lib/server/sse'
import { listAdminInboxEmailsAfterCursor } from '../../../../lib/server/verification'

export const Route = createFileRoute('/api/admin/emails/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdmin(request)
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

        return createPollingSseResponse({
          intervalMs: 2000,
          timeoutMs: 120000,
          loadEvent: async () => {
            const nextEmail = (
              await listAdminInboxEmailsAfterCursor({
                cursor,
                limit: 1,
              })
            )[0]

            if (!nextEmail) {
              return null
            }

            cursor = nextEmail.cursor

            return {
              id: nextEmail.cursor,
              event: 'email',
              data: nextEmail,
            }
          },
        })
      },
    },
  },
})
