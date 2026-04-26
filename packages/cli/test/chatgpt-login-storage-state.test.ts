import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRuntimeConfig = vi.fn()
const resolveStoredChatGPTIdentity = vi.fn()
const persistChatGPTSessions = vi.fn()
const createVerificationProvider = vi.fn()
const createChatGPTSessionCapture = vi.fn()
const saveLocalChatGPTStorageState = vi.fn()
const clickLoginEntryIfPresent = vi.fn()
const completePasswordOrVerificationLoginFallback = vi.fn()
const continueOpenAIWorkspaceSelection = vi.fn()
const gotoLoginEntry = vi.fn()
const logStep = vi.fn()
const submitLoginEmail = vi.fn()
const waitForAuthenticatedSession = vi.fn()
const waitForLoginSurface = vi.fn()
const waitForPasswordInputReady = vi.fn()
const waitForPostLoginCompletionCandidates = vi.fn()
const waitForPostEmailLoginCandidates = vi.fn()
const createChatGPTBackendMeSessionProbe = vi.fn()
const waitForBackendMeSession = vi.fn()
const disposeBackendMeSessionProbe = vi.fn()
const waitForVerificationCodeInputReady = vi.fn()
const syncManagedIdentityToCodeyApp = vi.fn()

vi.mock('../src/config', () => ({
  getRuntimeConfig,
}))

vi.mock('../src/modules/credentials', () => ({
  resolveStoredChatGPTIdentity,
}))

vi.mock('../src/modules/credentials/sessions', () => ({
  persistChatGPTSessions,
}))

vi.mock('../src/modules/verification', () => ({
  createVerificationProvider,
}))

vi.mock('../src/modules/chatgpt/session', () => ({
  createChatGPTSessionCapture,
}))

vi.mock('../src/modules/chatgpt/storage-state', () => ({
  saveLocalChatGPTStorageState,
}))

vi.mock('../src/modules/chatgpt/shared', () => ({
  CHATGPT_ENTRY_LOGIN_URL: 'https://chatgpt.com/auth/login',
  CHATGPT_HOME_URL: 'https://chatgpt.com/',
  clickLoginEntryIfPresent,
  completePasswordOrVerificationLoginFallback,
  continueOpenAIWorkspaceSelection,
  createChatGPTBackendMeSessionProbe,
  gotoLoginEntry,
  logStep,
  submitLoginEmail,
  waitForAuthenticatedSession,
  waitForLoginSurface,
  waitForPasswordInputReady,
  waitForPostLoginCompletionCandidates,
  waitForPostEmailLoginCandidates,
  waitForVerificationCodeInputReady,
}))

vi.mock('../src/modules/app-auth/managed-identities', () => ({
  syncManagedIdentityToCodeyApp,
}))

function createStoredIdentity() {
  const summary = {
    id: 'identity-123',
    email: 'person@example.com',
    createdAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    credentialCount: 1,
    storePath: 'codey-app://managed-identities/identity-123',
    encrypted: false,
  }

  return {
    identity: {
      id: summary.id,
      provider: 'chatgpt',
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      email: summary.email,
      password: 'super-secret-password',
      metadata: {
        source: 'chatgpt-register',
      },
    },
    summary,
  }
}

function createPage() {
  return {
    goto: vi.fn(async () => undefined),
    locator: vi.fn(() => ({
      waitFor: vi.fn(async () => undefined),
    })),
    waitForLoadState: vi.fn(async () => undefined),
    url: vi.fn(() => 'https://chatgpt.com/'),
    title: vi.fn(async () => 'ChatGPT'),
  }
}

