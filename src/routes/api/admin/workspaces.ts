import { createFileRoute } from '@tanstack/react-router'
import { requireAdminPermission } from '../../../lib/server/auth'
import { json, text } from '../../../lib/server/http'
import { readJsonBody } from '../../../lib/server/request'
import {
  createManagedWorkspace,
  deleteManagedWorkspace,
  updateManagedWorkspace,
} from '../../../lib/server/workspaces'

interface AdminWorkspaceMutationBody {
  intent?: string
  id?: string
  workspaceId?: string
  label?: string
  memberEmails?: string[] | string
}

function readMemberEmails(value: unknown): string[] | null | undefined {
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

export const Route = createFileRoute('/api/admin/workspaces')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireAdminPermission(request, 'MANAGED_IDENTITIES')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        const body = await readJsonBody<AdminWorkspaceMutationBody>(request)
        const intent = String(body.intent || 'save').trim().toLowerCase()

        try {
          if (intent === 'delete') {
            const id = String(body.id || '').trim()
            if (!id) {
              return text('id is required', 400)
            }

            const record = await deleteManagedWorkspace(id)
            if (!record) {
              return text('Workspace not found', 404)
            }

            return json({
              ok: true,
              id: record.id,
            })
          }

          const workspaceId = String(body.workspaceId || '').trim()
          const memberEmails = readMemberEmails(body.memberEmails)

          if (!workspaceId) {
            return text('workspaceId is required', 400)
          }
          if (memberEmails === null) {
            return text(
              'memberEmails must be a string array or comma-separated string',
              400,
            )
          }

          const workspace = body.id
            ? await updateManagedWorkspace(String(body.id).trim(), {
                workspaceId,
                label: String(body.label || ''),
                memberEmails: memberEmails ?? [],
              })
            : await createManagedWorkspace({
                workspaceId,
                label: String(body.label || ''),
                memberEmails: memberEmails ?? [],
              })

          if (!workspace) {
            return text('Workspace not found', 404)
          }

          return json({
            ok: true,
            workspace,
          })
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unable to save workspace',
            400,
          )
        }
      },
    },
  },
})
