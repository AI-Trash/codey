import { createFileRoute } from '@tanstack/react-router'
import { requireAdminPermission } from '../../../../../lib/server/auth'
import { json, text } from '../../../../../lib/server/http'
import { readJsonBody } from '../../../../../lib/server/request'
import { resetManagedWorkspaceAuthorizationStatuses } from '../../../../../lib/server/workspaces'

interface ResetWorkspaceAuthorizationBody {
  memberIds?: string[] | string
}

function readStringList(value: unknown): string[] | null | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value === 'string') {
    return value
      .split(/[\r\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
  ) {
    return value
  }

  return null
}

export const Route = createFileRoute(
  '/api/admin/workspaces/$workspaceId/reset-authorization',
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          await requireAdminPermission(request, 'MANAGED_IDENTITIES')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        const body =
          await readJsonBody<ResetWorkspaceAuthorizationBody>(request)
        const memberIds = readStringList(body.memberIds)
        if (memberIds === null) {
          return text(
            'memberIds must be a string array or comma-separated string',
            400,
          )
        }

        try {
          const result = await resetManagedWorkspaceAuthorizationStatuses({
            id: params.workspaceId,
            memberIds,
          })

          return json({
            ok: true,
            workspace: result.workspace,
            resetCount: result.resetCount,
          })
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unable to reset workspace authorization statuses'
          const status = message === 'Workspace not found' ? 404 : 400
          return text(message, status)
        }
      },
    },
  },
})
