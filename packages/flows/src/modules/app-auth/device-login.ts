import { getRuntimeConfig } from '../../config'
import { sleep } from '../../utils/wait'
import { resolveAppUrl } from './http'
import {
  exchangeOidcDeviceCode,
  OidcRequestError,
  startOidcDeviceAuthorization,
} from './oidc'
import type {
  AdminNotificationEvent,
  DeviceChallengeResponse,
  DeviceChallengeStatusResponse,
  DeviceChallengeTokenResponse,
} from './types'
import {
  createStoredAppSession,
  getAppSessionAccessToken,
  isAppSessionExpired,
  readAppSession,
  saveAppSession,
} from './token-store'
import { streamSse } from './sse'

function getCodeyAppConfig() {
  const config = getRuntimeConfig()
  return {
    baseUrl: config.app?.baseUrl ?? config.verification?.app?.baseUrl,
    oidcIssuer: config.app?.oidcIssuer ?? config.verification?.app?.oidcIssuer,
    oidcBasePath:
      config.app?.oidcBasePath ?? config.verification?.app?.oidcBasePath,
    clientId: config.app?.clientId ?? config.verification?.app?.clientId,
    clientSecret:
      config.app?.clientSecret ?? config.verification?.app?.clientSecret,
    scope: config.app?.scope ?? config.verification?.app?.scope,
    resource: config.app?.resource ?? config.verification?.app?.resource,
    tokenEndpointAuthMethod:
      config.app?.tokenEndpointAuthMethod ??
      config.verification?.app?.tokenEndpointAuthMethod,
    cliEventsPath:
      config.app?.cliEventsPath ?? config.verification?.app?.cliEventsPath,
  }
}

function getAppOidcConfig(input: { scope?: string } = {}) {
  const config = getCodeyAppConfig()
  return {
    baseUrl: config.baseUrl,
    oidcIssuer: config.oidcIssuer,
    oidcBasePath: config.oidcBasePath,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scope: input.scope || config.scope,
    resource: config.resource,
    tokenEndpointAuthMethod: config.tokenEndpointAuthMethod,
  }
}

function mapDeviceAuthorizationError(
  error: OidcRequestError,
  expiresAt: string,
  pollIntervalSeconds: number,
): DeviceChallengeStatusResponse {
  if (error.error === 'authorization_pending') {
    return {
      status: 'PENDING',
      error: error.error,
      errorDescription: error.errorDescription,
      expiresAt,
      pollIntervalSeconds,
    }
  }

  if (error.error === 'access_denied') {
    return {
      status: 'DENIED',
      error: error.error,
      errorDescription: error.errorDescription,
      expiresAt,
    }
  }

  if (error.error === 'expired_token') {
    return {
      status: 'EXPIRED',
      error: error.error,
      errorDescription: error.errorDescription,
      expiresAt,
    }
  }

  throw error
}

export async function startDeviceLogin(
  input: {
    flowType?: string
    cliName?: string
    scope?: string
  } = {},
): Promise<DeviceChallengeResponse> {
  return startOidcDeviceAuthorization(getAppOidcConfig({ scope: input.scope }))
}

export async function exchangeDeviceChallenge(
  challenge: DeviceChallengeResponse,
  target?: string,
): Promise<DeviceChallengeTokenResponse> {
  const startedAt = Date.now()
  const expiresAtMs = Date.parse(challenge.expiresAt)
  let pollIntervalMs = Math.max((challenge.interval || 5) * 1000, 1000)

  while (Date.now() <= expiresAtMs) {
    try {
      const tokenSet = await exchangeOidcDeviceCode(
        getAppOidcConfig(),
        challenge.deviceCode,
      )
      const session = createStoredAppSession({
        tokenSet,
        target,
      })
      saveAppSession(session)
      return {
        status: 'APPROVED',
        ...tokenSet,
        subject: session.subject,
        user: session.user,
      }
    } catch (error) {
      if (!(error instanceof OidcRequestError)) {
        throw error
      }

      if (error.error === 'slow_down') {
        pollIntervalMs += 5000
        await sleep(pollIntervalMs)
        continue
      }

      const status = mapDeviceAuthorizationError(
        error,
        challenge.expiresAt,
        Math.ceil(pollIntervalMs / 1000),
      )
      if (status.status === 'PENDING') {
        await sleep(pollIntervalMs)
        continue
      }

      throw new Error(
        status.errorDescription ||
          (status.status === 'DENIED'
            ? 'Device authorization was denied.'
            : 'Device authorization expired.'),
      )
    }
  }

  const elapsedSeconds = Math.max(
    Math.round((Date.now() - startedAt) / 1000),
    0,
  )
  throw new Error(
    `Device authorization expired after waiting ${elapsedSeconds} seconds.`,
  )
}

export async function waitForDeviceApproval(
  challenge: DeviceChallengeResponse,
): Promise<DeviceChallengeStatusResponse> {
  try {
    await exchangeDeviceChallenge(challenge)
    return {
      status: 'APPROVED',
      expiresAt: challenge.expiresAt,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/denied/i.test(message)) {
      return {
        status: 'DENIED',
        errorDescription: message,
        expiresAt: challenge.expiresAt,
      }
    }
    if (/expired/i.test(message)) {
      return {
        status: 'EXPIRED',
        errorDescription: message,
        expiresAt: challenge.expiresAt,
      }
    }
    throw error
  }
}

export async function* streamCliNotifications(
  input: {
    target?: string
    cliName?: string
  } = {},
): AsyncGenerator<AdminNotificationEvent, void, void> {
  const config = getCodeyAppConfig()
  const session = readAppSession()
  if (isAppSessionExpired(session)) {
    throw new Error(
      'Stored app session is expired. Run `codey auth login` again.',
    )
  }
  const target =
    input.target ||
    session.target ||
    session.subject ||
    session.user?.githubLogin ||
    session.user?.email ||
    undefined
  const eventsUrl = new URL(
    resolveAppUrl(config.cliEventsPath || '/api/cli/events'),
  )
  if (target) {
    eventsUrl.searchParams.set('target', target)
  }

  const response = await fetch(eventsUrl, {
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${getAppSessionAccessToken(session)}`,
      ...(input.cliName ? { 'X-Codey-CLI-Name': input.cliName } : {}),
    },
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  for await (const event of streamSse(response)) {
    if (event.event !== 'admin_notification' || !event.data) continue
    yield JSON.parse(event.data) as AdminNotificationEvent
  }
}
