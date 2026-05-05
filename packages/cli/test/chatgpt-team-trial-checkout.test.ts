import { afterEach, describe, expect, it, vi } from 'vitest'
import { faker } from '@faker-js/faker'
import { resolveConfig, setRuntimeConfig } from '../src/config'
import {
  DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME,
  resolveChatGPTTeamTrialBillingAddress,
  resolveChatGPTTeamTrialGoPayAccount,
  resolveChatGPTTeamTrialGoPayUnlinkOptions,
} from '../src/flows/chatgpt-team-trial'
import {
  buildChatGPTTrialCheckoutPayload,
  buildChatGPTTrialCheckoutUrl,
  buildChatGPTTrialPricingPromoUrl,
  clickChatGPTCheckoutSubscribeAndCapturePaymentLink,
  clickGoPayAuthorizationConsentIfPresent,
  createChatGPTTrialCheckoutLink,
  clickTrialPricingFreeTrial,
  extractGoPayPaymentRedirectLink,
  extractPaypalBillingAgreementLink,
  getChatGPTTrialPricingFreeTrialSelectors,
  getChatGPTTrialPricingPlanToggleSelectors,
  continueGoPayPaymentFromRedirect,
  readChatGPTCheckoutBillingCountry,
  selectChatGPTCheckoutPaymentMethodIfPresent,
  selectChatGPTCheckoutPaypalPaymentMethodIfPresent,
  selectChatGPTPricingRegion,
  selectEligibleChatGPTTrialPromoCoupon,
  submitGoPayAuthorizationOtpIfPresent,
  fillChatGPTCheckoutBillingAddress,
} from '../src/modules/chatgpt/shared'
import {
  isChatGPTCheckoutUrl,
  waitForChatGPTCheckoutReady,
} from '../src/modules/chatgpt/queries'

const baseConfig = resolveConfig()

