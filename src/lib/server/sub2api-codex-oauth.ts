import '@tanstack/react-start/server-only'

import type { Sub2ApiConfig } from '../../../packages/cli/src/config'
import { buildSub2ApiOpenAiRelatedModelMapping } from '../../../packages/cli/src/modules/app-auth/sub2api-related-models'
import {
  getCliSub2ApiConfig,
  hasEnabledSub2ApiServiceConfig,
} from './external-service-configs'

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
}

const DEFAULT_SUB2API_LOGIN_PATH = '/api/v1/auth/login'
const DEFAULT_SUB2API_REFRESH_TOKEN_PATH = '/api/v1/admin/openai/refresh-token'
const DEFAULT_SUB2API_ACCOUNTS_PATH = '/api/v1/admin/accounts'

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

function asNonEmptyStringOrNumber(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  return asNonEmptyString(value)
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeWorkspaceId(value: unknown): string | undefined {
  return asNonEmptyString(value)
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
    method: 'GET' | 'POST' | 'PUT'
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
    throw new Error('Sub2API password login requires both email and password.')
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
  fallbackExpiresAt?: string | number
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

function buildSub2ApiAccountName(input: {
  workspaceId?: string | null
  email: string
}): string {
  const email = normalizeEmail(input.email)
  const workspaceId = normalizeWorkspaceId(input.workspaceId)
  return workspaceId ? `${email} + ${workspaceId}` : email
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

function findMatchingSub2ApiAccount(
  accounts: Sub2ApiAccountRecord[],
  input: {
    email: string
    workspaceId?: string
  },
): Sub2ApiAccountRecord | undefined {
  const normalizedEmail = normalizeEmail(input.email)
  const normalizedWorkspaceId = normalizeWorkspaceId(input.workspaceId)

  const metadataMatch = accounts.find((account) => {
    const metadata = parseSub2ApiAccountNotes(account.notes)
    return metadata
      ? metadata.email === normalizedEmail &&
          normalizeWorkspaceId(metadata.workspaceId) === normalizedWorkspaceId
      : false
  })

  if (metadataMatch) {
    return metadataMatch
  }

  const legacyEmailMatches = accounts.filter((account) => {
    if (parseSub2ApiAccountNotes(account.notes)) {
      return false
    }

    const credentials = asRecord(account.credentials)
    const credentialEmail = asNonEmptyString(credentials?.email)
    return credentialEmail
      ? normalizeEmail(credentialEmail) === normalizedEmail
      : false
  })

  return legacyEmailMatches.length === 1 ? legacyEmailMatches[0] : undefined
}

export async function syncManagedCodexOAuthSessionToSub2Api(input: {
  email: string
  clientId?: string | null
  workspaceId?: string | null
  sessionData: Record<string, unknown>
}): Promise<SyncedSub2ApiAccountResult | null> {
  if (!(await hasEnabledSub2ApiServiceConfig())) {
    return null
  }

  const config = await getCliSub2ApiConfig()
  const sessionData = asRecord(input.sessionData) ?? {}
  const sessionTokens = asRecord(sessionData.tokens) ?? {}
  const refreshToken = asNonEmptyString(sessionTokens.refresh_token)
  if (!refreshToken) {
    throw new Error(
      'Sub2API sync requires a Codex refresh token, but none was captured.',
    )
  }

  const normalizedEmail = normalizeEmail(input.email)
  const refreshTokenPath =
    config.refreshTokenPath?.trim() || DEFAULT_SUB2API_REFRESH_TOKEN_PATH
  const accountsPath =
    config.accountsPath?.trim() || DEFAULT_SUB2API_ACCOUNTS_PATH
  const resolvedClientId =
    config.clientId?.trim() ||
    asNonEmptyString(input.clientId) ||
    asNonEmptyString(sessionData.client_id) ||
    'unknown'
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
  const normalizedWorkspaceId = normalizeWorkspaceId(input.workspaceId)
  const accountName = buildSub2ApiAccountName({
    workspaceId: normalizedWorkspaceId,
    email: accountEmail,
  })
  const credentials = buildSub2ApiAccountCredentials({
    tokenInfo: refreshedToken,
    fallbackRefreshToken: refreshToken,
    fallbackClientId: resolvedClientId,
    fallbackEmail: accountEmail,
    fallbackExpiresAt: asNonEmptyStringOrNumber(sessionTokens.expires_at),
  })
  const notes = buildSub2ApiAccountNotes({
    workspaceId: normalizedWorkspaceId,
    email: accountEmail,
  })

  const searchParams = new URLSearchParams({
    page: '1',
    page_size: '1000',
    platform: 'openai',
    type: 'oauth',
    search: accountEmail,
  })
  const existingAccounts = await requestSub2ApiJson<
    Sub2ApiPaginatedData<Sub2ApiAccountRecord>
  >(config, authHeaders, {
    method: 'GET',
    pathname: accountsPath,
    searchParams,
  })
  const existing = findMatchingSub2ApiAccount(
    Array.isArray(existingAccounts.items) ? existingAccounts.items : [],
    {
      email: accountEmail,
      workspaceId: normalizedWorkspaceId,
    },
  )

  if (existing) {
    const updated = await requestSub2ApiJson<Sub2ApiAccountRecord>(
      config,
      authHeaders,
      {
        method: 'PUT',
        pathname: `${accountsPath.replace(/\/+$/, '')}/${existing.id}`,
        body: {
          name: accountName,
          notes,
          credentials,
        },
      },
    )

    return {
      accountId: updated.id || existing.id,
      action: 'updated',
      email: accountEmail,
    }
  }

  const created = await requestSub2ApiJson<Sub2ApiAccountRecord>(
    config,
    authHeaders,
    {
      method: 'POST',
      pathname: accountsPath,
      body: {
        name: accountName,
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
