import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRuntimeConfig = vi.fn()
const waitForLoginSurface = vi.fn()
const continueChatGPTLoginWithStoredIdentity = vi.fn()
const createAuthorizationCallbackCapture = vi.fn()
const startCodexAuthorization = vi.fn()
const exchangeCodexAuthorizationCode = vi.fn()
const saveCodexToken = vi.fn()
const signIn = vi.fn()
const createChannel = vi.fn()
const buildCodexOAuthCredentials = vi.fn()
const AxonHubAdminClient = vi.fn()

vi.mock('../src/config', () => ({
  getRuntimeConfig,
}))

vi.mock('../src/modules/chatgpt/shared', () => ({
  waitForLoginSurface,
}))

vi.mock('../src/flows/chatgpt-login', () => ({
  continueChatGPTLoginWithStoredIdentity,
}))

vi.mock('../src/modules/authorization/codex-authorization', () => ({
  createAuthorizationCallbackCapture,
}))

vi.mock('../src/modules/authorization/codex-client', () => ({
  startCodexAuthorization,
  exchangeCodexAuthorizationCode,
}))

vi.mock('../src/modules/authorization/codex-token-store', () => ({
  saveCodexToken,
}))

vi.mock('../src/modules/authorization/axonhub-client', () => ({
  AxonHubAdminClient,
  buildCodexOAuthCredentials,
}))

describe('runCodexOAuthFlow', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    getRuntimeConfig.mockReturnValue({
      codex: {
        authorizeUrl: 'https://auth.openai.com/oauth/authorize',
        tokenUrl: 'https://auth.openai.com/oauth/token',
        clientId: 'codex-client-id',
        scope: 'openid profile email offline_access',
        redirectHost: 'localhost',
        redirectPort: 1455,
        redirectPath: '/auth/callback',
      },
      axonHub: {
        baseUrl: 'https://axonhub.example.com',
        email: 'admin@example.com',
        password: 'admin-password',
        projectId: 'project-from-config',
      },
      codexChannel: {
        name: 'Codex OAuth',
        baseUrl: 'https://api.openai.com',
        tags: ['codex'],
        supportedModels: ['codex-mini-latest'],
        manualModels: [],
        defaultTestModel: 'codex-mini-latest',
      },
    })

    startCodexAuthorization.mockReturnValue({
      authorizationUrl:
        'https://auth.openai.com/oauth/authorize?client_id=codex-client-id',
      redirectUri: 'http://localhost:1455/auth/callback',
      redirectHost: 'localhost',
      redirectPort: 1455,
      redirectPath: '/auth/callback',
      state: 'oauth-state',
      codeVerifier: 'oauth-code-verifier',
    })

    saveCodexToken.mockReturnValue('C:/tmp/codex-oauth.json')

    buildCodexOAuthCredentials.mockImplementation(
      (
        token: {
          accessToken: string
          refreshToken?: string
          tokenType?: string
          scope?: string
        },
        clientId: string,
      ) => ({
        oauth: {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          clientID: clientId,
          tokenType: token.tokenType,
          scopes: token.scope?.split(/\s+/).filter(Boolean) || [],
        },
      }),
    )

    signIn.mockResolvedValue({
      token: 'axonhub-admin-token',
    })

    createChannel.mockResolvedValue({
      id: 'channel-123',
      name: 'Codex OAuth',
      credentials: {
        oauth: {
          accessToken: 'channel-access-token',
        },
      },
    })

    AxonHubAdminClient.mockImplementation(() => ({
      signIn,
      createChannel,
    }))
  })

  it('waits for a late login surface and continues stored-identity login before exchanging the callback', async () => {
    let currentUrl = 'https://auth.openai.com/oauth/authorize'
    let resolveCallback!: (value: {
      code: string
      state: string
      callbackUrl: string
      rawQuery: string
    }) => void

    const callbackResult = new Promise<{
      code: string
      state: string
      callbackUrl: string
      rawQuery: string
    }>((resolve) => {
      resolveCallback = resolve
    })

    createAuthorizationCallbackCapture.mockResolvedValue({
      result: callbackResult,
      abort: vi.fn().mockResolvedValue(undefined),
    })

    waitForLoginSurface.mockImplementation(
      async (_page: unknown, timeoutMs: number) => {
        return timeoutMs >= 180000 ? 'email' : 'unknown'
      },
    )

    continueChatGPTLoginWithStoredIdentity.mockImplementation(
      async (
        _page: unknown,
        options: {
          onEmailRetry?: (
            attempt: number,
            reason: 'retry' | 'timeout',
          ) => void | Promise<void>
        },
      ) => {
        await options.onEmailRetry?.(1, 'retry')
        currentUrl =
          'http://localhost:1455/auth/callback?code=oauth-code&state=oauth-state'
        resolveCallback({
          code: 'oauth-code',
          state: 'oauth-state',
          callbackUrl: currentUrl,
          rawQuery: '/auth/callback?code=oauth-code&state=oauth-state',
        })

        return {
          email: 'person@example.com',
          storedIdentity: {
            id: 'identity-123',
            email: 'person@example.com',
          },
          surface: 'email',
          method: 'password',
          assertionObserved: false,
          passkeyStore: { credentials: [] },
        }
      },
    )

    exchangeCodexAuthorizationCode.mockResolvedValue({
      accessToken: 'codex-access-token',
      refreshToken: 'codex-refresh-token',
      expiresIn: 3600,
      scope: 'openid profile email offline_access',
      tokenType: 'Bearer',
      createdAt: '2026-04-17T00:00:00.000Z',
    })

    const page = {
      goto: vi.fn(async (url: string) => {
        currentUrl = url
      }),
      url: vi.fn(() => currentUrl),
      title: vi.fn(async () => 'Authorization received'),
    } as never

    const { runCodexOAuthFlow } = await import('../src/flows/codex-oauth')
    const result = await runCodexOAuthFlow(page, {})

    expect(createAuthorizationCallbackCapture).toHaveBeenCalledWith(
      page,
      expect.objectContaining({
        timeoutMs: 180000,
      }),
    )
    expect(waitForLoginSurface).toHaveBeenCalledWith(page, 180000)
    expect(continueChatGPTLoginWithStoredIdentity).toHaveBeenCalledOnce()
    expect(exchangeCodexAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'oauth-code',
        redirectUri: 'http://localhost:1455/auth/callback',
        codeVerifier: 'oauth-code-verifier',
      }),
    )
    expect(result).toMatchObject({
      pageName: 'codex-oauth',
      redirectUri: 'http://localhost:1455/auth/callback',
      tokenStorePath: 'C:/tmp/codex-oauth.json',
      axonHub: {
        channel: {
          id: 'channel-123',
          name: 'Codex OAuth',
        },
      },
    })
    expect(
      result.machine.history.some(
        (entry) =>
          entry.event === 'codex.oauth.retry.requested' &&
          entry.to === 'retrying',
      ),
    ).toBe(true)
  })
})
