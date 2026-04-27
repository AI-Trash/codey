import type { CodeyAppConfig, Sub2ApiConfig } from '../../config'
import { getRuntimeConfig } from '../../config'
import type { CodexTokenResponse } from '../authorization/codex-client'
import type { StoredChatGPTIdentitySummary } from '../credentials'
import { AppVerificationProviderClient } from '../verification/app-client'
import { buildSub2ApiOpenAiRelatedModelMapping } from './sub2api-related-models'

export interface SharedCodexOAuthSessionResult {
  identityId: string
  identityRecordId: string
  sessionRecordId: string
  sessionStorePath: string
  sub2api?: SyncedSub2ApiAccountResult
}

export interface SyncedSub2ApiAccountResult {
  accountId: number
  action: 'created' | 'updated'
  email: string
}

interface Sub2ApiEnvelope<T> {
  code?: number
  message?: string
  reason?: string
  data?: T
}

interface Sub2ApiLoginResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  requires_2fa?: boolean
  temp_token?: string
}

interface Sub2ApiTokenInfo {
  access_token?: string
  refresh_token?: string
  id_token?: string
  client_id?: string
  expires_at?: number | string
  email?: string
  chatgpt_account_id?: string
  chatgpt_user_id?: string
  organization_id?: string
  plan_type?: string
  privacy_mode?: string
}

interface Sub2ApiAccountRecord {
  id: number
  name?: string
  notes?: string | null
  credentials?: Record<string, unknown>
}

interface Sub2ApiPaginatedData<T> {
  items?: T[]
  pages?: number
}

const APP_SESSION_STORE_ROOT = 'codey-app://managed-sessions'
const DEFAULT_SUB2API_LOGIN_PATH = '/api/v1/auth/login'
const DEFAULT_SUB2API_REFRESH_TOKEN_PATH = '/api/v1/admin/openai/refresh-token'
const DEFAULT_SUB2API_ACCOUNTS_PATH = '/api/v1/admin/accounts'
const SUB2API_ACCOUNTS_PAGE_SIZE = 1000

function resolveCodeyAppConfig(): CodeyAppConfig {
  const config = getRuntimeConfig()
  const sharedAppConfig = config.app
  const verificationAppConfig = config.verification?.app

  return {
    baseUrl: verificationAppConfig?.baseUrl ?? sharedAppConfig?.baseUrl,
    oidcIssuer:
      verificationAppConfig?.oidcIssuer ?? sharedAppConfig?.oidcIssuer,
    oidcBasePath:
      verificationAppConfig?.oidcBasePath ?? sharedAppConfig?.oidcBasePath,
    clientId: verificationAppConfig?.clientId ?? sharedAppConfig?.clientId,
    clientSecret:
      verificationAppConfig?.clientSecret ?? sharedAppConfig?.clientSecret,
    scope: verificationAppConfig?.scope ?? sharedAppConfig?.scope,
    resource: verificationAppConfig?.resource ?? sharedAppConfig?.resource,
    tokenEndpointAuthMethod:
      verificationAppConfig?.tokenEndpointAuthMethod ??
      sharedAppConfig?.tokenEndpointAuthMethod,
  }
}

function resolveSub2ApiConfig(): Sub2ApiConfig | undefined {
  return getRuntimeConfig().sub2api
}