afterEach(() => {
  setRuntimeConfig(baseConfig)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const stripeBillingAddress = {
  name: DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME,
  country: 'SG',
  line1: '128 Orchard Road',
  line2: 'Orchard',
  city: 'Singapore',
  state: undefined,
  postalCode: '238858',
} as const

class FakeCheckoutLocator {
  clicks = 0
  fills: string[] = []
  forceClicks = 0
  private readonly afterClickCallbacks: Array<() => void> = []

  constructor(
    private readonly visible: boolean | (() => boolean) = false,
    private readonly onClick?: () => void,
    private readonly text: string | (() => string) = '',
    private readonly evaluateElement?: HTMLElement & {
      disabled?: boolean
    },
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

  async isEnabled(): Promise<boolean> {
    return this.isCurrentlyVisible()
  }

  async waitFor(options: { state?: string } = {}): Promise<void> {
    const state = options.state ?? 'visible'
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const visible = this.isCurrentlyVisible()
      if ((state === 'visible' || state === 'attached') && visible) return
      if ((state === 'hidden' || state === 'detached') && !visible) return
    }
    throw new Error(`Locator did not reach state ${state}`)
  }

  async scrollIntoViewIfNeeded(): Promise<void> {}

  async click(options?: { force?: boolean }): Promise<void> {
    if (!this.isCurrentlyVisible()) {
      throw new Error('Locator is not visible')
    }
    this.clicks += 1
    if (options?.force === true) {
      this.forceClicks += 1
    }
    this.onClick?.()
    for (const callback of this.afterClickCallbacks) {
      callback()
    }
  }

  async fill(value: string): Promise<void> {
    if (!this.isCurrentlyVisible()) {
      throw new Error('Locator is not visible')
    }
    this.fills.push(value)
  }

  async textContent(): Promise<string> {
    return typeof this.text === 'function' ? this.text() : this.text
  }

  async innerText(): Promise<string> {
    return this.textContent()
  }

  afterClick(callback: () => void): this {
    this.afterClickCallbacks.push(callback)
    return this
  }

  async evaluate<T>(
    callback: (element: HTMLElement & { disabled?: boolean }) => T,
  ): Promise<T> {
    if (this.evaluateElement) {
      return callback(this.evaluateElement)
    }

    const visible = this.isCurrentlyVisible()
    const element = {
      disabled: !visible,
      getAttribute(name: string): string | null {
        return name === 'aria-disabled' ? String(!visible) : null
      },
    } as HTMLElement & { disabled?: boolean }
    return callback(element)
  }

  private isCurrentlyVisible(): boolean {
    return typeof this.visible === 'function' ? this.visible() : this.visible
  }
}

interface FakeCheckoutFrameOptions {
  paypalSelectorLocator?: FakeCheckoutLocator
  gopaySelectorLocator?: FakeCheckoutLocator
  hasPaymentSelectionState?: () => boolean
  paypalSelected?: () => boolean
  gopaySelected?: () => boolean
  addressFrameReady?: boolean
  evaluateCallback?: <T, Arg>(
    callback: (arg: Arg) => Promise<T> | T,
    arg: Arg,
  ) => Promise<T>
}

interface FakeCheckoutPageOptions {
  url?: string
  paymentMethodFrameVisible?: boolean
  billingAddressFrameVisible?: boolean
  subscribeButton?: FakeCheckoutLocator
  termsCheckbox?: FakeCheckoutLocator
  gopayAccordionButton?: FakeCheckoutLocator
  gopayRadioLocator?: FakeCheckoutLocator
  hasHostedPaymentSelectionState?: () => boolean
  hostedGopaySelected?: () => boolean
  gopayAccordionAction?: FakeCheckoutLocator
  paymentErrorMessage?: string | (() => string | undefined)
  evaluateCallback?: <T, Arg>(
    callback: (arg: Arg) => Promise<T> | T,
    arg: Arg,
  ) => Promise<T>
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

  getByRole(
    role: string,
    options: { name?: string | RegExp } = {},
  ): FakeCheckoutLocator {
    if (!['button', 'radio', 'tab'].includes(role)) {
      return this.hiddenLocator
    }

    const requestedMethod = this.getRequestedPaymentMethod(options.name)
    if (requestedMethod === 'gopay') {
      return this.options.gopaySelectorLocator ?? this.hiddenLocator
    }

    if (requestedMethod === 'paypal') {
      return this.options.paypalSelectorLocator ?? this.paypalTabLocator
    }

    return role === 'tab' ? this.paypalTabLocator : this.hiddenLocator
  }

  getByText(): FakeCheckoutLocator {
    return this.hiddenLocator
  }

  locator(selector = ''): FakeCheckoutLocator {
    const normalizedSelector = selector.toLowerCase()
    const requestedMethod =
      this.getRequestedPaymentMethodFromSelector(normalizedSelector)

    if (
      normalizedSelector.includes('[aria-selected="true"]') ||
      normalizedSelector.includes('[aria-checked="true"]') ||
      normalizedSelector.includes('[aria-pressed="true"]') ||
      normalizedSelector.includes('[data-state="active"]') ||
      normalizedSelector.includes('[data-state="checked"]') ||
      normalizedSelector.includes('[data-state="selected"]') ||
      normalizedSelector.includes('[data-state="on"]') ||
      normalizedSelector.includes('[data-selected="true"]') ||
      normalizedSelector.includes('paymentmethodformaccordionitem--selected') ||
      normalizedSelector.includes(':checked')
    ) {
      return new FakeCheckoutLocator(() =>
        requestedMethod === 'gopay'
          ? Boolean(this.options.gopaySelected?.())
          : Boolean(this.options.paypalSelected?.()),
      )
    }
    if (
      normalizedSelector.includes('[aria-selected]') ||
      normalizedSelector.includes('[aria-checked]') ||
      normalizedSelector.includes('[aria-pressed]') ||
      normalizedSelector.includes('[data-state]') ||
      normalizedSelector.includes('[data-selected]') ||
      normalizedSelector.includes('input[type="radio"]') ||
      normalizedSelector.includes(':checked')
    ) {
      return new FakeCheckoutLocator(() =>
        Boolean(this.options.hasPaymentSelectionState?.()),
      )
    }
    if (requestedMethod === 'gopay') {
      return this.options.gopaySelectorLocator ?? this.hiddenLocator
    }
    if (
      requestedMethod === 'paypal' ||
      normalizedSelector.includes('#paypal-tab')
    ) {
      return this.options.paypalSelectorLocator ?? this.hiddenLocator
    }
    if (
      this.options.addressFrameReady &&
      (normalizedSelector.includes('addressline1') ||
        normalizedSelector.includes('address-line1') ||
        normalizedSelector.includes('address_line1') ||
        normalizedSelector.includes('billing_details[address][line1]') ||
        normalizedSelector.includes('country') ||
        normalizedSelector.includes('postal') ||
        normalizedSelector.includes('city'))
    ) {
      return new FakeCheckoutLocator(true)
    }

    return this.hiddenLocator
  }

  private getRequestedPaymentMethodFromSelector(
    selector: string,
  ): 'paypal' | 'gopay' | undefined {
    if (
      selector.includes('gopay') ||
      selector.includes('go-pay') ||
      selector.includes('go_pay')
    ) {
      return 'gopay'
    }

    if (selector.includes('paypal')) {
      return 'paypal'
    }

    return undefined
  }

  private getRequestedPaymentMethod(
    value: string | RegExp | undefined,
  ): 'paypal' | 'gopay' | undefined {
    if (!value) {
      return undefined
    }

    const candidates = ['PayPal', 'GoPay']
    for (const candidate of candidates) {
      const matches =
        typeof value === 'string'
          ? candidate.toLowerCase().includes(value.toLowerCase())
          : value.test(candidate)
      if (!matches) continue
      return candidate === 'GoPay' ? 'gopay' : 'paypal'
    }

    return undefined
  }

  async evaluate<T, Arg>(
    callback: (arg: Arg) => Promise<T> | T,
    arg: Arg,
  ): Promise<T> {
    if (this.options.evaluateCallback) {
      return this.options.evaluateCallback(callback, arg)
    }

    return callback(arg)
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

  context(): {
    pages: () => FakeCheckoutPage[]
    on: () => void
    off: () => void
  } {
    return {
      pages: () => [this],
      on: () => undefined,
      off: () => undefined,
    }
  }

  on(): void {}

  off(): void {}

  getByRole(
    role: string,
    options: { name?: string | RegExp } = {},
  ): FakeCheckoutLocator {
    if (role === 'alert') {
      return this.getPaymentErrorLocator()
    }

    const name = options.name
    const subscribePattern =
      /订阅|購読|subscribe|start trial|start free trial|confirm/i
    if (
      role === 'button' &&
      (name == null ||
        (typeof name === 'string'
          ? subscribePattern.test(name)
          : name.test('Subscribe')))
    ) {
      return this.options.subscribeButton ?? this.hiddenLocator
    }

    return this.hiddenLocator
  }

  getByText(text?: string | RegExp): FakeCheckoutLocator {
    const paymentErrorLocator = this.getPaymentErrorLocator()
    const paymentErrorMessage = this.getPaymentErrorMessage()
    if (
      paymentErrorMessage &&
      text &&
      (typeof text === 'string'
        ? paymentErrorMessage.includes(text)
        : text.test(paymentErrorMessage))
    ) {
      return paymentErrorLocator
    }

    return this.hiddenLocator
  }

  locator(selector = ''): FakeCheckoutLocator {
    const normalizedSelector = selector.toLowerCase()
    const requestedMethod =
      normalizedSelector.includes('gopay') ||
      normalizedSelector.includes('go-pay') ||
      normalizedSelector.includes('go_pay')
        ? 'gopay'
        : undefined

    if (
      requestedMethod === 'gopay' &&
      (normalizedSelector.includes('[aria-selected="true"]') ||
        normalizedSelector.includes('[aria-checked="true"]') ||
        normalizedSelector.includes('[aria-pressed="true"]') ||
        normalizedSelector.includes('[data-state="active"]') ||
        normalizedSelector.includes('[data-state="checked"]') ||
        normalizedSelector.includes('[data-state="selected"]') ||
        normalizedSelector.includes('[data-state="on"]') ||
        normalizedSelector.includes('[data-selected="true"]') ||
        normalizedSelector.includes(':checked') ||
        normalizedSelector.includes('paymentmethodformaccordionitem--selected'))
    ) {
      return new FakeCheckoutLocator(() =>
        Boolean(this.options.hostedGopaySelected?.()),
      )
    }
    if (
      requestedMethod === 'gopay' &&
      (normalizedSelector.includes('input[type="radio"]') ||
        normalizedSelector.includes('[aria-selected]') ||
        normalizedSelector.includes('[aria-checked]') ||
        normalizedSelector.includes('[aria-pressed]') ||
        normalizedSelector.includes('[data-state]') ||
        normalizedSelector.includes('[data-selected]'))
    ) {
      return new FakeCheckoutLocator(() =>
        Boolean(this.options.hasHostedPaymentSelectionState?.()),
      )
    }
    if (
      requestedMethod === 'gopay' &&
      normalizedSelector.includes('gopay-accordion-item-button') &&
      normalizedSelector.includes('> div')
    ) {
      return this.options.gopayAccordionAction ?? this.hiddenLocator
    }
    if (
      requestedMethod === 'gopay' &&
      (normalizedSelector.includes('accordion-item-button') ||
        normalizedSelector.includes('accordionitemheader') ||
        normalizedSelector.includes('accordionitemcover-header') ||
        normalizedSelector.includes('[data-testid="gopay-accordion-item"]'))
    ) {
      return this.options.gopayAccordionButton ?? this.hiddenLocator
    }
    if (
      requestedMethod === 'gopay' &&
      (normalizedSelector.includes('input') ||
        normalizedSelector.includes('[role="radio"]'))
    ) {
      return this.options.gopayRadioLocator ?? this.hiddenLocator
    }
    if (
      normalizedSelector.includes('checkout-submit-button') ||
      normalizedSelector.includes('hosted-payment-submit-button') ||
      normalizedSelector.includes('button[type="submit"]')
    ) {
      return this.options.subscribeButton ?? this.hiddenLocator
    }
    if (normalizedSelector.includes('termsofserviceconsentcheckbox')) {
      return this.options.termsCheckbox ?? this.hiddenLocator
    }
    if (
      normalizedSelector.includes('[role="alert"]') ||
      normalizedSelector.includes('[aria-live=')
    ) {
      return this.getPaymentErrorLocator()
    }
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
    if (
      this.options.evaluateCallback &&
      (normalizedSelector.includes('billingname') ||
        normalizedSelector.includes('billingcountry') ||
        normalizedSelector.includes('billingaddressline1') ||
        normalizedSelector.includes('billinglocality') ||
        normalizedSelector.includes('billingpostalcode') ||
        normalizedSelector.includes('billingadministrativearea') ||
        normalizedSelector.includes('formfieldgroup-billing-address'))
    ) {
      return new FakeCheckoutLocator(true)
    }

    return this.hiddenLocator
  }

  async evaluate<T, Arg>(
    callback: (arg: Arg) => Promise<T> | T,
    arg: Arg,
  ): Promise<T> {
    if (this.options.evaluateCallback) {
      return this.options.evaluateCallback(callback, arg)
    }

    return callback(arg)
  }

  private getPaymentErrorMessage(): string | undefined {
    const value = this.options.paymentErrorMessage
    return typeof value === 'function' ? value() : value
  }

  private getPaymentErrorLocator(): FakeCheckoutLocator {
    return new FakeCheckoutLocator(
      () => Boolean(this.getPaymentErrorMessage()),
      undefined,
      () => this.getPaymentErrorMessage() || '',
    )
  }
}

interface FakeGoPayAuthorizationPageOptions {
  otpReadyAfterConsent?: boolean
  pinReadyAfterConsent?: boolean
  redirectUrlAfterConsent?: string
}

class FakeGoPayAuthorizationPage {
  private readonly hiddenLocator = new FakeCheckoutLocator(false)
  private readonly otpInput = new FakeGoPayOtpInputLocator()
  private readonly digitInputs = new FakeGoPayOtpDigitInputsLocator()
  private bodyText = ''
  private otpReady = false
  private pinReady = false

  constructor(
    private pageUrl: string,
    private readonly consentButton: FakeCheckoutLocator,
    private readonly options: FakeGoPayAuthorizationPageOptions = {},
  ) {
    this.consentButton.afterClick(() => this.applyPostConsentState())
  }

  url(): string {
    return this.pageUrl
  }

  getByRole(
    role: string,
    options: { name?: string | RegExp } = {},
  ): FakeCheckoutLocator {
    if (role !== 'button') {
      return this.hiddenLocator
    }

    const consentButtonPattern =
      /hubungkan|connect|authorize|confirm|continue|lanjut/i
    const name = options.name
    const matchesConsentButton =
      name == null ||
      (typeof name === 'string'
        ? consentButtonPattern.test(name)
        : name.test('Connect'))

    return matchesConsentButton ? this.consentButton : this.hiddenLocator
  }

  locator(selector = ''): FakeCheckoutLocator {
    const normalizedSelector = selector.toLowerCase()
    if (
      normalizedSelector.includes('pin-input-field') ||
      normalizedSelector.includes('pattern="\\\\d{6}"')
    ) {
      return this.otpReady ? this.otpInput : this.hiddenLocator
    }
    if (
      normalizedSelector.includes('[data-testid^="pin-input-"]') ||
      normalizedSelector.includes('maxlength="1"')
    ) {
      return this.otpReady || this.pinReady
        ? this.digitInputs
        : this.hiddenLocator
    }
    if (normalizedSelector === 'body') {
      return new FakeGoPayTextLocator(this.bodyText)
    }
    if (
      normalizedSelector.includes('consent-button') ||
      normalizedSelector.includes('hubungkan') ||
      normalizedSelector.includes('connect')
    ) {
      return this.consentButton
    }

    return this.hiddenLocator
  }

  getByText(text?: string | RegExp): FakeCheckoutLocator {
    if (!text) {
      return this.hiddenLocator
    }

    const matches =
      typeof text === 'string'
        ? this.bodyText.includes(text)
        : text.test(this.bodyText)

    return matches ? new FakeCheckoutLocator(true) : this.hiddenLocator
  }

  private applyPostConsentState(): void {
    if (this.options.redirectUrlAfterConsent) {
      this.pageUrl = this.options.redirectUrlAfterConsent
    }

    if (this.options.otpReadyAfterConsent) {
      this.otpReady = true
      this.bodyText = 'Masukkin OTP yang dikirim ke WhatsApp'
      return
    }

    if (this.options.pinReadyAfterConsent) {
      this.pinReady = true
      this.bodyText = 'Masukkan 6 digit PIN kamu'
    }
  }

  async waitForLoadState(): Promise<void> {}
}

class FakeGoPayOtpInputLocator extends FakeCheckoutLocator {
  value = ''

  constructor(visible = true) {
    super(visible)
  }

  async waitFor(): Promise<void> {}

  async fill(value: string): Promise<void> {
    this.value = value
  }

  async evaluate<T>(
    callback: (element: HTMLElement & { disabled?: boolean }) => T,
  ): Promise<T> {
    const element = {
      disabled: false,
      dispatchEvent: vi.fn(),
      getAttribute(): string | null {
        return null
      },
    } as unknown as HTMLElement & { disabled?: boolean }
    return callback(element)
  }
}

class FakeGoPayOtpDigitInputsLocator extends FakeCheckoutLocator {
  readonly values: string[]

  constructor(
    private readonly index?: number,
    values?: string[],
  ) {
    super(true)
    this.values = values || Array.from({ length: 6 }, () => '')
  }

  first(): FakeCheckoutLocator {
    return this.nth(0)
  }

  nth(index: number): FakeCheckoutLocator {
    return new FakeGoPayOtpDigitInputsLocator(index, this.values)
  }

  async count(): Promise<number> {
    return this.index === undefined ? this.values.length : 1
  }

  async fill(value: string): Promise<void> {
    if (this.index !== undefined) {
      this.values[this.index] = value
    }
  }

  async evaluate<T>(
    callback: (element: HTMLElement & { disabled?: boolean }) => T,
  ): Promise<T> {
    const element = {
      disabled: false,
      dispatchEvent: vi.fn(),
      getAttribute(): string | null {
        return null
      },
    } as unknown as HTMLElement & { disabled?: boolean }
    return callback(element)
  }
}

class FakeGoPayTextLocator extends FakeCheckoutLocator {
  constructor(text: string) {
    super(true, undefined, text)
  }

  async innerText(): Promise<string> {
    return this.textContent()
  }
}

class FakeGoPayOtpPage {
  private readonly hiddenLocator = new FakeCheckoutLocator(false)
  readonly otpInput: FakeGoPayOtpInputLocator
  readonly digitInputs: FakeGoPayOtpDigitInputsLocator
  readonly keyboard = {
    press: vi.fn<() => Promise<void>>(async () => {}),
  }

  constructor(
    private readonly pageUrl: string,
    private readonly options: {
      bodyText?: string
      splitInputs?: boolean
    } = {},
  ) {
    this.otpInput = new FakeGoPayOtpInputLocator(!options.splitInputs)
    this.digitInputs = new FakeGoPayOtpDigitInputsLocator()
  }

  url(): string {
    return this.pageUrl
  }

  locator(selector = ''): FakeCheckoutLocator {
    const normalizedSelector = selector.toLowerCase()
    if (
      normalizedSelector.includes('pin-input-field') ||
      normalizedSelector.includes('pattern="\\\\d{6}"')
    ) {
      return this.otpInput
    }
    if (
      normalizedSelector.includes('[data-testid^="pin-input-"]') ||
      normalizedSelector.includes('maxlength="1"')
    ) {
      return this.options.splitInputs ? this.digitInputs : this.hiddenLocator
    }
    if (normalizedSelector === 'body') {
      return new FakeGoPayTextLocator(
        this.options.bodyText ||
          'Masukkin OTP yang dikirim ke WhatsApp\nOTP dikirim ke +86xxxxxxx3609',
      )
    }

    return this.hiddenLocator
  }

  getByText(text?: string | RegExp): FakeCheckoutLocator {
    const bodyText =
      this.options.bodyText ||
      'Masukkin OTP yang dikirim ke WhatsApp\nOTP dikirim ke +86xxxxxxx3609'
    const matches =
      text === undefined
        ? false
        : typeof text === 'string'
          ? bodyText.includes(text)
          : text.test(bodyText)

    return matches ? new FakeCheckoutLocator(true) : this.hiddenLocator
  }
}

class FakeGoPayTokenizationLocator extends FakeCheckoutLocator {
  constructor(
    private readonly page: FakeGoPayTokenizationPage,
    private readonly kind:
      | 'body'
      | 'phone'
      | 'link'
      | 'pay'
      | 'country-trigger'
      | 'country-search'
      | 'country-option'
      | 'phone-code',
  ) {
    super(
      () => page.isLocatorVisible(kind),
      () => page.clickLocator(kind),
    )
  }

  async waitFor(options: { state?: string } = {}): Promise<void> {
    const state = options.state ?? 'visible'
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const visible = this.page.isLocatorVisible(this.kind)
      if ((state === 'visible' || state === 'attached') && visible) return
      if ((state === 'hidden' || state === 'detached') && !visible) return
    }
    throw new Error(`GoPay tokenization ${this.kind} did not reach ${state}`)
  }

  async fill(value: string): Promise<void> {
    if (this.kind === 'country-search') {
      this.page.countrySearch = value
      return
    }

    this.page.phoneNumber = value
  }

  async evaluate<T>(
    callback: (element: HTMLElement & { disabled?: boolean }) => T,
  ): Promise<T> {
    const element = {
      disabled: !this.page.isLocatorVisible(this.kind),
      dispatchEvent: vi.fn(),
      getAttribute: (name: string) =>
        name === 'aria-disabled'
          ? String(!this.page.isLocatorVisible(this.kind))
          : null,
    } as unknown as HTMLElement & { disabled?: boolean }
    return callback(element)
  }

  async innerText(): Promise<string> {
    return this.kind === 'phone-code' ? this.page.selectedCountryCode : ''
  }
}

class FakeGoPayTokenizationPage {
  readonly calls: string[] = []
  readonly keyboard = {
    press: vi.fn<() => Promise<void>>(async () => {}),
  }
  phoneNumber = ''
  countrySearch = ''
  selectedCountryCode = '1'
  private pageUrl = ''
  private payReady = false
  private countryPickerOpen = false
  private countryOptionVisibilityChecks = 0
  private readonly hiddenLocator = new FakeCheckoutLocator(false)

  constructor(
    private readonly options: {
      activationLinkUrl?: string
      countryOptionVisibleAfterChecks?: number
      payReadyAfterChecks?: number
      pinReady?: boolean
      showPayNowButton?: boolean
    } = {},
  ) {}

  async goto(url: string): Promise<void> {
    this.pageUrl = url
    this.calls.push(url.includes('/authorize') ? 'goto:authorize' : 'goto')
  }

  url(): string {
    return this.pageUrl
  }

  async title(): Promise<string> {
    return 'Midtrans GoPay'
  }

  async waitForLoadState(): Promise<void> {}

  waitForResponse(
    predicate: (response: {
      url: () => string
      request: () => { method: () => string }
    }) => boolean,
  ): Promise<{
    ok: () => boolean
    status: () => number
    text: () => Promise<string>
  }> {
    return new Promise((resolve) => {
      this.responseResolvers.push(() => {
        const response = {
          url: () => 'https://api.midtrans.com/snap/v4/accounts/test/linking',
          request: () => ({ method: () => 'POST' }),
        }
        if (!predicate(response)) return
        resolve({
          ok: () => true,
          status: () => 200,
          text: async () =>
            JSON.stringify({
              activation_link_url: this.options.activationLinkUrl,
              account_status: 'linked',
              status_code: '200',
            }),
        })
      })
    })
  }

  locator(selector = ''): FakeCheckoutLocator {
    const normalizedSelector = selector.toLowerCase()
    if (normalizedSelector === 'body') {
      return new FakeGoPayTokenizationLocator(this, 'body')
    }
    if (normalizedSelector.includes('phone-code-wrapper')) {
      return new FakeGoPayTokenizationLocator(this, 'country-trigger')
    }
    if (
      normalizedSelector.includes('input[type="search"]') ||
      normalizedSelector.includes('placeholder*="country"')
    ) {
      return new FakeGoPayTokenizationLocator(this, 'country-search')
    }
    if (normalizedSelector.includes('country-item')) {
      return new FakeGoPayTokenizationLocator(this, 'country-option')
    }
    if (normalizedSelector.includes('phone-code')) {
      return new FakeGoPayTokenizationLocator(this, 'phone-code')
    }
    if (normalizedSelector.includes('input[type="tel"]')) {
      return new FakeGoPayTokenizationLocator(this, 'phone')
    }
    if (normalizedSelector.includes('linking-cta')) {
      return new FakeGoPayTokenizationLocator(this, 'link')
    }
    if (
      normalizedSelector.includes('[data-testid^="pin-input-"]') ||
      normalizedSelector.includes('maxlength="1"')
    ) {
      return this.options.pinReady
        ? new FakeGoPayOtpDigitInputsLocator()
        : this.hiddenLocator
    }
    if (
      normalizedSelector.includes('gopay-tokenization-balance-content') ||
      normalizedSelector.includes('masked-phone')
    ) {
      return new FakeGoPayTokenizationLocator(this, 'pay')
    }

    return this.hiddenLocator
  }

  getByRole(
    role: string,
    options: { name?: RegExp } = {},
  ): FakeCheckoutLocator {
    if (role !== 'button') return this.hiddenLocator
    const name = options.name
    if (name?.test('Link and pay')) {
      return new FakeGoPayTokenizationLocator(this, 'link')
    }
    if (name?.test('Pay now')) {
      if (this.options.showPayNowButton === false) {
        return this.hiddenLocator
      }

      return new FakeGoPayTokenizationLocator(this, 'pay')
    }

    return this.hiddenLocator
  }

  getByText(text?: string | RegExp): FakeCheckoutLocator {
    if (!this.options.pinReady || !text) {
      return this.hiddenLocator
    }

    const bodyText = 'Masukkan 6 digit PIN kamu'
    const matches =
      typeof text === 'string' ? bodyText.includes(text) : text.test(bodyText)
    return matches ? new FakeCheckoutLocator(true) : this.hiddenLocator
  }

  isLocatorVisible(
    kind:
      | 'body'
      | 'phone'
      | 'link'
      | 'pay'
      | 'country-trigger'
      | 'country-search'
      | 'country-option'
      | 'phone-code',
  ): boolean {
    if (kind === 'body') return Boolean(this.pageUrl)
    if (kind === 'country-trigger') return Boolean(this.pageUrl)
    if (kind === 'country-search') return this.countryPickerOpen
    if (kind === 'country-option') {
      this.countryOptionVisibilityChecks += 1
      return (
        this.countryPickerOpen &&
        this.countrySearch === '86' &&
        this.countryOptionVisibilityChecks >
          (this.options.countryOptionVisibleAfterChecks ?? 0)
      )
    }
    if (kind === 'phone-code') return Boolean(this.pageUrl)
    if (kind === 'phone' || kind === 'link') return !this.payReady
    if (kind === 'pay') {
      if (!this.payReady) return false
      const payReadyAfterChecks = this.options.payReadyAfterChecks
      if (payReadyAfterChecks === undefined) return true

      this.payVisibilityChecks += 1
      return this.payVisibilityChecks > payReadyAfterChecks
    }

    return false
  }

  clickLocator(
    kind:
      | 'body'
      | 'phone'
      | 'link'
      | 'pay'
      | 'country-trigger'
      | 'country-search'
      | 'country-option'
      | 'phone-code',
  ): void {
    this.calls.push(`click:${kind}`)
    if (kind === 'country-trigger') {
      this.countryPickerOpen = true
      return
    }
    if (kind === 'country-option') {
      this.selectedCountryCode = '86'
      this.countryPickerOpen = false
      return
    }
    if (kind !== 'link') return
    this.payReady = true
    this.responseResolvers.splice(0).forEach((resolve) => resolve())
  }

  private readonly responseResolvers: Array<() => void> = []
  private payVisibilityChecks = 0
}

class FakePricingLocator {
  clicks = 0

  constructor(
    private readonly visible: boolean | (() => boolean) = false,
    private readonly options: {
      onClick?: () => void
      selected?: boolean | (() => boolean)
    } = {},
  ) {}

  first(): FakePricingLocator {
    return this
  }

  async isVisible(): Promise<boolean> {
    return this.isCurrentlyVisible()
  }

  async isEnabled(): Promise<boolean> {
    return true
  }

  async waitFor(options: { state?: string } = {}): Promise<void> {
    const state = options.state ?? 'visible'
    const visible = this.isCurrentlyVisible()
    if ((state === 'visible' || state === 'attached') && visible) return
    if ((state === 'hidden' || state === 'detached') && !visible) return
    throw new Error(`Locator did not reach state ${state}`)
  }

  async click(): Promise<void> {
    if (!this.isCurrentlyVisible()) {
      throw new Error('Locator is not visible')
    }
    this.clicks += 1
    this.options.onClick?.()
  }

  async evaluate<T>(
    callback: (element: HTMLElement & { disabled?: boolean }) => T,
  ): Promise<T> {
    const selected = this.isSelected()
    const element = {
      disabled: false,
      getAttribute(name: string): string | null {
        if (name === 'aria-disabled') return 'false'
        if (
          name === 'aria-checked' ||
          name === 'aria-selected' ||
          name === 'aria-pressed'
        ) {
          return selected ? 'true' : 'false'
        }
        if (name === 'data-state') return selected ? 'on' : 'off'
        return null
      },
    } as HTMLElement & { disabled?: boolean }
    return callback(element)
  }

  private isCurrentlyVisible(): boolean {
    return typeof this.visible === 'function' ? this.visible() : this.visible
  }

  private isSelected(): boolean {
    const selected = this.options.selected
    return typeof selected === 'function' ? selected() : Boolean(selected)
  }
}

class FakePricingPage {
  private readonly hiddenLocator = new FakePricingLocator(false)

  constructor(
    private readonly locators: {
      personalToggle?: FakePricingLocator
      businessToggle?: FakePricingLocator
      plusButton?: FakePricingLocator
      teamButton?: FakePricingLocator
    },
  ) {}

  locator(selector = ''): FakePricingLocator {
    const normalizedSelector = selector.toLowerCase()
    if (
      normalizedSelector.includes('aria-label*="个人"') ||
      normalizedSelector.includes('has-text("个人")') ||
      normalizedSelector.includes('personal')
    ) {
      return this.locators.personalToggle ?? this.hiddenLocator
    }
    if (
      normalizedSelector.includes('business') ||
      normalizedSelector.includes('aria-label*="企业"') ||
      normalizedSelector.includes('has-text("企业")')
    ) {
      return this.locators.businessToggle ?? this.hiddenLocator
    }
    if (normalizedSelector.includes('plus')) {
      return this.locators.plusButton ?? this.hiddenLocator
    }
    if (normalizedSelector.includes('team')) {
      return this.locators.teamButton ?? this.hiddenLocator
    }

    return this.hiddenLocator
  }

  getByRole(
    role: string,
    options: { name?: string | RegExp } = {},
  ): FakePricingLocator {
    const name = String(options.name ?? '').toLowerCase()
    if (role === 'radio' || role === 'button') {
      if (name.includes('个人') || name.includes('personal')) {
        return this.locators.personalToggle ?? this.hiddenLocator
      }
      if (
        name.includes('business') ||
        name.includes('team') ||
        name.includes('企业')
      ) {
        return this.locators.businessToggle ?? this.hiddenLocator
      }
      if (name.includes('plus')) {
        return this.locators.plusButton ?? this.hiddenLocator
      }
    }

    return this.hiddenLocator
  }

  getByText(): FakePricingLocator {
    return this.hiddenLocator
  }

  async waitForLoadState(): Promise<void> {}
}

class FakePricingRegionLocator {
  clicks = 0

  constructor(
    private readonly visible: boolean | (() => boolean) = false,
    private readonly options: {
      onClick?: () => void
      text?: string | (() => string)
    } = {},
  ) {}

  first(): FakePricingRegionLocator {
    return this
  }

  nth(): FakePricingRegionLocator {
    return this
  }

  filter(): FakePricingRegionLocator {
    return this
  }

  async count(): Promise<number> {
    return this.isCurrentlyVisible() ? 1 : 0
  }

  async isVisible(): Promise<boolean> {
    return this.isCurrentlyVisible()
  }

  async waitFor(options: { state?: string } = {}): Promise<void> {
    const state = options.state ?? 'visible'
    const visible = this.isCurrentlyVisible()
    if ((state === 'visible' || state === 'attached') && visible) return
    if ((state === 'hidden' || state === 'detached') && !visible) return
    throw new Error(`Pricing region locator did not reach state ${state}`)
  }

  async scrollIntoViewIfNeeded(): Promise<void> {}

  async click(): Promise<void> {
    if (!this.isCurrentlyVisible()) {
      throw new Error('Pricing region locator is not visible')
    }
    this.clicks += 1
    this.options.onClick?.()
  }

  async textContent(): Promise<string> {
    const text = this.options.text
    return typeof text === 'function' ? text() : text || ''
  }

  private isCurrentlyVisible(): boolean {
    return typeof this.visible === 'function' ? this.visible() : this.visible
  }
}

class FakePricingRegionPage {
  readonly keyboard = {
    press: vi.fn<() => Promise<void>>(async () => {}),
    type: vi.fn<() => Promise<void>>(async () => {}),
  }
  readonly combobox: FakePricingRegionLocator
  readonly option: FakePricingRegionLocator
  private selectedCountry = 'United States'
  private opened = false
  private readonly hiddenLocator = new FakePricingRegionLocator(false)

  constructor(options: { optionVisibleAfterChecks?: number } = {}) {
    const optionVisibleAfterChecks = options.optionVisibleAfterChecks ?? 0
    let optionVisibilityChecks = 0
    this.combobox = new FakePricingRegionLocator(true, {
      onClick: () => {
        this.opened = true
      },
      text: () => this.selectedCountry,
    })
    this.option = new FakePricingRegionLocator(
      () => {
        optionVisibilityChecks += 1
        return this.opened && optionVisibilityChecks > optionVisibleAfterChecks
      },
      {
        onClick: () => {
          this.selectedCountry = 'Indonesia'
        },
        text: 'Indonesia',
      },
    )
  }

  getByRole(
    role: string,
    options: { name?: string | RegExp } = {},
  ): FakePricingRegionLocator {
    if (role === 'combobox') return this.combobox
    if (role === 'option' && this.matchesIndonesia(options.name)) {
      return this.option
    }

    return this.hiddenLocator
  }

  getByText(text?: string | RegExp): FakePricingRegionLocator {
    return this.matchesIndonesia(text) ? this.option : this.hiddenLocator
  }

  locator(selector = ''): FakePricingRegionLocator {
    const normalizedSelector = selector.toLowerCase()
    if (
      normalizedSelector.includes('role="combobox"') ||
      normalizedSelector.includes('aria-haspopup="listbox"') ||
      normalizedSelector.includes('aria-controls^="radix-"')
    ) {
      return this.combobox
    }
    if (
      normalizedSelector.includes('role="option"') ||
      normalizedSelector.includes('radix-collection-item')
    ) {
      return this.option
    }

    return this.hiddenLocator
  }

  async waitForLoadState(): Promise<void> {}

  async evaluate<T, Arg>(
    callback: (arg: Arg) => Promise<T> | T,
    arg: Arg,
  ): Promise<T> {
    return callback(arg)
  }

  private matchesIndonesia(value: string | RegExp | undefined): boolean {
    if (!value) return false
    return typeof value === 'string'
      ? /indonesia|印度尼西亚|印尼/i.test(value)
      : value.test('Indonesia')
  }
}

describe('chatgpt team trial checkout defaults', () => {
  it('generates a Singapore billing address with faker by default', () => {
    setRuntimeConfig({
      ...baseConfig,
      chatgptTeamTrial: undefined,
    })
    vi.spyOn(faker.number, 'int')
      .mockReturnValueOnce(128)
      .mockReturnValueOnce(23)
      .mockReturnValueOnce(8858)
    vi.spyOn(faker.helpers, 'arrayElement')
      .mockReturnValueOnce('Orchard Road')
      .mockReturnValueOnce('Orchard')

    const address = resolveChatGPTTeamTrialBillingAddress()

    expect(address).toEqual(stripeBillingAddress)
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

  it('generates a Faker billing address for the checkout country when preserved', () => {
    setRuntimeConfig({
      ...baseConfig,
      chatgptTeamTrial: undefined,
    })

    const address = resolveChatGPTTeamTrialBillingAddress({}, 'ID')

    expect(address).toMatchObject({
      name: DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME,
      country: 'ID',
    })
    expect(address.line1).toBeTruthy()
    expect(address.line2).toBeTruthy()
    expect(address.city).toBeTruthy()
    expect(address.postalCode).toBeTruthy()
    expect(address.line1).not.toContain('Orchard Road')
  })

  it('uses a stable US billing address when the hosted checkout country is preserved', () => {
    setRuntimeConfig({
      ...baseConfig,
      chatgptTeamTrial: undefined,
    })

    const address = resolveChatGPTTeamTrialBillingAddress({}, 'US')

    expect(address).toEqual({
      name: DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME,
      country: 'US',
      line1: '1 Market Street',
      line2: undefined,
      city: 'San Francisco',
      state: 'CA',
      postalCode: '94105',
    })
  })

  it('resolves GoPay account config from runtime config', () => {
    setRuntimeConfig({
      ...baseConfig,
      chatgptTeamTrial: {
        gopay: {
          countryCode: '86',
          phoneNumber: '18400000000',
          pin: '123456',
          authorizationTimeoutMs: 30000,
          unlinkBeforeLink: false,
          unlinkTimeoutMs: 45000,
        },
      },
    })

    expect(resolveChatGPTTeamTrialGoPayAccount()).toMatchObject({
      countryCode: '86',
      phoneNumber: '18400000000',
      pin: '123456',
      authorizationTimeoutMs: 30000,
    })
    expect(resolveChatGPTTeamTrialGoPayUnlinkOptions()).toEqual({
      enabled: false,
      timeoutMs: 45000,
    })
  })

  it('enables GoPay Appium unlink before authorization by default', () => {
    setRuntimeConfig({
      ...baseConfig,
      chatgptTeamTrial: {
        gopay: {
          phoneNumber: '18400000000',
        },
      },
    })

    expect(resolveChatGPTTeamTrialGoPayUnlinkOptions()).toEqual({
      enabled: true,
      timeoutMs: undefined,
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
    ).toContain('button[data-testid="select-plan-button-plus-upgrade"]')
    expect(
      getChatGPTTrialPricingFreeTrialSelectors('plus-1-month-free'),
    ).toContain('button[data-testid="select-plan-button-plus"]')
    expect(
      getChatGPTTrialPricingPlanToggleSelectors('plus-1-month-free'),
    ).toContain('button[role="radio"][aria-label*="个人"]')
    expect(
      getChatGPTTrialPricingPlanToggleSelectors('team-1-month-free'),
    ).toContain('button[role="radio"][aria-label*="Business" i]')
  })

  it('builds hosted direct checkout payloads for GoPay with Indonesian billing details', () => {
    expect(
      buildChatGPTTrialCheckoutPayload('team-1-month-free', {
        paymentMethod: 'gopay',
      }),
    ).toMatchObject({
      plan_name: 'chatgptteamplan',
      billing_details: {
        country: 'ID',
        currency: 'IDR',
      },
      promo_campaign: {
        promo_campaign_id: 'team-1-month-free',
        is_coupon_from_query_param: false,
      },
      cancel_url: 'https://chatgpt.com/#pricing',
      checkout_ui_mode: 'hosted',
    })
    expect(
      buildChatGPTTrialCheckoutPayload('team-1-month-free', {
        paymentMethod: 'gopay',
      }),
    ).not.toHaveProperty('entry_point')
  })

  it('uses the actual selected coupon when building Plus direct checkout payloads', () => {
    expect(
      buildChatGPTTrialCheckoutPayload('plus-1-month-free', {
        paymentMethod: 'gopay',
      }),
    ).toMatchObject({
      plan_name: 'chatgptplusplan',
      billing_details: {
        country: 'ID',
        currency: 'IDR',
      },
      promo_campaign: {
        promo_campaign_id: 'plus-1-month-free',
        is_coupon_from_query_param: false,
      },
      cancel_url: 'https://chatgpt.com/#pricing',
      checkout_ui_mode: 'hosted',
    })
    expect(
      buildChatGPTTrialCheckoutPayload('plus-1-month-free', {
        paymentMethod: 'gopay',
      }),
    ).not.toHaveProperty('team_plan_data')
    expect(
      buildChatGPTTrialCheckoutPayload('plus-1-month-free', {
        paymentMethod: 'gopay',
      }),
    ).not.toHaveProperty('entry_point')
  })

  it('builds direct checkout URLs from checkout session ids', () => {
    expect(buildChatGPTTrialCheckoutUrl('cs_test_123', 'openai_llc')).toBe(
      'https://chatgpt.com/checkout/openai_llc/cs_test_123',
    )
  })

  it('fills Singapore billing address fields with Stripe address names', async () => {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM(
      `<form>
        <input name="billingName" />
        <select name="billing_details[address][country]">
          <option value="SG">Singapore</option>
        </select>
        <input name="billing_details[address][line1]" />
        <input name="billing_details[address][line2]" />
        <input name="billing_details[address][postal_code]" />
        <input name="billing_details[address][city]" />
      </form>`,
      { pretendToBeVisual: true },
    )
    const window = dom.window as unknown as Window & typeof globalThis
    window.HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1,
        bottom: 1,
        width: 1,
        height: 1,
        toJSON: () => ({}),
      }) as DOMRect
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    const previousHTMLElement = globalThis.HTMLElement
    const previousHTMLInputElement = globalThis.HTMLInputElement
    const previousHTMLTextAreaElement = globalThis.HTMLTextAreaElement
    const previousHTMLSelectElement = globalThis.HTMLSelectElement
    const previousEvent = globalThis.Event
    const previousInputEvent = globalThis.InputEvent
    const previousFocusEvent = globalThis.FocusEvent

    Object.assign(globalThis, {
      window,
      document: window.document,
      HTMLElement: window.HTMLElement,
      HTMLInputElement: window.HTMLInputElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      HTMLSelectElement: window.HTMLSelectElement,
      Event: window.Event,
      InputEvent: window.InputEvent,
      FocusEvent: window.FocusEvent,
    })

    try {
      const addressFrame = new FakeCheckoutFrame(
        new FakeCheckoutLocator(false),
        'https://js.stripe.com/v3/elements-inner-address-test.html',
        {
          addressFrameReady: true,
          evaluateCallback: (callback, arg) => Promise.resolve(callback(arg)),
        },
      )
      const page = new FakeCheckoutPage([addressFrame], {
        billingAddressFrameVisible: true,
      })

      await fillChatGPTCheckoutBillingAddress(
        page as never,
        stripeBillingAddress,
      )

      expect(
        (
          window.document.querySelector(
            'input[name="billing_details[address][line1]"]',
          ) as HTMLInputElement
        ).value,
      ).toBe('128 Orchard Road')
      expect(
        (
          window.document.querySelector(
            'input[name="billing_details[address][line2]"]',
          ) as HTMLInputElement
        ).value,
      ).toBe('Orchard')
      expect(
        (
          window.document.querySelector(
            'input[name="billing_details[address][city]"]',
          ) as HTMLInputElement
        ).value,
      ).toBe('Singapore')
    } finally {
      Object.assign(globalThis, {
        window: previousWindow,
        document: previousDocument,
        HTMLElement: previousHTMLElement,
        HTMLInputElement: previousHTMLInputElement,
        HTMLTextAreaElement: previousHTMLTextAreaElement,
        HTMLSelectElement: previousHTMLSelectElement,
        Event: previousEvent,
        InputEvent: previousInputEvent,
        FocusEvent: previousFocusEvent,
      })
    }
  }, 10000)

  it('fills hosted GoPay checkout billing fields with Stripe hosted names', async () => {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM(
      `<form>
        <input name="billingName" />
        <select name="billingCountry">
          <option value="US">United States</option>
          <option value="ID">Indonesia</option>
        </select>
        <input name="billingAddressLine1" />
        <input name="billingAddressLine2" />
        <input name="billingLocality" />
        <input name="billingPostalCode" />
      </form>`,
      { pretendToBeVisual: true },
    )
    const window = dom.window as unknown as Window & typeof globalThis
    window.HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1,
        bottom: 1,
        width: 1,
        height: 1,
        toJSON: () => ({}),
      }) as DOMRect
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    const previousHTMLElement = globalThis.HTMLElement
    const previousHTMLInputElement = globalThis.HTMLInputElement
    const previousHTMLTextAreaElement = globalThis.HTMLTextAreaElement
    const previousHTMLSelectElement = globalThis.HTMLSelectElement
    const previousEvent = globalThis.Event
    const previousInputEvent = globalThis.InputEvent
    const previousFocusEvent = globalThis.FocusEvent

    Object.assign(globalThis, {
      window,
      document: window.document,
      HTMLElement: window.HTMLElement,
      HTMLInputElement: window.HTMLInputElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      HTMLSelectElement: window.HTMLSelectElement,
      Event: window.Event,
      InputEvent: window.InputEvent,
      FocusEvent: window.FocusEvent,
    })

    try {
      const page = new FakeCheckoutPage([], {
        evaluateCallback: (callback, arg) => Promise.resolve(callback(arg)),
      })

      await fillChatGPTCheckoutBillingAddress(
        page as never,
        {
          ...stripeBillingAddress,
          country: 'ID',
          postalCode: '10110',
        },
        { fillCountry: true },
      )

      expect(
        (
          window.document.querySelector(
            'input[name="billingName"]',
          ) as HTMLInputElement
        ).value,
      ).toBe(stripeBillingAddress.name)
      expect(
        (
          window.document.querySelector(
            'select[name="billingCountry"]',
          ) as HTMLSelectElement
        ).value,
      ).toBe('ID')
      expect(
        (
          window.document.querySelector(
            'input[name="billingAddressLine1"]',
          ) as HTMLInputElement
        ).value,
      ).toBe('128 Orchard Road')
      expect(
        (
          window.document.querySelector(
            'input[name="billingLocality"]',
          ) as HTMLInputElement
        ).value,
      ).toBe('Singapore')
      expect(
        (
          window.document.querySelector(
            'input[name="billingPostalCode"]',
          ) as HTMLInputElement
        ).value,
      ).toBe('10110')
    } finally {
      Object.assign(globalThis, {
        window: previousWindow,
        document: previousDocument,
        HTMLElement: previousHTMLElement,
        HTMLInputElement: previousHTMLInputElement,
        HTMLTextAreaElement: previousHTMLTextAreaElement,
        HTMLSelectElement: previousHTMLSelectElement,
        Event: previousEvent,
        InputEvent: previousInputEvent,
        FocusEvent: previousFocusEvent,
      })
    }
  }, 10000)

  it('fills hosted US billing state fields with Stripe hosted names', async () => {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM(
      `<form>
        <select name="billingCountry">
          <option value="US" selected>United States</option>
        </select>
        <input name="billingAddressLine1" />
        <input name="billingLocality" />
        <input name="billingPostalCode" />
        <select name="billingAdministrativeArea">
          <option value="" disabled hidden>State</option>
          <option value="CA">California</option>
          <option value="NY">New York</option>
        </select>
      </form>`,
      { pretendToBeVisual: true },
    )
    const window = dom.window as unknown as Window & typeof globalThis
    window.HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1,
        bottom: 1,
        width: 1,
        height: 1,
        toJSON: () => ({}),
      }) as DOMRect
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    const previousHTMLElement = globalThis.HTMLElement
    const previousHTMLInputElement = globalThis.HTMLInputElement
    const previousHTMLTextAreaElement = globalThis.HTMLTextAreaElement
    const previousHTMLSelectElement = globalThis.HTMLSelectElement
    const previousEvent = globalThis.Event
    const previousInputEvent = globalThis.InputEvent
    const previousFocusEvent = globalThis.FocusEvent

    Object.assign(globalThis, {
      window,
      document: window.document,
      HTMLElement: window.HTMLElement,
      HTMLInputElement: window.HTMLInputElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      HTMLSelectElement: window.HTMLSelectElement,
      Event: window.Event,
      InputEvent: window.InputEvent,
      FocusEvent: window.FocusEvent,
    })

    try {
      const page = new FakeCheckoutPage([], {
        evaluateCallback: (callback, arg) => Promise.resolve(callback(arg)),
      })

      await fillChatGPTCheckoutBillingAddress(
        page as never,
        {
          name: DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME,
          country: 'US',
          line1: '1 Market Street',
          city: 'San Francisco',
          state: 'CA',
          postalCode: '94105',
        },
        { fillCountry: false },
      )

      expect(
        (
          window.document.querySelector(
            'select[name="billingCountry"]',
          ) as HTMLSelectElement
        ).value,
      ).toBe('US')
      expect(
        (
          window.document.querySelector(
            'select[name="billingAdministrativeArea"]',
          ) as HTMLSelectElement
        ).value,
      ).toBe('CA')
      expect(
        (
          window.document.querySelector(
            'input[name="billingLocality"]',
          ) as HTMLInputElement
        ).value,
      ).toBe('San Francisco')
    } finally {
      Object.assign(globalThis, {
        window: previousWindow,
        document: previousDocument,
        HTMLElement: previousHTMLElement,
        HTMLInputElement: previousHTMLInputElement,
        HTMLTextAreaElement: previousHTMLTextAreaElement,
        HTMLSelectElement: previousHTMLSelectElement,
        Event: previousEvent,
        InputEvent: previousInputEvent,
        FocusEvent: previousFocusEvent,
      })
    }
  }, 10000)

  it('can fill billing details without changing the checkout country', async () => {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM(
      `<form>
        <input name="billingName" />
        <select name="billing_details[address][country]">
          <option value="ID" selected>Indonesia</option>
          <option value="SG">Singapore</option>
        </select>
        <input name="billing_details[address][line1]" />
        <input name="billing_details[address][line2]" />
        <input name="billing_details[address][postal_code]" />
        <input name="billing_details[address][city]" />
      </form>`,
      { pretendToBeVisual: true },
    )
    const window = dom.window as unknown as Window & typeof globalThis
    window.HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1,
        bottom: 1,
        width: 1,
        height: 1,
        toJSON: () => ({}),
      }) as DOMRect
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    const previousHTMLElement = globalThis.HTMLElement
    const previousHTMLInputElement = globalThis.HTMLInputElement
    const previousHTMLTextAreaElement = globalThis.HTMLTextAreaElement
    const previousHTMLSelectElement = globalThis.HTMLSelectElement
    const previousEvent = globalThis.Event
    const previousInputEvent = globalThis.InputEvent
    const previousFocusEvent = globalThis.FocusEvent

    Object.assign(globalThis, {
      window,
      document: window.document,
      HTMLElement: window.HTMLElement,
      HTMLInputElement: window.HTMLInputElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      HTMLSelectElement: window.HTMLSelectElement,
      Event: window.Event,
      InputEvent: window.InputEvent,
      FocusEvent: window.FocusEvent,
    })

    try {
      const addressFrame = new FakeCheckoutFrame(
        new FakeCheckoutLocator(false),
        'https://js.stripe.com/v3/elements-inner-address-test.html',
        {
          addressFrameReady: true,
          evaluateCallback: (callback, arg) => Promise.resolve(callback(arg)),
        },
      )
      const page = new FakeCheckoutPage([addressFrame], {
        billingAddressFrameVisible: true,
      })

      await fillChatGPTCheckoutBillingAddress(
        page as never,
        stripeBillingAddress,
        {
          fillCountry: false,
        },
      )

      expect(
        (
          window.document.querySelector(
            'select[name="billing_details[address][country]"]',
          ) as HTMLSelectElement
        ).value,
      ).toBe('ID')
      expect(
        (
          window.document.querySelector(
            'input[name="billing_details[address][line1]"]',
          ) as HTMLInputElement
        ).value,
      ).toBe('128 Orchard Road')
    } finally {
      Object.assign(globalThis, {
        window: previousWindow,
        document: previousDocument,
        HTMLElement: previousHTMLElement,
        HTMLInputElement: previousHTMLInputElement,
        HTMLTextAreaElement: previousHTMLTextAreaElement,
        HTMLSelectElement: previousHTMLSelectElement,
        Event: previousEvent,
        InputEvent: previousInputEvent,
        FocusEvent: previousFocusEvent,
      })
    }
  }, 10000)

  it('expands and fills hidden billing address line 2 fields', async () => {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM(
      `<form>
        <input name="billingName" />
        <select name="billing_details[address][country]">
          <option value="SG">Singapore</option>
        </select>
        <input name="billing_details[address][line1]" />
        <button id="add-line2" type="button">Add apartment, suite, or unit</button>
        <input name="billing_details[address][postal_code]" />
        <input name="billing_details[address][city]" />
      </form>`,
      { pretendToBeVisual: true },
    )
    const window = dom.window as unknown as Window & typeof globalThis
    const form = window.document.querySelector('form') as HTMLFormElement
    window.document
      .querySelector('#add-line2')
      ?.addEventListener('click', () => {
        const line2 = window.document.createElement('input')
        line2.setAttribute('name', 'billing_details[address][line2]')
        form.insertBefore(
          line2,
          window.document.querySelector(
            'input[name="billing_details[address][postal_code]"]',
          ),
        )
      })
    window.HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1,
        bottom: 1,
        width: 1,
        height: 1,
        toJSON: () => ({}),
      }) as DOMRect
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    const previousHTMLElement = globalThis.HTMLElement
    const previousHTMLInputElement = globalThis.HTMLInputElement
    const previousHTMLTextAreaElement = globalThis.HTMLTextAreaElement
    const previousHTMLSelectElement = globalThis.HTMLSelectElement
    const previousEvent = globalThis.Event
    const previousInputEvent = globalThis.InputEvent
    const previousFocusEvent = globalThis.FocusEvent

    Object.assign(globalThis, {
      window,
      document: window.document,
      HTMLElement: window.HTMLElement,
      HTMLInputElement: window.HTMLInputElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      HTMLSelectElement: window.HTMLSelectElement,
      Event: window.Event,
      InputEvent: window.InputEvent,
      FocusEvent: window.FocusEvent,
    })

    try {
      const addressFrame = new FakeCheckoutFrame(
        new FakeCheckoutLocator(false),
        'https://js.stripe.com/v3/elements-inner-address-test.html',
        {
          addressFrameReady: true,
          evaluateCallback: (callback, arg) => Promise.resolve(callback(arg)),
        },
      )
      const page = new FakeCheckoutPage([addressFrame], {
        billingAddressFrameVisible: true,
      })

      await fillChatGPTCheckoutBillingAddress(
        page as never,
        stripeBillingAddress,
      )

      expect(
        (
          window.document.querySelector(
            'input[name="billing_details[address][line2]"]',
          ) as HTMLInputElement
        ).value,
      ).toBe('Orchard')
    } finally {
      Object.assign(globalThis, {
        window: previousWindow,
        document: previousDocument,
        HTMLElement: previousHTMLElement,
        HTMLInputElement: previousHTMLInputElement,
        HTMLTextAreaElement: previousHTMLTextAreaElement,
        HTMLSelectElement: previousHTMLSelectElement,
        Event: previousEvent,
        InputEvent: previousInputEvent,
        FocusEvent: previousFocusEvent,
      })
    }
  }, 10000)

  it('matches billing state select options by visible label', async () => {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM(
      `<form>
        <input name="billingName" />
        <select name="billing_details[address][country]">
          <option value="US" selected>United States</option>
        </select>
        <input name="billing_details[address][line1]" />
        <input name="billing_details[address][postal_code]" />
        <input name="billing_details[address][city]" />
        <select name="billing_details[address][state]">
          <option value="">Select state</option>
          <option value="CA">California</option>
        </select>
      </form>`,
      { pretendToBeVisual: true },
    )
    const window = dom.window as unknown as Window & typeof globalThis
    window.HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1,
        bottom: 1,
        width: 1,
        height: 1,
        toJSON: () => ({}),
      }) as DOMRect
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    const previousHTMLElement = globalThis.HTMLElement
    const previousHTMLInputElement = globalThis.HTMLInputElement
    const previousHTMLTextAreaElement = globalThis.HTMLTextAreaElement
    const previousHTMLSelectElement = globalThis.HTMLSelectElement
    const previousEvent = globalThis.Event
    const previousInputEvent = globalThis.InputEvent
    const previousFocusEvent = globalThis.FocusEvent

    Object.assign(globalThis, {
      window,
      document: window.document,
      HTMLElement: window.HTMLElement,
      HTMLInputElement: window.HTMLInputElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      HTMLSelectElement: window.HTMLSelectElement,
      Event: window.Event,
      InputEvent: window.InputEvent,
      FocusEvent: window.FocusEvent,
    })

    try {
      const addressFrame = new FakeCheckoutFrame(
        new FakeCheckoutLocator(false),
        'https://js.stripe.com/v3/elements-inner-address-test.html',
        {
          addressFrameReady: true,
          evaluateCallback: (callback, arg) => Promise.resolve(callback(arg)),
        },
      )
      const page = new FakeCheckoutPage([addressFrame], {
        billingAddressFrameVisible: true,
      })

      await fillChatGPTCheckoutBillingAddress(
        page as never,
        {
          name: DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME,
          country: 'US',
          line1: '1 Market Street',
          city: 'San Francisco',
          state: 'California',
          postalCode: '94105',
        },
        {
          fillCountry: false,
        },
      )

      expect(
        (
          window.document.querySelector(
            'select[name="billing_details[address][country]"]',
          ) as HTMLSelectElement
        ).value,
      ).toBe('US')
      expect(
        (
          window.document.querySelector(
            'select[name="billing_details[address][state]"]',
          ) as HTMLSelectElement
        ).value,
      ).toBe('CA')
    } finally {
      Object.assign(globalThis, {
        window: previousWindow,
        document: previousDocument,
        HTMLElement: previousHTMLElement,
        HTMLInputElement: previousHTMLInputElement,
        HTMLTextAreaElement: previousHTMLTextAreaElement,
        HTMLSelectElement: previousHTMLSelectElement,
        Event: previousEvent,
        InputEvent: previousInputEvent,
        FocusEvent: previousFocusEvent,
      })
    }
  }, 10000)

  it('reads the preselected checkout billing country', async () => {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM(
      `<form>
        <select name="billing_details[address][country]">
          <option value="ID" selected>Indonesia</option>
          <option value="SG">Singapore</option>
        </select>
      </form>`,
      { pretendToBeVisual: true },
    )
    const window = dom.window as unknown as Window & typeof globalThis
    window.HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1,
        bottom: 1,
        width: 1,
        height: 1,
        toJSON: () => ({}),
      }) as DOMRect
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    const previousHTMLElement = globalThis.HTMLElement
    const previousHTMLInputElement = globalThis.HTMLInputElement
    const previousHTMLSelectElement = globalThis.HTMLSelectElement

    Object.assign(globalThis, {
      window,
      document: window.document,
      HTMLElement: window.HTMLElement,
      HTMLInputElement: window.HTMLInputElement,
      HTMLSelectElement: window.HTMLSelectElement,
    })

    try {
      const addressFrame = new FakeCheckoutFrame(
        new FakeCheckoutLocator(false),
        'https://js.stripe.com/v3/elements-inner-address-test.html',
        {
          addressFrameReady: true,
          evaluateCallback: (callback) => Promise.resolve(callback()),
        },
      )
      const page = new FakeCheckoutPage([addressFrame], {
        billingAddressFrameVisible: true,
      })

      await expect(
        readChatGPTCheckoutBillingCountry(page as never),
      ).resolves.toBe('ID')
    } finally {
      Object.assign(globalThis, {
        window: previousWindow,
        document: previousDocument,
        HTMLElement: previousHTMLElement,
        HTMLInputElement: previousHTMLInputElement,
        HTMLSelectElement: previousHTMLSelectElement,
      })
    }
  }, 10000)

  it('does not require a city field for Singapore billing addresses', async () => {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM(
      `<form>
        <input name="billingName" />
        <select name="billing_details[address][country]">
          <option value="SG">Singapore</option>
        </select>
        <input name="billing_details[address][line1]" />
        <input name="billing_details[address][line2]" />
        <input name="billing_details[address][postal_code]" />
      </form>`,
      { pretendToBeVisual: true },
    )
    const window = dom.window as unknown as Window & typeof globalThis
    window.HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1,
        bottom: 1,
        width: 1,
        height: 1,
        toJSON: () => ({}),
      }) as DOMRect
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    const previousHTMLElement = globalThis.HTMLElement
    const previousHTMLInputElement = globalThis.HTMLInputElement
    const previousHTMLTextAreaElement = globalThis.HTMLTextAreaElement
    const previousHTMLSelectElement = globalThis.HTMLSelectElement
    const previousEvent = globalThis.Event
    const previousInputEvent = globalThis.InputEvent
    const previousFocusEvent = globalThis.FocusEvent

    Object.assign(globalThis, {
      window,
      document: window.document,
      HTMLElement: window.HTMLElement,
      HTMLInputElement: window.HTMLInputElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      HTMLSelectElement: window.HTMLSelectElement,
      Event: window.Event,
      InputEvent: window.InputEvent,
      FocusEvent: window.FocusEvent,
    })

    try {
      const addressFrame = new FakeCheckoutFrame(
        new FakeCheckoutLocator(false),
        'https://js.stripe.com/v3/elements-inner-address-test.html',
        {
          addressFrameReady: true,
          evaluateCallback: (callback, arg) => Promise.resolve(callback(arg)),
        },
      )
      const page = new FakeCheckoutPage([addressFrame], {
        billingAddressFrameVisible: true,
      })

      await expect(
        fillChatGPTCheckoutBillingAddress(page as never, stripeBillingAddress),
      ).resolves.toBeUndefined()

      expect(
        (
          window.document.querySelector(
            'input[name="billing_details[address][postal_code]"]',
          ) as HTMLInputElement
        ).value,
      ).toBe('238858')
    } finally {
      Object.assign(globalThis, {
        window: previousWindow,
        document: previousDocument,
        HTMLElement: previousHTMLElement,
        HTMLInputElement: previousHTMLInputElement,
        HTMLTextAreaElement: previousHTMLTextAreaElement,
        HTMLSelectElement: previousHTMLSelectElement,
        Event: previousEvent,
        InputEvent: previousInputEvent,
        FocusEvent: previousFocusEvent,
      })
    }
  }, 10000)

  it('creates direct checkout links with the browser session access token', async () => {
    const requests: Array<{
      url: string
      init?: RequestInit
    }> = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      requests.push({ url: String(url), init })
      if (String(url) === '/api/auth/session') {
        return {
          ok: true,
          status: 200,
          url: 'https://chatgpt.com/api/auth/session',
          text: async () => JSON.stringify({ accessToken: 'access-token' }),
        }
      }

      return {
        ok: true,
        status: 200,
        url: String(url),
        text: async () =>
          JSON.stringify({
            url: 'https://chatgpt.com/checkout/openai_llc/cs_hosted_456',
            checkout_session_id: 'cs_live_123',
            processor_entity: 'openai_llc',
          }),
      }
    })
    const page = {
      async evaluate<T, Arg>(
        callback: (arg: Arg) => Promise<T>,
        arg: Arg,
      ): Promise<T> {
        return callback(arg)
      },
    }

    const link = await createChatGPTTrialCheckoutLink(
      page as never,
      'plus-1-month-free',
      {
        paymentMethod: 'gopay',
      },
    )

    expect(link).toMatchObject({
      url: 'https://chatgpt.com/checkout/openai_llc/cs_hosted_456',
      checkoutSessionId: 'cs_live_123',
      processorEntity: 'openai_llc',
    })
    expect(requests[1]?.url).toBe(
      'https://chatgpt.com/backend-api/payments/checkout',
    )
    expect(requests[1]?.init?.headers).toMatchObject({
      Authorization: 'Bearer access-token',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      plan_name: 'chatgptplusplan',
      billing_details: {
        country: 'ID',
        currency: 'IDR',
      },
      promo_campaign: {
        promo_campaign_id: 'plus-1-month-free',
        is_coupon_from_query_param: false,
      },
      cancel_url: 'https://chatgpt.com/#pricing',
      checkout_ui_mode: 'hosted',
    })
    expect(JSON.parse(String(requests[1]?.init?.body))).not.toHaveProperty(
      'entry_point',
    )
  })

  it('switches Plus pricing to Personal before claiming the free trial', async () => {
    let personalSelected = false
    const clickOrder: string[] = []
    const personalToggle = new FakePricingLocator(true, {
      selected: () => personalSelected,
      onClick: () => {
        personalSelected = true
        clickOrder.push('personal')
      },
    })
    const plusButton = new FakePricingLocator(true, {
      onClick: () => {
        clickOrder.push('plus')
      },
    })
    const page = new FakePricingPage({
      personalToggle,
      plusButton,
    })

    await clickTrialPricingFreeTrial(page as never, 'plus-1-month-free')

    expect(personalToggle.clicks).toBe(1)
    expect(plusButton.clicks).toBe(1)
    expect(clickOrder).toEqual(['personal', 'plus'])
  })

  it('selects the GoPay pricing region without fixed option delays', async () => {
    vi.useFakeTimers()
    const page = new FakePricingRegionPage({
      optionVisibleAfterChecks: 12,
    })

    const result = selectChatGPTPricingRegion(page as never, 'ID', {
      timeoutMs: 1000,
    })

    try {
      await expect(result).resolves.toBe(true)
      expect(page.combobox.clicks).toBe(1)
      expect(page.option.clicks).toBe(1)
    } finally {
      vi.useRealTimers()
    }
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
  it('recognizes OpenAI hosted checkout URLs', () => {
    expect(
      isChatGPTCheckoutUrl(
        'https://pay.openai.com/c/pay/cs_live_123#fidkdWxOYHwn',
      ),
    ).toBe(true)
    expect(
      isChatGPTCheckoutUrl('https://pay.openai.com/c/session/cs_live_123'),
    ).toBe(false)
  })

  it('treats the payment method frame as ready before the billing address frame appears', async () => {
    const page = new FakeCheckoutPage([], {
      paymentMethodFrameVisible: true,
      billingAddressFrameVisible: false,
    })

    await expect(waitForChatGPTCheckoutReady(page as never, 100)).resolves.toBe(
      true,
    )
  })

  it('treats OpenAI hosted GoPay payment choices as checkout ready', async () => {
    const page = new FakeCheckoutPage([], {
      url: 'https://pay.openai.com/c/pay/cs_live_123#fidkdWxOYHwn',
      gopayAccordionButton: new FakeCheckoutLocator(true),
    })

    await expect(waitForChatGPTCheckoutReady(page as never, 100)).resolves.toBe(
      true,
    )
  })
})

