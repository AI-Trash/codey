import { createFileRoute } from '@tanstack/react-router'
import {
  listManagedIdentityCredentialSummaries,
  resolveManagedIdentityCredential,
  syncManagedIdentity,
} from '../../lib/server/identities'
import {
  normalizeManagedIdentityTags,
  parseManagedIdentityTagsInput,
} from '../../lib/managed-identity-tags'
import { json, text } from '../../lib/server/http'
import { requireBearerToken } from '../../lib/server/oauth-resource'
import { VERIFICATION_RESERVE_SCOPE } from '../../lib/server/oauth-scopes'
import { readJsonBody } from '../../lib/server/request'

interface ManagedIdentitySyncBody {
  identityId?: string
  email?: string
  label?: string
  tags?: string[] | string
  plan?: string
  status?: string
  password?: string
  metadata?: Record<string, unknown>
  credentialCount?: number
  reservationId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readManagedIdentityPlan(
  value: unknown,
): 'free' | 'plus' | 'team' | undefined | null {
  if (value === undefined || value === null) {
    return undefined
  }

  const normalized = String(value).trim().toLowerCase()
  if (!normalized) {
    return undefined
  }

  if (normalized === 'free' || normalized === 'plus' || normalized === 'team') {
    return normalized
  }

  return null
}

function readManagedIdentityStatus(
  value: unknown,
): 'ACTIVE' | 'REVIEW' | 'ARCHIVED' | 'BANNED' | undefined | null {
  if (value === undefined || value === null) {
    return undefined
  }

  const normalized = String(value).trim().toUpperCase()
  if (!normalized) {
    return undefined
  }

  if (
    normalized === 'ACTIVE' ||
    normalized === 'REVIEW' ||
    normalized === 'ARCHIVED' ||
    normalized === 'BANNED'
  ) {
    return normalized
  }

  return null
}

function readManagedIdentityTags(value: unknown): string[] | undefined | null {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value === 'string') {
    return parseManagedIdentityTagsInput(value)
  }

  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
  ) {
    return normalizeManagedIdentityTags(value)
  }

  return null
}

export const Route = createFileRoute('/api/managed-identities')({
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
        const list = url.searchParams.get('list')
        if (list === '1' || list === 'true') {
          const identities = await listManagedIdentityCredentialSummaries()
          return json({ identities })
        }

        const identity = await resolveManagedIdentityCredential({
          identityId: url.searchParams.get('identityId') || undefined,
          email: url.searchParams.get('email') || undefined,
        })

        if (!identity) {
          return text('Managed identity not found', 404)
        }

        return json({ identity })
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

        const body = await readJsonBody<ManagedIdentitySyncBody>(request)
        const identityId = String(body.identityId || '').trim()
        const email = String(body.email || '')
          .trim()
          .toLowerCase()
        const credentialCount =
          body.credentialCount === undefined || body.credentialCount === null
            ? undefined
            : Number(body.credentialCount)

        if (!identityId || !email) {
          return text('identityId and email are required', 400)
        }
        if (
          credentialCount !== undefined &&
          (!Number.isInteger(credentialCount) || credentialCount < 0)
        ) {
          return text('credentialCount must be a non-negative integer', 400)
        }
        if (body.metadata !== undefined && !isRecord(body.metadata)) {
          return text('metadata must be an object', 400)
        }
        const plan = readManagedIdentityPlan(body.plan)
        const status = readManagedIdentityStatus(body.status)
        const tags = readManagedIdentityTags(body.tags)

        if (body.plan !== undefined && plan === null) {
          return text('plan must be one of free, plus, or team', 400)
        }
        if (body.status !== undefined && status === null) {
          return text(
            'status must be one of ACTIVE, REVIEW, ARCHIVED, or BANNED',
            400,
          )
        }
        if (body.tags !== undefined && tags === null) {
          return text(
            'tags must be a string array or comma-separated string',
            400,
          )
        }

        const record = await syncManagedIdentity({
          identityId,
          email,
          label: String(body.label || '').trim() || undefined,
          tags: tags ?? undefined,
          plan: plan ?? undefined,
          status: status ?? undefined,
          password: String(body.password || '').trim() || undefined,
          metadata: body.metadata,
          credentialCount,
          reservationId: String(body.reservationId || '').trim() || undefined,
        })

        return json({ ok: true, id: record.id })
      },
    },
  },
})
