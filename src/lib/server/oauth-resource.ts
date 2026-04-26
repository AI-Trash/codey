import '@tanstack/react-start/server-only'

import type { AccessToken, ClientCredentials } from 'oidc-provider'
import { getOidcProvider } from './oidc/config'

export interface BearerTokenContext {
  token: AccessToken | ClientCredentials
  kind: 'access_token' | 'client_credentials'
  clientId: string
  scope: string[]
  audience: string[]
  accountId?: string
}

export interface BearerTokenRequirement {
  scopes?: string[]
}

function readBearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization')
  if (!header) {
    return undefined
  }
  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return undefined
  }
  return token.trim()
}

function toAudienceList(value: string | string[] | undefined): string[] {
  if (!value) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

function hasRequiredScopes(
  grantedScopes: string[],
  requiredScopes: string[],
): boolean {
  return requiredScopes.every((scope) => grantedScopes.includes(scope))
}

async function findOidcBearerToken(
  bearerToken: string,
): Promise<BearerTokenContext | null> {
  const provider = await getOidcProvider()
  const accessToken = await provider.AccessToken.find(bearerToken)
  if (accessToken) {
    if (!accessToken.clientId) {
      return null
    }
    return {
      token: accessToken,
      kind: 'access_token',
      clientId: accessToken.clientId,
      scope: Array.from(accessToken.scopes),
      audience: toAudienceList(accessToken.aud),
      accountId: accessToken.accountId,
    }
  }

  const clientCredentials = await provider.ClientCredentials.find(bearerToken)
  if (clientCredentials) {
    if (!clientCredentials.clientId) {
      return null
    }
    return {
      token: clientCredentials,
      kind: 'client_credentials',
      clientId: clientCredentials.clientId,
      scope: Array.from(clientCredentials.scopes),
      audience: toAudienceList(clientCredentials.aud),
    }
  }

  return null
}

export async function getBearerTokenContext(
  request: Request,
): Promise<BearerTokenContext | null> {
  const bearerToken = readBearerToken(request)
  if (!bearerToken) {
    return null
  }
  return findOidcBearerToken(bearerToken)
}

export async function requireBearerToken(
  request: Request,
  requirement: BearerTokenRequirement = {},
): Promise<BearerTokenContext> {
  const context = await getBearerTokenContext(request)
  if (!context) {
    throw new Error('Bearer token required')
  }
  const requiredScopes = requirement.scopes || []
  if (
    requiredScopes.length &&
    !hasRequiredScopes(context.scope, requiredScopes)
  ) {
    throw new Error(`Missing required scope: ${requiredScopes.join(' ')}`)
  }
  return context
}
