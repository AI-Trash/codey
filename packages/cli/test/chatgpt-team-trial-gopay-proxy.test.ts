import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  callOrder,
  clickChatGPTCheckoutSubscribeAndCapturePaymentLink,
  createChatGPTTrialCheckoutLink,
  fillChatGPTCheckoutBillingAddress,
  gotoTrialPricingPromo,
  clickTrialPricingFreeTrial,
  readChatGPTCheckoutBillingCountry,
  selectChatGPTTrialPricingPlanIfPresent,
  selectChatGPTCheckoutPaymentMethodIfPresent,
  selectEligibleChatGPTTrialPromoCoupon,
  waitForTrialPricingFreeTrialReady,
  waitForChatGPTCheckoutReady,
  waitForAuthenticatedSession,
} = vi.hoisted(() => ({
  callOrder: [] as string[],
  clickChatGPTCheckoutSubscribeAndCapturePaymentLink: vi.fn(),
  createChatGPTTrialCheckoutLink: vi.fn(),
  fillChatGPTCheckoutBillingAddress: vi.fn(),
  gotoTrialPricingPromo: vi.fn(),
  clickTrialPricingFreeTrial: vi.fn(),
  readChatGPTCheckoutBillingCountry: vi.fn(),
  selectChatGPTTrialPricingPlanIfPresent: vi.fn(),
  selectChatGPTCheckoutPaymentMethodIfPresent: vi.fn(),
  selectEligibleChatGPTTrialPromoCoupon: vi.fn(),
  waitForTrialPricingFreeTrialReady: vi.fn(),
  waitForChatGPTCheckoutReady: vi.fn(),
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
    clickChatGPTCheckoutSubscribeAndCapturePaymentLink,
    clickTrialPricingFreeTrial,
    createChatGPTTrialCheckoutLink,
    fillChatGPTCheckoutBillingAddress,
    gotoTrialPricingPromo,
    readChatGPTCheckoutBillingCountry,
    selectChatGPTTrialPricingPlanIfPresent,
    selectChatGPTCheckoutPaymentMethodIfPresent,
    selectEligibleChatGPTTrialPromoCoupon,
    waitForTrialPricingFreeTrialReady,
    waitForChatGPTCheckoutReady,
    waitForAuthenticatedSession,
  }
})

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

describe('ChatGPT Team trial GoPay proxy timing', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    callOrder.length = 0

    waitForAuthenticatedSession.mockResolvedValue(true)
    waitForChatGPTCheckoutReady.mockResolvedValue(true)
    waitForTrialPricingFreeTrialReady.mockResolvedValue(true)
    gotoTrialPricingPromo.mockResolvedValue(undefined)
    selectChatGPTTrialPricingPlanIfPresent.mockResolvedValue(false)
    clickTrialPricingFreeTrial.mockResolvedValue(undefined)
    selectChatGPTCheckoutPaymentMethodIfPresent.mockResolvedValue(true)
    readChatGPTCheckoutBillingCountry.mockResolvedValue('ID')
    fillChatGPTCheckoutBillingAddress.mockResolvedValue(undefined)
    clickChatGPTCheckoutSubscribeAndCapturePaymentLink.mockResolvedValue({
      url: 'https://app.midtrans.com/snap/v4/redirection/gopay-1#/gopay-tokenization/linking',
      paymentMethod: 'gopay',
      redirectId: 'gopay-1',
      capturedAt: new Date(0).toISOString(),
    })
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
      sessionAccessToken: {
        available: true,
        ok: true,
        status: 200,
        url: 'https://chatgpt.com/api/auth/session',
      },
    })
    createChatGPTTrialCheckoutLink.mockImplementation(async () => ({
      url: 'https://chatgpt.com/checkout/openai_llc/cs_test_123',
      checkoutSessionId: 'cs_test_123',
      processorEntity: 'openai_llc',
      payload: {},
    }))
  })

  it('creates a GoPay checkout link using the flow runtime proxy', async () => {
    createChatGPTTrialCheckoutLink.mockImplementationOnce(async () => {
      callOrder.push('createCheckout')
      throw new Error('stop after checkout link')
    })

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

  it('falls back to pricing checkout when the session access token is unavailable', async () => {
    selectEligibleChatGPTTrialPromoCoupon.mockResolvedValueOnce({
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
      sessionAccessToken: {
        available: false,
        ok: true,
        status: 200,
        url: 'https://chatgpt.com/api/auth/session',
      },
    })

    const { completeChatGPTTrialAfterAuthenticatedSession } =
      await import('../src/flows/chatgpt-team-trial')

    await completeChatGPTTrialAfterAuthenticatedSession(createPage() as never, {
      email: 'person@example.com',
      paymentMethod: 'gopay',
    })

    expect(createChatGPTTrialCheckoutLink).not.toHaveBeenCalled()
    expect(gotoTrialPricingPromo).toHaveBeenCalledWith(
      expect.anything(),
      'team-1-month-free',
    )
    expect(clickTrialPricingFreeTrial).toHaveBeenCalledWith(
      expect.anything(),
      'team-1-month-free',
    )
  })

  it('falls back to pricing checkout when direct checkout loses the access token', async () => {
    createChatGPTTrialCheckoutLink.mockRejectedValueOnce(
      new Error(
        'ChatGPT trial checkout link could not be generated (HTTP 403): ChatGPT session access token was not available.',
      ),
    )

    const { completeChatGPTTrialAfterAuthenticatedSession } =
      await import('../src/flows/chatgpt-team-trial')

    await completeChatGPTTrialAfterAuthenticatedSession(createPage() as never, {
      email: 'person@example.com',
      paymentMethod: 'gopay',
    })

    expect(createChatGPTTrialCheckoutLink).toHaveBeenCalledTimes(1)
    expect(gotoTrialPricingPromo).toHaveBeenCalledWith(
      expect.anything(),
      'team-1-month-free',
    )
    expect(clickTrialPricingFreeTrial).toHaveBeenCalledWith(
      expect.anything(),
      'team-1-month-free',
    )
  })

  it('uses the preselected checkout country for GoPay billing address defaults', async () => {
    const { completeChatGPTTrialAfterAuthenticatedSession } =
      await import('../src/flows/chatgpt-team-trial')

    await completeChatGPTTrialAfterAuthenticatedSession(createPage() as never, {
      email: 'person@example.com',
      paymentMethod: 'gopay',
    })

    expect(readChatGPTCheckoutBillingCountry).toHaveBeenCalled()
    expect(fillChatGPTCheckoutBillingAddress).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        country: 'ID',
      }),
      {
        fillCountry: false,
      },
    )
  })
})
