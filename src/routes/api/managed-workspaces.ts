import { createFileRoute } from '@tanstack/react-router'
import {
  resolveAssociatedManagedWorkspace,
  syncManagedWorkspaceInvite,
} from '../../lib/server/workspaces'
import { json, text } from '../../lib/server/http'
import { requireBearerToken } from '../../lib/server/oauth-resource'
import { VERIFICATION_RESERVE_SCOPE } from '../../lib/server/oauth-scopes'
import { readJsonBody } from '../../lib/server/request'

interface ManagedWorkspaceSyncBody {
  workspaceId?: string
  label?: string
  ownerIdentityId?: string | null
  memberIdentityIds?: string[]
  memberEmails?: string[]
  confirmedInviteEmails?: string[]
  failedInviteEmails?: string[]
}

function readStringArray(value: unknown): string[] | null | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
  ) {
    return value
  }

  return null
}

function readOptionalIdentityId(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized ? normalized : null
}

export const Route = createFileRoute('/api/managed-workspaces')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireBearerToken(request, {
            scopes: [VERIFICATION_RESERVE_SCOPE],
          })
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        const url = new URL(request.url)
        const identityId = url.searchParams.get('identityId') || undefined
        const email = url.searchParams.get('email') || undefined

        if (!identityId && !email) {
          return text('identityId or email is required', 400)
        }

        const workspace = await resolveAssociatedManagedWorkspace({
          identityId,
          email,
        })

        return json({ workspace })
      },
      POST: async ({ request }) => {
        try {
          await requireBearerToken(request, {
            scopes: [VERIFICATION_RESERVE_SCOPE],
          })
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        const body = await readJsonBody<ManagedWorkspaceSyncBody>(request)
        const workspaceId = String(body.workspaceId || '').trim()
        const ownerIdentityId = readOptionalIdentityId(body.ownerIdentityId)
        const memberIdentityIds = readStringArray(body.memberIdentityIds)
        const memberEmails = readStringArray(body.memberEmails)
        const confirmedInviteEmails = readStringArray(
          body.confirmedInviteEmails,
        )
        const failedInviteEmails = readStringArray(body.failedInviteEmails)

        if (!workspaceId) {
          return text('workspaceId is required', 400)
        }
        if (memberIdentityIds === null) {
          return text('memberIdentityIds must be a string array', 400)
        }
        if (memberEmails === null) {
          return text('memberEmails must be a string array', 400)
        }
        if (confirmedInviteEmails === null) {
          return text('confirmedInviteEmails must be a string array', 400)
        }
        if (failedInviteEmails === null) {
          return text('failedInviteEmails must be a string array', 400)
        }

        const workspace = await syncManagedWorkspaceInvite({
          workspaceId,
          label: String(body.label || '').trim() || undefined,
          ownerIdentityId,
          memberIdentityIds,
          memberEmails: memberEmails ?? [],
          confirmedInviteEmails: confirmedInviteEmails ?? [],
          failedInviteEmails: failedInviteEmails ?? [],
        })

        return json({
          ok: true,
          workspace,
        })
      },
    },
  },
})
