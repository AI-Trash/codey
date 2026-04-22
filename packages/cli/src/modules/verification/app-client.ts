import type { AppVerificationProviderConfig, Sub2ApiConfig } from '../../config'
import { sleep } from '../../utils/wait'
import { ensureJson } from '../app-auth/http'
import {
  exchangeOidcDeviceCode,
  exchangeOidcClientCredentials,
  type OidcTokenSet,
  startOidcDeviceAuthorization,
} from '../app-auth/oidc'
import { streamSse } from '../app-auth/sse'
import {
  clearAppSession,
  createStoredAppSession,
  getAppSessionAccessToken,
  isAppSessionExpired,
  readAppSession,
  saveAppSession,
} from '../app-auth/token-store'
import { extractChatGPTVerificationCodeFromEmail } from '../chatgpt/common'
import { writeCliStderrLine } from '../../utils/cli-output'
import type {
  VerificationCodeStreamEvent,
  VerificationEmailTarget,
  WaitForVerificationCodeOptions,
} from './types'

export interface AppVerificationEmailReservation extends VerificationEmailTarget {
  reservationId: string
  expiresAt?: string
}

export interface AppVerificationCodeLookupResponse {
  reservationId?: string
  status: 'pending' | 'resolved'
  code?: string
  source?: string
  receivedAt?: string
  emails?: AppVerificationEmailRecord[]
}

export interface AppVerificationCodeStreamResponse {
  id: string
  cursor: string
  reservationId: string
  email: string
  code: string
  source: string
  receivedAt: string
}

export interface AppVerificationEmailRecord {
  messageId?: string | null
  subject?: string | null
  textBody?: string | null
  htmlBody?: string | null
  rawPayload?: string | null
  receivedAt: string
}

export type AppVerificationEvent = VerificationCodeStreamEvent

const VERIFICATION_READ_SCOPE = 'verification:read'
const VERIFICATION_RESERVE_SCOPE = 'verification:reserve'
const NOTIFICATIONS_READ_SCOPE = 'notifications:read'
const VERIFICATION_APP_SCOPES = [
  VERIFICATION_READ_SCOPE,
  VERIFICATION_RESERVE_SCOPE,
] as const

export interface AppManagedIdentitySyncResponse {
  ok: boolean
  id: string
}

export interface AppManagedIdentityMetadata {
  prefix?: string
  mailbox?: string
  source?: 'chatgpt-register'
  chatgptUrl?: string
}

export type AppManagedIdentityPlan = 'free' | 'plus' | 'team'
export type AppManagedIdentityStatus =
  | 'ACTIVE'
  | 'REVIEW'
  | 'ARCHIVED'
  | 'BANNED'

export interface AppManagedIdentitySummaryRecord {
  id: string
  email: string
  label?: string | null
  tags?: string[]
  credentialCount: number
  encrypted: boolean
  createdAt: string
  updatedAt: string
  status: string
  plan: AppManagedIdentityPlan
  metadata?: AppManagedIdentityMetadata
}

export interface AppManagedIdentityRecord extends AppManagedIdentitySummaryRecord {
  password: string
}

export interface AppManagedIdentityListResponse {
  identities: AppManagedIdentitySummaryRecord[]
}

export interface AppManagedIdentityLookupResponse {
  identity: AppManagedIdentityRecord
}

export interface AppManagedSessionSyncResponse {
  ok: boolean
  id: string
}

export interface AppManagedWorkspaceMemberRecord {
  id: string
  email: string
  identityId: string | null
  identityLabel: string | null
}

export interface AppManagedWorkspaceRecord {
  id: string
  workspaceId: string
  label?: string | null
  memberCount: number
  members: AppManagedWorkspaceMemberRecord[]
  createdAt: string
  updatedAt: string
}

export interface AppManagedWorkspaceLookupResponse {
  workspace: AppManagedWorkspaceRecord | null
}

export interface AppManagedWorkspaceSyncResponse {
  ok: boolean
  workspace: AppManagedWorkspaceRecord
}

export interface AppManagedSub2ApiConfigResponse {
  config?: Sub2ApiConfig
}

