import { createFileRoute } from '@tanstack/react-router'

import { getCliSessionUser } from '../../../../../../../lib/server/auth'
import {
  getAdminCliConnectionSummaryById,
  isCliConnectionOwnedByActor,
} from '../../../../../../../lib/server/cli-connections'
import {
  completeFlowTask,
  refreshFlowTaskLease,
  retryFlowTask,
} from '../../../../../../../lib/server/flow-tasks'
import { json, text } from '../../../../../../../lib/server/http'
import { NOTIFICATIONS_READ_SCOPE } from '../../../../../../../lib/server/oauth-scopes'
import { getBearerTokenContext } from '../../../../../../../lib/server/oauth-resource'

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

function parseOptionalRecord(
  value: unknown,
): Record<string, unknown> | null | undefined {
  if (value === null) {
    return null
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function parseOptionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return undefined
  }

  return value
}

function parseOptionalRetryRequest(value: unknown):
  | {
      reason: string
      message?: string | null
      maxAttempts?: number
    }
  | null
  | undefined {
  if (value === undefined || value === null) {
    return null
  }

  const retry = parseOptionalRecord(value)
  if (!retry) {
    return undefined
  }

  const reason = parseOptionalString(retry.reason)
  if (!reason) {
    return undefined
  }

  const message = parseOptionalString(retry.message)
  if ('message' in retry && message === undefined) {
    return undefined
  }

  const maxAttempts = parseOptionalPositiveInteger(retry.maxAttempts)
  if ('maxAttempts' in retry && maxAttempts === undefined) {
    return undefined
  }

  return {
    reason,
    ...(message !== undefined ? { message } : {}),
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
  }
}

export const Route = createFileRoute(
  '/api/cli/connections/$connectionId/tasks/$taskId/status',
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

        const status = parseOptionalString(body?.status)
        if (
          status !== 'LEASED' &&
          status !== 'RUNNING' &&
          status !== 'SUCCEEDED' &&
          status !== 'FAILED' &&
          status !== 'CANCELED'
        ) {
          return text(
            'status must be one of LEASED, RUNNING, SUCCEEDED, FAILED, or CANCELED',
            400,
          )
        }

        const error = parseOptionalString(body?.error)
        if ('error' in (body || {}) && error === undefined) {
          return text('error must be a string or null', 400)
        }

        const message = parseOptionalString(body?.message)
        if ('message' in (body || {}) && message === undefined) {
          return text('message must be a string or null', 400)
        }

        const result = parseOptionalRecord(body?.result)
        if ('result' in (body || {}) && result === undefined) {
          return text('result must be an object or null', 400)
        }

        const retry = parseOptionalRetryRequest(body?.retry)
        if ('retry' in (body || {}) && retry === undefined) {
          return text(
            'retry must include reason and optional message/maxAttempts',
            400,
          )
        }

        if (retry && status !== 'FAILED') {
          return text('retry can only be provided with FAILED status', 400)
        }

        try {
          const task =
            status === 'LEASED' || status === 'RUNNING'
              ? await refreshFlowTaskLease({
                  connectionId: params.connectionId,
                  taskId: params.taskId,
                  status,
                  message,
                })
              : retry
                ? await retryFlowTask({
                    connectionId: params.connectionId,
                    taskId: params.taskId,
                    error,
                    message,
                    retryReason: retry.reason,
                    retryMessage: retry.message,
                    maxAttempts: retry.maxAttempts,
                  })
                : await completeFlowTask({
                    connectionId: params.connectionId,
                    taskId: params.taskId,
                    status,
                    error,
                    message,
                    ...(result !== undefined ? { result } : {}),
                  })

          if (!task) {
            return text('Flow task lease is no longer active.', 409)
          }

          return json({ ok: true })
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to update flow task',
            400,
          )
        }
      },
    },
  },
})
