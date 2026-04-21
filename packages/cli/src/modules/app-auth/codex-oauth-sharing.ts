import type { CodeyAppConfig } from '../../config'
import { getRuntimeConfig } from '../../config'
import type { CodexTokenResponse } from '../authorization/codex-client'
import type { StoredChatGPTIdentitySummary } from '../credentials'
import { AppVerificationProviderClient } from '../verification/app-client'

export interface SharedCodexOAuthSessionResult {
  identityId: string
  identityRecordId: string
  sessionRecordId: string
  sessionStorePath: string
}

const APP_SESSION_STORE_ROOT = 'codey-app://managed-sessions'

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

export async function shareCodexOAuthSessionWithCodeyApp(input: {
  identity: StoredChatGPTIdentitySummary
  token: CodexTokenResponse
  clientId: string
  redirectUri: string
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
    expiresAt,
    lastRefreshAt: input.token.createdAt,
    sessionData: {
      auth_mode: 'codex-oauth',
      provider: 'codex',
      last_refresh: input.token.createdAt,
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
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
  }
}
