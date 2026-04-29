import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig, setRuntimeConfig } from '../src/config'
import {
  DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME,
  DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_ADDRESS,
  resolveChatGPTTeamTrialBillingAddress,
} from '../src/flows/chatgpt-team-trial'
import {
  buildChatGPTTrialPricingPromoUrl,
  extractPaypalBillingAgreementLink,
  getChatGPTTrialPricingFreeTrialSelectors,
  selectChatGPTCheckoutPaypalPaymentMethodIfPresent,
  selectEligibleChatGPTTrialPromoCoupon,
} from '../src/modules/chatgpt/shared'
import { waitForChatGPTCheckoutReady } from '../src/modules/chatgpt/queries'

const baseConfig = resolveConfig()

afterEach(() => {
  setRuntimeConfig(baseConfig)
  vi.unstubAllGlobals()
})

class FakeCheckoutLocator {
  clicks = 0

  constructor(
    private readonly visible: boolean | (() => boolean) = false,
    private readonly onClick?: () => void,
  ) {}

  first(): FakeCheckoutLocator {
    return this
  }

  async count(): Promise<number> {
    return this.isCurrentlyVisible() ? 1 : 0
  }

  async isVisible(): Promise<boolean> {
    return this.isCurrentlyVisible()
  }

  async scrollIntoViewIfNeeded(): Promise<void> {}

  async click(): Promise<void> {
    if (!this.isCurrentlyVisible()) {
      throw new Error('Locator is not visible')
    }
    this.clicks += 1
    this.onClick?.()
  }

  private isCurrentlyVisible(): boolean {
    return typeof this.visible === 'function' ? this.visible() : this.visible
  }
}

interface FakeCheckoutFrameOptions {
  paypalSelectorLocator?: FakeCheckoutLocator
  hasPaymentSelectionState?: () => boolean
  paypalSelected?: () => boolean
}

interface FakeCheckoutPageOptions {
  url?: string
  paymentMethodFrameVisible?: boolean
  billingAddressFrameVisible?: boolean
}

class FakeCheckoutFrame {
  private readonly hiddenLocator = new FakeCheckoutLocator(false)

  constructor(
    private readonly paypalTabLocator: FakeCheckoutLocator,
    private readonly frameUrl = 'https://js.stripe.com/v3/elements-inner-payment-test.html',
    private readonly options: FakeCheckoutFrameOptions = {},
  ) {}

  url(): string {
    return this.frameUrl
  }

  getByRole(role: string): FakeCheckoutLocator {
    return role === 'tab' ? this.paypalTabLocator : this.hiddenLocator
  }

  getByText(): FakeCheckoutLocator {
    return this.hiddenLocator
  }

  locator(selector = ''): FakeCheckoutLocator {
    const normalizedSelector = selector.toLowerCase()
    if (
      normalizedSelector.includes('[aria-selected="true"]') ||
      normalizedSelector.includes('[aria-checked="true"]') ||
      normalizedSelector.includes(':checked')
    ) {
      return new FakeCheckoutLocator(() =>
        Boolean(this.options.paypalSelected?.()),
      )
    }
    if (
      normalizedSelector.includes('[aria-selected]') ||
      normalizedSelector.includes('[aria-checked]')
    ) {
      return new FakeCheckoutLocator(() =>
        Boolean(this.options.hasPaymentSelectionState?.()),
      )
    }
    if (
      normalizedSelector.includes('value="paypal"') ||
      normalizedSelector.includes('data-testid="paypal"') ||
      normalizedSelector.includes('aria-controls="paypal-panel"') ||
      normalizedSelector.includes('#paypal-tab')
    ) {
      return this.options.paypalSelectorLocator ?? this.hiddenLocator
    }

    return this.hiddenLocator
  }
}

class FakeCheckoutPage {
  private readonly hiddenLocator = new FakeCheckoutLocator(false)

  constructor(
    private readonly checkoutFrames: FakeCheckoutFrame[],
    private readonly options: FakeCheckoutPageOptions = {},
  ) {}

  url(): string {
    return this.options.url ?? 'https://chatgpt.com/checkout/team/cs_test_123'
  }

  frames(): FakeCheckoutFrame[] {
    return this.checkoutFrames
  }

  getByRole(): FakeCheckoutLocator {
    return this.hiddenLocator
  }

