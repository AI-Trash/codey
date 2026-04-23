import { createFileRoute } from '@tanstack/react-router'
import { requireAdminPermission } from '../../../../../lib/server/auth'
import {
  isSharedCliConnection,
  listAdminCliConnectionStateForActor,
  type AdminCliConnectionSummary,
} from '../../../../../lib/server/cli-connections'
import { dispatchCliFlowTasks } from '../../../../../lib/server/cli-tasks'
import { createFlowAppRequest } from '../../../../../lib/server/admin'
import { json, text } from '../../../../../lib/server/http'
import { readJsonBody } from '../../../../../lib/server/request'
import { findAdminManagedWorkspaceSummary } from '../../../../../lib/server/workspaces'

interface StartWorkspaceCodexOAuthBody {
  connectionId?: string
}

function isConnectionBusy(connection: AdminCliConnectionSummary) {
  return Boolean(
    connection.runtimeFlowId &&
      !connection.runtimeFlowCompletedAt &&
      connection.runtimeFlowStatus !== 'completed',
  )
}

function getConnectionLabel(connection: AdminCliConnectionSummary) {
  return (
    connection.cliName ||
    connection.target ||
    connection.authClientId ||
    'CLI'
  )
}

function sortCodexOAuthCapableConnections(
  connections: AdminCliConnectionSummary[],
): AdminCliConnectionSummary[] {
  return [...connections].sort((left, right) => {
    const sharedDelta =
      Number(isSharedCliConnection(right)) - Number(isSharedCliConnection(left))
    if (sharedDelta) {
      return sharedDelta
    }

    const busyDelta = Number(isConnectionBusy(left)) - Number(isConnectionBusy(right))
    if (busyDelta) {
      return busyDelta
    }

    return (
      new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime()
    )
  })
}

function buildWorkspaceCodexOAuthNotes(input: {
  workspaceId: string
  workspaceLabel?: string | null
  ownerIdentityId: string
}) {
  return [
    `Workspace: ${input.workspaceLabel || input.workspaceId}`,
    `Workspace ID: ${input.workspaceId}`,
    `Owner identity: ${input.ownerIdentityId}`,
    'Codey will pass this workspace ID into the Codex OAuth flow.',
  ].join('\n')
}

export const Route = createFileRoute(
  '/api/admin/workspaces/$workspaceId/codex-oauth',
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

        const workspace = await findAdminManagedWorkspaceSummary(params.workspaceId)
        if (!workspace) {
          return text('Workspace not found', 404)
        }

        if (!workspace.owner?.identityId) {
          return text(
            'Workspace owner identity is required before starting Codex OAuth',
            400,
          )
        }

        const body = await readJsonBody<StartWorkspaceCodexOAuthBody>(request)
        const requestedConnectionId = String(body.connectionId || '').trim()
        const actor = {
          userId: admin.user.id,
          githubLogin: admin.user.githubLogin,
          email: admin.user.email,
        }

        try {
          const connectionId =
            requestedConnectionId ||
            sortCodexOAuthCapableConnections(
              (
                await listAdminCliConnectionStateForActor(actor)
              ).activeConnections.filter((connection) =>
                connection.registeredFlows.includes('codex-oauth'),
              ),
            )[0]?.id

          if (connectionId) {
            const result = await dispatchCliFlowTasks({
              connectionId,
              flowId: 'codex-oauth',
              actor,
              config: {
                identityId: workspace.owner.identityId,
                workspaceId: workspace.workspaceId,
              },
            })

            return json({
              ok: true,
              mode: 'dispatch' as const,
              queuedCount: result.tasks.length,
              connectionId: result.connection.id,
              connectionLabel: getConnectionLabel(result.connection),
            })
          }

          const flowRequest = await createFlowAppRequest({
            appName: workspace.label || workspace.workspaceId,
            flowType: 'codex-oauth',
            requestedBy:
              admin.user.githubLogin || admin.user.email || admin.user.name || undefined,
            requestedIdentity: workspace.owner.identityId,
            notes: buildWorkspaceCodexOAuthNotes({
              workspaceId: workspace.workspaceId,
              workspaceLabel: workspace.label,
              ownerIdentityId: workspace.owner.identityId,
            }),
          })

          return json(
            {
              ok: true,
              mode: 'request' as const,
              requestId: flowRequest.id,
            },
            201,
          )
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to start workspace Codex OAuth flow',
            400,
          )
        }
      },
    },
  },
})
