import { spawn } from 'child_process'
import {
  buildAuthorizationUrl,
  waitForAuthorizationCode,
} from './codex-authorization'
import { fetchWithHarCapture, type NodeHarRecorder } from './har-recorder'

interface CodexTokenPayload {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
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
      tokenPayload.error_description ||
        tokenPayload.error ||
        'Codex token exchange failed.',
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

export function startCodexAuthorization(input: {
  authorizeUrl: string
  clientId: string
  scope?: string
  redirectHost?: string
  redirectPort?: number
  redirectPath?: string
  openBrowserWindow?: boolean
}): CodexAuthorizationStartResult {
  const redirectHost = input.redirectHost || 'localhost'
  const redirectPort = input.redirectPort || 1455
  const redirectPath = input.redirectPath || '/auth/callback'
  const redirectUri = `http://${redirectHost}:${redirectPort}${redirectPath}`
  const authorization = buildAuthorizationUrl({
    authorizeUrl: input.authorizeUrl,
    clientId: input.clientId,
    redirectUri,
    scope: input.scope,
    pkce: true,
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
}): Promise<CodexTokenResponse> {
  const response = await fetchWithHarCapture(
    input.harRecorder,
    input.tokenUrl,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: input.clientId,
        ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
        ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
      }),
    },
    {
      comment: 'Codex OAuth token exchange',
    },
  )

  const tokenPayload = (await response.json()) as CodexTokenPayload
  if (!response.ok) {
    throw new Error(
      tokenPayload.error_description ||
        tokenPayload.error ||
        'Codex token exchange failed.',
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
}): Promise<CodexTokenResponse> {
  const started = startCodexAuthorization({
    authorizeUrl: input.authorizeUrl,
    clientId: input.clientId,
    scope: input.scope,
    redirectHost: input.redirectHost,
    redirectPort: input.redirectPort,
    redirectPath: input.redirectPath,
    openBrowserWindow: input.openBrowserWindow,
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
  })
}