describe('loginChatGPT local storage-state restore', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    getRuntimeConfig.mockReturnValue({})
    resolveStoredChatGPTIdentity.mockResolvedValue(createStoredIdentity())
    createChatGPTSessionCapture.mockReturnValue({
      capture: vi.fn(async () => []),
      dispose: vi.fn(),
    })
    persistChatGPTSessions.mockResolvedValue({
      sessions: [],
      primarySummary: undefined,
    })
    createVerificationProvider.mockReturnValue({})
    saveLocalChatGPTStorageState.mockResolvedValue({
      identityId: 'identity-123',
      email: 'person@example.com',
      storageStatePath: 'C:/tmp/state.json',
      flowType: 'chatgpt-login',
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    })
    clickLoginEntryIfPresent.mockResolvedValue(false)
    completePasswordOrVerificationLoginFallback.mockResolvedValue({
      method: 'password',
    })
    gotoLoginEntry.mockResolvedValue(undefined)
    submitLoginEmail.mockResolvedValue(undefined)
    waitForLoginSurface.mockResolvedValue('email')
    waitForPasswordInputReady.mockResolvedValue(true)
    waitForPostLoginCompletionCandidates.mockResolvedValue(['authenticated'])
    waitForPostEmailLoginCandidates.mockResolvedValue(['password'])
    waitForBackendMeSession.mockResolvedValue(false)
    disposeBackendMeSessionProbe.mockReturnValue(undefined)
    createChatGPTBackendMeSessionProbe.mockReturnValue({
      wait: waitForBackendMeSession,
      dispose: disposeBackendMeSessionProbe,
    })
    waitForVerificationCodeInputReady.mockResolvedValue(false)
    syncManagedIdentityToCodeyApp.mockResolvedValue(undefined)
  })

  it('skips the restored-session check when storage-state restore is disabled', async () => {
    waitForAuthenticatedSession
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const progressReporter = vi.fn()
    const page = createPage()
    const { loginChatGPT } = await import('../src/flows/chatgpt-login')

    const result = await loginChatGPT(page as never, {
      email: 'person@example.com',
      progressReporter,
    })

    expect(page.goto).not.toHaveBeenCalledWith('https://chatgpt.com/', {
      waitUntil: 'domcontentloaded',
    })
    expect(gotoLoginEntry).toHaveBeenCalledTimes(1)
    expect(result.method).toBe('password')
    expect(progressReporter).not.toHaveBeenCalledWith({
      message:
        'No matching local ChatGPT storage state for person@example.com; continuing with normal login',
    })
    expect(progressReporter).not.toHaveBeenCalledWith({
      message:
        'Local ChatGPT storage state did not restore login for person@example.com; continuing with normal login',
    })
  })

  it('reports a normal-login fallback when storage-state restore is requested but no state was loaded', async () => {
    waitForAuthenticatedSession
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const progressReporter = vi.fn()
    const page = createPage()
    const { loginChatGPT } = await import('../src/flows/chatgpt-login')

    const result = await loginChatGPT(page as never, {
      email: 'person@example.com',
      restoreStorageState: true,
      progressReporter,
    })

    expect(page.goto).not.toHaveBeenCalledWith('https://chatgpt.com/', {
      waitUntil: 'domcontentloaded',
    })
    expect(gotoLoginEntry).toHaveBeenCalledTimes(1)
    expect(result.method).toBe('password')
    expect(progressReporter).toHaveBeenCalledWith({
      message:
        'No matching local ChatGPT storage state for person@example.com; continuing with normal login',
    })
  })

  it('falls back to normal login when the loaded local storage state does not restore a profile', async () => {
    waitForBackendMeSession.mockResolvedValueOnce(false)
    waitForAuthenticatedSession
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const progressReporter = vi.fn()
    const page = createPage()
    const { loginChatGPT } = await import('../src/flows/chatgpt-login')

    const result = await loginChatGPT(page as never, {
      email: 'person@example.com',
      restoreStorageState: true,
      chatgptStorageStatePath: 'C:/tmp/state.json',
      progressReporter,
    })

    expect(page.goto).toHaveBeenCalledWith('https://chatgpt.com/', {
      waitUntil: 'domcontentloaded',
    })
    expect(createChatGPTBackendMeSessionProbe).toHaveBeenCalledWith(page, {
      expectedEmail: 'person@example.com',
    })
    expect(gotoLoginEntry).toHaveBeenCalledTimes(1)
    expect(result.method).toBe('password')
    expect(progressReporter).toHaveBeenCalledWith({
      message:
        'Local ChatGPT storage state did not restore login for person@example.com; continuing with normal login',
    })
  })

  it('keeps the restored-session path only when the loaded local storage state restores a profile', async () => {
    waitForBackendMeSession.mockResolvedValueOnce(true)

    const page = createPage()
    const { loginChatGPT } = await import('../src/flows/chatgpt-login')

    const result = await loginChatGPT(page as never, {
      email: 'person@example.com',
      restoreStorageState: true,
      chatgptStorageStatePath: 'C:/tmp/state.json',
    })

    expect(page.goto).toHaveBeenCalledWith('https://chatgpt.com/', {
      waitUntil: 'domcontentloaded',
    })
    expect(gotoLoginEntry).not.toHaveBeenCalled()
    expect(result.method).toBe('restored')
  })

  it('auto-selects the first OpenAI workspace when requested after login', async () => {
    waitForAuthenticatedSession
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    waitForPostLoginCompletionCandidates.mockResolvedValueOnce(['workspace'])
    continueOpenAIWorkspaceSelection.mockResolvedValueOnce({
      availableWorkspaces: 2,
      selectedWorkspaceIndex: 1,
      selectedWorkspaceId: 'workspace-selected',
      selectionStrategy: 'index',
    })

    const page = createPage()
    const { loginChatGPT } = await import('../src/flows/chatgpt-login')

    const result = await loginChatGPT(page as never, {
      email: 'person@example.com',
      autoSelectFirstWorkspace: true,
    })

    expect(continueOpenAIWorkspaceSelection).toHaveBeenCalledWith(page, 1)
    expect(result.selectedWorkspaceId).toBe('workspace-selected')
  })
})
