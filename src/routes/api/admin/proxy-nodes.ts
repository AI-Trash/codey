import { createFileRoute } from '@tanstack/react-router'

import { requireAdminPermission } from '../../../lib/server/auth'
import { json, text } from '../../../lib/server/http'
import { readJsonBody } from '../../../lib/server/request'
import {
  createProxyNode,
  listProxyNodes,
  type ProxyNodeProtocol,
} from '../../../lib/server/proxy-nodes'

interface CreateProxyNodeBody {
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

function parseServerPort(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string') {
    return Number(value)
  }

  return Number.NaN
}

export const Route = createFileRoute('/api/admin/proxy-nodes')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdminPermission(request, 'PROXY_NODES')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        return json({
          nodes: await listProxyNodes(),
        })
      },
      POST: async ({ request }) => {
        let sessionUser: Awaited<ReturnType<typeof requireAdminPermission>>
        try {
          sessionUser = await requireAdminPermission(request, 'PROXY_NODES')
        } catch (error) {
          return text(
            error instanceof Error ? error.message : 'Unauthorized',
            401,
          )
        }

        const body = await readJsonBody<CreateProxyNodeBody>(request)

        try {
          const node = await createProxyNode({
            name: String(body.name || ''),
            tag: String(body.tag || ''),
            protocol: body.protocol,
            server: String(body.server || ''),
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
              typeof body.description === 'string' || body.description === null
                ? body.description
                : undefined,
            enabled:
              typeof body.enabled === 'boolean' ? body.enabled : undefined,
            updatedByUserId: sessionUser.user.id,
          })

          return json({ node }, 201)
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to create proxy node',
            400,
          )
        }
      },
    },
  },
})
