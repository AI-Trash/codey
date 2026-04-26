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

interface StartWorkspaceTeamTrialBody {
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
    connection.cliName || connection.target || connection.authClientId || 'CLI'
  )
}

function sortTeamTrialCapableConnections(
  connections: AdminCliConnectionSummary[],
): AdminCliConnectionSummary[] {
  return [...connections].sort((left, right) => {
    const sharedDelta =
      Number(isSharedCliConnection(right)) - Number(isSharedCliConnection(left))
    if (sharedDelta) {
      return sharedDelta
    }

    const busyDelta =
      Number(isConnectionBusy(left)) - Number(isConnectionBusy(right))
    if (busyDelta) {
      return busyDelta
    }

    return (
      new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime()
    )
  })
}

function buildWorkspaceTeamTrialNotes(input: {
  workspaceId?: string | null
  workspaceLabel?: string | null
  ownerEmail: string
  ownerIdentityId?: string | null
}) {
  return [
    `Workspace: ${input.workspaceLabel || input.workspaceId || 'Workspace'}`,
    ...(input.workspaceId ? [`Workspace ID: ${input.workspaceId}`] : []),
    `Owner email: ${input.ownerEmail}`,
    ...(input.ownerIdentityId
      ? [`Owner identity: ${input.ownerIdentityId}`]
      : []),
    'Flow: chatgpt-team-trial',
  ].join('\n')
}

export const Route = createFileRoute(
  '/api/admin/workspaces/$workspaceId/team-trial',
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

        const workspace = await findAdminManagedWorkspaceSummary(
          params.workspaceId,
        )
        if (!workspace) {
          return text('Workspace not found', 404)
        }

        const ownerEmail = workspace.owner?.email.trim().toLowerCase()
        if (!ownerEmail) {
          return text(
            'Workspace owner email is required before starting Team trial',
            400,
          )
        }

        const body = await readJsonBody<StartWorkspaceTeamTrialBody>(request)
        const requestedConnectionId = String(body.connectionId || '').trim()
        const actor = {
          userId: admin.user.id,
          githubLogin: admin.user.githubLogin,
          email: admin.user.email,
        }

        try {
          const connectionId =
            requestedConnectionId ||
            sortTeamTrialCapableConnections(
              (
                await listAdminCliConnectionStateForActor(actor)
              ).activeConnections.filter((connection) =>
                connection.registeredFlows.includes('chatgpt-team-trial'),
              ),
            )[0]?.id

          if (connectionId) {
            const result = await dispatchCliFlowTasks({
              connectionId,
              flowId: 'chatgpt-team-trial',
              actor,
              config: {
                email: ownerEmail,
              },
              metadata: {
                workspace: {
                  recordId: workspace.id,
                  ...(workspace.workspaceId
                    ? { workspaceId: workspace.workspaceId }
                    : {}),
                  ...(workspace.label ? { label: workspace.label } : {}),
                  ...(workspace.owner?.identityId
                    ? { ownerIdentityId: workspace.owner.identityId }
                    : {}),
                },
              },
            })

            return json({
              ok: true,
              mode: 'dispatch' as const,
              queuedCount: result.tasks.length,
              assignedCliCount: result.assignedCliCount,
              ownerEmail,
              connectionId: result.connection.id,
              connectionLabel: getConnectionLabel(result.connection),
            })
          }

          const flowRequest = await createFlowAppRequest({
            appName: workspace.label || workspace.workspaceId || 'Workspace',
            flowType: 'chatgpt-team-trial',
            requestedBy:
              admin.user.githubLogin ||
              admin.user.email ||
              admin.user.name ||
              undefined,
            requestedIdentity: workspace.owner?.identityId || undefined,
            notes: buildWorkspaceTeamTrialNotes({
              workspaceId: workspace.workspaceId,
              workspaceLabel: workspace.label,
              ownerEmail,
              ownerIdentityId: workspace.owner?.identityId,
            }),
          })

          return json(
            {
              ok: true,
              mode: 'request' as const,
              requestId: flowRequest.id,
              ownerEmail,
            },
            201,
          )
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to start workspace Team trial flow',
            400,
          )
        }
      },
    },
  },
})