describe('checkout payment method selection', () => {
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

  it('rescans payment method candidates without a fixed poll delay', async () => {
    vi.useFakeTimers()
    let visibilityChecks = 0
    const paypalTabLocator = new FakeCheckoutLocator(() => {
      visibilityChecks += 1
      return visibilityChecks > 12
    })
    const page = new FakeCheckoutPage([new FakeCheckoutFrame(paypalTabLocator)])

    const result = selectChatGPTCheckoutPaypalPaymentMethodIfPresent(
      page as never,
      {
        timeoutMs: 1000,
      },
    )

    try {
      await expect(result).resolves.toBe(true)
      expect(paypalTabLocator.clicks).toBe(1)
      expect(visibilityChecks).toBeGreaterThan(12)
    } finally {
      vi.useRealTimers()
    }
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

  it('does not wait on a fixed settle delay after PayPal selection is observed', async () => {
    vi.useFakeTimers()
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

    const result = selectChatGPTCheckoutPaypalPaymentMethodIfPresent(
      page as never,
      {
        timeoutMs: 1000,
      },
    )

    try {
      await expect(result).resolves.toBe(true)
      expect(paypalSelectorLocator.clicks).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('switches card and GoPay Stripe tablists to the GoPay tab', async () => {
    let gopaySelected = false
    const gopaySelectorLocator = new FakeCheckoutLocator(true, () => {
      gopaySelected = true
    })
    const page = new FakeCheckoutPage([
      new FakeCheckoutFrame(
        new FakeCheckoutLocator(false),
        'https://js.stripe.com/v3/elements-inner-payment-test.html',
        {
          gopaySelectorLocator,
          hasPaymentSelectionState: () => true,
          gopaySelected: () => gopaySelected,
        },
      ),
    ])

    await expect(
      selectChatGPTCheckoutPaymentMethodIfPresent(page as never, 'gopay', {
        timeoutMs: 1000,
      }),
    ).resolves.toBe(true)

    expect(gopaySelectorLocator.clicks).toBe(1)
    expect(gopaySelected).toBe(true)
  })

  it('opens hosted GoPay checkout with the accordion button before the hidden radio', async () => {
    let gopaySelected = false
    const gopayAccordionButton = new FakeCheckoutLocator(true, undefined, '')
    const gopayAccordionAction = new FakeCheckoutLocator(true, () => {
      gopaySelected = true
    })
    const gopayRadioLocator = new FakeCheckoutLocator(true)
    const page = new FakeCheckoutPage([], {
      gopayAccordionButton,
      gopayAccordionAction,
      gopayRadioLocator,
      hasHostedPaymentSelectionState: () => true,
      hostedGopaySelected: () => gopaySelected,
    })

    await expect(
      selectChatGPTCheckoutPaymentMethodIfPresent(page as never, 'gopay', {
        timeoutMs: 1000,
      }),
    ).resolves.toBe(true)

    expect(gopayAccordionAction.clicks).toBe(1)
    expect(gopayAccordionAction.forceClicks).toBe(1)
    expect(gopayAccordionButton.clicks).toBe(0)
    expect(gopayRadioLocator.clicks).toBe(0)
    expect(gopaySelected).toBe(true)
  })

  it('selects hosted GoPay before trying generic payment method locators', async () => {
    let gopaySelected = false
    const gopayAccordionButton = new FakeCheckoutLocator(true, () => {
      throw new Error('generic GoPay locator should not be clicked')
    })
    const gopayAccordionAction = new FakeCheckoutLocator(true, () => {
      gopaySelected = true
    })
    const page = new FakeCheckoutPage([], {
      gopayAccordionButton,
      gopayAccordionAction,
      hasHostedPaymentSelectionState: () => true,
      hostedGopaySelected: () => gopaySelected,
    })

    await expect(
      selectChatGPTCheckoutPaymentMethodIfPresent(page as never, 'gopay', {
        timeoutMs: 1000,
      }),
    ).resolves.toBe(true)

    expect(gopayAccordionAction.forceClicks).toBe(1)
    expect(gopayAccordionButton.clicks).toBe(0)
  })

  it('falls back to the visible GoPay button when the hosted action fails', async () => {
    let gopaySelected = false
    const gopayAccordionAction = new FakeCheckoutLocator(true, () => {
      throw new Error('hosted GoPay action failed')
    })
    const gopayAccordionButton = new FakeCheckoutLocator(true, () => {
      gopaySelected = true
    })
    const page = new FakeCheckoutPage([], {
      gopayAccordionAction,
      gopayAccordionButton,
      hasHostedPaymentSelectionState: () => true,
      hostedGopaySelected: () => gopaySelected,
    })

    await expect(
      selectChatGPTCheckoutPaymentMethodIfPresent(page as never, 'gopay', {
        timeoutMs: 1000,
      }),
    ).resolves.toBe(true)

    expect(gopayAccordionAction.forceClicks).toBe(1)
    expect(gopayAccordionButton.clicks).toBeGreaterThan(0)
    expect(gopaySelected).toBe(true)
  })

  it('does not report GoPay selected when the payment tab state remains on another method', async () => {
    const gopaySelectorLocator = new FakeCheckoutLocator(true)
    const page = new FakeCheckoutPage([
      new FakeCheckoutFrame(
        new FakeCheckoutLocator(false),
        'https://js.stripe.com/v3/elements-inner-payment-test.html',
        {
          gopaySelectorLocator,
          hasPaymentSelectionState: () => true,
          gopaySelected: () => false,
        },
      ),
    ])

    await expect(
      selectChatGPTCheckoutPaymentMethodIfPresent(page as never, 'gopay', {
        timeoutMs: 50,
      }),
    ).resolves.toBe(false)

    expect(gopaySelectorLocator.clicks).toBeGreaterThan(0)
  })

  it('aborts checkout when ChatGPT reports the payment was not approved', async () => {
    let paymentErrorMessage: string | undefined
    const subscribeButton = new FakeCheckoutLocator(true, () => {
      paymentErrorMessage = '付款未获批准'
    })
    const page = new FakeCheckoutPage(
      [
        new FakeCheckoutFrame(
          new FakeCheckoutLocator(true),
          'https://js.stripe.com/v3/elements-inner-payment-test.html',
          {
            paypalSelected: () => true,
          },
        ),
      ],
      {
        subscribeButton,
        paymentErrorMessage: () => paymentErrorMessage,
      },
    )

    await expect(
      clickChatGPTCheckoutSubscribeAndCapturePaymentLink(page as never, {
        paymentMethod: 'paypal',
        timeoutMs: 1000,
      }),
    ).rejects.toThrow('ChatGPT checkout payment was not approved: 付款未获批准')

    expect(subscribeButton.clicks).toBe(1)
  })

  it('aborts checkout when hosted checkout cannot calculate address tax', async () => {
    let paymentErrorMessage: string | undefined
    const subscribeButton = new FakeCheckoutLocator(true, () => {
      paymentErrorMessage = '我们无法计算该地址的税额。'
    })
    const page = new FakeCheckoutPage(
      [
        new FakeCheckoutFrame(
          new FakeCheckoutLocator(true),
          'https://js.stripe.com/v3/elements-inner-payment-test.html',
          {
            gopaySelected: () => true,
          },
        ),
      ],
      {
        subscribeButton,
        paymentErrorMessage: () => paymentErrorMessage,
      },
    )

    await expect(
      clickChatGPTCheckoutSubscribeAndCapturePaymentLink(page as never, {
        paymentMethod: 'gopay',
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(
      'ChatGPT checkout payment was not approved: 我们无法计算该地址的税额。',
    )

    expect(subscribeButton.clicks).toBe(1)
  })

  it('checks hosted checkout terms before submitting GoPay', async () => {
    const termsCheckbox = new FakeCheckoutLocator(true)
    const subscribeButton = new FakeCheckoutLocator(true)
    const page = new FakeCheckoutPage(
      [
        new FakeCheckoutFrame(
          new FakeCheckoutLocator(true),
          'https://js.stripe.com/v3/elements-inner-payment-test.html',
          {
            gopaySelected: () => true,
          },
        ),
      ],
      {
        subscribeButton,
        termsCheckbox,
      },
    )

    await expect(
      clickChatGPTCheckoutSubscribeAndCapturePaymentLink(page as never, {
        paymentMethod: 'gopay',
        timeoutMs: 50,
      }),
    ).rejects.toThrow('ChatGPT gopay payment redirect link was not captured.')

    expect(termsCheckbox.clicks).toBeGreaterThan(0)
    expect(subscribeButton.clicks).toBeGreaterThan(0)
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

describe('gopay payment redirect extraction', () => {
  it('captures Midtrans GoPay tokenization redirect URLs', () => {
    const url =
      'https://app.midtrans.com/snap/v4/redirection/b46fbc69-c628-4ad7-abcf-b4ca1cbb23e1#/gopay-tokenization/linking'

    expect(extractGoPayPaymentRedirectLink(url)).toMatchObject({
      url,
      paymentMethod: 'gopay',
      redirectId: 'b46fbc69-c628-4ad7-abcf-b4ca1cbb23e1',
    })
  })

  it('ignores non-GoPay Midtrans redirects', () => {
    expect(
      extractGoPayPaymentRedirectLink(
        'https://app.midtrans.com/snap/v4/redirection/b46fbc69-c628-4ad7-abcf-b4ca1cbb23e1#/card',
      ),
    ).toBeUndefined()
    expect(
      extractGoPayPaymentRedirectLink(
        'https://example.com/snap/v4/redirection/b46fbc69-c628-4ad7-abcf-b4ca1cbb23e1#/gopay-tokenization/linking',
      ),
    ).toBeUndefined()
  })

  it('clicks the GoPay authorization consent button after linking', async () => {
    vi.useFakeTimers()
    const consentButton = new FakeCheckoutLocator(true)
    const page = new FakeGoPayAuthorizationPage(
      'https://gwc.gopayapi.com/snap/linking/authorize',
      consentButton,
      {
        pinReadyAfterConsent: true,
      },
    )

    try {
      await expect(
        clickGoPayAuthorizationConsentIfPresent(page as never),
      ).resolves.toBe(true)

      expect(consentButton.clicks).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for GoPay authorization consent without fixed polling', async () => {
    vi.useFakeTimers()
    let visibilityChecks = 0
    const consentButton = new FakeCheckoutLocator(() => {
      visibilityChecks += 1
      return visibilityChecks > 12
    })
    const page = new FakeGoPayAuthorizationPage(
      'https://gwc.gopayapi.com/snap/linking/authorize',
      consentButton,
      {
        pinReadyAfterConsent: true,
      },
    )

    try {
      await expect(
        clickGoPayAuthorizationConsentIfPresent(page as never, {
          timeoutMs: 1000,
        }),
      ).resolves.toBe(true)

      expect(consentButton.clicks).toBe(1)
      expect(visibilityChecks).toBeGreaterThan(12)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for GoPay unlink before submitting the tokenization phone number', async () => {
    vi.useFakeTimers()
    const page = new FakeGoPayTokenizationPage({
      countryOptionVisibleAfterChecks: 12,
    })
    const redirect = extractGoPayPaymentRedirectLink(
      'https://app.midtrans.com/snap/v4/redirection/b46fbc69-c628-4ad7-abcf-b4ca1cbb23e1#/gopay-tokenization/linking',
    )
    const events: string[] = []

    try {
      await expect(
        continueGoPayPaymentFromRedirect(page as never, redirect!, {
          countryCode: '+86',
          phoneNumber: '18400000000',
          async beforePhoneSubmit() {
            events.push('beforePhoneSubmit')
            page.calls.push('beforePhoneSubmit')
            expect(page.calls).not.toContain('click:link')
          },
        }),
      ).rejects.toThrow(
        'GoPay tokenization did not return an activation link after submitting the phone number.',
      )

      expect(events).toEqual(['beforePhoneSubmit'])
      expect(page.calls.indexOf('beforePhoneSubmit')).toBeLessThan(
        page.calls.indexOf('click:link'),
      )
      expect(page.calls).toContain('click:country-trigger')
      expect(page.calls).toContain('click:country-option')
      expect(page.selectedCountryCode).toBe('86')
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for Midtrans payment page readiness without fixed polling', async () => {
    vi.useFakeTimers()
    const page = new FakeGoPayTokenizationPage({
      activationLinkUrl:
        'https://merchants-gws-app.gopayapi.com/app/authorize?reference=abc',
      payReadyAfterChecks: 12,
      pinReady: true,
      showPayNowButton: false,
    })
    const redirect = extractGoPayPaymentRedirectLink(
      'https://app.midtrans.com/snap/v4/redirection/b46fbc69-c628-4ad7-abcf-b4ca1cbb23e1#/gopay-tokenization/linking',
    )

    const result = continueGoPayPaymentFromRedirect(page as never, redirect!, {
      phoneNumber: '18400000000',
    })

    try {
      await expect(result).resolves.toMatchObject({
        status: 'payment-page-ready',
        payNowClicked: false,
      })
      expect(page.calls).toContain('goto:authorize')
      expect(page.calls).toContain('click:link')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not click matching consent buttons outside GoPay authorization', async () => {
    const consentButton = new FakeCheckoutLocator(true)
    const page = new FakeGoPayAuthorizationPage(
      'https://example.com/snap/linking/authorize',
      consentButton,
    )

    await expect(
      clickGoPayAuthorizationConsentIfPresent(page as never),
    ).resolves.toBe(false)

    expect(consentButton.clicks).toBe(0)
  })

  it('fills the GoPay WhatsApp OTP input on the authorization page', async () => {
    const page = new FakeGoPayOtpPage(
      'https://merchants-gws-app.gopayapi.com/app/authorize?reference=abc',
    )

    await expect(
      submitGoPayAuthorizationOtpIfPresent(page as never, '654321'),
    ).resolves.toBe(true)
    expect(page.otpInput.value).toBe('654321')
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter')
  })

  it('fills split GoPay OTP fields when the page labels them as WhatsApp OTP', async () => {
    const page = new FakeGoPayOtpPage(
      'https://merchants-gws-app.gopayapi.com/app/authorize?reference=abc',
      {
        splitInputs: true,
        bodyText: 'Masukkin OTP yang dikirim ke WhatsApp',
      },
    )

    await expect(
      submitGoPayAuthorizationOtpIfPresent(page as never, '532128'),
    ).resolves.toBe(true)
    expect(page.digitInputs.values.join('')).toBe('532128')
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter')
  })

  it('does not fill split PIN fields as GoPay OTP', async () => {
    const page = new FakeGoPayOtpPage(
      'https://merchants-gws-app.gopayapi.com/app/authorize?reference=abc',
      {
        splitInputs: true,
        bodyText: 'Masukkan 6 digit PIN kamu',
      },
    )

    await expect(
      submitGoPayAuthorizationOtpIfPresent(page as never, '532128'),
    ).resolves.toBe(false)
    expect(page.digitInputs.values.join('')).toBe('')
  })

  it('does not fill GoPay OTP fields outside GoPay authorization', async () => {
    const page = new FakeGoPayOtpPage('https://example.com/app/authorize')

    await expect(
      submitGoPayAuthorizationOtpIfPresent(page as never, '654321'),
    ).resolves.toBe(false)
    expect(page.otpInput.value).toBe('')
  })
})
