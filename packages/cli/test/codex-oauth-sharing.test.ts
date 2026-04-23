import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSub2ApiOpenAiRelatedModelMapping } from '../src/modules/app-auth/sub2api-related-models'

const getRuntimeConfig = vi.fn()

vi.mock('../src/config', () => ({
  getRuntimeConfig,
}))

describe('syncCodexOAuthSessionToSub2Api', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns null when Sub2API sync is not configured', async () => {
    getRuntimeConfig.mockReturnValue({})

    const { syncCodexOAuthSessionToSub2Api } =
      await import('../src/modules/app-auth/codex-oauth-sharing')

    await expect(
      syncCodexOAuthSessionToSub2Api({
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
      }),
    ).resolves.toBeNull()
  })

  it('creates a Sub2API account and uses the email as the account name', async () => {
    getRuntimeConfig.mockReturnValue({
      sub2api: {
        baseUrl: 'https://sub2api.example.com',
        bearerToken: 'sub2api-bearer',
      },
    })

    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: 'success',
            data: {
              access_token: 'fresh-access-token',
              refresh_token: 'fresh-refresh-token',
              expires_at: 1770000000,
              client_id: 'codex-client-id',
              email: 'person@example.com',
            },
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
            code: 0,
            message: 'success',
            data: {
              items: [],
            },
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
            code: 0,
            message: 'success',
            data: {
              id: 42,
              name: 'person@example.com',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { syncCodexOAuthSessionToSub2Api } =
      await import('../src/modules/app-auth/codex-oauth-sharing')

    await expect(
      syncCodexOAuthSessionToSub2Api({
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
          createdAt: '2026-04-21T00:00:00.000Z',
        },
        clientId: 'codex-client-id',
      }),
    ).resolves.toEqual({
      accountId: 42,
      action: 'created',
      email: 'person@example.com',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://sub2api.example.com/api/v1/admin/openai/refresh-token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sub2api-bearer',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          refresh_token: 'codex-refresh-token',
          client_id: 'codex-client-id',
        }),
      }),
    )

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://sub2api.example.com/api/v1/admin/accounts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'person@example.com',
          platform: 'openai',
          type: 'oauth',
          credentials: {
            access_token: 'fresh-access-token',
            refresh_token: 'fresh-refresh-token',
            expires_at: 1770000000,
            email: 'person@example.com',
            client_id: 'codex-client-id',
          },
          extra: {
            email: 'person@example.com',
          },
          concurrency: 0,
          priority: 0,
        }),
      }),
    )
  })

  it('adds related model mappings when auto-fill is enabled', async () => {
    getRuntimeConfig.mockReturnValue({
      sub2api: {
        baseUrl: 'https://sub2api.example.com',
        bearerToken: 'sub2api-bearer',
        autoFillRelatedModels: true,
      },
    })

    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: 'success',
            data: {
              access_token: 'fresh-access-token',
              refresh_token: 'fresh-refresh-token',
              email: 'person@example.com',
            },
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
            code: 0,
            message: 'success',
            data: {
              items: [],
            },
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
            code: 0,
            message: 'success',
            data: {
              id: 43,
              name: 'person@example.com',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { syncCodexOAuthSessionToSub2Api } =
      await import('../src/modules/app-auth/codex-oauth-sharing')

    await expect(
      syncCodexOAuthSessionToSub2Api({
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
      }),
    ).resolves.toEqual({
      accountId: 43,
      action: 'created',
      email: 'person@example.com',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://sub2api.example.com/api/v1/admin/accounts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'person@example.com',
          platform: 'openai',
          type: 'oauth',
          credentials: {
            access_token: 'fresh-access-token',
            refresh_token: 'fresh-refresh-token',
            email: 'person@example.com',
            client_id: 'codex-client-id',
            model_mapping: buildSub2ApiOpenAiRelatedModelMapping(),
          },
          extra: {
            email: 'person@example.com',
          },
          concurrency: 0,
          priority: 0,
        }),
      }),
    )
  })

  it('updates an existing Sub2API account matched by email', async () => {
    getRuntimeConfig.mockReturnValue({
      sub2api: {
        baseUrl: 'https://sub2api.example.com',
        bearerToken: 'sub2api-bearer',
      },
    })

    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: 'success',
            data: {
              access_token: 'fresh-access-token',
              expires_at: 1770000000,
              email: 'person@example.com',
            },
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
            code: 0,
            message: 'success',
            data: {
              items: [
                {
                  id: 99,
                  name: 'Old Name',
                  credentials: {
                    email: 'person@example.com',
                  },
                },
              ],
            },
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
            code: 0,
            message: 'success',
            data: {
              id: 99,
              name: 'person@example.com',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { syncCodexOAuthSessionToSub2Api } =
      await import('../src/modules/app-auth/codex-oauth-sharing')

    await expect(
      syncCodexOAuthSessionToSub2Api({
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
      }),
    ).resolves.toEqual({
      accountId: 99,
      action: 'updated',
      email: 'person@example.com',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://sub2api.example.com/api/v1/admin/accounts/99',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          name: 'person@example.com',
          credentials: {
            access_token: 'fresh-access-token',
            refresh_token: 'codex-refresh-token',
            expires_at: 1770000000,
            email: 'person@example.com',
            client_id: 'codex-client-id',
          },
        }),
      }),
    )
  })

  it('logs into Sub2API with email/password when bearer token is not configured', async () => {
    getRuntimeConfig.mockReturnValue({
      sub2api: {
        baseUrl: 'https://sub2api.example.com',
        email: 'admin@example.com',
        password: 'super-secret',
      },
    })

    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            message: 'success',
            data: {
              access_token: 'admin-jwt-token',
              token_type: 'Bearer',
            },
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
            code: 0,
            message: 'success',
            data: {
              access_token: 'fresh-access-token',
              refresh_token: 'fresh-refresh-token',
              email: 'person@example.com',
            },
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
            code: 0,
            message: 'success',
            data: {
              items: [],
            },
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
            code: 0,
            message: 'success',
            data: {
              id: 77,
              name: 'person@example.com',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const { syncCodexOAuthSessionToSub2Api } =
      await import('../src/modules/app-auth/codex-oauth-sharing')

    await expect(
      syncCodexOAuthSessionToSub2Api({
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
      }),
    ).resolves.toEqual({
      accountId: 77,
      action: 'created',
      email: 'person@example.com',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://sub2api.example.com/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'super-secret',
        }),
      }),
    )

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://sub2api.example.com/api/v1/admin/openai/refresh-token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer admin-jwt-token',
          'Content-Type': 'application/json',
        }),
      }),
    )
  })
})
