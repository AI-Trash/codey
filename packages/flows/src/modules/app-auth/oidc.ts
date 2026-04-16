import type { OidcEndpointConfig } from '../../config'
import { resolveAppBaseUrl } from './http'

export interface OidcDiscoveryDocument {
  issuer: string
  token_endpoint: string
  device_authorization_endpoint?: string
}

export interface OidcTokenSet {
  accessToken: string
  tokenType: string
  refreshToken?: string
  idToken?: string
  scope?: string
  obtainedAt: string
  expiresAt?: string
}

export interface OidcDeviceAuthorizationResponse {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresIn: number
  interval?: number
  scope?: string
  expiresAt: string
}

interface OidcJsonErrorPayload {
  error?: string | boolean
  error_description?: string
  detail?: string
  message?: string
}

interface OidcDiscoveryPayload extends OidcJsonErrorPayload {
  issuer?: string
  token_endpoint?: string
  device_authorization_endpoint?: string
}

interface OidcTokenPayload extends OidcJsonErrorPayload {
  access_token?: string
  token_type?: string
  refresh_token?: string
  id_token?: string
  scope?: string
  expires_in?: number
}

interface OidcDeviceAuthorizationPayload extends OidcJsonErrorPayload {
  device_code?: string
  user_code?: string
  verification_uri?: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
  scope?: string
}

export class OidcRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly error?: string,
    readonly errorDescription?: string,
  ) {
    super(message)
    this.name = 'OidcRequestError'
  }
}

function firstNonEmptyText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return undefined
}

function readOidcErrorCode(
  payload: Pick<OidcJsonErrorPayload, 'error'>,
): string | undefined {
  return firstNonEmptyText(payload.error)
}

function readOidcErrorMessage(
  payload: OidcJsonErrorPayload,
  fallbackMessage: string,
): string {
  return (
    firstNonEmptyText(
      payload.error_description,
      payload.detail,
      payload.message,
      payload.error,
    ) || fallbackMessage
  )
}

function normalizeDiscoveredOidcUrl(
  endpoint: string | undefined,
  issuer: string | undefined,
): string | undefined {
  if (!endpoint || !issuer) {
    return endpoint
  }

  try {
    const endpointUrl = new URL(endpoint)
    const issuerUrl = new URL(issuer)
    if (
      endpointUrl.protocol === 'http:' &&
      issuerUrl.protocol === 'https:' &&
      endpointUrl.host === issuerUrl.host
    ) {
      endpointUrl.protocol = issuerUrl.protocol
      return endpointUrl.toString()
    }
  } catch {
    return endpoint
  }

  return endpoint
}

const DEFAULT_OIDC_BASE_PATH = '/oidc'
const DEFAULT_TOKEN_TYPE = 'Bearer'
const discoveryCache = new Map<string, Promise<OidcDiscoveryDocument>>()

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function normalizeBasePath(value: string | undefined): string {
  const basePath = (value || DEFAULT_OIDC_BASE_PATH).trim()
  if (!basePath || basePath === '/') {
    return '/'
  }
  return basePath.startsWith('/') ? basePath : `/${basePath}`
}

function readBaseUrl(baseUrl: string | undefined): string {
  return baseUrl?.trim() || resolveAppBaseUrl()
}

