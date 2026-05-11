import { createFileRoute } from '@tanstack/react-router'
import { requireAdminPermission } from '../../../../../lib/server/auth'
import { json, text } from '../../../../../lib/server/http'
import { exportPersonalMailboxAccessToken } from '../../../../../lib/server/personal-mailboxes'

export const Route = createFileRoute(
  '/api/admin/personal-mailboxes/$mailboxId/access-token',
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          await requireAdminPermission(request, 'VERIFICATION_DOMAINS')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        try {
          const token = await exportPersonalMailboxAccessToken(params.mailboxId)
          if (!token) {
            return text('Personal mailbox not found', 404)
          }

          return json({ token })
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to export personal mailbox access token',
            400,
          )
        }
      },
    },
  },
})
