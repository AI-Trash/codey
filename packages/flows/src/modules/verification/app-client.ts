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
import { extractChatGPTVerificationCodeFromSubject } from '../chatgpt/common'
import type {
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
  receivedAt?: string
  emails?: AppVerificationEmailRecord[]
}

export interface AppVerificationEmailRecord {
  messageId?: string | null
  subject?: string | null
  textBody?: string | null
  htmlBody?: string | null
  rawPayload?: string | null
  receivedAt: string
}

export interface AppVerificationEvent {
  type: 'keepalive' | 'verification_code'
  reservationId?: string
  email?: string
  code?: string
  receivedAt?: string
  emails?: AppVerificationEmailRecord[]
}

const VERIFICATION_READ_SCOPE = 'verification:read'
const VERIFICATION_RESERVE_SCOPE = 'verification:reserve'

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
      [VERIFICATION_RESERVE_SCOPE],
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
      options.onPollAttempt?.(attempt)

      const result = await this.getJson<AppVerificationCodeLookupResponse>(
        codeUrl,
        {},
        [VERIFICATION_READ_SCOPE],
      )
      for (const email of result.emails || []) {
        const extractedCode = extractChatGPTVerificationCodeFromSubject(
          email.subject,
        )
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
        headers: {
          Accept: 'text/event-stream',
        },
      },
      [VERIFICATION_READ_SCOPE],
    )

    if (!response.ok) {
      throw new Error(await response.text())
    }

    for await (const event of streamSse(response)) {
      if (event.event === 'verification_code' && event.data) {
        const payload = JSON.parse(
          event.data,
        ) as AppVerificationCodeLookupResponse
        yield {
          type: 'verification_code',
          reservationId: payload.reservationId,
          email: params.email,
          code: payload.code,
          receivedAt: payload.receivedAt,
          emails: payload.emails,
        }
        continue
      }

      yield {
        type: 'keepalive',
        email: params.email,
      }
    }
  }
}
