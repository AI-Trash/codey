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

function sortCodexOAuthCapableConnections(
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

function buildWorkspaceCodexOAuthNotes(input: {
  workspaceId?: string | null
  workspaceLabel?: string | null
  targetEmails: string[]
}) {
  return [
    `Workspace: ${input.workspaceLabel || input.workspaceId || 'Workspace'}`,
    ...(input.workspaceId ? [`Workspace ID: ${input.workspaceId}`] : []),
    'Authorize workspace owner and members with Codex OAuth:',
    ...input.targetEmails.map((email) => `- ${email}`),
    input.workspaceId
      ? 'Codey will pass this workspace ID into each Codex OAuth flow.'
      : 'Codey will let Codex OAuth use the default workspace selection.',
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

        const workspace = await findAdminManagedWorkspaceSummary(
          params.workspaceId,
        )
        if (!workspace) {
          return text('Workspace not found', 404)
        }

        const body = await readJsonBody<StartWorkspaceCodexOAuthBody>(request)
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

        const selectedTargets = [
          ...(!memberIds?.length && workspace.owner
            ? [
                {
                  email: workspace.owner.email,
                  identityId: workspace.owner.identityId,
                  authorization: workspace.owner.authorization,
                },
              ]
            : []),
          ...selectedMembers.map((member) => ({
            email: member.email,
            identityId: member.identityId,
            authorization: member.authorization,
          })),
        ]
        const pendingTargets = selectedTargets.filter(
          (target) => target.authorization.state !== 'authorized',
        )
        if (!pendingTargets.length) {
          return text(
            'All requested workspace identities are already authorized',
            400,
          )
        }

        const targetEmails = Array.from(
          new Set(
            pendingTargets
              .map((target) => target.email.trim().toLowerCase())
              .filter(Boolean),
          ),
        )
        if (!targetEmails.length) {
          return text('No workspace identities are available to authorize', 400)
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
              configs: targetEmails.map((email) => ({
                email,
                ...(workspace.workspaceId
                  ? { workspaceId: workspace.workspaceId }
                  : {}),
              })),
              metadata: {
                workspace: {
                  recordId: workspace.id,
                  workspaceId: workspace.workspaceId || undefined,
                  label: workspace.label || undefined,
                  ownerIdentityId: workspace.owner?.identityId || undefined,
                },
              },
            })

            return json({
              ok: true,
              mode: 'dispatch' as const,
              queuedCount: result.tasks.length,
              assignedCliCount: result.assignedCliCount,
              memberEmails: targetEmails,
              connectionId: result.connection.id,
              connectionLabel: getConnectionLabel(result.connection),
            })
          }

          const flowRequest = await createFlowAppRequest({
            appName: workspace.label || workspace.workspaceId || 'Workspace',
            flowType: 'codex-oauth',
            requestedBy:
              admin.user.githubLogin ||
              admin.user.email ||
              admin.user.name ||
              undefined,
            requestedIdentity:
              pendingTargets.length === 1
                ? pendingTargets[0]?.identityId || undefined
                : undefined,
            notes: buildWorkspaceCodexOAuthNotes({
              workspaceId: workspace.workspaceId,
              workspaceLabel: workspace.label,
              targetEmails,
            }),
          })

          return json(
            {
              ok: true,
              mode: 'request' as const,
              requestId: flowRequest.id,
              memberEmails: targetEmails,
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
