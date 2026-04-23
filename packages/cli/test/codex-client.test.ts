import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  exchangeCodexAuthorizationCode,
  startCodexAuthorization,
} from '../src/modules/authorization/codex-client'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('startCodexAuthorization', () => {
  it('includes the simplified Codex CLI flow param by default', () => {
    const started = startCodexAuthorization({
      authorizeUrl: 'https://auth.openai.com/oauth/authorize',
      clientId: 'codex-client-id',
      scope: 'openid profile email offline_access',
      redirectHost: 'localhost',
      redirectPort: 1455,
      redirectPath: '/auth/callback',
      openBrowserWindow: false,
    })

    const authorizationUrl = new URL(started.authorizationUrl)

    expect(authorizationUrl.searchParams.get('codex_cli_simplified_flow')).toBe(
      'true',
    )
    expect(authorizationUrl.searchParams.get('allowed_workspace_id')).toBeNull()
  })

  it('only includes allowed_workspace_id when a workspace id is provided', () => {
    const started = startCodexAuthorization({
      authorizeUrl: 'https://auth.openai.com/oauth/authorize',
      clientId: 'codex-client-id',
      scope: 'openid profile email offline_access',
      redirectHost: 'localhost',
      redirectPort: 1455,
      redirectPath: '/auth/callback',
      openBrowserWindow: false,
      allowedWorkspaceId: 'ws-associated',
    })

    const authorizationUrl = new URL(started.authorizationUrl)

    expect(authorizationUrl.searchParams.get('codex_cli_simplified_flow')).toBe(
      'true',
    )
    expect(authorizationUrl.searchParams.get('allowed_workspace_id')).toBe(
      'ws-associated',
    )
  })
})

describe('exchangeCodexAuthorizationCode', () => {
  it('requires a Patchright API request context', async () => {
    await expect(
      exchangeCodexAuthorizationCode({
        tokenUrl: 'https://auth.openai.com/oauth/token',
        clientId: 'codex-client-id',
        code: 'oauth-code',
        redirectUri: 'http://localhost:1455/auth/callback',
      }),
    ).rejects.toThrow(
      'Codex OAuth token exchange requires a Patchright APIRequestContext.',
    )
  })

  it('uses the Patchright API request context for token exchange', async () => {
    const requestContext = {
      fetch: vi.fn(async () => ({
        ok: () => true,
        status: () => 200,
        statusText: () => 'OK',
        text: async () =>
          JSON.stringify({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
            scope: 'openid profile email offline_access',
            token_type: 'Bearer',
          }),
      })),
    }

    await expect(
      exchangeCodexAuthorizationCode({
        tokenUrl: 'https://auth.openai.com/oauth/token',
        clientId: 'codex-client-id',
        code: 'oauth-code',
        redirectUri: 'http://localhost:1455/auth/callback',
        codeVerifier: 'verifier',
        requestContext: requestContext as never,
      }),
    ).resolves.toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
      scope: 'openid profile email offline_access',
      tokenType: 'Bearer',
    })

    expect(requestContext.fetch).toHaveBeenCalledWith(
      'https://auth.openai.com/oauth/token',
      expect.objectContaining({
        method: 'POST',
        failOnStatusCode: false,
      }),
    )
  })

  it('surfaces nested OAuth error objects as readable messages', async () => {
    const requestContext = {
      fetch: vi.fn(async () => ({
        ok: () => false,
        status: () => 400,
        statusText: () => 'Bad Request',
        text: async () =>
          JSON.stringify({
            error: {
              message: 'Authorization code already redeemed.',
              code: 'invalid_grant',
            },
          }),
      })),
    }

    await expect(
      exchangeCodexAuthorizationCode({
        tokenUrl: 'https://auth.openai.com/oauth/token',
        clientId: 'codex-client-id',
        code: 'oauth-code',
        redirectUri: 'http://localhost:1455/auth/callback',
        codeVerifier: 'verifier',
        requestContext: requestContext as never,
      }),
    ).rejects.toThrow('Authorization code already redeemed. (invalid_grant)')
  })

  it('surfaces non-JSON token exchange failures verbatim', async () => {
    const requestContext = {
      fetch: vi.fn(async () => ({
        ok: () => false,
        status: () => 400,
        statusText: () => 'Bad Request',
        text: async () => 'authorization code expired',
      })),
    }

    await expect(
      exchangeCodexAuthorizationCode({
        tokenUrl: 'https://auth.openai.com/oauth/token',
        clientId: 'codex-client-id',
        code: 'oauth-code',
        redirectUri: 'http://localhost:1455/auth/callback',
        requestContext: requestContext as never,
      }),
    ).rejects.toThrow('authorization code expired')
  })
})