  getByText(): FakeCheckoutLocator {
    return this.hiddenLocator
  }

  locator(selector = ''): FakeCheckoutLocator {
    const normalizedSelector = selector.toLowerCase()
    if (normalizedSelector.includes('elements-inner-payment')) {
      return new FakeCheckoutLocator(
        Boolean(this.options.paymentMethodFrameVisible),
      )
    }
    if (normalizedSelector.includes('elements-inner-address')) {
      return new FakeCheckoutLocator(
        Boolean(this.options.billingAddressFrameVisible),
      )
    }

    return this.hiddenLocator
  }
}

describe('chatgpt team trial checkout defaults', () => {
  it('uses the configured Netherlands billing address by default', () => {
    setRuntimeConfig({
      ...baseConfig,
      chatgptTeamTrial: undefined,
    })

    const address = resolveChatGPTTeamTrialBillingAddress()

    expect(address).toMatchObject(DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_ADDRESS)
    expect(address.name).toBe(DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME)
    expect(address.country).toBe('NL')
    expect(address.line1).toBe('Bertha von Suttnerlaan 97')
    expect(address.line2).toBe('762 Effertz Stream')
    expect(address.postalCode).toBe('1187 ST')
    expect(address.city).toBe('Amstelveen')
  })

  it('lets CLI billing options override runtime config values', () => {
    setRuntimeConfig({
      ...baseConfig,
      chatgptTeamTrial: {
        billingAddress: {
          name: 'Runtime Name',
          country: 'IE',
          line1: 'Runtime line 1',
          line2: 'Runtime line 2',
          city: 'Runtime city',
          postalCode: 'RUNTIME',
        },
      },
    })

    const address = resolveChatGPTTeamTrialBillingAddress({
      billingName: 'CLI Name',
      billingAddressLine1: 'CLI line 1',
      billingCity: 'CLI city',
      billingPostalCode: 'CLI POST',
    })

    expect(address).toMatchObject({
      name: 'CLI Name',
      country: 'IE',
      line1: 'CLI line 1',
      line2: 'Runtime line 2',
      city: 'CLI city',
      postalCode: 'CLI POST',
    })
  })
})

describe('trial coupon pricing helpers', () => {
  it('builds pricing URLs for both trial coupons', () => {
    expect(buildChatGPTTrialPricingPromoUrl('team-1-month-free')).toBe(
      'https://chatgpt.com/?promo_campaign=team-1-month-free#pricing',
    )
    expect(buildChatGPTTrialPricingPromoUrl('plus-1-month-free')).toBe(
      'https://chatgpt.com/?promo_campaign=plus-1-month-free#pricing',
    )
  })

  it('uses separate pricing selectors for Team and Plus trial coupons', () => {
    expect(
      getChatGPTTrialPricingFreeTrialSelectors('team-1-month-free'),
    ).toContain('button[data-testid="select-plan-button-teams-create"]')
    expect(
      getChatGPTTrialPricingFreeTrialSelectors('plus-1-month-free'),
    ).toContain('button[data-testid="select-plan-button-plus"]')
  })

  it('checks Team before Plus and selects the first eligible coupon', async () => {
    const requested: Array<{
      url: string
      headers?: Record<string, string>
    }> = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      requested.push({
        url: String(url),
        headers: init?.headers as Record<string, string> | undefined,
      })
      const coupon = new URL(String(url)).searchParams.get('coupon')
      return {
        ok: true,
        status: 200,
        url: String(url),
        text: async () =>
          JSON.stringify({
            coupon,
            state: coupon === 'plus-1-month-free' ? 'eligible' : 'ineligible',
          }),
      }
    })
    const page = {
      async evaluate<T>(
        callback: (input: {
          url: string
          headers: Record<string, string>
        }) => Promise<T>,
        input: { url: string; headers: Record<string, string> },
      ): Promise<T> {
        return callback(input)
      },
    }

    const selection = await selectEligibleChatGPTTrialPromoCoupon(
      page as never,
      {
        requestHeaders: {
          authorization: 'Bearer access-token',
          'oai-device-id': 'device-123',
          'oai-session-id': 'session-123',
          'x-oai-is': 'ois1.payload',
        },
      },
    )

    expect(selection.selected).toMatchObject({
      coupon: 'plus-1-month-free',
      eligible: true,
      state: 'eligible',
    })
    expect(
      requested.map(({ url }) => new URL(url).searchParams.get('coupon')),
    ).toEqual(['team-1-month-free', 'plus-1-month-free'])
    expect(requested[1]?.headers).toMatchObject({
      Authorization: 'Bearer access-token',
      'OAI-Device-Id': 'device-123',
      'OAI-Session-Id': 'session-123',
      'X-OAI-Is': 'ois1.payload',
      'X-OpenAI-Target-Path': '/backend-api/promo_campaign/check_coupon',
      'X-OpenAI-Target-Route': '/backend-api/promo_campaign/check_coupon',
    })
  })
})