function parseScopeList(value: string | undefined): string[] {
  if (!value) {
    return []
  }

  return value
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export class AppVerificationProviderClient {
  private tokenCache?: OidcTokenSet
  private tokenCacheKey?: string

  constructor(private readonly config: AppVerificationProviderConfig = {}) {}

  private getBaseUrl(): string {
    const baseUrl = this.config.baseUrl?.trim()
    if (!baseUrl) {
      throw new Error(
        'CODEY_APP_BASE_URL is required when verification.provider is "app".',
      )
    }

    return baseUrl
  }

  private invalidateCachedToken(): void {
    this.tokenCache = undefined
    this.tokenCacheKey = undefined
  }

  private hasClientCredentials(): boolean {
    return Boolean(
      this.config.clientId?.trim() && this.config.clientSecret?.trim(),
    )
  }

  private buildRequestedScope(requiredScopes: string[]): string | undefined {
    const requestedScopes = new Set([
      ...parseScopeList(this.config.scope),
      ...requiredScopes,
    ])
    return requestedScopes.size
      ? Array.from(requestedScopes).join(' ')
      : undefined
  }

  private hasRequiredScopes(
    grantedScope: string | undefined,
    requiredScopes: string[],
  ): boolean {
    if (!requiredScopes.length) {
      return true
    }

    const granted = parseScopeList(grantedScope)
    return requiredScopes.every((scope) => granted.includes(scope))
  }

  private hasValidCachedToken(cacheKey: string): boolean {
    if (!this.tokenCache?.accessToken) {
      return false
    }
    if (this.tokenCacheKey !== cacheKey) {
      return false
    }
    if (!this.tokenCache.expiresAt) {
      return true
    }
    return Date.parse(this.tokenCache.expiresAt) - Date.now() > 30_000
  }

  private async getClientCredentialsAccessToken(
    requiredScopes: string[],
  ): Promise<string> {
    const requestedScope = this.buildRequestedScope(requiredScopes)
    const cacheKey = requestedScope || '__default__'

    if (!this.hasValidCachedToken(cacheKey)) {
      this.tokenCache = await exchangeOidcClientCredentials({
        baseUrl: this.config.baseUrl,
        oidcIssuer: this.config.oidcIssuer,
        oidcBasePath: this.config.oidcBasePath,
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        scope: requestedScope,
        resource: this.config.resource,
        tokenEndpointAuthMethod: this.config.tokenEndpointAuthMethod,
      })
      this.tokenCacheKey = cacheKey
    }

    if (!this.tokenCache?.accessToken) {
      throw new Error(
        'Unable to acquire an OIDC access token for verification.',
      )
    }

    return this.tokenCache.accessToken
  }

  private async getDeviceCodeAccessToken(
    requiredScopes: string[],
  ): Promise<string> {
    try {
      const session = readAppSession()
      if (
        !isAppSessionExpired(session) &&
        this.hasRequiredScopes(session.tokenSet.scope, requiredScopes)
      ) {
        return getAppSessionAccessToken(session)
      }
    } catch {
      // Ignore missing or malformed stored sessions and fall through to device auth.
    }

    const requestedScope = this.buildRequestedScope(requiredScopes)
    const challenge = await startOidcDeviceAuthorization({
      baseUrl: this.config.baseUrl,
      oidcIssuer: this.config.oidcIssuer,
      oidcBasePath: this.config.oidcBasePath,
      clientId: this.config.clientId,
      scope: requestedScope,
      resource: this.config.resource,
      tokenEndpointAuthMethod: this.config.tokenEndpointAuthMethod,
    })

    writeCliStderrLine(
      challenge.verificationUriComplete
        ? `Codey app approval required. Open ${challenge.verificationUriComplete} to continue this flow.`
        : `Codey app approval required. Visit ${challenge.verificationUri} and enter the user code ${challenge.userCode}.`,
    )

    const tokenSet = await exchangeOidcDeviceCode(
      {
        baseUrl: this.config.baseUrl,
        oidcIssuer: this.config.oidcIssuer,
        oidcBasePath: this.config.oidcBasePath,
        clientId: this.config.clientId,
        resource: this.config.resource,
        tokenEndpointAuthMethod: this.config.tokenEndpointAuthMethod,
      },
      challenge.deviceCode,
    )
    saveAppSession(
      createStoredAppSession({
        tokenSet,
      }),
    )
    return tokenSet.accessToken
  }

  private async getAccessToken(requiredScopes: string[] = []): Promise<string> {
    if (this.hasClientCredentials()) {
      return this.getClientCredentialsAccessToken(requiredScopes)
    }

    return this.getDeviceCodeAccessToken(requiredScopes)
  }

  private async fetchWithAuthorization(
    input: RequestInfo | URL,
    init: RequestInit = {},
    requiredScopes: string[] = [],
  ): Promise<Response> {
    const runRequest = async (): Promise<Response> => {
      const headers = new Headers(init.headers)
      headers.set(
        'Authorization',
        `Bearer ${await this.getAccessToken(requiredScopes)}`,
      )
      if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json')
      }
      return fetch(input, {
        ...init,
        headers,
      })
    }

    let response = await runRequest()
    if (response.status !== 401) {
      return response
    }

    this.invalidateCachedToken()
    if (!this.hasClientCredentials()) {
      clearAppSession()
    }
    response = await runRequest()
    return response
  }

  private buildUrl(pathname: string): string {
    const baseUrl = this.getBaseUrl()
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    return new URL(pathname, normalizedBase).toString()
  }

  private async getJson<T>(
    input: RequestInfo | URL,
    init?: RequestInit,
    requiredScopes: string[] = [],
  ): Promise<T> {
    const response = await this.fetchWithAuthorization(
      input,
      init,
      requiredScopes,
    )
    return ensureJson<T>(response)
  }

  async reserveEmailTarget(): Promise<AppVerificationEmailReservation> {
    const reserveUrl = this.buildUrl(
      this.config.reserveEmailPath || '/api/verification/email-reservations',
    )
    return this.getJson<AppVerificationEmailReservation>(
      reserveUrl,
      {
        method: 'POST',
      },
      [...VERIFICATION_APP_SCOPES],
    )
  }

  async getManagedSub2ApiConfig(): Promise<Sub2ApiConfig> {
    const result = await this.getJson<AppManagedSub2ApiConfigResponse>(
      this.buildUrl('/api/cli/external-services/sub2api'),
      {},
      [NOTIFICATIONS_READ_SCOPE],
    )

    if (!result.config) {
      throw new Error('Codey app did not return a Sub2API config.')
    }

    return result.config
  }

  async waitForVerificationCode(
    options: WaitForVerificationCodeOptions,
  ): Promise<string> {
    const codeUrl = new URL(
      this.buildUrl(
        this.config.verificationCodePath || '/api/verification/codes',
      ),
    )
    codeUrl.searchParams.set('email', options.email)
    codeUrl.searchParams.set('startedAt', options.startedAt)

    const deadline = Date.now() + options.timeoutMs
    let attempt = 0

    while (Date.now() < deadline) {
      attempt += 1
      await options.onPollAttempt?.(attempt)

      const result = await this.getJson<AppVerificationCodeLookupResponse>(
        codeUrl,
        {},
        [...VERIFICATION_APP_SCOPES],
      )
      if (
        result.status === 'resolved' &&
        result.code &&
        result.source === 'MANUAL'
      ) {
        return result.code
      }
      for (const email of result.emails || []) {
        const extractedCode = extractChatGPTVerificationCodeFromEmail({
          subject: email.subject,
          textBody: email.textBody,
          htmlBody: email.htmlBody,
        })
        if (extractedCode) {
          return extractedCode
        }
      }
      if (result.status === 'resolved' && result.code) {
        return result.code
      }

      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) {
        break
      }

      await sleep(Math.min(options.pollIntervalMs, remainingMs))
    }

    throw new Error(
      `Timed out waiting for a verification code sent to ${options.email}.`,
    )
  }

  async *streamVerificationEvents(params: {
    email: string
    startedAt: string
    signal?: AbortSignal
  }): AsyncGenerator<AppVerificationEvent, void, void> {
    const eventsUrl = new URL(
      this.buildUrl(
        this.config.verificationEventsPath || '/api/verification/events',
      ),
    )
    eventsUrl.searchParams.set('email', params.email)
    eventsUrl.searchParams.set('startedAt', params.startedAt)
    const response = await this.fetchWithAuthorization(
      eventsUrl,
      {
        signal: params.signal,
        headers: {
          Accept: 'text/event-stream',
        },
      },
      [...VERIFICATION_APP_SCOPES],
    )

    if (!response.ok) {
      throw new Error(await response.text())
    }

    for await (const event of streamSse(response)) {
      if (event.event === 'verification_code' && event.data) {
        const payload = JSON.parse(
          event.data,
        ) as AppVerificationCodeStreamResponse
        yield {
          type: 'verification_code',
          reservationId: payload.reservationId,
          email: payload.email,
          code: payload.code,
          source: payload.source,
          receivedAt: payload.receivedAt,
          cursor: payload.cursor,
        }
        continue
      }

      yield {
        type: 'keepalive',
        email: params.email,
      }
    }
  }

  async upsertManagedIdentity(input: {
    identityId: string
    email: string
    label?: string
    tags?: string[]
    plan?: AppManagedIdentityPlan
    status?: AppManagedIdentityStatus
    password?: string
    metadata?: AppManagedIdentityMetadata
    credentialCount?: number
    reservationId?: string
  }): Promise<AppManagedIdentitySyncResponse> {
    return this.getJson<AppManagedIdentitySyncResponse>(
      this.buildUrl('/api/managed-identities'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identityId: input.identityId,
          email: input.email,
          label: input.label,
          tags: input.tags,
          plan: input.plan,
          status: input.status,
          password: input.password,
          metadata: input.metadata,
          credentialCount: input.credentialCount,
          reservationId: input.reservationId,
        }),
      },
      [VERIFICATION_RESERVE_SCOPE],
    )
  }

  async getManagedIdentity(
    input: {
      identityId?: string
      email?: string
    } = {},
  ): Promise<AppManagedIdentityRecord> {
    const url = new URL(this.buildUrl('/api/managed-identities'))
    if (input.identityId?.trim()) {
      url.searchParams.set('identityId', input.identityId.trim())
    }
    if (input.email?.trim()) {
      url.searchParams.set('email', input.email.trim().toLowerCase())
    }

    const response = await this.getJson<AppManagedIdentityLookupResponse>(
      url,
      {},
      [VERIFICATION_RESERVE_SCOPE],
    )
    return response.identity
  }

  async listManagedIdentities(): Promise<AppManagedIdentitySummaryRecord[]> {
    const url = new URL(this.buildUrl('/api/managed-identities'))
    url.searchParams.set('list', '1')
    const response = await this.getJson<AppManagedIdentityListResponse>(
      url,
      {},
      [VERIFICATION_RESERVE_SCOPE],
    )
    return response.identities
  }

  async upsertManagedSession(input: {
    identityId: string
    email: string
    flowType: string
    clientId: string
    authMode: string
    accountId?: string
    sessionId?: string
    expiresAt?: string
    lastRefreshAt?: string
    sessionData: Record<string, unknown>
  }): Promise<AppManagedSessionSyncResponse> {
    return this.getJson<AppManagedSessionSyncResponse>(
      this.buildUrl('/api/managed-sessions'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identityId: input.identityId,
          email: input.email,
          flowType: input.flowType,
          clientId: input.clientId,
          authMode: input.authMode,
          accountId: input.accountId,
          sessionId: input.sessionId,
          expiresAt: input.expiresAt,
          lastRefreshAt: input.lastRefreshAt,
          sessionData: input.sessionData,
        }),
      },
      [VERIFICATION_RESERVE_SCOPE],
    )
  }

  async getAssociatedManagedWorkspace(input: {
    identityId?: string
    email?: string
  }): Promise<AppManagedWorkspaceRecord | null> {
    const url = new URL(this.buildUrl('/api/managed-workspaces'))
    if (input.identityId?.trim()) {
      url.searchParams.set('identityId', input.identityId.trim())
    }
    if (input.email?.trim()) {
      url.searchParams.set('email', input.email.trim().toLowerCase())
    }

    const response = await this.getJson<AppManagedWorkspaceLookupResponse>(
      url,
      {},
      [VERIFICATION_RESERVE_SCOPE],
    )

    return response.workspace || null
  }

  async syncManagedWorkspace(input: {
    workspaceId: string
    label?: string
    memberEmails?: string[]
  }): Promise<AppManagedWorkspaceRecord> {
    const response = await this.getJson<AppManagedWorkspaceSyncResponse>(
      this.buildUrl('/api/managed-workspaces'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceId: input.workspaceId,
          label: input.label,
          memberEmails: input.memberEmails,
        }),
      },
      [VERIFICATION_RESERVE_SCOPE],
    )

    return response.workspace
  }
}
