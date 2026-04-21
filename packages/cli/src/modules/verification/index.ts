import type { CliRuntimeConfig } from '../../config'
import { AppVerificationProviderClient } from './app-client'
import { AppVerificationProvider } from './app-provider'
import { ExchangeVerificationProvider } from './exchange-provider'
import type { VerificationProvider, VerificationProviderKind } from './types'

function resolveVerificationAppConfig(config: {
  app?: CliRuntimeConfig['app']
  verification?: CliRuntimeConfig['verification']
}) {
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
    reserveEmailPath:
      verificationAppConfig?.reserveEmailPath ??
      sharedAppConfig?.reserveEmailPath,
    verificationCodePath:
      verificationAppConfig?.verificationCodePath ??
      sharedAppConfig?.verificationCodePath,
    verificationEventsPath:
      verificationAppConfig?.verificationEventsPath ??
      sharedAppConfig?.verificationEventsPath,
  }
}

function hasAppVerificationConfig(config: {
  app?: CliRuntimeConfig['app']
  verification?: CliRuntimeConfig['verification']
}): boolean {
  const appConfig = resolveVerificationAppConfig(config)
  return Boolean(
    appConfig.baseUrl ||
    appConfig.oidcIssuer ||
    appConfig.oidcBasePath ||
    appConfig.clientId ||
    appConfig.clientSecret ||
    appConfig.scope ||
    appConfig.resource ||
    appConfig.reserveEmailPath ||
    appConfig.verificationCodePath ||
    appConfig.verificationEventsPath,
  )
}

export function resolveVerificationProviderKind(config: {
  app?: CliRuntimeConfig['app']
  exchange?: CliRuntimeConfig['exchange']
  verification?: CliRuntimeConfig['verification']
}): VerificationProviderKind {
  const explicitProvider = config.verification?.provider
  if (explicitProvider === 'exchange' || explicitProvider === 'app') {
    return explicitProvider
  }

  if (config.exchange) return 'exchange'
  if (hasAppVerificationConfig(config)) return 'app'

  throw new Error(
    'Verification provider is not configured. Provide Exchange config or configure CODEY_APP_* app settings.',
  )
}

export function createVerificationProvider(
  config: Pick<CliRuntimeConfig, 'app' | 'exchange' | 'verification'>,
): VerificationProvider {
  const provider = resolveVerificationProviderKind(config)
  if (provider === 'exchange') {
    if (!config.exchange) {
      throw new Error(
        'Exchange config is required when verification.provider is "exchange".',
      )
    }

    return new ExchangeVerificationProvider(config.exchange)
  }

  return new AppVerificationProvider(
    new AppVerificationProviderClient(resolveVerificationAppConfig(config)),
  )
}

export * from './types'
export * from './exchange-provider'
export * from './app-client'
export * from './app-provider'
