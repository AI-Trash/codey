import { createFileRoute } from '@tanstack/react-router'

import { getCliSessionUser } from '../../../../../../lib/server/auth'
import {
  getAdminCliConnectionSummaryById,
  isCliConnectionOwnedByActor,
} from '../../../../../../lib/server/cli-connections'
import { claimNextFlowTaskForConnection } from '../../../../../../lib/server/flow-tasks'
import { json, text } from '../../../../../../lib/server/http'
import { NOTIFICATIONS_READ_SCOPE } from '../../../../../../lib/server/oauth-scopes'
import { getBearerTokenContext } from '../../../../../../lib/server/oauth-resource'

export const Route = createFileRoute(
  '/api/cli/connections/$connectionId/tasks/claim',
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

        try {
          const task = await claimNextFlowTaskForConnection({
            connectionId: params.connectionId,
          })

          return json({
            ok: true,
            browserLimit: connection.browserLimit,
            task: task
              ? {
                  id: task.id,
                  title: task.title,
                  body: task.body,
                  flowType: task.flowType,
                  target: task.target,
                  payload: task.payload,
                  createdAt: task.createdAt.toISOString(),
                }
              : null,
          })
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to claim flow task',
            400,
          )
        }
      },
    },
  },
})