function joinUrl(baseUrl: string, pathname: string): string {
  if (pathname === '/') {
    return stripTrailingSlash(baseUrl)
  }
  return stripTrailingSlash(
    new URL(
      pathname.replace(/^\//, ''),
      ensureTrailingSlash(baseUrl),
    ).toString(),
  )
}

export function resolveOidcIssuer(
  config: Pick<
    OidcEndpointConfig & { baseUrl?: string },
    'baseUrl' | 'oidcIssuer' | 'oidcBasePath'
  >,
): string {
  const explicitIssuer = config.oidcIssuer?.trim()
  const basePath = normalizeBasePath(config.oidcBasePath)

  if (!explicitIssuer) {
    return joinUrl(readBaseUrl(config.baseUrl), basePath)
  }

  if (basePath === '/') {
    return stripTrailingSlash(explicitIssuer)
  }

  const parsed = new URL(explicitIssuer)
  if (parsed.pathname && parsed.pathname !== '/') {
    return stripTrailingSlash(parsed.toString())
  }

  return joinUrl(parsed.toString(), basePath)
}

export function buildOidcDiscoveryUrl(
  config: Pick<
    OidcEndpointConfig & { baseUrl?: string },
    'baseUrl' | 'oidcIssuer' | 'oidcBasePath'
  >,
): string {
  return new URL(
    '.well-known/openid-configuration',
    ensureTrailingSlash(resolveOidcIssuer(config)),
  ).toString()
}

function buildClientAuth(
  config: Pick<
    OidcEndpointConfig,
    'clientId' | 'clientSecret' | 'tokenEndpointAuthMethod'
  >,
  options: { requireClientSecret?: boolean } = {},
): {
  headers: Headers
  params: URLSearchParams
} {
  const clientId = config.clientId?.trim()
  const clientSecret = config.clientSecret?.trim()
  if (!clientId) {
    throw new Error('OIDC clientId is required for app-backed OAuth flows.')
  }
  if (options.requireClientSecret && !clientSecret) {
    throw new Error(
      'OIDC clientSecret is required for client_credentials verification access.',
    )
  }

  const authMethod = config.tokenEndpointAuthMethod || 'client_secret_basic'
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  })
  const params = new URLSearchParams()

  if (!clientSecret) {
    params.set('client_id', clientId)
    return { headers, params }
  }

  if (authMethod === 'client_secret_post') {
    params.set('client_id', clientId)
    params.set('client_secret', clientSecret)
    return { headers, params }
  }

  headers.set(
    'Authorization',
    `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
  )
  return { headers, params }
}

async function parseJsonResponse<T extends OidcJsonErrorPayload>(
  response: Response,
): Promise<T> {
  const body = await response.text()
  if (!body) {
    return {} as T
  }

  try {
    return JSON.parse(body) as T
  } catch {
    if (!response.ok) {
      throw new OidcRequestError(body, response.status)
    }
    throw new Error('Expected a JSON response from the OIDC provider.')
  }
}

function buildOidcError(
  response: Response,
  payload: OidcJsonErrorPayload,
  fallbackMessage: string,
): OidcRequestError {
  return new OidcRequestError(
    readOidcErrorMessage(payload, fallbackMessage),
    response.status,
    readOidcErrorCode(payload),
    firstNonEmptyText(
      payload.error_description,
      payload.detail,
      payload.message,
    ),
  )
}

function mapTokenSet(payload: OidcTokenPayload): OidcTokenSet {
  if (!payload.access_token) {
    throw new Error(readOidcErrorMessage(payload, 'OIDC token exchange failed.'))
  }

  const obtainedAt = new Date().toISOString()
  const expiresAt =
    typeof payload.expires_in === 'number' &&
    Number.isFinite(payload.expires_in)
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : undefined

  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type || DEFAULT_TOKEN_TYPE,
    refreshToken: payload.refresh_token,
    idToken: payload.id_token,
    scope: payload.scope,
    obtainedAt,
    expiresAt,
  }
}

export async function getOidcDiscovery(
  config: Pick<
    OidcEndpointConfig & { baseUrl?: string },
    'baseUrl' | 'oidcIssuer' | 'oidcBasePath'
  >,
): Promise<OidcDiscoveryDocument> {
  const discoveryUrl = buildOidcDiscoveryUrl(config)
  const cached = discoveryCache.get(discoveryUrl)
  if (cached) {
    return cached
  }

  const pending = (async () => {
    const response = await fetch(discoveryUrl, {
      headers: {
        Accept: 'application/json',
      },
    })
    const payload = await parseJsonResponse<OidcDiscoveryPayload>(response)
    if (!response.ok) {
      throw buildOidcError(
        response,
        payload,
        'Unable to load the OIDC discovery document.',
      )
    }
    if (!payload.issuer || !payload.token_endpoint) {
      throw new Error(
        `OIDC discovery document is missing required endpoints at ${discoveryUrl}.`,
      )
    }

    return {
      issuer: payload.issuer,
      token_endpoint: normalizeDiscoveredOidcUrl(
        payload.token_endpoint,
        payload.issuer,
      )!,
      device_authorization_endpoint: normalizeDiscoveredOidcUrl(
        payload.device_authorization_endpoint,
        payload.issuer,
      ),
    }
  })()

  discoveryCache.set(discoveryUrl, pending)
  try {
    return await pending
  } catch (error) {
    discoveryCache.delete(discoveryUrl)
    throw error
  }
}

export async function exchangeOidcClientCredentials(
  config: Pick<
    OidcEndpointConfig & { baseUrl?: string },
    | 'baseUrl'
    | 'oidcIssuer'
    | 'oidcBasePath'
    | 'clientId'
    | 'clientSecret'
    | 'scope'
    | 'resource'
    | 'tokenEndpointAuthMethod'
  >,
): Promise<OidcTokenSet> {
  const discovery = await getOidcDiscovery(config)
  const auth = buildClientAuth(config, { requireClientSecret: true })
  const body = new URLSearchParams(auth.params)
  body.set('grant_type', 'client_credentials')
  if (config.scope?.trim()) {
    body.set('scope', config.scope.trim())
  }
  if (config.resource?.trim()) {
    body.set('resource', config.resource.trim())
  }

  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: auth.headers,
    body,
  })
  const payload = await parseJsonResponse<OidcTokenPayload>(response)
  if (!response.ok) {
    throw buildOidcError(
      response,
      payload,
      'OIDC client credentials exchange failed.',
    )
  }

  return mapTokenSet(payload)
}

export async function startOidcDeviceAuthorization(
  config: Pick<
    OidcEndpointConfig & { baseUrl?: string },
    | 'baseUrl'
    | 'oidcIssuer'
    | 'oidcBasePath'
    | 'clientId'
    | 'clientSecret'
    | 'scope'
    | 'resource'
    | 'tokenEndpointAuthMethod'
  >,
): Promise<OidcDeviceAuthorizationResponse> {
  const discovery = await getOidcDiscovery(config)
  if (!discovery.device_authorization_endpoint) {
    throw new Error(
      `OIDC discovery at ${discovery.issuer} does not advertise a device authorization endpoint.`,
    )
  }

  const auth = buildClientAuth(config)
  const body = new URLSearchParams(auth.params)
  if (config.scope?.trim()) {
    body.set('scope', config.scope.trim())
  }
  if (config.resource?.trim()) {
    body.set('resource', config.resource.trim())
  }

  const response = await fetch(discovery.device_authorization_endpoint, {
    method: 'POST',
    headers: auth.headers,
    body,
  })
  const payload =
    await parseJsonResponse<OidcDeviceAuthorizationPayload>(response)
  if (!response.ok) {
    throw buildOidcError(
      response,
      payload,
      'OIDC device authorization request failed.',
    )
  }
  if (
    !payload.device_code ||
    !payload.user_code ||
    !payload.verification_uri ||
    typeof payload.expires_in !== 'number'
  ) {
    throw new Error(
      'OIDC device authorization response is missing required fields.',
    )
  }

  return {
    deviceCode: payload.device_code,
    userCode: payload.user_code,
    verificationUri: payload.verification_uri,
    verificationUriComplete: payload.verification_uri_complete,
    expiresIn: payload.expires_in,
    interval: payload.interval,
    scope: payload.scope,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
  }
}

export async function exchangeOidcDeviceCode(
  config: Pick<
    OidcEndpointConfig & { baseUrl?: string },
    | 'baseUrl'
    | 'oidcIssuer'
    | 'oidcBasePath'
    | 'clientId'
    | 'clientSecret'
    | 'resource'
    | 'tokenEndpointAuthMethod'
  >,
  deviceCode: string,
): Promise<OidcTokenSet> {
  const discovery = await getOidcDiscovery(config)
  const auth = buildClientAuth(config)
  const body = new URLSearchParams(auth.params)
  body.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code')
  body.set('device_code', deviceCode)
  if (config.resource?.trim()) {
    body.set('resource', config.resource.trim())
  }

  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: auth.headers,
    body,
  })
  const payload = await parseJsonResponse<OidcTokenPayload>(response)
  if (!response.ok) {
    throw buildOidcError(
      response,
      payload,
      'OIDC device token exchange failed.',
    )
  }

  return mapTokenSet(payload)
}