function resolveCodexTokenExpiresAt(
  token: CodexTokenResponse,
): string | undefined {
  if (!token.expiresIn) {
    return undefined
  }

  const createdAt = new Date(token.createdAt).getTime()
  if (!Number.isFinite(createdAt)) {
    return undefined
  }

  return new Date(createdAt + token.expiresIn * 1000).toISOString()
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : undefined
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized ? normalized : undefined
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeWorkspaceId(value: unknown): string | undefined {
  return asNonEmptyString(value)
}

function requireSub2ApiConfig(): Sub2ApiConfig | null {
  const config = resolveSub2ApiConfig()
  if (!config) {
    return null
  }

  const hasBaseUrl = Boolean(config.baseUrl?.trim())
  const hasApiKey = Boolean(config.apiKey?.trim())
  const hasBearerToken = Boolean(config.bearerToken?.trim())
  const hasEmail = Boolean(config.email?.trim())
  const hasPassword = Boolean(config.password?.trim())
  const hasPasswordLogin = hasEmail || hasPassword

  if (!hasBaseUrl && !hasApiKey && !hasBearerToken && !hasPasswordLogin) {
    return null
  }

  if (!hasBaseUrl) {
    throw new Error('Sub2API sync requires SUB2API_BASE_URL.')
  }

  if (!hasApiKey && !hasBearerToken && !hasPasswordLogin) {
    throw new Error(
      'Sub2API sync requires SUB2API_API_KEY, SUB2API_BEARER_TOKEN, or both SUB2API_EMAIL and SUB2API_PASSWORD.',
    )
  }

  if (!hasApiKey && !hasBearerToken && hasEmail !== hasPassword) {
    throw new Error(
      'Sub2API password login requires both SUB2API_EMAIL and SUB2API_PASSWORD.',
    )
  }

  return config
}

function joinSub2ApiUrl(baseUrl: string, pathname: string): string {
  const trimmedBase = baseUrl.trim().replace(/\/+$/, '')
  const normalizedPath = `/${pathname.trim().replace(/^\/+/, '')}`
  if (
    trimmedBase.endsWith('/api/v1') &&
    normalizedPath.startsWith('/api/v1/')
  ) {
    return `${trimmedBase}${normalizedPath.slice('/api/v1'.length)}`
  }

  return `${trimmedBase}${normalizedPath}`
}

function buildSub2ApiUrl(config: Sub2ApiConfig, pathname: string): string {
  if (!config.baseUrl?.trim()) {
    throw new Error('Sub2API base URL is not configured.')
  }

  return joinSub2ApiUrl(config.baseUrl, pathname)
}

function buildSub2ApiHeaders(input: {
  accessToken?: string
  apiKey?: string
}): HeadersInit {
  const apiKey = asNonEmptyString(input.apiKey)
  if (apiKey) {
    return {
      Accept: 'application/json',
      'x-api-key': apiKey,
    }
  }

  const accessToken = asNonEmptyString(input.accessToken)
  if (!accessToken) {
    throw new Error('Sub2API request auth is not configured.')
  }

  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  }
}

async function parseSub2ApiResponse<T>(response: Response): Promise<T> {
  const body = await response.text().catch(() => '')
  let payload = {} as Sub2ApiEnvelope<T>

  if (body) {
    try {
      payload = (JSON.parse(body) as Sub2ApiEnvelope<T>) ?? {}
    } catch {
      payload = {}
    }
  }

  if (response.ok && payload.code === 0 && payload.data !== undefined) {
    return payload.data
  }

  const message =
    payload.message?.trim() ||
    payload.reason?.trim() ||
    body ||
    `Sub2API request failed with ${response.status}.`
  throw new Error(message)
}

