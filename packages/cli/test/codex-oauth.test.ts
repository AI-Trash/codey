import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRuntimeConfig = vi.fn()
const waitForCodexOAuthSurface = vi.fn()
const waitForCodexOAuthSurfaceCandidates = vi.fn()
const clickLoginEntryIfPresent = vi.fn()
const clickPasswordSubmit = vi.fn()
const clickVerificationContinue = vi.fn()
const completePasswordOrVerificationLoginFallback = vi.fn()
const continueCodexOrganizationSelection = vi.fn()
const continueCodexWorkspaceSelection = vi.fn()
const continueCodexOAuthConsent = vi.fn()
const submitLoginEmail = vi.fn()
const typePassword = vi.fn()
const typeVerificationCode = vi.fn()
const waitForPasswordInputReady = vi.fn()
const waitForPostEmailLoginCandidates = vi.fn()
const waitForVerificationCode = vi.fn()
const waitForVerificationCodeInputReady = vi.fn()
const createAuthorizationCallbackCapture = vi.fn()
const startCodexAuthorization = vi.fn()
const exchangeCodexAuthorizationCode = vi.fn()
const shareCodexOAuthSessionWithCodeyApp = vi.fn()
const syncCodexOAuthSessionToSub2Api = vi.fn()
const resolveStoredChatGPTIdentity = vi.fn()

vi.mock('../src/config', () => ({
  getRuntimeConfig,
}))

vi.mock('../src/modules/chatgpt/shared', () => ({
  clickLoginEntryIfPresent,
  clickPasswordSubmit,
  clickVerificationContinue,
  completePasswordOrVerificationLoginFallback,
  continueCodexOAuthConsent,
  continueCodexOrganizationSelection,
  continueCodexWorkspaceSelection,
  submitLoginEmail,
  typePassword,
  typeVerificationCode,
  waitForCodexOAuthSurface,
  waitForCodexOAuthSurfaceCandidates,
  waitForPasswordInputReady,
  waitForPostEmailLoginCandidates,
  waitForVerificationCode,
  waitForVerificationCodeInputReady,
}))

vi.mock('../src/modules/credentials', () => ({
  resolveStoredChatGPTIdentity,
}))

vi.mock('../src/modules/authorization/codex-authorization', () => ({
  createAuthorizationCallbackCapture,
}))

vi.mock('../src/modules/authorization/codex-client', () => ({
  startCodexAuthorization,
  exchangeCodexAuthorizationCode,
}))

vi.mock('../src/modules/app-auth/codex-oauth-sharing', () => ({
  shareCodexOAuthSessionWithCodeyApp,
  syncCodexOAuthSessionToSub2Api,
}))

