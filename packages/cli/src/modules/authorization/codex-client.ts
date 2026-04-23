import { spawn } from 'child_process'
import type { APIRequestContext, APIResponse } from 'patchright'
import {
  buildAuthorizationUrl,
  waitForAuthorizationCode,
} from './codex-authorization'
import {
  fetchWithApiRequestHarCapture,
  type NodeHarRecorder,
} from './har-recorder'

interface CodexJsonErrorPayload {
  error?: unknown
  error_description?: unknown
  detail?: unknown
  message?: unknown
}

interface CodexTokenPayload extends CodexJsonErrorPayload {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

export interface CodexTokenResponse {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  scope?: string
  tokenType?: string
  createdAt: string
}

export interface CodexAuthorizationStartResult {
  authorizationUrl: string
  redirectUri: string
  redirectHost: string
  redirectPort: number
  redirectPath: string
  state: string
  codeVerifier?: string
}

function normalizeCodexErrorValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => normalizeCodexErrorValue(entry, seen))
      .filter((entry): entry is string => Boolean(entry))
    return parts.length > 0 ? parts.join('; ') : undefined
  }

  if (!value || typeof value !== 'object') {
    return undefined
  }

  if (seen.has(value)) {
    return undefined
  }
  seen.add(value)

  const record = value as Record<string, unknown>
  const primary =
    normalizeCodexErrorValue(record.error_description, seen) ||
    normalizeCodexErrorValue(record.detail, seen) ||
    normalizeCodexErrorValue(record.message, seen) ||
    normalizeCodexErrorValue(record.error, seen) ||
    normalizeCodexErrorValue(record.reason, seen) ||
    normalizeCodexErrorValue(record.description, seen)
  const extras = [
    normalizeCodexErrorValue(record.code, seen),
    normalizeCodexErrorValue(record.type, seen),
  ].filter((entry): entry is string => Boolean(entry))

  if (primary && extras.length > 0) {
    const suffix = extras.filter((entry) => !primary.includes(entry)).join(', ')
    return suffix ? `${primary} (${suffix})` : primary
  }

  return primary || extras[0]
}

function readCodexErrorMessage(
  payload: CodexJsonErrorPayload,
  fallbackMessage: string,
): string {
  return (
    normalizeCodexErrorValue(payload.error_description) ||
    normalizeCodexErrorValue(payload.detail) ||
    normalizeCodexErrorValue(payload.message) ||
    normalizeCodexErrorValue(payload.error) ||
    fallbackMessage
  )
}

async function parseCodexTokenPayload(
  response: APIResponse,
): Promise<CodexTokenPayload> {
  const body = await response.text()
  if (!body) {
    return {}
  }

  try {
    return JSON.parse(body) as CodexTokenPayload
  } catch {
    if (!response.ok()) {
      throw new Error(
        body.trim() || `Codex token exchange failed (${response.status()}).`,
      )
    }

    throw new Error('Expected a JSON response from the Codex OAuth provider.')
  }
}

function openBrowser(url: string): void {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
    }).unref()
    return
  }

  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  spawn(command, [url], {
    detached: true,
    stdio: 'ignore',
  }).unref()
}

function mapCodexTokenResponse(
  tokenPayload: CodexTokenPayload,
): CodexTokenResponse {
  if (!tokenPayload.access_token) {
    throw new Error(
      readCodexErrorMessage(tokenPayload, 'Codex token exchange failed.'),
    )
  }

  return {
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token,
    expiresIn: tokenPayload.expires_in,
    scope: tokenPayload.scope,
    tokenType: tokenPayload.token_type,
    createdAt: new Date().toISOString(),
  }
}

function requireRequestContext(
  requestContext: APIRequestContext | undefined,
): APIRequestContext {
  if (!requestContext) {
    throw new Error(
      'Codex OAuth token exchange requires a Patchright APIRequestContext.',
    )
  }

  return requestContext
}