async function requestSub2ApiJson<T>(
  config: Sub2ApiConfig,
  authHeaders: HeadersInit,
  input: {
    method: 'DELETE' | 'GET' | 'POST' | 'PUT'
    pathname: string
    searchParams?: URLSearchParams
    body?: Record<string, unknown>
  },
): Promise<T> {
  const url = new URL(buildSub2ApiUrl(config, input.pathname))
  if (input.searchParams) {
    url.search = input.searchParams.toString()
  }

  const response = await fetch(url.toString(), {
    method: input.method,
    headers: {
      ...authHeaders,
      ...(input.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  })

  return parseSub2ApiResponse<T>(response)
}

async function resolveSub2ApiAuthHeaders(
  config: Sub2ApiConfig,
): Promise<HeadersInit> {
  const apiKey = asNonEmptyString(config.apiKey)
  if (apiKey) {
    return buildSub2ApiHeaders({ apiKey })
  }

  const bearerToken = asNonEmptyString(config.bearerToken)
  if (bearerToken) {
    return buildSub2ApiHeaders({ accessToken: bearerToken })
  }

  const email = asNonEmptyString(config.email)
  const password = asNonEmptyString(config.password)
  if (!email || !password) {
    throw new Error(
      'Sub2API password login requires both SUB2API_EMAIL and SUB2API_PASSWORD.',
    )
  }

  const loginPath = config.loginPath?.trim() || DEFAULT_SUB2API_LOGIN_PATH
  const response = await fetch(buildSub2ApiUrl(config, loginPath), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
  })
  const result = await parseSub2ApiResponse<Sub2ApiLoginResponse>(response)

  if (result.requires_2fa) {
    throw new Error(
      'Sub2API password login requires completing 2FA, which Codey does not support yet.',
    )
  }

  const accessToken = asNonEmptyString(result.access_token)
  if (!accessToken) {
    throw new Error('Sub2API login did not return an access token.')
  }

  const tokenType = asNonEmptyString(result.token_type) || 'Bearer'
  if (tokenType.toLowerCase() !== 'bearer') {
    throw new Error(
      `Sub2API login returned unsupported token type "${tokenType}".`,
    )
  }

  return buildSub2ApiHeaders({ accessToken })
}

function buildSub2ApiAccountCredentials(input: {
  tokenInfo: Sub2ApiTokenInfo
  fallbackRefreshToken: string
  fallbackClientId: string
  fallbackEmail: string
  fallbackExpiresAt?: string
}): Record<string, unknown> {
  const accessToken = asNonEmptyString(input.tokenInfo.access_token)
  if (!accessToken) {
    throw new Error('Sub2API token refresh did not return an access token.')
  }

  const credentials: Record<string, unknown> = {
    access_token: accessToken,
  }

  const refreshToken =
    asNonEmptyString(input.tokenInfo.refresh_token) ||
    input.fallbackRefreshToken
  if (refreshToken) {
    credentials.refresh_token = refreshToken
  }

  const idToken = asNonEmptyString(input.tokenInfo.id_token)
  if (idToken) {
    credentials.id_token = idToken
  }

  const expiresAt = input.tokenInfo.expires_at ?? input.fallbackExpiresAt
  if (expiresAt != null && expiresAt !== '') {
    credentials.expires_at = expiresAt
  }

  const email = asNonEmptyString(input.tokenInfo.email) || input.fallbackEmail
  if (email) {
    credentials.email = email
  }

  const chatgptAccountId = asNonEmptyString(input.tokenInfo.chatgpt_account_id)
  if (chatgptAccountId) {
    credentials.chatgpt_account_id = chatgptAccountId
  }

  const chatgptUserId = asNonEmptyString(input.tokenInfo.chatgpt_user_id)
  if (chatgptUserId) {
    credentials.chatgpt_user_id = chatgptUserId
  }

  const organizationId = asNonEmptyString(input.tokenInfo.organization_id)
  if (organizationId) {
    credentials.organization_id = organizationId
  }

  const planType = asNonEmptyString(input.tokenInfo.plan_type)
  if (planType) {
    credentials.plan_type = planType
  }

  const clientId =
    asNonEmptyString(input.tokenInfo.client_id) || input.fallbackClientId
  if (clientId) {
    credentials.client_id = clientId
  }

  return credentials
}

function buildSub2ApiAccountExtra(
  tokenInfo: Sub2ApiTokenInfo,
  email: string,
  config?: Sub2ApiConfig,
): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {}

  if (email) {
    extra.email = email
  }

  const privacyMode = asNonEmptyString(tokenInfo.privacy_mode)
  if (privacyMode) {
    extra.privacy_mode = privacyMode
  }

  const wsMode = config?.openaiOAuthResponsesWebSocketV2Mode
  if (wsMode) {
    extra.openai_oauth_responses_websockets_v2_mode = wsMode
    extra.openai_oauth_responses_websockets_v2_enabled = wsMode !== 'off'
  }

  return Object.keys(extra).length > 0 ? extra : undefined
}

function buildSub2ApiAccountNotes(input: {
  workspaceId?: string
  email: string
}): string {
  return JSON.stringify({
    workspaceId: normalizeWorkspaceId(input.workspaceId) ?? null,
    email: normalizeEmail(input.email),
  })
}

