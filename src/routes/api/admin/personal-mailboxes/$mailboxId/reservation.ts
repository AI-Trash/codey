import { createFileRoute } from '@tanstack/react-router'
import { requireAdminPermission } from '../../../../../lib/server/auth'
import { json, text } from '../../../../../lib/server/http'
import { createManualPersonalMailboxReservation } from '../../../../../lib/server/personal-mailboxes'

export const Route = createFileRoute(
  '/api/admin/personal-mailboxes/$mailboxId/reservation',
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
          const reservation = await createManualPersonalMailboxReservation(
            params.mailboxId,
          )
          if (!reservation) {
            return text('Personal mailbox not found', 404)
          }

          return json({ reservation }, 201)
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to create personal mailbox reservation',
            400,
          )
        }
      },
    },
  },
})
