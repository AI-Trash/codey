import { getRuntimeConfig } from '../../config'
import { sleep } from '../../utils/wait'
import { DEFAULT_CODEY_APP_BASE_URL, resolveAppUrl } from './http'
import {
  exchangeOidcClientCredentials,
  exchangeOidcDeviceCode,
  OidcRequestError,
  startOidcDeviceAuthorization,
} from './oidc'
import type {
  AdminNotificationEvent,
  CliConnectionEvent,
  CliRealtimeEnvelope,
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
  type StoredAppSession,
} from './token-store'
import { listCliFlowCommandIds } from '../flow-cli/flow-registry'
import { deriveCliTargetFromAuthState } from './target'
import { connectWebSocket, streamWebSocketEvents, toWebSocketUrl } from './ws'

const NOTIFICATIONS_READ_SCOPE = 'notifications:read'

export interface CliNotificationsAuthState {
  mode: 'client_credentials' | 'device_session'
  accessToken: string
  clientId?: string
  session?: StoredAppSession
}

function getCodeyAppConfig() {
  const config = getRuntimeConfig()
  return {
    baseUrl:
      config.app?.baseUrl ??
      config.verification?.app?.baseUrl ??
      process.env.APP_BASE_URL ??
      DEFAULT_CODEY_APP_BASE_URL,
    oidcIssuer: config.app?.oidcIssuer ?? config.verification?.app?.oidcIssuer,
    oidcBasePath:
      config.app?.oidcBasePath ??
      config.verification?.app?.oidcBasePath ??
      '/oidc',
    clientId: config.app?.clientId ?? config.verification?.app?.clientId,
    clientSecret:
      config.app?.clientSecret ?? config.verification?.app?.clientSecret,
    scope: config.app?.scope ?? config.verification?.app?.scope,
    resource: config.app?.resource ?? config.verification?.app?.resource,
    tokenEndpointAuthMethod:
      config.app?.tokenEndpointAuthMethod ??
      config.verification?.app?.tokenEndpointAuthMethod,
    cliEventsPath:
      config.app?.cliEventsPath ??
      config.verification?.app?.cliEventsPath ??
      '/api/realtime/ws',
  }
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

function buildRequestedScope(
  baseScope: string | undefined,
  requiredScopes: string[],
): string | undefined {
  const requestedScopes = new Set([
    ...parseScopeList(baseScope),
    ...requiredScopes,
  ])
  return requestedScopes.size
    ? Array.from(requestedScopes).join(' ')
    : undefined
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

function getRequiredCliNotificationScopes(): string[] {
  return [NOTIFICATIONS_READ_SCOPE]
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

function hasClientCredentialsConfig(): boolean {
  const config = getCodeyAppConfig()
  return Boolean(config.clientId?.trim() && config.clientSecret?.trim())
}

export async function resolveCliNotificationsAuthState(): Promise<CliNotificationsAuthState> {
  const requiredScopes = getRequiredCliNotificationScopes()
  const config = getCodeyAppConfig()

  if (hasClientCredentialsConfig()) {
    const tokenSet = await exchangeOidcClientCredentials({
      ...getAppOidcConfig({
        scope: buildRequestedScope(config.scope, requiredScopes),
      }),
    })

    return {
      mode: 'client_credentials',
      accessToken: tokenSet.accessToken,
      clientId: config.clientId?.trim(),
    }
  }

  const session = readAppSession()
  if (isAppSessionExpired(session)) {
    throw new Error(
      'Stored app session is expired. Run `codey auth login` again.',
    )
  }
  if (!hasRequiredScopes(session.tokenSet.scope, requiredScopes)) {
    throw new Error(
      `Stored app session is missing the required ${NOTIFICATIONS_READ_SCOPE} scope. Run \`codey auth login --scope ${NOTIFICATIONS_READ_SCOPE}\` again.`,
    )
  }

  return {
    mode: 'device_session',
    accessToken: getAppSessionAccessToken(session),
    session,
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
    workerId?: string
  } = {},
  authState?: CliNotificationsAuthState,
  handlers?: {
    onDebug?: (message: string) => void
    onConnection?: (event: CliConnectionEvent) => void
  },
  options?: {
    signal?: AbortSignal
  },
): AsyncGenerator<AdminNotificationEvent, void, void> {
  const config = getCodeyAppConfig()
  const resolvedAuthState =
    authState || (await resolveCliNotificationsAuthState())
  const target = input.target || deriveCliTargetFromAuthState(resolvedAuthState)
  const wsUrl = toWebSocketUrl(new URL(resolveAppUrl('/api/realtime/ws')))
  handlers?.onDebug?.(`Opening WebSocket ${wsUrl.toString()}`)
  const headers = {
    Authorization: `Bearer ${resolvedAuthState.accessToken}`,
    ...(resolvedAuthState.mode === 'device_session' && resolvedAuthState.session?.user?.id
      ? { 'X-Codey-User-Id': resolvedAuthState.session.user.id }
      : {}),
    ...(resolvedAuthState.mode === 'client_credentials' && resolvedAuthState.clientId
      ? { 'X-Codey-Auth-Client-Id': resolvedAuthState.clientId }
      : {}),
    ...(input.cliName ? { 'X-Codey-CLI-Name': input.cliName } : {}),
    ...(input.workerId ? { 'X-Codey-Worker-Id': input.workerId } : {}),
    'X-Codey-Registered-Flows': listCliFlowCommandIds().join(','),
  }
  const socket = await connectWebSocket({ url: wsUrl, headers })
  handlers?.onDebug?.(`WebSocket open ${wsUrl.toString()}`)

  for await (const envelope of streamWebSocketEvents<CliRealtimeEnvelope['event']>({
    url: wsUrl,
    socket,
    signal: options?.signal,
    onDebug: handlers?.onDebug,
    onReady: (readySocket) => {
      handlers?.onDebug?.('Sending realtime subscription: cli')
      readySocket.send(
        JSON.stringify({
          action: 'subscribe',
          channel: 'cli',
          ...(target ? { target } : {}),
          ...(input.cliName ? { cliName: input.cliName } : {}),
        }),
      )
    },
  })) {
    handlers?.onDebug?.(`Realtime event received: ${envelope.event}`)
    if (envelope.event === 'cli_connection') {
      handlers?.onConnection?.(envelope.data as CliConnectionEvent)
      continue
    }
    if (envelope.event === 'timeout') {
      break
    }
    if (envelope.event === 'realtime_subscription') {
      handlers?.onDebug?.(
        `Realtime subscription acknowledged: ${String(envelope.data.channel || 'unknown')} ${String(envelope.data.status || '')}`.trim(),
      )
      continue
    }
    if (envelope.event === 'error') {
      throw new Error(String(envelope.data.message || 'Realtime connection error'))
    }
    if (envelope.event !== 'admin_notification') {
      continue
    }

    yield envelope.data as AdminNotificationEvent
  }
}
