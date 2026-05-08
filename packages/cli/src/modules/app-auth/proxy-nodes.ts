import type { CliNotificationsAuthState } from './device-login'
import { ensureJson, resolveAppUrl } from './http'

export type CodeyProxyNodeProtocol =
  | 'hysteria2'
  | 'trojan'
  | 'vmess'
  | 'vless'
  | 'socks'
  | 'http'

export interface CodeyVmessTransportSettings {
  type: 'grpc' | 'http' | 'httpupgrade' | 'quic' | 'ws'
  serviceName?: string
  idleTimeout?: string
  pingTimeout?: string
  permitWithoutStream?: boolean
  host?: string | string[]
  path?: string
  method?: string
  headers?: Record<string, string | string[]>
  maxEarlyData?: number
  earlyDataHeaderName?: string
}

export interface CodeyVmessProtocolSettings {
  security?:
    | 'auto'
    | 'none'
    | 'zero'
    | 'aes-128-gcm'
    | 'chacha20-poly1305'
    | 'aes-128-ctr'
  alterId?: number
  globalPadding?: boolean
  authenticatedLength?: boolean
  network?: 'tcp' | 'udp'
  packetEncoding?: 'packetaddr' | 'xudp'
  transport?: CodeyVmessTransportSettings
}

export interface CodeyProxyNode {
  id: string
  name: string
  tag: string
  protocol: CodeyProxyNodeProtocol
  server: string
  serverPort: number
  username?: string
  password?: string
  uuid?: string
  vlessFlow?: string
  vmess?: CodeyVmessProtocolSettings
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
