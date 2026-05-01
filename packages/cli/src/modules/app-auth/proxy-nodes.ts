import type { CliNotificationsAuthState } from './device-login'
import { ensureJson, resolveAppUrl } from './http'

export type CodeyProxyNodeProtocol = 'hysteria2' | 'socks' | 'http'

export interface CodeyProxyNode {
  id: string
  name: string
  tag: string
  protocol: CodeyProxyNodeProtocol
  server: string
  serverPort: number
  username?: string
  password?: string
  tls?: {
    enabled: true
    serverName?: string
    insecure?: boolean
  }
}

export async function fetchCodeyProxyNodes(input: {
  authState: CliNotificationsAuthState
}): Promise<CodeyProxyNode[]> {
  const response = await fetch(resolveAppUrl('/api/cli/proxy-nodes'), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${input.authState.accessToken}`,
    },
  })

  const result = await ensureJson<{
    nodes?: CodeyProxyNode[]
  }>(response)

  return Array.isArray(result.nodes) ? result.nodes : []
}