describe('checkout readiness', () => {
  it('treats the payment method frame as ready before the billing address frame appears', async () => {
    const page = new FakeCheckoutPage([], {
      paymentMethodFrameVisible: true,
      billingAddressFrameVisible: false,
    })

    await expect(waitForChatGPTCheckoutReady(page as never, 100)).resolves.toBe(
      true,
    )
  })
})

describe('paypal payment method selection', () => {
  it('switches Stripe checkout payment tabs to PayPal inside frames', async () => {
    const paypalTabLocator = new FakeCheckoutLocator(true)
    const page = new FakeCheckoutPage([new FakeCheckoutFrame(paypalTabLocator)])

    await expect(
      selectChatGPTCheckoutPaypalPaymentMethodIfPresent(page as never),
    ).resolves.toBe(true)

    expect(paypalTabLocator.clicks).toBe(1)
  })

  it('waits for PayPal tabs to render in Stripe payment frames', async () => {
    let visibilityChecks = 0
    const paypalTabLocator = new FakeCheckoutLocator(() => {
      visibilityChecks += 1
      return visibilityChecks > 1
    })
    const page = new FakeCheckoutPage([new FakeCheckoutFrame(paypalTabLocator)])

    await expect(
      selectChatGPTCheckoutPaypalPaymentMethodIfPresent(page as never, {
        timeoutMs: 1000,
      }),
    ).resolves.toBe(true)

    expect(paypalTabLocator.clicks).toBe(1)
  })

  it('switches card and PayPal Stripe tablists to the PayPal tab', async () => {
    let paypalSelected = false
    const paypalSelectorLocator = new FakeCheckoutLocator(true, () => {
      paypalSelected = true
    })
    const page = new FakeCheckoutPage([
      new FakeCheckoutFrame(
        new FakeCheckoutLocator(false),
        'https://js.stripe.com/v3/elements-inner-payment-test.html',
        {
          paypalSelectorLocator,
          hasPaymentSelectionState: () => true,
          paypalSelected: () => paypalSelected,
        },
      ),
    ])

    await expect(
      selectChatGPTCheckoutPaypalPaymentMethodIfPresent(page as never, {
        timeoutMs: 1000,
      }),
    ).resolves.toBe(true)

    expect(paypalSelectorLocator.clicks).toBe(1)
    expect(paypalSelected).toBe(true)
  })
})

describe('paypal billing agreement link extraction', () => {
  it('captures PayPal approval URLs that contain a ba_token', () => {
    const url =
      'https://www.paypal.com/agreements/approve?ba_token=BA-123456789&country.x=NL'

    expect(extractPaypalBillingAgreementLink(url)).toMatchObject({
      url,
      baToken: 'BA-123456789',
      tokenParam: 'ba_token',
    })
  })

  it('captures PayPal pay URLs that contain a BA token parameter', () => {
    const url =
      'https://www.paypal.com/pay?ssrt=1777211592082&token=BA-5YL10191GX878080G&ul=1'

    expect(extractPaypalBillingAgreementLink(url)).toMatchObject({
      url,
      baToken: 'BA-5YL10191GX878080G',
      tokenParam: 'token',
    })
  })

  it('ignores non-PayPal hosts and PayPal URLs without BA tokens', () => {
    expect(
      extractPaypalBillingAgreementLink(
        'https://paypal.example.com/agreements/approve?ba_token=BA-123',
      ),
    ).toBeUndefined()
    expect(
      extractPaypalBillingAgreementLink('https://www.paypal.com/checkoutnow'),
    ).toBeUndefined()
    expect(
      extractPaypalBillingAgreementLink(
        'https://www.paypal.com/pay?token=EC-123456789',
      ),
    ).toBeUndefined()
  })
})
