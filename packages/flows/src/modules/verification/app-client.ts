import type { AppVerificationProviderConfig } from '../../config'
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
const VERIFICATION_APP_SCOPES = [
  VERIFICATION_READ_SCOPE,
  VERIFICATION_RESERVE_SCOPE,
] as const

export interface AppManagedIdentitySyncResponse {
  ok: boolean
  id: string
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

    console.error(
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
    credentialCount?: number
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
          credentialCount: input.credentialCount,
        }),
      },
      [VERIFICATION_RESERVE_SCOPE],
    )
  }
}