function parseSub2ApiAccountNotes(
  value: unknown,
): { workspaceId?: string; email?: string } | undefined {
  const notes = asNonEmptyString(value)
  if (!notes) {
    return undefined
  }

  try {
    const parsed = asRecord(JSON.parse(notes))
    if (!parsed) {
      return undefined
    }

    const email = asNonEmptyString(parsed.email)
    const workspaceId = normalizeWorkspaceId(parsed.workspaceId)
    if (!email && !workspaceId) {
      return undefined
    }

    return {
      email: email ? normalizeEmail(email) : undefined,
      workspaceId,
    }
  } catch {
    return undefined
  }
}

function buildSub2ApiAccountModelMapping(
  config: Sub2ApiConfig,
): Record<string, string> | undefined {
  if (!config.autoFillRelatedModels) {
    return undefined
  }

  return buildSub2ApiOpenAiRelatedModelMapping()
}

function findDuplicateSub2ApiAccounts(
  accounts: Sub2ApiAccountRecord[],
  input: {
    email: string
    workspaceId?: string
  },
): Sub2ApiAccountRecord[] {
  const normalizedEmail = normalizeEmail(input.email)
  const normalizedWorkspaceId = normalizeWorkspaceId(input.workspaceId)

  return accounts.filter((account) => {
    const metadata = parseSub2ApiAccountNotes(account.notes)
    return metadata
      ? metadata.email === normalizedEmail &&
          normalizeWorkspaceId(metadata.workspaceId) === normalizedWorkspaceId
      : false
  })
}

async function listSub2ApiOpenAiOAuthAccounts(
  config: Sub2ApiConfig,
  authHeaders: HeadersInit,
  accountsPath: string,
): Promise<Sub2ApiAccountRecord[]> {
  const accounts: Sub2ApiAccountRecord[] = []
  let page = 1

  while (true) {
    const searchParams = new URLSearchParams({
      page: String(page),
      page_size: String(SUB2API_ACCOUNTS_PAGE_SIZE),
      platform: 'openai',
      type: 'oauth',
    })
    const result = await requestSub2ApiJson<
      Sub2ApiPaginatedData<Sub2ApiAccountRecord>
    >(config, authHeaders, {
      method: 'GET',
      pathname: accountsPath,
      searchParams,
    })
    const items = Array.isArray(result.items) ? result.items : []
    accounts.push(...items)

    const pages =
      typeof result.pages === 'number' && Number.isFinite(result.pages)
        ? Math.max(1, Math.trunc(result.pages))
        : undefined
    if (pages ? page >= pages : items.length < SUB2API_ACCOUNTS_PAGE_SIZE) {
      break
    }

    page += 1
  }

  return accounts
}

export async function shareCodexOAuthSessionWithCodeyApp(input: {
  identity: StoredChatGPTIdentitySummary
  token: CodexTokenResponse
  clientId: string
  redirectUri: string
  workspaceId?: string
  workspaceRecordId?: string
}): Promise<SharedCodexOAuthSessionResult | null> {
  const config = resolveCodeyAppConfig()
  if (!config.baseUrl?.trim()) {
    return null
  }

  const client = new AppVerificationProviderClient(config)
  const normalizedEmail = input.identity.email.trim().toLowerCase()
  const expiresAt = resolveCodexTokenExpiresAt(input.token)
  const identity = await client.upsertManagedIdentity({
    identityId: input.identity.id,
    email: normalizedEmail,
    credentialCount: input.identity.credentialCount,
  })
  const session = await client.upsertManagedSession({
    identityId: input.identity.id,
    email: normalizedEmail,
    flowType: 'codex-oauth',
    clientId: input.clientId,
    authMode: 'codex-oauth',
    workspaceId: input.workspaceId,
    workspaceRecordId: input.workspaceRecordId,
    expiresAt,
    lastRefreshAt: input.token.createdAt,
    sessionData: {
      auth_mode: 'codex-oauth',
      provider: 'codex',
      last_refresh: input.token.createdAt,
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      ...(input.workspaceId ? { workspace_id: input.workspaceId } : {}),
      ...(input.workspaceRecordId
        ? { workspace_record_id: input.workspaceRecordId }
        : {}),
      tokens: {
        access_token: input.token.accessToken,
        refresh_token: input.token.refreshToken,
        token_type: input.token.tokenType,
        scope: input.token.scope,
        expires_at: expiresAt,
      },
    },
  })

  return {
    identityId: input.identity.id,
    identityRecordId: identity.id,
    sessionRecordId: session.id,
    sessionStorePath: `${APP_SESSION_STORE_ROOT}/${session.id}`,
    sub2api: session.sub2api,
  }
}

