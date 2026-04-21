import { createFileRoute } from '@tanstack/react-router'
import { getCliSessionUser } from '../../../../../lib/server/auth'
import {
  getAdminCliConnectionSummaryById,
  isCliConnectionOwnedByActor,
  updateCliConnectionRuntimeState,
} from '../../../../../lib/server/cli-connections'
import { json, text } from '../../../../../lib/server/http'
import { NOTIFICATIONS_READ_SCOPE } from '../../../../../lib/server/oauth-scopes'
import { getBearerTokenContext } from '../../../../../lib/server/oauth-resource'

function parseOptionalString(value: unknown): string | null | undefined {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || null
}

function parseOptionalTimestamp(value: unknown): string | null | undefined {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  return Number.isNaN(Date.parse(normalized)) ? undefined : normalized
}

export const Route = createFileRoute(
  '/api/cli/connections/$connectionId/status',
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const sessionUser = await getCliSessionUser(request)
        const bearerContext = await getBearerTokenContext(request)
        const serviceClientAuthorized =
          bearerContext?.kind === 'client_credentials' &&
          bearerContext.scope.includes(NOTIFICATIONS_READ_SCOPE)

        if (!sessionUser && !serviceClientAuthorized) {
          return text('CLI authentication required', 401)
        }

        const connection = await getAdminCliConnectionSummaryById(
          params.connectionId,
        )
        if (!connection) {
          return text('CLI connection not found', 404)
        }

        const actorAuthorized = sessionUser
          ? isCliConnectionOwnedByActor(connection, {
              userId: sessionUser.user.id,
              githubLogin: sessionUser.user.githubLogin,
              email: sessionUser.user.email,
            })
          : false
        const clientAuthorized = Boolean(
          serviceClientAuthorized &&
          bearerContext?.clientId &&
          connection.authClientId === bearerContext.clientId,
        )

        if (!actorAuthorized && !clientAuthorized) {
          return text('CLI connection ownership mismatch', 403)
        }

        let body: Record<string, unknown> | null = null
        try {
          const parsed = await request.json()
          body =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : null
        } catch {
          return text('Invalid JSON body', 400)
        }

        const runtimeFlowStatus = parseOptionalString(body?.runtimeFlowStatus)
        if (
          'runtimeFlowStatus' in (body || {}) &&
          runtimeFlowStatus === undefined
        ) {
          return text('runtimeFlowStatus must be a string or null', 400)
        }

        const runtimeFlowId = parseOptionalString(body?.runtimeFlowId)
        if ('runtimeFlowId' in (body || {}) && runtimeFlowId === undefined) {
          return text('runtimeFlowId must be a string or null', 400)
        }

        const runtimeTaskId = parseOptionalString(body?.runtimeTaskId)
        if ('runtimeTaskId' in (body || {}) && runtimeTaskId === undefined) {
          return text('runtimeTaskId must be a string or null', 400)
        }

        const runtimeFlowMessage = parseOptionalString(body?.runtimeFlowMessage)
        if (
          'runtimeFlowMessage' in (body || {}) &&
          runtimeFlowMessage === undefined
        ) {
          return text('runtimeFlowMessage must be a string or null', 400)
        }

        const runtimeFlowStartedAt = parseOptionalTimestamp(
          body?.runtimeFlowStartedAt,
        )
        if (
          'runtimeFlowStartedAt' in (body || {}) &&
          runtimeFlowStartedAt === undefined
        ) {
          return text(
            'runtimeFlowStartedAt must be an ISO timestamp or null',
            400,
          )
        }

        const runtimeFlowCompletedAt = parseOptionalTimestamp(
          body?.runtimeFlowCompletedAt,
        )
        if (
          'runtimeFlowCompletedAt' in (body || {}) &&
          runtimeFlowCompletedAt === undefined
        ) {
          return text(
            'runtimeFlowCompletedAt must be an ISO timestamp or null',
            400,
          )
        }

        await updateCliConnectionRuntimeState(params.connectionId, {
          runtimeFlowId,
          runtimeTaskId,
          runtimeFlowStatus,
          runtimeFlowMessage,
          runtimeFlowStartedAt,
          runtimeFlowCompletedAt,
        })

        return json({ ok: true })
      },
    },
  },
})