export function startCodexAuthorization(input: {
  authorizeUrl: string
  clientId: string
  scope?: string
  redirectHost?: string
  redirectPort?: number
  redirectPath?: string
  openBrowserWindow?: boolean
  codexCliSimplifiedFlow?: boolean
  allowedWorkspaceId?: string
}): CodexAuthorizationStartResult {
  const redirectHost = input.redirectHost || 'localhost'
  const redirectPort = input.redirectPort || 1455
  const redirectPath = input.redirectPath || '/auth/callback'
  const redirectUri = `http://${redirectHost}:${redirectPort}${redirectPath}`
  const allowedWorkspaceId = input.allowedWorkspaceId?.trim() || undefined
  const authorization = buildAuthorizationUrl({
    authorizeUrl: input.authorizeUrl,
    clientId: input.clientId,
    redirectUri,
    scope: input.scope,
    pkce: true,
    extraParams: {
      ...(input.codexCliSimplifiedFlow === false
        ? {}
        : { codex_cli_simplified_flow: true }),
      ...(allowedWorkspaceId
        ? { allowed_workspace_id: allowedWorkspaceId }
        : {}),
    },
  })

  if (input.openBrowserWindow !== false) {
    openBrowser(authorization.authorizationUrl)
  }

  return {
    authorizationUrl: authorization.authorizationUrl,
    redirectUri,
    redirectHost,
    redirectPort,
    redirectPath,
    state: authorization.state,
    codeVerifier: authorization.codeVerifier || undefined,
  }
}

export async function exchangeCodexAuthorizationCode(input: {
  tokenUrl: string
  clientId: string
  clientSecret?: string
  code: string
  redirectUri: string
  codeVerifier?: string
  harRecorder?: NodeHarRecorder
  requestContext?: APIRequestContext
}): Promise<CodexTokenResponse> {
  const form = {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
    ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
  } satisfies Record<string, string>

  const response = await fetchWithApiRequestHarCapture(
    input.harRecorder,
    requireRequestContext(input.requestContext),
    input.tokenUrl,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      form,
    },
    {
      comment: 'Codex OAuth token exchange',
    },
  )

  const tokenPayload = await parseCodexTokenPayload(response)
  if (!response.ok()) {
    throw new Error(
      readCodexErrorMessage(
        tokenPayload,
        `Codex token exchange failed (${response.status()}).`,
      ),
    )
  }

  return mapCodexTokenResponse(tokenPayload)
}

export async function runCodexAuthorization(input: {
  authorizeUrl: string
  tokenUrl: string
  clientId: string
  clientSecret?: string
  scope?: string
  redirectHost?: string
  redirectPort?: number
  redirectPath?: string
  openBrowserWindow?: boolean
  harRecorder?: NodeHarRecorder
  requestContext?: APIRequestContext
  codexCliSimplifiedFlow?: boolean
  allowedWorkspaceId?: string
}): Promise<CodexTokenResponse> {
  const started = startCodexAuthorization({
    authorizeUrl: input.authorizeUrl,
    clientId: input.clientId,
    scope: input.scope,
    redirectHost: input.redirectHost,
    redirectPort: input.redirectPort,
    redirectPath: input.redirectPath,
    openBrowserWindow: input.openBrowserWindow,
    codexCliSimplifiedFlow: input.codexCliSimplifiedFlow,
    allowedWorkspaceId: input.allowedWorkspaceId,
  })

  const callback = await waitForAuthorizationCode({
    host: started.redirectHost,
    port: started.redirectPort,
    path: started.redirectPath,
  })
  if (!callback.state) {
    throw new Error('Codex OAuth callback did not include state.')
  }
  if (!callback.code) {
    throw new Error(
      'Codex OAuth callback did not include an authorization code.',
    )
  }
  if (callback.state !== started.state) {
    throw new Error('Codex OAuth state mismatch.')
  }

  return exchangeCodexAuthorizationCode({
    tokenUrl: input.tokenUrl,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    code: callback.code,
    redirectUri: started.redirectUri,
    codeVerifier: started.codeVerifier,
    harRecorder: input.harRecorder,
    requestContext: input.requestContext,
  })
}
