import { createFileRoute } from '@tanstack/react-router'

import { requireAdminPermission } from '../../../../../lib/server/auth'
import { json, text } from '../../../../../lib/server/http'
import { readJsonBody } from '../../../../../lib/server/request'
import { startWorkspaceInviteAuthorizeWorkflow } from '../../../../../lib/server/workspace-invite-authorize'

interface StartWorkspaceInviteAuthorizeBody {
  connectionId?: string
}

export const Route = createFileRoute(
  '/api/admin/workspaces/$workspaceId/invite-and-authorize',
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        let admin: Awaited<ReturnType<typeof requireAdminPermission>>
        try {
          admin = await requireAdminPermission(request, 'CLI_OPERATIONS')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        const body =
          await readJsonBody<StartWorkspaceInviteAuthorizeBody>(request)
        const connectionId = String(body.connectionId || '').trim() || undefined
        const actor = {
          userId: admin.user.id,
          githubLogin: admin.user.githubLogin,
          email: admin.user.email,
        }

        try {
          const result = await startWorkspaceInviteAuthorizeWorkflow({
            workspaceRecordId: params.workspaceId,
            actor,
            connectionId,
          })

          return json({
            ok: true,
            mode: 'dispatch' as const,
            workflowId: result.workflowId,
            workspace: result.workspace,
            memberEmails: result.memberEmails,
            queuedLoginCount: result.queuedLoginCount,
            assignedCliCount: result.assignedCliCount,
            connectionId: result.connectionId,
            connectionLabel: result.connectionLabel,
          })
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unable to start workspace invite and authorize workflow'
          const status = message === 'Workspace not found' ? 404 : 400
          return text(message, status)
        }
      },
    },
  },
})
