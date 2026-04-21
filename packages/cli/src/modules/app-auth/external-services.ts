import type { CodeyAppConfig, Sub2ApiConfig } from '../../config'
import { getRuntimeConfig } from '../../config'
import { AppVerificationProviderClient } from '../verification/app-client'

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

export async function fetchManagedSub2ApiConfigFromCodeyApp(): Promise<Sub2ApiConfig> {
  const config = resolveCodeyAppConfig()
  if (!config.baseUrl?.trim()) {
    throw new Error(
      'Codey app access is required before loading the app-managed Sub2API config.',
    )
  }

  const client = new AppVerificationProviderClient(config)
  return client.getManagedSub2ApiConfig()
}
