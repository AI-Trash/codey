import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveStoredChatGPTIdentity = vi.fn()
const resolveLocalChatGPTStorageState = vi.fn()

vi.mock('../src/modules/credentials', () => ({
  resolveStoredChatGPTIdentity,
}))

vi.mock('../src/modules/chatgpt/storage-state', () => ({
  resolveLocalChatGPTStorageState,
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

describe('prepareFlowStorageState', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resolveStoredChatGPTIdentity.mockResolvedValue(createStoredIdentity())
    resolveLocalChatGPTStorageState.mockReturnValue({
      identityId: 'identity-123',
      email: 'person@example.com',
      storageStatePath: 'C:/tmp/state.json',
      flowType: 'chatgpt-login',
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    })
  })

  it('does not load local ChatGPT storage state unless restoreStorageState is enabled', async () => {
    const { prepareFlowStorageState } =
      await import('../src/modules/flow-cli/storage-state')

    const prepared = await prepareFlowStorageState({
      flowId: 'chatgpt-login',
      options: {
        email: 'person@example.com',
      },
    })

    expect(resolveStoredChatGPTIdentity).toHaveBeenCalledWith({
      id: undefined,
      email: 'person@example.com',
    })
    expect(resolveLocalChatGPTStorageState).not.toHaveBeenCalled()
    expect(prepared.storageState).toBeUndefined()
    expect(prepared.options).toMatchObject({
      identityId: 'identity-123',
      email: 'person@example.com',
      restoreStorageState: false,
    })
    expect(prepared.options.chatgptStorageStatePath).toBeUndefined()
  })

  it('loads matching local ChatGPT storage state when restoreStorageState is enabled', async () => {
    const { prepareFlowStorageState } =
      await import('../src/modules/flow-cli/storage-state')

    const prepared = await prepareFlowStorageState({
      flowId: 'chatgpt-login',
      options: {
        email: 'person@example.com',
        restoreStorageState: true,
      },
    })

    expect(resolveLocalChatGPTStorageState).toHaveBeenCalledWith({
      identityId: 'identity-123',
      email: 'person@example.com',
    })
    expect(prepared.storageState).toMatchObject({
      storageStatePath: 'C:/tmp/state.json',
    })
    expect(prepared.options).toMatchObject({
      identityId: 'identity-123',
      email: 'person@example.com',
      restoreStorageState: true,
      chatgptStorageStatePath: 'C:/tmp/state.json',
    })
  })
})
