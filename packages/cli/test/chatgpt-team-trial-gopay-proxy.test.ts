import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  callOrder,
  createChatGPTTrialCheckoutLink,
  selectCodeySingBoxProxyConfig,
  selectEligibleChatGPTTrialPromoCoupon,
  waitForAuthenticatedSession,
} = vi.hoisted(() => ({
  callOrder: [] as string[],
  createChatGPTTrialCheckoutLink: vi.fn(),
  selectCodeySingBoxProxyConfig: vi.fn(),
  selectEligibleChatGPTTrialPromoCoupon: vi.fn(),
  waitForAuthenticatedSession: vi.fn(),
}))

vi.mock('../src/flows/chatgpt-login', () => ({
  loginChatGPT: vi.fn(),
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
  const actual = await vi.importActual<
    typeof import('../src/modules/chatgpt/shared')
  >('../src/modules/chatgpt/shared')

  return {
    ...actual,
    createChatGPTTrialCheckoutLink,
    selectEligibleChatGPTTrialPromoCoupon,
    waitForAuthenticatedSession,
  }
})

function createPage() {
  return {
    url: vi.fn(() => 'https://chatgpt.com/'),
    title: vi.fn(async () => 'ChatGPT'),
  }
}

describe('ChatGPT Team trial GoPay proxy timing', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    callOrder.length = 0

    waitForAuthenticatedSession.mockResolvedValue(true)
    selectEligibleChatGPTTrialPromoCoupon.mockResolvedValue({
      selected: {
        coupon: 'team-1-month-free',
        state: 'eligible',
      },
      checked: [
        {
          coupon: 'team-1-month-free',
          state: 'eligible',
          status: 200,
        },
      ],
    })
    selectCodeySingBoxProxyConfig.mockImplementation(async (config) => {
      callOrder.push(`proxy:${config.label}`)
      return {
        selected: true,
        selectedTag: config.label,
        changed: true,
      }
    })
    createChatGPTTrialCheckoutLink.mockImplementation(async () => {
      callOrder.push('createCheckout')
      throw new Error('stop after checkout link')
    })
  })

  it('selects the Singapore payment proxy before creating a GoPay checkout link', async () => {
    const { completeChatGPTTrialAfterAuthenticatedSession } =
      await import('../src/flows/chatgpt-team-trial')

    await expect(
      completeChatGPTTrialAfterAuthenticatedSession(createPage() as never, {
        email: 'person@example.com',
        paymentMethod: 'gopay',
      }),
    ).rejects.toThrow('stop after checkout link')

    expect(selectCodeySingBoxProxyConfig).toHaveBeenNthCalledWith(1, {
      label: 'japan',
      tags: ['japan', '日本', 'jp'],
    })
    expect(selectCodeySingBoxProxyConfig).toHaveBeenNthCalledWith(2, {
      label: 'singapore',
      tags: ['singapore', '新加坡', 'sg'],
    })
    expect(callOrder).toEqual([
      'proxy:japan',
      'proxy:singapore',
      'createCheckout',
    ])
  })
})
