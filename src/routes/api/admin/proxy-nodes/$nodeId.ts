import { createFileRoute } from '@tanstack/react-router'

import { requireAdminPermission } from '../../../../lib/server/auth'
import { json, text } from '../../../../lib/server/http'
import { readJsonBody } from '../../../../lib/server/request'
import {
  deleteProxyNode,
  updateProxyNode,
  type ProxyNodeProtocol,
} from '../../../../lib/server/proxy-nodes'

interface UpdateProxyNodeBody {
  name?: string
  tag?: string
  protocol?: ProxyNodeProtocol
  server?: string
  serverPort?: number | string
  username?: string | null
  password?: string | null
  tlsServerName?: string | null
  tlsInsecure?: boolean
  description?: string | null
  enabled?: boolean
}

function parseServerPort(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string') {
    return Number(value)
  }

  return Number.NaN
}

export const Route = createFileRoute('/api/admin/proxy-nodes/$nodeId')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        let sessionUser: Awaited<ReturnType<typeof requireAdminPermission>>
        try {
          sessionUser = await requireAdminPermission(request, 'PROXY_NODES')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        const body = await readJsonBody<UpdateProxyNodeBody>(request)

        try {
          const node = await updateProxyNode(params.nodeId, {
            name: typeof body.name === 'string' ? body.name : undefined,
            tag: typeof body.tag === 'string' ? body.tag : undefined,
            protocol: body.protocol,
            server: typeof body.server === 'string' ? body.server : undefined,
            serverPort: parseServerPort(body.serverPort),
            username:
              typeof body.username === 'string' || body.username === null
                ? body.username
                : undefined,
            password:
              typeof body.password === 'string' || body.password === null
                ? body.password
                : undefined,
            tlsServerName:
              typeof body.tlsServerName === 'string' ||
              body.tlsServerName === null
                ? body.tlsServerName
                : undefined,
            tlsInsecure:
              typeof body.tlsInsecure === 'boolean'
                ? body.tlsInsecure
                : undefined,
            description:
              typeof body.description === 'string' ||
              body.description === null
                ? body.description
                : undefined,
            enabled:
              typeof body.enabled === 'boolean' ? body.enabled : undefined,
            updatedByUserId: sessionUser.user.id,
          })

          return json({ node })
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to update proxy node',
            400,
          )
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          await requireAdminPermission(request, 'PROXY_NODES')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        try {
          await deleteProxyNode(params.nodeId)
          return json({ ok: true })
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to delete proxy node',
            400,
          )
        }
      },
    },
  },
})
