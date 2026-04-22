import type { CodeyAppConfig } from '../../config'
import { getRuntimeConfig } from '../../config'
import {
  AppVerificationProviderClient,
  type AppManagedWorkspaceRecord,
} from '../verification/app-client'
import {
  getAppSessionAccessToken,
  isAppSessionExpired,
  readAppSession,
} from './token-store'

const MANAGED_WORKSPACE_SYNC_SCOPE = 'verification:reserve'

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
      hasRequiredScopes(session.tokenSet.scope, [MANAGED_WORKSPACE_SYNC_SCOPE])
    )
  } catch {
    return false
  }
}

export async function syncManagedWorkspaceToCodeyApp(input: {
  workspaceId: string
  label?: string
  ownerIdentityId?: string
  memberEmails?: string[]
}): Promise<AppManagedWorkspaceRecord | null> {
  const config = resolveCodeyAppConfig()
  if (!hasReusableCodeyAppAccess(config)) {
    return null
  }

  const client = new AppVerificationProviderClient(config)
  return client.syncManagedWorkspace({
    workspaceId: input.workspaceId.trim(),
    label: input.label?.trim() || undefined,
    ownerIdentityId: input.ownerIdentityId?.trim() || undefined,
    memberEmails: input.memberEmails || [],
  })
}

export async function resolveAssociatedManagedWorkspaceFromCodeyApp(input: {
  identityId?: string
  email?: string
}): Promise<AppManagedWorkspaceRecord | null> {
  const config = resolveCodeyAppConfig()
  if (!hasReusableCodeyAppAccess(config)) {
    return null
  }

  const identityId = input.identityId?.trim() || undefined
  const email = input.email?.trim().toLowerCase() || undefined
  if (!identityId && !email) {
    return null
  }

  const client = new AppVerificationProviderClient(config)
  return client.getAssociatedManagedWorkspace({
    identityId,
    email,
  })
}
