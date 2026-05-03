import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  callOrder,
  createChatGPTTrialCheckoutLink,
  selectEligibleChatGPTTrialPromoCoupon,
  waitForAuthenticatedSession,
} = vi.hoisted(() => ({
  callOrder: [] as string[],
  createChatGPTTrialCheckoutLink: vi.fn(),
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
    createChatGPTTrialCheckoutLink.mockImplementation(async () => {
      callOrder.push('createCheckout')
      throw new Error('stop after checkout link')
    })
  })

  it('creates a GoPay checkout link using the flow runtime proxy', async () => {
    const { completeChatGPTTrialAfterAuthenticatedSession } =
      await import('../src/flows/chatgpt-team-trial')

    await expect(
      completeChatGPTTrialAfterAuthenticatedSession(createPage() as never, {
        email: 'person@example.com',
        paymentMethod: 'gopay',
      }),
    ).rejects.toThrow('stop after checkout link')

    expect(callOrder).toEqual(['createCheckout'])
  })
})
