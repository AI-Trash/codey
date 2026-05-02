import { beforeEach, describe, expect, it, vi } from 'vitest'

const callOrder: string[] = []
const createVerificationProvider = vi.fn()
const gotoLoginEntry = vi.fn()
const selectCodeySingBoxProxyConfig = vi.fn()

vi.mock('../src/config', () => ({
  getRuntimeConfig: () => ({
    chatgptTeamTrial: {
      gopay: {
        unlinkBeforeLink: false,
      },
    },
  }),
}))

vi.mock('../src/modules/verification', () => ({
  createVerificationProvider,
}))

vi.mock('../src/modules/chatgpt/session', () => ({
  createChatGPTSessionCapture: () => ({
    capture: vi.fn(async () => []),
    dispose: vi.fn(),
  }),
}))

vi.mock('../src/modules/credentials', () => ({
  persistChatGPTIdentity: vi.fn(),
}))

vi.mock('../src/modules/credentials/sessions', () => ({
  persistChatGPTSessions: vi.fn(),
}))

vi.mock('../src/modules/chatgpt/storage-state', () => ({
  saveLocalChatGPTStorageState: vi.fn(),
}))

vi.mock('../src/modules/gopay/android-unlink', () => ({
  unlinkGoPayLinkedApps: vi.fn(),
}))

vi.mock('../src/modules/proxy/sing-box', () => ({
  selectCodeySingBoxProxyConfig,
}))

vi.mock('../src/modules/chatgpt/account-deactivation', () => ({
  reportChatGPTAccountDeactivationToCodeyApp: vi.fn(),
}))

vi.mock('../src/modules/chatgpt/shared', async () => {
  const actual = await vi.importActual('../src/modules/chatgpt/shared')
  return {
    ...actual,
    gotoLoginEntry,
  }
})

function createPage() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    url: vi.fn(() => 'https://chatgpt.com/auth/login'),
    title: vi.fn(async () => 'ChatGPT'),
  }
}

describe('registerChatGPT GoPay proxy selection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    callOrder.length = 0

    createVerificationProvider.mockReturnValue({
      kind: 'app',
      prepareEmailTarget: vi.fn(async () => ({
        email: 'person@example.com',
        prefix: 'person',
        mailbox: 'example.com',
      })),
      primeInbox: vi.fn(async () => {
        callOrder.push('primeInbox')
      }),
      waitForVerificationCode: vi.fn(async () => '123456'),
    })
    selectCodeySingBoxProxyConfig.mockImplementation(async (config) => {
      callOrder.push(`proxy:${config.label}`)
      return {
        selected: config.label === 'japan',
        selectedTag: config.label,
        changed: true,
      }
    })
    gotoLoginEntry.mockImplementation(async () => {
      callOrder.push('gotoLoginEntry')
      throw new Error('stop after entry navigation')
    })
  })

  it('selects the Japan proxy before opening the registration entry for GoPay trials', async () => {
    const { registerChatGPT } = await import('../src/flows/chatgpt-register')

    await expect(
      registerChatGPT(createPage() as never, {
        claimTrial: 'gopay',
      }),
    ).rejects.toThrow('stop after entry navigation')

    expect(selectCodeySingBoxProxyConfig).toHaveBeenCalledWith({
      label: 'japan',
      tags: ['japan', '日本', 'jp'],
    })
    expect(callOrder).toEqual(['proxy:japan', 'primeInbox', 'gotoLoginEntry'])
  })
})
