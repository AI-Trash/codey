import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRuntimeConfig = vi.fn()

vi.mock('../src/config', () => ({
  getRuntimeConfig,
}))

describe('shareCodexOAuthSessionWithCodeyApp', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns null when Codey app sharing is not configured', async () => {
    getRuntimeConfig.mockReturnValue({})

    const { shareCodexOAuthSessionWithCodeyApp } =
      await import('../src/modules/app-auth/codex-oauth-sharing')

    await expect(
      shareCodexOAuthSessionWithCodeyApp({
        identity: {
          id: 'identity-1',
          email: 'person@example.com',
          createdAt: '2026-04-21T00:00:00.000Z',
          updatedAt: '2026-04-21T00:00:00.000Z',
          credentialCount: 1,
          encrypted: true,
          storePath: 'codey-app://managed-identities/identity-1',
        },
        token: {
          accessToken: 'codex-access-token',
          refreshToken: 'codex-refresh-token',
          createdAt: '2026-04-21T00:00:00.000Z',
        },
        clientId: 'codex-client-id',
        redirectUri: 'http://localhost:1455/auth/callback',
        workspaceId: 'ws-primary',
      }),
    ).resolves.toBeNull()
  })

  it('stores the session in Codey app and returns the server-side Sub2API sync result', async () => {
    getRuntimeConfig.mockReturnValue({
      app: {
        baseUrl: 'http://localhost:4317',
        clientId: 'codey_client',
        clientSecret: 'codey_secret',
      },
    })

    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issuer: 'http://localhost:4317/oidc',
            token_endpoint: 'http://localhost:4317/oidc/token',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'token-123',
            token_type: 'Bearer',
            scope: 'verification:read verification:reserve',
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            id: 'identity-1',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            id: 'managed-session-123',
            sub2api: {
              accountId: 42,
              action: 'created',
              email: 'person@example.com',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { shareCodexOAuthSessionWithCodeyApp } =
      await import('../src/modules/app-auth/codex-oauth-sharing')

    await expect(
      shareCodexOAuthSessionWithCodeyApp({
        identity: {
          id: 'identity-1',
          email: 'person@example.com',
          createdAt: '2026-04-21T00:00:00.000Z',
          updatedAt: '2026-04-21T00:00:00.000Z',
          credentialCount: 1,
          encrypted: true,
          storePath: 'codey-app://managed-identities/identity-1',
        },
        token: {
          accessToken: 'codex-access-token',
          refreshToken: 'codex-refresh-token',
          expiresIn: 3600,
          scope: 'openid profile email offline_access',
          tokenType: 'Bearer',
          createdAt: '2026-04-21T00:00:00.000Z',
        },
        clientId: 'codex-client-id',
        redirectUri: 'http://localhost:1455/auth/callback',
        workspaceId: 'ws-primary',
      }),
    ).resolves.toEqual({
      identityId: 'identity-1',
      identityRecordId: 'identity-1',
      sessionRecordId: 'managed-session-123',
      sessionStorePath: 'codey-app://managed-sessions/managed-session-123',
      sub2api: {
        accountId: 42,
        action: 'created',
        email: 'person@example.com',
      },
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:4317/api/managed-identities',
      expect.objectContaining({
        method: 'POST',
      }),
    )

    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'http://localhost:4317/api/managed-sessions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          identityId: 'identity-1',
          email: 'person@example.com',
          flowType: 'codex-oauth',
          clientId: 'codex-client-id',
          authMode: 'codex-oauth',
          workspaceId: 'ws-primary',
          accountId: undefined,
          sessionId: undefined,
          expiresAt: '2026-04-21T01:00:00.000Z',
          lastRefreshAt: '2026-04-21T00:00:00.000Z',
          sessionData: {
            auth_mode: 'codex-oauth',
            provider: 'codex',
            last_refresh: '2026-04-21T00:00:00.000Z',
            client_id: 'codex-client-id',
            redirect_uri: 'http://localhost:1455/auth/callback',
            workspace_id: 'ws-primary',
            tokens: {
              access_token: 'codex-access-token',
              refresh_token: 'codex-refresh-token',
              token_type: 'Bearer',
              scope: 'openid profile email offline_access',
              expires_at: '2026-04-21T01:00:00.000Z',
            },
          },
        }),
      }),
    )
  })
})
