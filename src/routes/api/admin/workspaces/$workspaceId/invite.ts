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

interface InviteWorkspaceMembersBody {
  memberIds?: string[] | string
  connectionId?: string
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

function sortInviteCapableConnections(
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

function buildWorkspaceInviteNotes(input: {
  workspaceId?: string | null
  workspaceLabel?: string | null
  ownerIdentityId: string
  memberEmails: string[]
}) {
  const lines = [
    `Workspace: ${input.workspaceLabel || input.workspaceId || 'Workspace'}`,
    ...(input.workspaceId ? [`Workspace ID: ${input.workspaceId}`] : []),
    `Owner identity: ${input.ownerIdentityId}`,
    'Invite emails:',
    ...input.memberEmails.map((email) => `- ${email}`),
  ]

  return lines.join('\n')
}

export const Route = createFileRoute(
  '/api/admin/workspaces/$workspaceId/invite',
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

        if (!workspace.owner?.identityId || !workspace.owner.email) {
          return text(
            'Workspace owner identity is required before inviting',
            400,
          )
        }

        const body = await readJsonBody<InviteWorkspaceMembersBody>(request)
        const memberIds = readStringList(body.memberIds)
        if (memberIds === null) {
          return text(
            'memberIds must be a string array or comma-separated string',
            400,
          )
        }

        const selectedMembers = memberIds?.length
          ? workspace.members.filter((member) => memberIds.includes(member.id))
          : workspace.members

        if (
          memberIds?.length &&
          selectedMembers.length !== new Set(memberIds).size
        ) {
          return text('Some requested workspace members were not found', 404)
        }

        if (!selectedMembers.length) {
          return text('No workspace members are available to invite', 400)
        }

        const memberEmails = Array.from(
          new Set(
            selectedMembers
              .map((member) => member.email.trim().toLowerCase())
              .filter(Boolean),
          ),
        )

        if (
          memberEmails.some(
            (email) => email === workspace.owner?.email.trim().toLowerCase(),
          )
        ) {
          return text('Workspace owner cannot also be invited as a member', 400)
        }

        const actor = {
          userId: admin.user.id,
          githubLogin: admin.user.githubLogin,
          email: admin.user.email,
        }
        const requestedConnectionId = String(body.connectionId || '').trim()

        try {
          const connectionId =
            requestedConnectionId ||
            sortInviteCapableConnections(
              (
                await listAdminCliConnectionStateForActor(actor)
              ).activeConnections.filter((connection) =>
                connection.registeredFlows.includes('chatgpt-login-invite'),
              ),
            )[0]?.id

          if (connectionId) {
            const result = await dispatchCliFlowTasks({
              connectionId,
              flowId: 'chatgpt-login-invite',
              actor,
              config: {
                identityId: workspace.owner.identityId,
                inviteEmail: memberEmails,
              },
            })

            return json({
              ok: true,
              mode: 'dispatch' as const,
              queuedCount: result.tasks.length,
              assignedCliCount: result.assignedCliCount,
              memberEmails,
              connectionId: result.connection.id,
              connectionLabel: getConnectionLabel(result.connection),
            })
          }

          const flowRequest = await createFlowAppRequest({
            appName: workspace.label || workspace.workspaceId || 'Workspace',
            flowType: 'chatgpt-login-invite',
            requestedBy:
              admin.user.githubLogin ||
              admin.user.email ||
              admin.user.name ||
              undefined,
            requestedIdentity: workspace.owner.identityId,
            notes: buildWorkspaceInviteNotes({
              workspaceId: workspace.workspaceId,
              workspaceLabel: workspace.label,
              ownerIdentityId: workspace.owner.identityId,
              memberEmails,
            }),
          })

          return json(
            {
              ok: true,
              mode: 'request' as const,
              requestId: flowRequest.id,
              memberEmails,
            },
            201,
          )
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to start workspace invite flow',
            400,
          )
        }
      },
    },
  },
})
