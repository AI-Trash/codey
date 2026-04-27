import { createFileRoute } from '@tanstack/react-router'

import { requireAdminPermission } from '../../../../../lib/server/auth'
import {
  getAdminCliConnectionSummaryById,
  isCliConnectionOwnedByActor,
  isSharedCliConnection,
  updateCliConnectionSettings,
} from '../../../../../lib/server/cli-connections'
import { json, text } from '../../../../../lib/server/http'

function readBrowserLimit(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN

  if (!Number.isInteger(parsed) || parsed < 1) {
    return null
  }

  return parsed
}

export const Route = createFileRoute(
  '/api/admin/cli-connections/$connectionId/settings',
)({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        let admin: Awaited<ReturnType<typeof requireAdminPermission>>
        try {
          admin = await requireAdminPermission(request, 'CLI_OPERATIONS')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Admin access required',
            401,
          )
        }

        const connection = await getAdminCliConnectionSummaryById(
          params.connectionId,
        )
        if (!connection) {
          return text('CLI connection not found', 404)
        }

        const actor = {
          userId: admin.user.id,
          githubLogin: admin.user.githubLogin,
          email: admin.user.email,
        }
        if (
          !isCliConnectionOwnedByActor(connection, actor) &&
          !isSharedCliConnection(connection)
        ) {
          return text(
            'You can only update your own CLI connection or a shared service-client connection.',
            403,
          )
        }

        let body: Record<string, unknown> | null = null
        try {
          const parsed = await request.json()
          body =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : null
        } catch {
          return text('Invalid JSON body', 400)
        }

        const browserLimit = readBrowserLimit(body?.browserLimit)
        if (browserLimit === null) {
          return text(
            'browserLimit must be a whole number greater than 0.',
            400,
          )
        }

        try {
          await updateCliConnectionSettings(params.connectionId, {
            browserLimit,
          })
          const nextConnection = await getAdminCliConnectionSummaryById(
            params.connectionId,
          )

          return json({
            ok: true,
            connection: nextConnection,
          })
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to update CLI settings',
            400,
          )
        }
      },
    },
  },
})