export async function syncCodexOAuthSessionToSub2Api(input: {
  identity: StoredChatGPTIdentitySummary
  token: CodexTokenResponse
  clientId: string
  workspaceId?: string
}): Promise<SyncedSub2ApiAccountResult | null> {
  const config = requireSub2ApiConfig()
  if (!config) {
    return null
  }

  const refreshToken = asNonEmptyString(input.token.refreshToken)
  if (!refreshToken) {
    throw new Error(
      'Sub2API sync requires a Codex refresh token, but none was captured.',
    )
  }

  const normalizedEmail = normalizeEmail(input.identity.email)
  const refreshTokenPath =
    config.refreshTokenPath?.trim() || DEFAULT_SUB2API_REFRESH_TOKEN_PATH
  const accountsPath =
    config.accountsPath?.trim() || DEFAULT_SUB2API_ACCOUNTS_PATH
  const resolvedClientId = config.clientId?.trim() || input.clientId
  const authHeaders = await resolveSub2ApiAuthHeaders(config)

  const refreshedToken = await requestSub2ApiJson<Sub2ApiTokenInfo>(
    config,
    authHeaders,
    {
      method: 'POST',
      pathname: refreshTokenPath,
      body: {
        refresh_token: refreshToken,
        client_id: resolvedClientId,
        ...(typeof config.proxyId === 'number'
          ? { proxy_id: config.proxyId }
          : {}),
      },
    },
  )

  const accountEmail = normalizeEmail(
    asNonEmptyString(refreshedToken.email) || normalizedEmail,
  )
  const credentials = buildSub2ApiAccountCredentials({
    tokenInfo: refreshedToken,
    fallbackRefreshToken: refreshToken,
    fallbackClientId: resolvedClientId,
    fallbackEmail: accountEmail,
    fallbackExpiresAt: resolveCodexTokenExpiresAt(input.token),
  })
  const notes = buildSub2ApiAccountNotes({
    workspaceId: input.workspaceId,
    email: accountEmail,
  })

  const existingAccounts = await listSub2ApiOpenAiOAuthAccounts(
    config,
    authHeaders,
    accountsPath,
  )
  const duplicateAccounts = findDuplicateSub2ApiAccounts(existingAccounts, {
    email: accountEmail,
    workspaceId: input.workspaceId,
  })

  for (const duplicate of duplicateAccounts) {
    await requestSub2ApiJson<Record<string, unknown>>(config, authHeaders, {
      method: 'DELETE',
      pathname: `${accountsPath.replace(/\/+$/, '')}/${duplicate.id}`,
    })
  }

  const created = await requestSub2ApiJson<Sub2ApiAccountRecord>(
    config,
    authHeaders,
    {
      method: 'POST',
      pathname: accountsPath,
      body: {
        name: accountEmail,
        notes,
        platform: 'openai',
        type: 'oauth',
        credentials: (() => {
          const modelMapping = buildSub2ApiAccountModelMapping(config)
          return {
            ...credentials,
            ...(modelMapping ? { model_mapping: modelMapping } : {}),
          }
        })(),
        extra: buildSub2ApiAccountExtra(refreshedToken, accountEmail, config),
        proxy_id: config.proxyId,
        concurrency: config.concurrency ?? 0,
        priority: config.priority ?? 0,
        group_ids: config.groupIds,
        confirm_mixed_channel_risk: config.confirmMixedChannelRisk,
      },
    },
  )

  return {
    accountId: created.id,
    action: 'created',
    email: accountEmail,
  }
}