describe('runCodexOAuthFlow', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    getRuntimeConfig.mockReturnValue({
      artifactsDir: 'C:/tmp/artifacts',
      browser: {
        recordHar: false,
      },
      app: {
        baseUrl: 'http://localhost:3000',
        clientId: 'codey-client-id',
        clientSecret: 'codey-client-secret',
      },
      codex: {
        authorizeUrl: 'https://auth.openai.com/oauth/authorize',
        tokenUrl: 'https://auth.openai.com/oauth/token',
        clientId: 'codex-client-id',
        scope: 'openid profile email offline_access',
        redirectHost: 'localhost',
        redirectPort: 1455,
        redirectPath: '/auth/callback',
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

    shareCodexOAuthSessionWithCodeyApp.mockResolvedValue({
      identityId: 'identity-123',
      identityRecordId: 'managed-identity-1',
      sessionRecordId: 'managed-session-1',
      sessionStorePath: 'codey-app://managed-sessions/managed-session-1',
    })
    syncCodexOAuthSessionToSub2Api.mockResolvedValue(null)
    resolveStoredChatGPTIdentity.mockReturnValue({
      identity: {
        email: 'person@example.com',
        password: 'person-password',
      },
      summary: {
        id: 'identity-123',
        email: 'person@example.com',
        credentialCount: 0,
      },
    })

    clickPasswordSubmit.mockResolvedValue(undefined)
    clickVerificationContinue.mockResolvedValue(true)
    completePasswordOrVerificationLoginFallback.mockResolvedValue({
      method: 'password',
    })
    continueCodexOrganizationSelection.mockResolvedValue({
      availableOrganizations: 1,
      selectedOrganizationIndex: 1,
      availableProjects: 1,
      selectedProjectIndex: 1,
    })
    submitLoginEmail.mockResolvedValue(undefined)
    typePassword.mockResolvedValue(true)
    typeVerificationCode.mockResolvedValue(undefined)
    waitForCodexOAuthSurfaceCandidates.mockResolvedValue([])
    waitForPasswordInputReady.mockResolvedValue(false)
    waitForPostEmailLoginCandidates.mockResolvedValue([])
    waitForVerificationCode.mockResolvedValue('654321')
    waitForVerificationCodeInputReady.mockResolvedValue(false)
  })

  it('advances stored identity login even when an earlier post-email candidate is a false positive', async () => {
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

    waitForCodexOAuthSurfaceCandidates.mockImplementation(
      async (_page: unknown, timeoutMs: number) => {
        if (timeoutMs >= 180000) {
          return ['email']
        }
        return new Promise<never>(() => undefined)
      },
    )
    clickLoginEntryIfPresent.mockResolvedValue(true)
    submitLoginEmail.mockImplementation(
      async (
        _page: unknown,
        _email: string,
        options?: {
          onRetry?: (
            attempt: number,
            reason: 'retry' | 'timeout',
          ) => void | Promise<void>
        },
      ) => {
        await options?.onRetry?.(1, 'retry')
      },
    )
    waitForPostEmailLoginCandidates.mockResolvedValueOnce(['retry', 'password'])
    completePasswordOrVerificationLoginFallback.mockImplementation(async () => {
      currentUrl =
        'http://localhost:1455/auth/callback?code=oauth-code&state=oauth-state'
      resolveCallback({
        code: 'oauth-code',
        state: 'oauth-state',
        callbackUrl: currentUrl,
        rawQuery: '/auth/callback?code=oauth-code&state=oauth-state',
      })
      return {
        method: 'verification',
        verificationCode: '654321',
      }
    })

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
    const result = await runCodexOAuthFlow(page, {
      identityId: 'identity-123',
      email: 'person@example.com',
    })

    expect(createAuthorizationCallbackCapture).toHaveBeenCalledWith(
      page,
      expect.objectContaining({
        timeoutMs: 180000,
      }),
    )
    expect(waitForCodexOAuthSurfaceCandidates).toHaveBeenCalledWith(
      page,
      180000,
    )
    expect(submitLoginEmail).toHaveBeenCalledWith(
      page,
      'person@example.com',
      expect.objectContaining({
        onRetry: expect.any(Function),
      }),
    )
    expect(waitForPostEmailLoginCandidates).toHaveBeenCalledWith(page, 15000)
    expect(completePasswordOrVerificationLoginFallback).toHaveBeenCalledWith(
      page,
      expect.objectContaining({
        email: 'person@example.com',
        password: 'person-password',
        step: 'password',
        verificationTimeoutMs: 180000,
        pollIntervalMs: 5000,
      }),
    )
    expect(resolveStoredChatGPTIdentity).toHaveBeenCalledWith({
      id: 'identity-123',
      email: 'person@example.com',
    })
    expect(
      result.machine.history.some(
        (entry) =>
          entry.event === 'context.updated' && entry.to === 'password-step',
      ),
    ).toBe(true)
    expect(exchangeCodexAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'oauth-code',
        redirectUri: 'http://localhost:1455/auth/callback',
        codeVerifier: 'oauth-code-verifier',
      }),
    )
    expect(result).toMatchObject({
      pageName: 'codex-oauth',
      email: 'person@example.com',
      redirectUri: 'http://localhost:1455/auth/callback',
      tokenStorePath: 'codey-app://managed-sessions/managed-session-1',
    })
    expect(
      result.machine.history.some(
        (entry) =>
          entry.event === 'codex.oauth.retry.requested' &&
          entry.to === 'retrying',
      ),
    ).toBe(true)
  })

  it('defaults to the latest stored identity when login is required and no identity is passed', async () => {
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

    waitForCodexOAuthSurfaceCandidates.mockImplementation(
      async (_page: unknown, timeoutMs: number) => {
        if (timeoutMs >= 180000) {
          return ['email']
        }
        return new Promise<never>(() => undefined)
      },
    )
    waitForPostEmailLoginCandidates.mockResolvedValueOnce(['password'])
    completePasswordOrVerificationLoginFallback.mockImplementation(async () => {
      currentUrl =
        'http://localhost:1455/auth/callback?code=oauth-code&state=oauth-state'
      resolveCallback({
        code: 'oauth-code',
        state: 'oauth-state',
        callbackUrl: currentUrl,
        rawQuery: '/auth/callback?code=oauth-code&state=oauth-state',
      })
      return {
        method: 'password',
      }
    })

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

    expect(resolveStoredChatGPTIdentity).toHaveBeenCalledWith({
      id: undefined,
      email: undefined,
    })
    expect(submitLoginEmail).toHaveBeenCalledWith(
      page,
      'person@example.com',
      expect.objectContaining({
        onRetry: expect.any(Function),
      }),
    )
    expect(result).toMatchObject({
      pageName: 'codex-oauth',
      email: 'person@example.com',
      tokenStorePath: 'codey-app://managed-sessions/managed-session-1',
    })
  })

  it('clicks the login entry surface before continuing stored-identity login', async () => {
    let currentUrl = 'https://chatgpt.com/auth/login'
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

    let surfaceChecks = 0
    waitForCodexOAuthSurfaceCandidates.mockImplementation(async () => {
      surfaceChecks += 1
      if (surfaceChecks === 1) {
        return ['login']
      }
      if (surfaceChecks === 2) {
        return ['email']
      }
      return new Promise<never>(() => undefined)
    })
    clickLoginEntryIfPresent.mockImplementation(async () => {
      currentUrl = 'https://auth.openai.com/log-in-or-create-account'
      return true
    })
    waitForPostEmailLoginCandidates.mockResolvedValueOnce(['password'])
    completePasswordOrVerificationLoginFallback.mockImplementation(async () => {
      currentUrl =
        'http://localhost:1455/auth/callback?code=oauth-code&state=oauth-state'
      resolveCallback({
        code: 'oauth-code',
        state: 'oauth-state',
        callbackUrl: currentUrl,
        rawQuery: '/auth/callback?code=oauth-code&state=oauth-state',
      })
      return {
        method: 'password',
      }
    })

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
    const result = await runCodexOAuthFlow(page, {
      identityId: 'identity-123',
      email: 'person@example.com',
    })

    expect(clickLoginEntryIfPresent).toHaveBeenCalledOnce()
    expect(waitForCodexOAuthSurfaceCandidates).toHaveBeenNthCalledWith(
      1,
      page,
      180000,
    )
    expect(waitForCodexOAuthSurfaceCandidates).toHaveBeenNthCalledWith(
      2,
      page,
      15000,
    )
    expect(submitLoginEmail).toHaveBeenCalledOnce()
    expect(waitForPostEmailLoginCandidates).toHaveBeenCalledWith(page, 15000)
    expect(completePasswordOrVerificationLoginFallback).toHaveBeenCalledWith(
      page,
      expect.objectContaining({
        email: 'person@example.com',
        password: 'person-password',
        step: 'password',
      }),
    )
    expect(
      result.machine.history.some(
        (entry) =>
          entry.event === 'codex.oauth.surface.ready' &&
          entry.to === 'login-entry',
      ),
    ).toBe(true)
    expect(
      result.machine.history.some(
        (entry) =>
          entry.event === 'codex.oauth.surface.ready' &&
          entry.to === 'email-step',
      ),
    ).toBe(true)
    expect(
      result.machine.history.some(
        (entry) =>
          entry.event === 'context.updated' && entry.to === 'password-step',
      ),
    ).toBe(true)
  })

  it('reuses the shared verification flow when OpenAI asks for email verification', async () => {
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

    waitForCodexOAuthSurfaceCandidates.mockImplementation(
      async (_page: unknown, timeoutMs: number) => {
        if (timeoutMs >= 180000) {
          return ['email']
        }
        return new Promise<never>(() => undefined)
      },
    )
    waitForPostEmailLoginCandidates.mockResolvedValueOnce(['verification'])
    waitForVerificationCodeInputReady.mockResolvedValue(true)
    completePasswordOrVerificationLoginFallback.mockImplementation(async () => {
      currentUrl =
        'http://localhost:1455/auth/callback?code=oauth-code&state=oauth-state'
      resolveCallback({
        code: 'oauth-code',
        state: 'oauth-state',
        callbackUrl: currentUrl,
        rawQuery: '/auth/callback?code=oauth-code&state=oauth-state',
      })
      return {
        method: 'verification',
        verificationCode: '654321',
      }
    })

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
    const result = await runCodexOAuthFlow(page, {
      identityId: 'identity-123',
      email: 'person@example.com',
    })

    expect(waitForVerificationCodeInputReady).toHaveBeenCalledWith(page, 10000)
    expect(completePasswordOrVerificationLoginFallback).toHaveBeenCalledWith(
      page,
      expect.objectContaining({
        email: 'person@example.com',
        password: 'person-password',
        step: 'verification',
        verificationTimeoutMs: 180000,
        pollIntervalMs: 5000,
      }),
    )
    expect(
      result.machine.history.some(
        (entry) =>
          entry.event === 'context.updated' && entry.to === 'verification-step',
      ),
    ).toBe(true)
    expect(result).toMatchObject({
      pageName: 'codex-oauth',
      email: 'person@example.com',
    })
  })

  it('can stop after generating the oauth url and return it for manual verification', async () => {
    const page = {
      goto: vi.fn(),
      url: vi.fn(() => 'about:blank'),
      title: vi.fn(async () => 'about:blank'),
    }

    const { runCodexOAuthFlow } = await import('../src/flows/codex-oauth')
    const result = await runCodexOAuthFlow(page as never, {
      authorizeUrlOnly: true,
    })

    expect(result).toMatchObject({
      pageName: 'codex-oauth-authorize-url',
      redirectUri: 'http://localhost:1455/auth/callback',
      oauthUrl:
        'https://auth.openai.com/oauth/authorize?client_id=codex-client-id',
    })
    expect(createAuthorizationCallbackCapture).not.toHaveBeenCalled()
    expect(waitForCodexOAuthSurfaceCandidates).not.toHaveBeenCalled()
    expect(exchangeCodexAuthorizationCode).not.toHaveBeenCalled()
    expect(page.goto).not.toHaveBeenCalled()
    expect(result.machine).toMatchObject({
      status: 'succeeded',
      state: 'completed',
      context: {
        redirectUri: 'http://localhost:1455/auth/callback',
        authorizationUrl:
          'https://auth.openai.com/oauth/authorize?client_id=codex-client-id',
        lastMessage:
          'Generated Codex OAuth URL and exited before browser login',
      },
    })
  })

  it('selects the requested Codex workspace before waiting for the callback', async () => {
    let currentUrl =
      'https://auth.openai.com/sign-in-with-chatgpt/codex/consent'
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

    waitForCodexOAuthSurfaceCandidates.mockResolvedValue(['workspace'])
    continueCodexWorkspaceSelection.mockImplementation(async () => {
      currentUrl =
        'http://localhost:1455/auth/callback?code=oauth-code&state=oauth-state'
      resolveCallback({
        code: 'oauth-code',
        state: 'oauth-state',
        callbackUrl: currentUrl,
        rawQuery: '/auth/callback?code=oauth-code&state=oauth-state',
      })

      return {
        availableWorkspaces: 3,
        selectedWorkspaceIndex: 2,
      }
    })

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
    const result = await runCodexOAuthFlow(page, {
      workspaceIndex: '2',
    })

    expect(continueCodexWorkspaceSelection).toHaveBeenCalledWith(page, 2)
    expect(
      result.machine.history.some(
        (entry) =>
          entry.event === 'codex.oauth.surface.ready' &&
          entry.to === 'workspace-step',
      ),
    ).toBe(true)
    expect(
      result.machine.history.some(
        (entry) =>
          entry.event === 'context.updated' &&
          entry.to === 'waiting-for-callback',
      ),
    ).toBe(true)
  })

  it('defaults to the first workspace when no workspace index is provided', async () => {
    let currentUrl =
      'https://auth.openai.com/sign-in-with-chatgpt/codex/consent'
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

    waitForCodexOAuthSurfaceCandidates.mockResolvedValue(['workspace'])
    continueCodexWorkspaceSelection.mockImplementation(async () => {
      currentUrl =
        'http://localhost:1455/auth/callback?code=oauth-code&state=oauth-state'
      resolveCallback({
        code: 'oauth-code',
        state: 'oauth-state',
        callbackUrl: currentUrl,
        rawQuery: '/auth/callback?code=oauth-code&state=oauth-state',
      })

      return {
        availableWorkspaces: 2,
        selectedWorkspaceIndex: 1,
      }
    })

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
    await runCodexOAuthFlow(page, {})

    expect(continueCodexWorkspaceSelection).toHaveBeenCalledWith(page, 1)
  })

  it('waits for the localhost callback once navigation starts instead of re-entering login branches', async () => {
    let currentUrl =
      'https://auth.openai.com/sign-in-with-chatgpt/codex/consent'
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

    let surfaceChecks = 0
    waitForCodexOAuthSurfaceCandidates.mockImplementation(async () => {
      surfaceChecks += 1
      if (surfaceChecks === 1) {
        return ['workspace']
      }

      await new Promise((resolve) => setTimeout(resolve, 25))
      return ['email']
    })

    continueCodexWorkspaceSelection.mockImplementation(async () => {
      currentUrl =
        'http://localhost:1455/auth/callback?code=oauth-code&state=oauth-state'
      setTimeout(() => {
        resolveCallback({
          code: 'oauth-code',
          state: 'oauth-state',
          callbackUrl: currentUrl,
          rawQuery: '/auth/callback?code=oauth-code&state=oauth-state',
        })
      }, 10)

      return {
        availableWorkspaces: 2,
        selectedWorkspaceIndex: 1,
      }
    })

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
      waitForURL: vi.fn(async (predicate: (url: URL) => boolean) => {
        if (!predicate(new URL(currentUrl))) {
          throw new Error('callback not reached')
        }
      }),
      title: vi.fn(async () => 'Authorization received'),
    } as never

    const { runCodexOAuthFlow } = await import('../src/flows/codex-oauth')
    const result = await runCodexOAuthFlow(page, {})

    expect(result).toMatchObject({
      pageName: 'codex-oauth',
      redirectUri: 'http://localhost:1455/auth/callback',
      tokenStorePath: 'codey-app://managed-sessions/managed-session-1',
    })
    expect(submitLoginEmail).not.toHaveBeenCalled()
    expect(page.waitForURL).toHaveBeenCalled()
  })

  it('continues the consent page automatically after workspace selection', async () => {
    let currentUrl =
      'https://auth.openai.com/sign-in-with-chatgpt/codex/consent'
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

    waitForCodexOAuthSurfaceCandidates.mockImplementation(async () => {
      if (currentUrl.includes('/api/accounts/consent')) {
        return ['consent']
      }
      return ['workspace']
    })

    continueCodexWorkspaceSelection.mockImplementation(async () => {
      currentUrl =
        'https://auth.openai.com/api/accounts/consent?consent_challenge=challenge-123'
      return {
        availableWorkspaces: 2,
        selectedWorkspaceIndex: 1,
      }
    })

    continueCodexOAuthConsent.mockImplementation(async () => {
      currentUrl =
        'http://localhost:1455/auth/callback?code=oauth-code&state=oauth-state'
      resolveCallback({
        code: 'oauth-code',
        state: 'oauth-state',
        callbackUrl: currentUrl,
        rawQuery: '/auth/callback?code=oauth-code&state=oauth-state',
      })
    })

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

    expect(continueCodexWorkspaceSelection).toHaveBeenCalledWith(page, 1)
    expect(continueCodexOAuthConsent).toHaveBeenCalledWith(page)
    expect(
      result.machine.history.some(
        (entry) =>
          entry.event === 'codex.oauth.surface.ready' &&
          entry.to === 'consent-step',
      ),
    ).toBe(true)
  })

  it('continues the organization page automatically after workspace selection', async () => {
    let currentUrl =
      'https://auth.openai.com/sign-in-with-chatgpt/codex/consent'
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

    waitForCodexOAuthSurfaceCandidates.mockImplementation(async () => {
      if (currentUrl.includes('/sign-in-with-chatgpt/codex/organization')) {
        return ['organization']
      }
      return ['workspace']
    })

    continueCodexWorkspaceSelection.mockImplementation(async () => {
      currentUrl =
        'https://auth.openai.com/sign-in-with-chatgpt/codex/organization'
      return {
        availableWorkspaces: 2,
        selectedWorkspaceIndex: 1,
      }
    })

    continueCodexOrganizationSelection.mockImplementation(async () => {
      currentUrl =
        'http://localhost:1455/auth/callback?code=oauth-code&state=oauth-state'
      resolveCallback({
        code: 'oauth-code',
        state: 'oauth-state',
        callbackUrl: currentUrl,
        rawQuery: '/auth/callback?code=oauth-code&state=oauth-state',
      })
      return {
        availableOrganizations: 1,
        selectedOrganizationIndex: 1,
        availableProjects: 1,
        selectedProjectIndex: 1,
      }
    })

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

    expect(continueCodexWorkspaceSelection).toHaveBeenCalledWith(page, 1)
    expect(continueCodexOrganizationSelection).toHaveBeenCalledWith(page, 1, 1)
    expect(
      result.machine.history.some(
        (entry) =>
          entry.event === 'codex.oauth.surface.ready' &&
          entry.to === 'organization-step',
      ),
    ).toBe(true)
  })

  it('prefers the oauth callback over an organization-branch error once localhost is reached', async () => {
    let currentUrl =
      'https://auth.openai.com/sign-in-with-chatgpt/codex/consent'
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

    waitForCodexOAuthSurfaceCandidates.mockImplementation(async () => {
      if (currentUrl.includes('/sign-in-with-chatgpt/codex/organization')) {
        return ['organization']
      }
      return ['workspace']
    })

    continueCodexWorkspaceSelection.mockImplementation(async () => {
      currentUrl =
        'https://auth.openai.com/sign-in-with-chatgpt/codex/organization'
      return {
        availableWorkspaces: 2,
        selectedWorkspaceIndex: 1,
      }
    })

    continueCodexOrganizationSelection.mockImplementation(async () => {
      currentUrl =
        'http://localhost:1455/auth/callback?code=oauth-code&state=oauth-state'
      resolveCallback({
        code: 'oauth-code',
        state: 'oauth-state',
        callbackUrl: currentUrl,
        rawQuery: '/auth/callback?code=oauth-code&state=oauth-state',
      })
      throw new Error(
        'Codex organization picker did not expose a project_id input, and the submit button did not become enabled for the default project.',
      )
    })

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

    expect(continueCodexOrganizationSelection).toHaveBeenCalledWith(page, 1, 1)
    expect(exchangeCodexAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'oauth-code',
        redirectUri: 'http://localhost:1455/auth/callback',
      }),
    )
    expect(result.url).toContain('http://localhost:1455/auth/callback')
  })

  it('shares the Codex OAuth session with Codey app', async () => {
    let currentUrl =
      'http://localhost:1455/auth/callback?code=oauth-code&state=oauth-state'

    createAuthorizationCallbackCapture.mockResolvedValue({
      result: Promise.resolve({
        code: 'oauth-code',
        state: 'oauth-state',
        callbackUrl: currentUrl,
        rawQuery: '/auth/callback?code=oauth-code&state=oauth-state',
      }),
      abort: vi.fn().mockResolvedValue(undefined),
    })
    waitForCodexOAuthSurfaceCandidates.mockResolvedValue(['authenticated'])

    getRuntimeConfig.mockReturnValue({
      artifactsDir: 'C:/tmp/artifacts',
      browser: {
        recordHar: false,
      },
      app: {
        baseUrl: 'http://localhost:3000',
        clientId: 'codey-client-id',
        clientSecret: 'codey-client-secret',
      },
      codex: {
        authorizeUrl: 'https://auth.openai.com/oauth/authorize',
        tokenUrl: 'https://auth.openai.com/oauth/token',
        clientId: 'codex-client-id',
        scope: 'openid profile email offline_access',
        redirectHost: 'localhost',
        redirectPort: 1455,
        redirectPath: '/auth/callback',
      },
    })

    exchangeCodexAuthorizationCode.mockResolvedValue({
      accessToken: 'codex-access-token',
      refreshToken: 'codex-refresh-token',
      expiresIn: 3600,
      scope: 'openid profile email offline_access',
      tokenType: 'Bearer',
      createdAt: '2026-04-17T00:00:00.000Z',
    })

    shareCodexOAuthSessionWithCodeyApp.mockResolvedValue({
      identityId: 'identity-123',
      identityRecordId: 'managed-identity-1',
      sessionRecordId: 'managed-session-1',
      sessionStorePath: 'codey-app://managed-sessions/managed-session-1',
    })
    syncCodexOAuthSessionToSub2Api.mockResolvedValue({
      accountId: 42,
      action: 'created',
      email: 'person@example.com',
    })

    const page = {
      goto: vi.fn(async (url: string) => {
        currentUrl = url
      }),
      url: vi.fn(() => currentUrl),
      title: vi.fn(async () => 'Authorization received'),
    } as never

    const { runCodexOAuthFlow } = await import('../src/flows/codex-oauth')
    const result = await runCodexOAuthFlow(page, {
      identityId: 'identity-123',
      email: 'person@example.com',
    })

    expect(shareCodexOAuthSessionWithCodeyApp).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({
          id: 'identity-123',
          email: 'person@example.com',
        }),
      }),
    )
    expect(syncCodexOAuthSessionToSub2Api).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({
          id: 'identity-123',
          email: 'person@example.com',
        }),
      }),
    )
    expect(result).toMatchObject({
      pageName: 'codex-oauth',
      email: 'person@example.com',
      codeyApp: {
        identityId: 'identity-123',
        identityRecordId: 'managed-identity-1',
        sessionRecordId: 'managed-session-1',
      },
      sub2api: {
        accountId: 42,
        action: 'created',
        email: 'person@example.com',
      },
    })
  })
})
