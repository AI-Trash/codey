import '@tanstack/react-start/server-only'

import Provider, {
  errors,
  type Account,
  type AccessToken,
  type AuthorizationCode,
  type BackchannelAuthenticationRequest,
  type Configuration,
  type DeviceCode,
  type KoaContextWithOIDC,
  type ResourceServer,
} from 'oidc-provider'
import { m } from '#/paraglide/messages'
import { createOidcAdapter } from './adapter'
import { getAppEnv } from '../env'
import { getManagedOidcJwks } from './jwks'
import {
  renderDeviceFlowSuccess,
  renderDeviceUserCodeConfirm,
  renderDeviceUserCodeInput,
} from './interactions'

interface ResourceIndicatorRecord {
  audience: string
  scope: string
  accessTokenTTL: number
  accessTokenFormat: 'opaque'
}

function readIssuer(): string {
  const env = getAppEnv()
  const baseUrl = env.oauthIssuer || env.appBaseUrl || 'http://localhost:3000'
  return baseUrl.endsWith('/oidc')
    ? baseUrl
    : `${baseUrl.replace(/\/$/, '')}/oidc`
}

function readSupportedScopes(): string[] {
  const env = getAppEnv()
  return env.oauthSupportedScopes
}

function getTokenEndpointAuthMethods() {
  return ['client_secret_basic', 'client_secret_post'] as const
}

function getResourceIndicators(): Record<string, ResourceIndicatorRecord> {
  const env = getAppEnv()
  const defaultAudience = env.oauthDefaultResourceIndicator || readIssuer()
  const scopes = readSupportedScopes().join(' ')
  return {
    [defaultAudience]: {
      audience: defaultAudience,
      scope: scopes,
      accessTokenTTL: env.oauthAccessTokenTtlSeconds,
      accessTokenFormat: 'opaque',
    },
  }
}

async function findAccount(
  _ctx: KoaContextWithOIDC,
  sub: string,
  token?:
    | AuthorizationCode
    | AccessToken
    | DeviceCode
    | BackchannelAuthenticationRequest,
): Promise<Account | undefined> {
  const accountId =
    ('accountId' in (token || {}) && typeof token?.accountId === 'string'
      ? token.accountId
      : undefined) || sub
  if (!accountId) {
    return undefined
  }
  return {
    accountId,
    async claims() {
      return { sub: accountId }
    },
  }
}

function buildOidcConfiguration(jwks: {
  keys: Array<Record<string, unknown>>
}): Configuration {
  const env = getAppEnv()
  const resourceIndicators = getResourceIndicators()
  return {
    adapter: createOidcAdapter,
    jwks,
    pkce: {
      required: () => false,
    },
    scopes: readSupportedScopes(),
    claims: {
      openid: ['sub'],
    },
    clientAuthMethods: [...getTokenEndpointAuthMethods()],
    clients: [],
    findAccount,
    extraClientMetadata: {
      properties: [],
    },
    renderError(ctx, out, error) {
      ctx.status = out.error === 'invalid_scope' ? 400 : 500
      ctx.body = {
        error: out.error,
        error_description:
          out.error_description ||
          (error instanceof Error ? error.message : 'OIDC provider error'),
      }
    },
    interactions: {
      url(_ctx, interaction) {
        return `/oidc/interaction/${interaction.uid}`
      },
    },
    features: {
      devInteractions: {
        enabled: false,
      },
      clientCredentials: {
        enabled: true,
      },
      deviceFlow: {
        enabled: true,
        mask: '****-****',
        async userCodeInputSource(ctx, form, _out, err) {
          ctx.type = 'html'
          ctx.body = await renderDeviceUserCodeInput({
            ctx,
            form,
            errorMessage:
              err && ('userCode' in err || err.name === 'NoCodeError')
                ? m.oidc_device_error_invalid_code()
                : err && err.name === 'AbortedError'
                  ? m.oidc_device_error_interrupted()
                  : err
                    ? m.oidc_device_error_generic()
                    : undefined,
          })
        },
        async userCodeConfirmSource(ctx, form, client, _deviceInfo, userCode) {
          ctx.type = 'html'
          ctx.body = await renderDeviceUserCodeConfirm({
            ctx,
            form,
            clientName: client.clientName || client.clientId,
            userCode,
          })
        },
        async successSource(ctx) {
          ctx.type = 'html'
          ctx.body = await renderDeviceFlowSuccess(
            ctx.oidc.client?.clientName ||
              ctx.oidc.client?.clientId ||
              m.oidc_device_client_fallback(),
          )
        },
      },
      revocation: {
        enabled: true,
      },
      introspection: {
        enabled: true,
      },
      resourceIndicators: {
        enabled: true,
        getResourceServerInfo(_ctx, resourceIndicator): ResourceServer {
          const resourceServer = resourceIndicators[resourceIndicator]
          if (!resourceServer) {
            throw new errors.InvalidTarget('Unknown resource indicator')
          }
          return {
            audience: resourceServer.audience,
            scope: resourceServer.scope,
            accessTokenTTL: resourceServer.accessTokenTTL,
            accessTokenFormat: resourceServer.accessTokenFormat,
          }
        },
        defaultResource() {
          return env.oauthDefaultResourceIndicator || readIssuer()
        },
      },
    },
    ttl: {
      AccessToken: env.oauthAccessTokenTtlSeconds,
      ClientCredentials: env.oauthAccessTokenTtlSeconds,
      DeviceCode: env.oauthDeviceCodeTtlSeconds,
    },
  }
}

declare global {
  var __codeyOidcProviderState:
    | {
        issuer: string
        jwksVersion: string
        provider: Provider
      }
    | undefined
  var __codeyOidcProviderPromise: Promise<Provider> | undefined
}

export async function getOidcConfiguration(): Promise<Configuration> {
  const snapshot = await getManagedOidcJwks()
  return buildOidcConfiguration({
    keys: snapshot.keys,
  })
}

export async function getOidcProvider(): Promise<Provider> {
  const issuer = readIssuer()
  const snapshot = await getManagedOidcJwks()
  const cached = globalThis.__codeyOidcProviderState
  if (
    cached &&
    cached.issuer === issuer &&
    cached.jwksVersion === snapshot.version
  ) {
    return cached.provider
  }

  if (!globalThis.__codeyOidcProviderPromise) {
    globalThis.__codeyOidcProviderPromise = (async () => {
      const resolvedIssuer = readIssuer()
      const resolvedSnapshot = await getManagedOidcJwks({
        forceRefresh: true,
      })
      const existing = globalThis.__codeyOidcProviderState
      if (
        existing &&
        existing.issuer === resolvedIssuer &&
        existing.jwksVersion === resolvedSnapshot.version
      ) {
        return existing.provider
      }

      const provider = new Provider(
        resolvedIssuer,
        buildOidcConfiguration({
          keys: resolvedSnapshot.keys,
        }),
      )
      provider.proxy = true
      globalThis.__codeyOidcProviderState = {
        issuer: resolvedIssuer,
        jwksVersion: resolvedSnapshot.version,
        provider,
      }
      return provider
    })().finally(() => {
      globalThis.__codeyOidcProviderPromise = undefined
    })
  }

  return globalThis.__codeyOidcProviderPromise
}
