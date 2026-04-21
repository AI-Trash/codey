import type { CodeyAppConfig } from '../../config'
import { getRuntimeConfig } from '../../config'
import { AppVerificationProviderClient } from '../verification/app-client'
import type { StoredChatGPTSession } from '../credentials/sessions'
import {
  getAppSessionAccessToken,
  isAppSessionExpired,
  readAppSession,
} from './token-store'

const MANAGED_SESSION_SYNC_SCOPE = 'verification:reserve'

function parseScopeList(value: string | undefined): string[] {
  if (!value) {
    return []
  }

  return value
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function hasRequiredScopes(
  grantedScope: string | undefined,
  requiredScopes: string[],
): boolean {
  if (!requiredScopes.length) {
    return true
  }

  const granted = parseScopeList(grantedScope)
  return requiredScopes.every((scope) => granted.includes(scope))
}

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

function hasReusableCodeyAppAccess(
  config: Pick<CodeyAppConfig, 'baseUrl' | 'clientId' | 'clientSecret'>,
): boolean {
  if (!config.baseUrl?.trim()) {
    return false
  }

  if (config.clientId?.trim() && config.clientSecret?.trim()) {
    return true
  }

  try {
    const session = readAppSession()
    return (
      Boolean(getAppSessionAccessToken(session)) &&
      !isAppSessionExpired(session) &&
      hasRequiredScopes(session.tokenSet.scope, [MANAGED_SESSION_SYNC_SCOPE])
    )
  } catch {
    return false
  }
}

export async function syncManagedSessionToCodeyApp(input: {
  identityId: string
  email: string
  flowType: 'chatgpt-register' | 'chatgpt-login' | 'codex-oauth'
  session: StoredChatGPTSession
}): Promise<{ ok: boolean; id: string } | null> {
  const config = resolveCodeyAppConfig()
  if (!hasReusableCodeyAppAccess(config)) {
    return null
  }

  const client = new AppVerificationProviderClient(config)
  return client.upsertManagedSession({
    identityId: input.identityId.trim(),
    email: input.email.trim().toLowerCase(),
    flowType: input.flowType,
    clientId: input.session.clientId,
    authMode: input.session.auth.auth_mode,
    accountId: input.session.accountId,
    sessionId: input.session.sessionId,
    expiresAt: input.session.expiresAt,
    lastRefreshAt: input.session.auth.last_refresh,
    sessionData: input.session.auth,
  })
}

export async function syncManagedSessionsToCodeyApp(input: {
  identityId: string
  email: string
  flowType: 'chatgpt-register' | 'chatgpt-login'
  sessions: StoredChatGPTSession[]
}): Promise<number> {
  let syncedCount = 0

  for (const session of input.sessions) {
    const result = await syncManagedSessionToCodeyApp({
      identityId: input.identityId,
      email: input.email,
      flowType: input.flowType,
      session,
    })
    if (!result) {
      continue
    }

    syncedCount += 1
  }

  return syncedCount
}
