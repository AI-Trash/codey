import '@tanstack/react-start/server-only'

import { getAppEnv } from './env'
import { text } from './http'
import { type BearerTokenContext, requireBearerToken } from './oauth-resource'

export async function readJsonBody<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>
}

export function getSearchParam(request: Request, key: string): string | null {
  return new URL(request.url).searchParams.get(key)
}

export function requireVerificationApiKey(request: Request): Response | null {
  const env = getAppEnv()
  if (!env.verificationApiKey) {
    return null
  }

  const provided = request.headers.get(env.verificationApiKeyHeader)
  if (provided !== env.verificationApiKey) {
    return text('Invalid verification API key', 401)
  }

  return null
}

export function requireFlowAppApiKey(request: Request): Response | null {
  const env = getAppEnv()
  if (!env.flowAppApiKey) {
    return text('FLOW_APP_API_KEY is not configured', 503)
  }

  const provided = request.headers.get(env.flowAppApiKeyHeader)
  if (provided !== env.flowAppApiKey) {
    return text('Invalid flow app API key', 401)
  }

  return null
}

export interface MachineAuthResult {
  kind: 'api_key' | 'oauth'
  bearerToken?: BearerTokenContext
}

async function authorizeWithScopedBearer(
  request: Request,
  scopes: string[],
): Promise<MachineAuthResult | Response> {
  try {
    const bearerToken = await requireBearerToken(request, { scopes })
    return {
      kind: 'oauth',
      bearerToken,
    }
  } catch (error) {
    return text(error instanceof Error ? error.message : 'Unauthorized', 401)
  }
}

function hasAuthorizationHeader(request: Request): boolean {
  return Boolean(request.headers.get('authorization')?.trim())
}

export async function requireVerificationAccess(
  request: Request,
  scopes: string[],
): Promise<Response | null> {
  const result = await authorizeVerificationAccess(request, scopes)
  return result instanceof Response ? result : null
}

export async function authorizeVerificationAccess(
  request: Request,
  scopes: string[],
): Promise<MachineAuthResult | Response> {
  if (hasAuthorizationHeader(request)) {
    return authorizeWithScopedBearer(request, scopes)
  }

  const apiKeyResult = requireVerificationApiKey(request)
  if (apiKeyResult) {
    return apiKeyResult
  }

  return {
    kind: 'api_key',
  }
}

export async function requireFlowAppAccess(
  request: Request,
  scopes: string[],
): Promise<Response | null> {
  if (hasAuthorizationHeader(request)) {
    const result = await authorizeWithScopedBearer(request, scopes)
    return result instanceof Response ? result : null
  }

  const apiKeyResult = requireFlowAppApiKey(request)
  if (apiKeyResult) {
    return apiKeyResult
  }

  return null
}
