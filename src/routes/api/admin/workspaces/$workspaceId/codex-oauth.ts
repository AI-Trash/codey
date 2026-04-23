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
import { getWorkspaceCodexOAuthParallelism } from '../../../../../lib/server/workspace-codex-oauth'
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

  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
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
  memberEmails: string[]
}) {
  return [
    `Workspace: ${input.workspaceLabel || input.workspaceId}`,
    `Workspace ID: ${input.workspaceId}`,
    'Authorize members with Codex OAuth:',
    ...input.memberEmails.map((email) => `- ${email}`),
    'Codey will pass this workspace ID into each Codex OAuth flow.',
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

        const body = await readJsonBody<StartWorkspaceCodexOAuthBody>(request)
        const memberIds = readStringList(body.memberIds)
        if (memberIds === null) {
          return text(
            'memberIds must be a string array or comma-separated string',
            400,
          )
        }

        const requestedConnectionId = String(body.connectionId || '').trim()
        const selectedMembers = memberIds?.length
          ? workspace.members.filter((member) => memberIds.includes(member.id))
          : workspace.members.filter(
              (member) => member.authorization.state !== 'authorized',
            )

        if (memberIds?.length && selectedMembers.length !== new Set(memberIds).size) {
          return text('Some requested workspace members were not found', 404)
        }

        const pendingMembers = selectedMembers.filter(
          (member) => member.authorization.state !== 'authorized',
        )
        if (!pendingMembers.length) {
          return text('All requested workspace members are already authorized', 400)
        }

        const memberEmails = Array.from(
          new Set(
            pendingMembers
              .map((member) => member.email.trim().toLowerCase())
              .filter(Boolean),
          ),
        )
        if (!memberEmails.length) {
          return text('No workspace members are available to authorize', 400)
        }

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
              parallelism: getWorkspaceCodexOAuthParallelism(memberEmails.length),
              configs: memberEmails.map((email) => ({
                email,
                workspaceId: workspace.workspaceId,
              })),
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
            appName: workspace.label || workspace.workspaceId,
            flowType: 'codex-oauth',
            requestedBy:
              admin.user.githubLogin || admin.user.email || admin.user.name || undefined,
            requestedIdentity:
              pendingMembers.length === 1
                ? pendingMembers[0]?.identityId || undefined
                : undefined,
            notes: buildWorkspaceCodexOAuthNotes({
              workspaceId: workspace.workspaceId,
              workspaceLabel: workspace.label,
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
              : 'Unable to start workspace Codex OAuth flow',
            400,
          )
        }
      },
    },
  },
})
