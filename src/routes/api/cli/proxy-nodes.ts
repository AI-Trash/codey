import { createFileRoute } from '@tanstack/react-router'

import { getCliSessionUser } from '../../../lib/server/auth'
import { json, text } from '../../../lib/server/http'
import { NOTIFICATIONS_READ_SCOPE } from '../../../lib/server/oauth-scopes'
import { getBearerTokenContext } from '../../../lib/server/oauth-resource'
import { listEnabledProxyNodesForCli } from '../../../lib/server/proxy-nodes'

export const Route = createFileRoute('/api/cli/proxy-nodes')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const sessionUser = await getCliSessionUser(request)
        const bearerContext = await getBearerTokenContext(request)
        const serviceClientAuthorized =
          bearerContext?.kind === 'client_credentials' &&
          bearerContext.scope.includes(NOTIFICATIONS_READ_SCOPE)

        if (!sessionUser && !serviceClientAuthorized) {
          return text('CLI authentication required', 401)
        }

        return json({
          nodes: await listEnabledProxyNodesForCli(),
        })
      },
    },
  },
})
