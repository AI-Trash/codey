import { createFileRoute } from '@tanstack/react-router'
import { requireAdminPermission } from '../../../lib/server/auth'
import { json, text } from '../../../lib/server/http'
import { listAdminCliConnectionStateForActor } from '../../../lib/server/cli-connections'

export const Route = createFileRoute('/api/admin/cli-connections')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let admin: Awaited<ReturnType<typeof requireAdminPermission>>
        try {
          admin = await requireAdminPermission(request, 'CLI_OPERATIONS')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Admin access required',
            401,
          )
        }

        return json(
          await listAdminCliConnectionStateForActor({
            userId: admin.user.id,
            githubLogin: admin.user.githubLogin,
            email: admin.user.email,
          }),
        )
      },
    },
  },
})
