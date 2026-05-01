import type { Frame, Locator, Page, Request } from 'patchright'
import { clickAny, clickIfPresent, typeIfPresent } from '../common/form-actions'
import type {
  VerificationCodeUpdateEvent,
  VerificationProvider,
} from '../verification'
import { sleep } from '../../utils/wait'
import {
  ADULT_BIRTHDAY,
  ADULT_BIRTH_DAY,
  ADULT_BIRTH_MONTH,
  ADULT_BIRTH_YEAR,
  ADULT_AGE,
  AGE_CONFIRM_SELECTORS,
  AGE_GATE_AGE_SELECTORS,
  AGE_GATE_BIRTHDAY_HIDDEN_INPUT_SELECTORS,
  AGE_GATE_BIRTHDAY_GROUP_SELECTORS,
  AGE_GATE_BIRTHDAY_TRIGGER_SELECTORS,
  AGE_GATE_BIRTH_DAY_SELECTORS,
  AGE_GATE_BIRTH_MONTH_SELECTORS,
  AGE_GATE_BIRTH_YEAR_SELECTORS,
  AGE_GATE_NAME_SELECTORS,
  CODEX_CONSENT_SUBMIT_SELECTORS,
  CODEX_ORGANIZATION_SUBMIT_SELECTORS,
  CODEX_WORKSPACE_SUBMIT_SELECTORS,
  CHATGPT_ENTRY_LOGIN_URL,
  CHATGPT_LOGIN_URL,
  CHATGPT_CHECKOUT_PAYMENT_METHOD_SELECTORS,
  CHATGPT_CHECKOUT_SUBSCRIBE_SELECTORS,
  CHATGPT_GOPAY_PRICING_REGION,
  CHATGPT_TRIAL_CHECKOUT_URL,
  COMPLETE_ACCOUNT_SELECTORS,
  LOGIN_CONTINUE_SELECTORS,
  LOGIN_EMAIL_SELECTORS,
  LOGIN_ENTRY_SELECTORS,
  ONBOARDING_ACTION_CANDIDATES,
  PASSWORD_SUBMIT_SELECTORS,
  PASSWORD_TIMEOUT_RETRY_SELECTORS,
  buildChatGPTTrialCheckoutPayload,
  buildChatGPTTrialCheckoutUrl,
  buildProfileName,
  buildChatGPTTrialPricingPromoUrl,
  getChatGPTTrialPricingFreeTrialSelectors,
  getChatGPTTrialPricingPlanToggleSelectors,
  REGISTRATION_CONTINUE_SELECTORS,
  REGISTRATION_EMAIL_SELECTORS,
  SIGNUP_ENTRY_SELECTORS,
  CHATGPT_HOME_URL,
  type ChatGPTTrialCheckoutPayload,
  type ChatGPTTrialPromoCoupon,
  type ChatGPTTrialPaymentMethod,
} from './common'
import type { SelectorTarget } from '../../types'
import { toLocator } from '../../utils/selectors'
import {
  type ChatGPTPostEmailLoginStep,
  hasPasswordTimeoutErrorState,
  isCodexConsentReady,
  isCodexOrganizationPickerReady,
  isCodexWorkspacePickerReady,
  isLocatorEnabled,
  isOpenAIWorkspacePickerReady,
  throwIfChatGPTAccountDeactivated,
  waitForAnySelectorState,
  waitForChatGPTCheckoutReady,
  waitForChatGPTCheckoutSubscribeReady,
  waitForEnabledSelector,
  waitForEditableSelector,
  waitForLoginEmailFormReady,
  waitForLoginEmailSubmissionOutcome,
  waitForPasswordInputReady,
  waitForPasswordSubmissionOutcome,
  waitForPostEmailLoginStep,
  waitForTrialPricingFreeTrialReady,
  waitForVerificationCode,
  waitForVerificationCodeInputReady,
} from './queries'

const AUTH_INPUT_TYPING_OPTIONS = {
  settleMs: 500,
  strategy: 'sequential',
} as const
const STRIPE_ADDRESS_FRAME_URL_PATTERN = /elements-inner-address/i
const STRIPE_PAYMENT_FRAME_URL_PATTERN = /elements-inner-payment/i
const STRIPE_ADDRESS_FIELD_SELECTORS = [
  'input[name="billingName"]',
  'input[name="billing_details[name]"]',
  'input[name="addressLine1"]',
  'input[name="line1"]',
  'input[name="address_line1"]',
  'input[name="address-line1"]',
  'input[autocomplete*="address-line1" i]',
  'input[name="locality"]',
  'input[name="city"]',
  'input[autocomplete*="address-level2" i]',
  'input[name="postalCode"]',
  'input[name="postal_code"]',
  'input[autocomplete*="postal-code" i]',
  'select[name="country"]',
] as const
const PAYPAL_HOST_PATTERN = /(^|\.)paypal\.com$/i
const MIDTRANS_HOST_PATTERN = /^app\.midtrans\.com$/i
const GOPAY_MIDTRANS_REDIRECT_PATH_PATTERN =
  /^\/snap\/v\d+\/redirection\/[^/]+$/i
const GOPAY_MIDTRANS_REDIRECT_HASH_PATTERN =
  /^#\/gopay-tokenization\/linking(?:[/?#].*)?$/i
const PAYMENT_CAPTURE_POLL_MS = 250
const PAYMENT_METHOD_POLL_MS = 250
const PAYMENT_METHOD_SETTLE_MS = 1500
const GOPAY_AUTHORIZATION_TIMEOUT_MS = 180000
const GOPAY_LINKING_RESPONSE_PATTERN =
  /\/snap\/v\d+\/accounts\/[^/]+\/linking$/i
const GOPAY_AUTHORIZATION_HOST_PATTERN = /(^|\.)gopayapi\.com$/i
const GOPAY_AUTHORIZATION_CONSENT_SETTLE_MS = 500
const GOPAY_PIN_LENGTH = 6
const PAYMENT_METHOD_LABEL_PATTERNS = {
  paypal: /paypal/i,
  gopay: /go\s*pay|gopay/i,
} as const satisfies Record<ChatGPTTrialPaymentMethod, RegExp>
const PAYMENT_METHOD_TEXT_LABELS = {
  paypal: 'PayPal',
  gopay: 'GoPay',
} as const satisfies Record<ChatGPTTrialPaymentMethod, string>
const PAYMENT_METHOD_ACTIVE_STATE_SELECTORS = [
  '[aria-selected="true"]',
  '[aria-checked="true"]',
  '[aria-pressed="true"]',
  '[data-state="active"]',
  '[data-state="checked"]',
  '[data-state="selected"]',
  '[data-state="on"]',
  '[data-selected="true"]',
  ':checked',
] as const
const PAYMENT_METHOD_SELECTION_STATE_SELECTORS = [
  '[aria-selected]',
  '[aria-checked]',
  '[aria-pressed]',
  '[data-state]',
  '[data-selected]',
  ':checked',
] as const
const CHATGPT_CHECKOUT_SELECTED_PAYMENT_METHOD_SELECTORS = {
  paypal: buildPaymentMethodStateSelectors(
    'paypal',
    PAYMENT_METHOD_ACTIVE_STATE_SELECTORS,
  ),
  gopay: buildPaymentMethodStateSelectors(
    'gopay',
    PAYMENT_METHOD_ACTIVE_STATE_SELECTORS,
  ),
} as const satisfies Record<ChatGPTTrialPaymentMethod, readonly string[]>
const CHATGPT_CHECKOUT_PAYMENT_METHOD_SELECTION_STATE_SELECTORS = [
  ...buildPaymentMethodStateSelectors(
    'paypal',
    PAYMENT_METHOD_SELECTION_STATE_SELECTORS,
  ),
  ...buildPaymentMethodStateSelectors(
    'gopay',
    PAYMENT_METHOD_SELECTION_STATE_SELECTORS,
  ),
  '[role="tab"][value="card" i][aria-selected]',
  '[role="tab"][value*="card" i][data-state]',
  '[role="tab"][data-testid="card" i][aria-selected]',
  '[role="tab"][data-testid*="card" i][data-state]',
  'button#paypal-tab[aria-selected]',
  'button#gopay-tab[aria-selected]',
  'button#card-tab[aria-selected]',
  'button#card-tab[data-state]',
  '[role="tab"][aria-selected]',
  '[role="tab"][data-state]',
  '[role="radio"][aria-checked]',
  '[role="radio"][data-state]',
  'button[aria-pressed]',
  'button[data-state]',
  'input[type="radio"]',
] as const

function buildPaymentMethodStateSelectors(
  paymentMethod: ChatGPTTrialPaymentMethod,
  stateSelectors: readonly string[],
): string[] {
  const labelText = PAYMENT_METHOD_TEXT_LABELS[paymentMethod]
  const selectors = new Set<string>()

  for (const methodSelector of CHATGPT_CHECKOUT_PAYMENT_METHOD_SELECTORS[
    paymentMethod
  ]) {
    for (const stateSelector of stateSelectors) {
      selectors.add(`${methodSelector}${stateSelector}`)
    }
  }

  for (const stateSelector of stateSelectors) {
    if (stateSelector === ':checked') continue

    selectors.add(`[role="radio"]${stateSelector}:has-text("${labelText}")`)
    selectors.add(`[role="tab"]${stateSelector}:has-text("${labelText}")`)
    selectors.add(`button${stateSelector}:has-text("${labelText}")`)
  }

  return [...selectors]
}

type CheckoutLocatorScope = Page | Frame

export interface OpenAIWorkspaceSelectionResult {
  availableWorkspaces: number
  selectedWorkspaceIndex: number
  selectedWorkspaceId?: string
  selectionStrategy: 'index' | 'workspace_id'
}

interface WorkspaceIdControlSelection extends OpenAIWorkspaceSelectionResult {
  status: 'selected' | 'out_of_range' | 'missing'
  submitKind?: 'selected-button'
}

type CodexWorkspaceSelectionResult = OpenAIWorkspaceSelectionResult

interface CodexOrganizationSelectionResult {
  availableOrganizations: number
  selectedOrganizationIndex: number
  availableProjects: number
  selectedProjectIndex: number
}

interface NamedSelectionResult {
  availableOptions: number
  selectedOptionIndex: number
  status: 'selected' | 'out_of_range' | 'missing'
}

export interface ChatGPTTeamTrialBillingAddress {
  name?: string
  country: string
  line1: string
  line2?: string
  city?: string
  state?: string
  postalCode: string
}

export interface PaypalBillingAgreementLink {
  url: string
  paymentMethod: 'paypal'
  baToken: string
  tokenParam: 'ba_token' | 'token'
  capturedAt: string
}

export interface GoPayPaymentRedirectLink {
  url: string
  paymentMethod: 'gopay'
  redirectId?: string
  capturedAt: string
}

export type ChatGPTCheckoutPaymentLink =
  | PaypalBillingAgreementLink
  | GoPayPaymentRedirectLink

export type GoPayPaymentContinuationStatus =
  | 'payment-page-ready'
  | 'otp-required'
  | 'pin-required'
  | 'pay-now-clicked'

export interface GoPayAuthorizationOpenInput {
  redirectUrl: string
  activationLinkUrl: string
  accountStatus?: string
  statusCode?: string
}

export interface GoPayAuthorizationOtpCodeInput {
  redirectUrl: string
  activationLinkUrl?: string
  startedAt: string
  timeoutMs: number
}

export type GoPayAuthorizationOtpCodeProvider = (
  input: GoPayAuthorizationOtpCodeInput,
) => Promise<string | undefined> | string | undefined

export interface GoPayAccountLinkingOptions {
  countryCode?: string
  phoneNumber?: string
  pin?: string
  authorizationTimeoutMs?: number
  beforeAuthorizationOpen?: (
    input: GoPayAuthorizationOpenInput,
  ) => Promise<void> | void
  waitForOtpCode?: GoPayAuthorizationOtpCodeProvider
}

export interface GoPayPaymentContinuationProgress {
  step:
    | 'redirect-opened'
    | 'phone-submitted'
    | 'authorization-opened'
    | 'authorization-consented'
    | 'otp-requested'
    | 'otp-submitted'
    | 'pin-submitted'
    | 'payment-page-ready'
    | 'pay-now-clicked'
  url?: string
  activationLinkUrl?: string
}

export interface GoPayPaymentContinuationResult {
  paymentMethod: 'gopay'
  redirectUrl: string
  finalUrl: string
  title: string
  status: GoPayPaymentContinuationStatus
  activationLinkUrl?: string
  accountStatus?: string
  statusCode?: string
  authorizationConsentClicked: boolean
  otpSubmitted: boolean
  pinSubmitted: boolean
  payNowClicked: boolean
}

export async function clickSignupEntry(page: Page): Promise<void> {
  await clickAny(page, SIGNUP_ENTRY_SELECTORS)
}

export async function gotoLoginEntry(page: Page): Promise<void> {
  await page.goto(CHATGPT_ENTRY_LOGIN_URL, { waitUntil: 'domcontentloaded' })
  await page.locator('body').waitFor({ state: 'visible' })
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

export async function gotoTeamPricingPromo(page: Page): Promise<void> {
  await gotoTrialPricingPromo(page, 'team-1-month-free')
}

export async function gotoTrialPricingPromo(
  page: Page,
  coupon: ChatGPTTrialPromoCoupon,
): Promise<void> {
  await page.goto(buildChatGPTTrialPricingPromoUrl(coupon), {
    waitUntil: 'domcontentloaded',
  })
  await page.locator('body').waitFor({ state: 'visible' })
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

export async function clickTeamPricingFreeTrial(page: Page): Promise<void> {
  await clickTrialPricingFreeTrial(page, 'team-1-month-free')
}

export async function selectChatGPTTrialPricingPlanIfPresent(
  page: Page,
  coupon: ChatGPTTrialPromoCoupon,
  options: {
    timeoutMs?: number
  } = {},
): Promise<boolean> {
  const selectors = getChatGPTTrialPricingPlanToggleSelectors(coupon)
  const deadline = Date.now() + Math.max(0, options.timeoutMs ?? 10000)

  do {
    const clicked = await clickVisiblePricingPlanToggleIfNeeded(page, selectors)
    if (clicked != null) return clicked

    if (await waitForTrialPricingFreeTrialReady(page, coupon, 0)) return false

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    await sleep(Math.min(250, remainingMs))
  } while (Date.now() <= deadline)

  return false
}

export async function clickTrialPricingFreeTrial(
  page: Page,
  coupon: ChatGPTTrialPromoCoupon,
): Promise<void> {
  await selectChatGPTTrialPricingPlanIfPresent(page, coupon)
  const ready = await waitForTrialPricingFreeTrialReady(page, coupon, 30000)
  if (!ready) {
    throw new Error('ChatGPT pricing free trial button did not become ready.')
  }

  await clickAny(page, getChatGPTTrialPricingFreeTrialSelectors(coupon))
  await page.waitForLoadState('domcontentloaded').catch(() => undefined)
}

export interface ChatGPTTrialCheckoutLink {
  url: string
  checkoutSessionId: string
  processorEntity: string
  payload: ChatGPTTrialCheckoutPayload
}

interface ChatGPTTrialCheckoutApiResult {
  ok: boolean
  status: number
  url: string
  text: string
  data?: unknown
  error?: string
}

export async function createChatGPTTrialCheckoutLink(
  page: Page,
  coupon: ChatGPTTrialPromoCoupon,
  options: {
    paymentMethod?: ChatGPTTrialPaymentMethod
  } = {},
): Promise<ChatGPTTrialCheckoutLink> {
  const payload = buildChatGPTTrialCheckoutPayload(coupon, {
    paymentMethod: options.paymentMethod,
  })
  const result = await page.evaluate(
    async ({ checkoutUrl, payload }) => {
      function parseJson(text: string): unknown {
        try {
          return text ? JSON.parse(text) : undefined
        } catch {
          return undefined
        }
      }

      function getStringField(value: unknown, key: string): string | undefined {
        if (!value || typeof value !== 'object') {
          return undefined
        }

        const field = (value as Record<string, unknown>)[key]
        return typeof field === 'string' ? field : undefined
      }

      try {
        const sessionResponse = await fetch('/api/auth/session', {
          credentials: 'include',
          cache: 'no-store',
        })
        const sessionText = await sessionResponse.text()
        const sessionData = parseJson(sessionText)
        const accessToken = getStringField(sessionData, 'accessToken')
        if (!sessionResponse.ok || !accessToken) {
          return {
            ok: false,
            status: sessionResponse.status,
            url: sessionResponse.url,
            text: sessionText,
            data: sessionData,
            error: 'ChatGPT session access token was not available.',
          }
        }

        const checkoutResponse = await fetch(checkoutUrl, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
        const checkoutText = await checkoutResponse.text()
        return {
          ok: checkoutResponse.ok,
          status: checkoutResponse.status,
          url: checkoutResponse.url,
          text: checkoutText,
          data: parseJson(checkoutText),
        }
      } catch (error) {
        return {
          ok: false,
          status: 0,
          url: checkoutUrl,
          text: '',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
    {
      checkoutUrl: CHATGPT_TRIAL_CHECKOUT_URL,
      payload,
    },
  )
  const checkoutSessionId = getCheckoutSessionId(result.data)
  const processorEntity = getCheckoutProcessorEntity(result.data)
  if (!result.ok || !checkoutSessionId || !processorEntity) {
    throw new Error(formatCheckoutLinkError(result))
  }

  return {
    url: buildChatGPTTrialCheckoutUrl(checkoutSessionId, processorEntity),
    checkoutSessionId,
    processorEntity,
    payload,
  }
}

export async function gotoChatGPTTrialCheckout(
  page: Page,
  coupon: ChatGPTTrialPromoCoupon,
  options: {
    paymentMethod?: ChatGPTTrialPaymentMethod
  } = {},
): Promise<ChatGPTTrialCheckoutLink> {
  const checkout = await createChatGPTTrialCheckoutLink(page, coupon, options)
  await page.goto(checkout.url, { waitUntil: 'domcontentloaded' })
  await page.locator('body').waitFor({ state: 'visible' })
  await page.waitForLoadState('networkidle').catch(() => undefined)
  return checkout
}

function getCheckoutSessionId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const checkoutSessionId = (value as Record<string, unknown>)[
    'checkout_session_id'
  ]
  return typeof checkoutSessionId === 'string' && checkoutSessionId.trim()
    ? checkoutSessionId.trim()
    : undefined
}

function getCheckoutProcessorEntity(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const processorEntity = (value as Record<string, unknown>)['processor_entity']
  return typeof processorEntity === 'string' && processorEntity.trim()
    ? processorEntity.trim()
    : undefined
}

function formatCheckoutLinkError(
  result: ChatGPTTrialCheckoutApiResult,
): string {
  const detail = getCheckoutErrorDetail(result.data)
  const suffix =
    detail || result.error || result.text.slice(0, 500).trim() || 'no response'
  return `ChatGPT trial checkout link could not be generated (HTTP ${result.status}): ${suffix}`
}

function getCheckoutErrorDetail(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  for (const key of ['detail', 'error', 'message']) {
    const field = record[key]
    if (typeof field === 'string' && field.trim()) {
      return field.trim()
    }
  }

  return undefined
}

export async function selectChatGPTPricingRegion(
  page: Page,
  country: string = CHATGPT_GOPAY_PRICING_REGION,
  options: {
    timeoutMs?: number
  } = {},
): Promise<boolean> {
  const countryCode = country.trim().toUpperCase()
  const targetPattern = getPricingRegionOptionPattern(countryCode)
  if (!targetPattern) {
    throw new Error(`Unsupported ChatGPT pricing region: ${country}.`)
  }

  const timeoutMs = Math.max(0, options.timeoutMs ?? 15000)
  const deadline = Date.now() + timeoutMs

  do {
    if (await isChatGPTPricingRegionSelected(page, countryCode)) {
      return true
    }

    for (const locator of getChatGPTPricingRegionComboboxLocators(page)) {
      const count = await locator.count().catch(() => 0)
      const limit = Math.min(count, 5)
      for (let index = 0; index < limit; index += 1) {
        const candidate = locator.nth(index)
        const visible = await candidate.isVisible().catch(() => false)
        if (!visible) continue

        await candidate.scrollIntoViewIfNeeded().catch(() => undefined)
        const opened = await candidate
          .click()
          .then(() => true)
          .catch(() => false)
        if (!opened) continue

        await sleep(250)
        if (await clickChatGPTPricingRegionOption(page, targetPattern)) {
          await page.waitForLoadState('networkidle').catch(() => undefined)
          await sleep(500)
          return isChatGPTPricingRegionSelected(page, countryCode)
        }
        if (
          await selectChatGPTPricingRegionOptionWithKeyboard(page, countryCode)
        ) {
          return true
        }
        if (
          await scrollAndClickChatGPTPricingRegionOption(page, targetPattern)
        ) {
          await page.waitForLoadState('networkidle').catch(() => undefined)
          await sleep(500)
          return isChatGPTPricingRegionSelected(page, countryCode)
        }

        await page.keyboard.press('Escape').catch(() => undefined)
      }
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    await sleep(Math.min(250, remainingMs))
  } while (Date.now() <= deadline)

  return isChatGPTPricingRegionSelected(page, countryCode)
}

function getPricingRegionOptionPattern(
  countryCode: string,
): RegExp | undefined {
  if (countryCode === CHATGPT_GOPAY_PRICING_REGION) {
    return /^(?:印度尼西亚|印尼|Indonesia)$/i
  }

  return undefined
}

function getPricingRegionSelectedPattern(
  countryCode: string,
): RegExp | undefined {
  if (countryCode === CHATGPT_GOPAY_PRICING_REGION) {
    return /印度尼西亚|印尼|Indonesia/i
  }

  return undefined
}

function getChatGPTPricingRegionComboboxLocators(page: Page): Locator[] {
  const likelyRegionText =
    /美国|美國|United States|USA|US|印度尼西亚|印尼|Indonesia|国家|國家|地区|地區|country|region/i

  return [
    page.getByRole('combobox', { name: likelyRegionText }),
    page
      .locator('button[role="combobox"]')
      .filter({ hasText: likelyRegionText }),
    page.locator('[role="combobox"]').filter({ hasText: likelyRegionText }),
    page
      .locator(
        'button[aria-haspopup="listbox"], button[aria-controls^="radix-"]',
      )
      .filter({ hasText: likelyRegionText }),
  ]
}

async function clickChatGPTPricingRegionOption(
  page: Page,
  targetPattern: RegExp,
): Promise<boolean> {
  for (const locator of [
    page.getByRole('option', { name: targetPattern }),
    page.locator('[role="option"]').filter({ hasText: targetPattern }),
    page.locator('[data-radix-collection-item]').filter({
      hasText: targetPattern,
    }),
    page.getByText(targetPattern),
  ]) {
    const count = await locator.count().catch(() => 0)
    const limit = Math.min(count, 5)
    for (let index = 0; index < limit; index += 1) {
      const candidate = locator.nth(index)
      const visible = await candidate.isVisible().catch(() => false)
      if (!visible) continue

      await candidate.scrollIntoViewIfNeeded().catch(() => undefined)
      const clicked = await candidate
        .click()
        .then(() => true)
        .catch(() => false)
      if (clicked) {
        return true
      }
    }
  }

  return false
}

async function selectChatGPTPricingRegionOptionWithKeyboard(
  page: Page,
  countryCode: string,
): Promise<boolean> {
  const typeahead = getPricingRegionTypeaheadText(countryCode)
  if (!typeahead) {
    return false
  }

  await page.keyboard.type(typeahead, { delay: 20 }).catch(() => undefined)
  await sleep(250)
  await page.keyboard.press('Enter').catch(() => undefined)
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await sleep(500)

  return isChatGPTPricingRegionSelected(page, countryCode)
}

function getPricingRegionTypeaheadText(
  countryCode: string,
): string | undefined {
  if (countryCode === CHATGPT_GOPAY_PRICING_REGION) {
    return 'Indonesia'
  }

  return undefined
}

async function scrollAndClickChatGPTPricingRegionOption(
  page: Page,
  targetPattern: RegExp,
): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await clickChatGPTPricingRegionOption(page, targetPattern)) {
      return true
    }

    const scrolled = await scrollOpenPricingRegionList(page)
    if (!scrolled) {
      await page.keyboard.press('PageDown').catch(() => undefined)
    }
    await sleep(150)
  }

  return clickChatGPTPricingRegionOption(page, targetPattern)
}

async function scrollOpenPricingRegionList(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      function isVisible(element: Element | null): element is HTMLElement {
        if (!(element instanceof HTMLElement)) return false
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return (
          element.isConnected &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || '1') > 0 &&
          rect.width > 0 &&
          rect.height > 0
        )
      }

      const optionSelector = '[role="option"], [data-radix-collection-item]'
      const preferredContainers = Array.from(
        document.querySelectorAll<HTMLElement>(
          [
            '[role="listbox"]',
            '[data-radix-select-content]',
            '[data-radix-select-viewport]',
            '[data-radix-popper-content-wrapper]',
          ].join(','),
        ),
      )
      const scrollableContainers = Array.from(
        document.querySelectorAll<HTMLElement>('*'),
      ).filter(
        (element) =>
          isVisible(element) &&
          element.scrollHeight > element.clientHeight + 4 &&
          (element.querySelector(optionSelector) ||
            preferredContainers.some((container) =>
              element.contains(container),
            )),
      )
      const containers = [...preferredContainers, ...scrollableContainers]

      for (const container of containers) {
        if (
          !isVisible(container) ||
          container.scrollHeight <= container.clientHeight + 4
        ) {
          continue
        }

        const before = container.scrollTop
        const step = Math.max(120, Math.floor(container.clientHeight * 0.8))
        container.scrollTop = Math.min(
          before + step,
          container.scrollHeight - container.clientHeight,
        )
        container.dispatchEvent(new Event('scroll', { bubbles: true }))

        if (container.scrollTop !== before) {
          return true
        }
      }

      return false
    })
    .catch(() => false)
}

async function isChatGPTPricingRegionSelected(
  page: Page,
  countryCode: string,
): Promise<boolean> {
  const selectedPattern = getPricingRegionSelectedPattern(countryCode)
  if (!selectedPattern) {
    return false
  }

  for (const locator of getChatGPTPricingRegionComboboxLocators(page)) {
    const count = await locator.count().catch(() => 0)
    const limit = Math.min(count, 5)
    for (let index = 0; index < limit; index += 1) {
      const candidate = locator.nth(index)
      const visible = await candidate.isVisible().catch(() => false)
      if (!visible) continue

      const text = await candidate.textContent().catch(() => '')
      if (selectedPattern.test(text || '')) {
        return true
      }
    }
  }

  return false
}

async function isPricingPlanToggleSelected(locator: Locator): Promise<boolean> {
  return locator
    .evaluate((element) => {
      const htmlElement = element as HTMLElement
      return (
        htmlElement.getAttribute('aria-checked') === 'true' ||
        htmlElement.getAttribute('aria-selected') === 'true' ||
        htmlElement.getAttribute('aria-pressed') === 'true' ||
        htmlElement.getAttribute('data-state') === 'on'
      )
    })
    .catch(() => false)
}

async function clickVisiblePricingPlanToggleIfNeeded(
  page: Page,
  selectors: SelectorTarget[],
): Promise<boolean | null> {
  for (const selector of selectors) {
    const locator = toLocator(page, selector).first()
    const visible = await locator.isVisible().catch(() => false)
    if (!visible) continue
    if (await isPricingPlanToggleSelected(locator)) return false
    if (!(await isLocatorEnabled(locator))) continue

    await locator.click()
    await page.waitForLoadState('domcontentloaded').catch(() => undefined)
    await sleep(500)
    return true
  }

  return null
}

export async function fillChatGPTCheckoutBillingAddress(
  page: Page,
  address: ChatGPTTeamTrialBillingAddress,
): Promise<void> {
  const checkoutReady = await waitForChatGPTCheckoutReady(page, 60000)
  if (!checkoutReady) {
    throw new Error('ChatGPT trial checkout did not become ready.')
  }

  const frame = await waitForStripeBillingAddressFrame(page, 30000)
  if (!frame) {
    throw new Error('ChatGPT checkout billing address frame was not visible.')
  }

  const fillResult = await fillStripeBillingAddressFrame(frame, address)
  const missingRequired = [
    address.name && !fillResult.name ? 'billing name' : undefined,
    fillResult.country ? undefined : 'country',
    fillResult.line1 ? undefined : 'address line 1',
    address.line2 && !fillResult.line2 ? 'address line 2' : undefined,
    address.city && isBillingCityRequired(address.country) && !fillResult.city
      ? 'city'
      : undefined,
    fillResult.postalCode ? undefined : 'postal code',
    isBillingStateRequired(address.country) && !fillResult.state
      ? 'state/province'
      : undefined,
  ].filter((field): field is string => Boolean(field))

  if (missingRequired.length > 0) {
    throw new Error(
      `ChatGPT checkout billing address could not fill: ${missingRequired.join(', ')}.`,
    )
  }

  await sleep(500)
}

export async function clickChatGPTCheckoutSubscribeAndCapturePaypalLink(
  page: Page,
  options: {
    timeoutMs?: number
  } = {},
): Promise<PaypalBillingAgreementLink> {
  return clickChatGPTCheckoutSubscribeAndCapturePaymentLink(page, {
    ...options,
    paymentMethod: 'paypal',
  }) as Promise<PaypalBillingAgreementLink>
}

export async function clickChatGPTCheckoutSubscribeAndCapturePaymentLink(
  page: Page,
  options: {
    paymentMethod: ChatGPTTrialPaymentMethod
    timeoutMs?: number
  },
): Promise<ChatGPTCheckoutPaymentLink> {
  const paymentMethod = options.paymentMethod
  const timeoutMs = Math.max(1, options.timeoutMs ?? 90000)
  const deadline = Date.now() + timeoutMs
  const capture = createCheckoutPaymentLinkCapture(page, paymentMethod)

  try {
    await selectChatGPTCheckoutPaymentMethodIfPresent(page, paymentMethod, {
      timeoutMs: Math.min(10000, timeoutMs),
    })

    let clickAttempt = 0
    while (Date.now() < deadline) {
      const existing = capture.get()
      if (existing) {
        return existing
      }

      const remainingMs = Math.max(1, deadline - Date.now())
      const ready = await waitForChatGPTCheckoutSubscribeReady(
        page,
        Math.min(10000, remainingMs),
      )
      if (!ready) {
        await selectChatGPTCheckoutPaymentMethodIfPresent(page, paymentMethod, {
          timeoutMs: Math.min(2500, Math.max(1, deadline - Date.now())),
        })
        const observed = await capture
          .wait(Math.min(1500, Math.max(1, deadline - Date.now())))
          .catch(() => undefined)
        if (observed) return observed
        continue
      }

      const paymentMethodSelected =
        await selectChatGPTCheckoutPaymentMethodIfPresent(page, paymentMethod, {
          timeoutMs: Math.min(5000, Math.max(1, deadline - Date.now())),
        })
      if (!paymentMethodSelected) {
        const observed = await capture
          .wait(Math.min(1500, Math.max(1, deadline - Date.now())))
          .catch(() => undefined)
        if (observed) {
          return observed
        }
        continue
      }

      clickAttempt += 1
      await clickChatGPTCheckoutSubscribe(page).catch(() => undefined)
      const observed = await capture
        .wait(Math.min(5000, Math.max(1, deadline - Date.now())))
        .catch(() => undefined)
      if (observed) {
        return observed
      }

      if (clickAttempt >= 5) {
        await sleep(Math.min(1500, Math.max(1, deadline - Date.now())))
      }
    }
  } finally {
    capture.dispose()
  }

  throw new Error(
    `ChatGPT ${paymentMethod} payment redirect link was not captured.`,
  )
}

export async function continueGoPayPaymentFromRedirect(
  page: Page,
  redirect: GoPayPaymentRedirectLink,
  options: GoPayAccountLinkingOptions & {
    onProgress?: (update: GoPayPaymentContinuationProgress) => void
  } = {},
): Promise<GoPayPaymentContinuationResult> {
  const timeoutMs = Math.max(
    1,
    options.authorizationTimeoutMs ?? GOPAY_AUTHORIZATION_TIMEOUT_MS,
  )
  const deadline = Date.now() + timeoutMs
  let activationLinkUrl: string | undefined
  let accountStatus: string | undefined
  let statusCode: string | undefined
  let authorizationConsentClicked = false
  let authorizationStartedAt = new Date().toISOString()
  let otpSubmitted = false
  let pinSubmitted = false

  await page.goto(redirect.url, { waitUntil: 'domcontentloaded' })
  await page.locator('body').waitFor({ state: 'visible' })
  await page.waitForLoadState('networkidle').catch(() => undefined)
  options.onProgress?.({ step: 'redirect-opened', url: page.url() })

  await throwIfMidtransGoPayExpired(page)

  if (!(await isMidtransGoPayPaymentPageReady(page))) {
    if (!(await isMidtransGoPayPhoneInputReady(page))) {
      throw new Error(
        'GoPay tokenization page did not show a phone-number form or a linked payment account.',
      )
    }

    if (!options.phoneNumber?.trim()) {
      throw new Error(
        'GoPay tokenization requires a phone number. Set CHATGPT_TEAM_TRIAL_GOPAY_PHONE_NUMBER before running the GoPay trial flow.',
      )
    }

    const linking = await submitMidtransGoPayLinking(page, {
      countryCode: options.countryCode,
      phoneNumber: options.phoneNumber,
    })
    activationLinkUrl = linking.activationLinkUrl
    accountStatus = linking.accountStatus
    statusCode = linking.statusCode
    options.onProgress?.({
      step: 'phone-submitted',
      url: page.url(),
      activationLinkUrl,
    })

    if (!activationLinkUrl) {
      throw new Error(
        'GoPay tokenization did not return an activation link after submitting the phone number.',
      )
    }

    await options.beforeAuthorizationOpen?.({
      redirectUrl: redirect.url,
      activationLinkUrl,
      accountStatus,
      statusCode,
    })

    authorizationStartedAt = new Date().toISOString()
    await page.goto(activationLinkUrl, { waitUntil: 'domcontentloaded' })
    await page.locator('body').waitFor({ state: 'visible' })
    await page.waitForLoadState('networkidle').catch(() => undefined)
    options.onProgress?.({
      step: 'authorization-opened',
      url: page.url(),
      activationLinkUrl,
    })
  }

  if (!(await isGoPayAuthorizationPinReady(page))) {
    const consentClicked = await clickGoPayAuthorizationConsentIfPresent(page, {
      timeoutMs: Math.min(5000, Math.max(1, deadline - Date.now())),
    })
    if (consentClicked) {
      authorizationConsentClicked = true
      options.onProgress?.({
        step: 'authorization-consented',
        url: page.url(),
        activationLinkUrl,
      })
    }
  }

  if (
    !(
      (await isGoPayAuthorizationPinReady(page)) ||
      (await isMidtransGoPayPaymentPageReady(page))
    ) &&
    (await isGoPayAuthorizationOtpReady(page))
  ) {
    options.onProgress?.({
      step: 'otp-requested',
      url: page.url(),
      activationLinkUrl,
    })
    const otpCode = await options.waitForOtpCode?.({
      redirectUrl: redirect.url,
      activationLinkUrl,
      startedAt: authorizationStartedAt,
      timeoutMs: Math.max(1, deadline - Date.now()),
    })
    if (!otpCode) {
      return buildGoPayPaymentContinuationResult(page, redirect, {
        status: 'otp-required',
        activationLinkUrl,
        accountStatus,
        statusCode,
        authorizationConsentClicked,
        otpSubmitted,
        pinSubmitted,
        payNowClicked: false,
      })
    }

    otpSubmitted = await submitGoPayAuthorizationOtpIfPresent(page, otpCode)
    if (otpSubmitted) {
      options.onProgress?.({
        step: 'otp-submitted',
        url: page.url(),
        activationLinkUrl,
      })
      await page
        .waitForLoadState('networkidle', { timeout: 10000 })
        .catch(() => undefined)
      await sleep(500)
    }
  }

  if (await isGoPayAuthorizationPinReady(page)) {
    const pin = options.pin?.replace(/\D/g, '') || ''
    if (pin) {
      if (pin.length !== GOPAY_PIN_LENGTH) {
        throw new Error(
          `GoPay PIN must contain ${GOPAY_PIN_LENGTH} digits when configured.`,
        )
      }

      await fillGoPayAuthorizationPin(page, pin)
      pinSubmitted = true
      options.onProgress?.({
        step: 'pin-submitted',
        url: page.url(),
        activationLinkUrl,
      })
    }
  }

  const paymentPageReady = await waitForMidtransGoPayPaymentPageReady(
    page,
    Math.max(1, deadline - Date.now()),
  )
  if (!paymentPageReady) {
    if (await isGoPayAuthorizationPinReady(page)) {
      return buildGoPayPaymentContinuationResult(page, redirect, {
        status: 'pin-required',
        activationLinkUrl,
        accountStatus,
        statusCode,
        authorizationConsentClicked,
        otpSubmitted,
        pinSubmitted,
        payNowClicked: false,
      })
    }

    throw new Error(
      'GoPay authorization did not return to the Midtrans payment page before the timeout.',
    )
  }

  options.onProgress?.({
    step: 'payment-page-ready',
    url: page.url(),
    activationLinkUrl,
  })

  const payNowClicked = await clickMidtransGoPayPayNow(page)
  if (!payNowClicked) {
    return buildGoPayPaymentContinuationResult(page, redirect, {
      status: 'payment-page-ready',
      activationLinkUrl,
      accountStatus,
      statusCode,
      authorizationConsentClicked,
      otpSubmitted,
      pinSubmitted,
      payNowClicked: false,
    })
  }

  options.onProgress?.({
    step: 'pay-now-clicked',
    url: page.url(),
    activationLinkUrl,
  })
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await sleep(1000)

  return buildGoPayPaymentContinuationResult(page, redirect, {
    status: 'pay-now-clicked',
    activationLinkUrl,
    accountStatus,
    statusCode,
    authorizationConsentClicked,
    otpSubmitted,
    pinSubmitted,
    payNowClicked: true,
  })
}

async function submitMidtransGoPayLinking(
  page: Page,
  account: Pick<GoPayAccountLinkingOptions, 'countryCode' | 'phoneNumber'>,
): Promise<{
  activationLinkUrl?: string
  accountStatus?: string
  statusCode?: string
}> {
  if (account.countryCode?.trim()) {
    const countrySelected = await selectMidtransGoPayCountryCode(
      page,
      account.countryCode,
    )
    if (!countrySelected) {
      throw new Error(
        `GoPay tokenization country code +${normalizePhoneDigits(account.countryCode)} could not be selected.`,
      )
    }
  }

  await fillMidtransGoPayPhoneNumber(page, account.phoneNumber || '')
  const responsePromise = page
    .waitForResponse(
      (response) => {
        const request = response.request()
        try {
          return (
            request.method().toUpperCase() === 'POST' &&
            GOPAY_LINKING_RESPONSE_PATTERN.test(
              new URL(response.url()).pathname,
            )
          )
        } catch {
          return false
        }
      },
      { timeout: 30000 },
    )
    .catch(() => undefined)

  await clickMidtransGoPayLinkAndPay(page)

  const response = await responsePromise
  if (!response) {
    await page.waitForLoadState('networkidle').catch(() => undefined)
    const currentUrl = page.url()
    if (isGoPayAuthorizationUrl(currentUrl)) {
      return {
        activationLinkUrl: currentUrl,
      }
    }

    return {}
  }

  const text = await response.text().catch(() => '')
  const data = parseJsonRecord(text)
  const activationLinkUrl = readStringField(data, 'activation_link_url')
  if (!response.ok()) {
    const message =
      readStringField(data, 'status_message') ||
      readStringField(data, 'message') ||
      text.slice(0, 500).trim() ||
      `HTTP ${response.status()}`
    throw new Error(`GoPay tokenization linking failed: ${message}`)
  }

  return {
    activationLinkUrl,
    accountStatus: readStringField(data, 'account_status'),
    statusCode: readStringField(data, 'status_code'),
  }
}

async function selectMidtransGoPayCountryCode(
  page: Page,
  countryCode: string,
): Promise<boolean> {
  const normalized = normalizePhoneDigits(countryCode)
  if (!normalized) {
    return true
  }

  if (await isMidtransGoPayCountryCodeSelected(page, normalized)) {
    return true
  }

  const trigger = page.locator('.phone-code-wrapper').first()
  const triggerVisible = await trigger.isVisible().catch(() => false)
  if (!triggerVisible) {
    return false
  }

  await trigger.click().catch(() => undefined)
  await sleep(250)

  const search = page
    .locator('input[type="search"], input[placeholder*="country" i]')
    .first()
  if (await search.isVisible().catch(() => false)) {
    await search.fill(normalized).catch(() => undefined)
    await sleep(250)
  }

  const option = page
    .locator(`.country-item:has-text("(+${normalized})")`)
    .first()
  if (!(await option.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape').catch(() => undefined)
    return isMidtransGoPayCountryCodeSelected(page, normalized)
  }

  await option.click()
  await sleep(500)
  return isMidtransGoPayCountryCodeSelected(page, normalized)
}

async function isMidtransGoPayCountryCodeSelected(
  page: Page,
  countryCode: string,
): Promise<boolean> {
  const selected = await page
    .locator('.phone-code')
    .first()
    .innerText({ timeout: 1000 })
    .catch(() => '')
  return normalizePhoneDigits(selected) === countryCode
}

async function fillMidtransGoPayPhoneNumber(
  page: Page,
  phoneNumber: string,
): Promise<void> {
  const normalizedPhone = normalizePhoneDigits(phoneNumber)
  if (!normalizedPhone) {
    throw new Error('GoPay tokenization phone number is empty.')
  }

  const phoneInput = page
    .locator('.phone-number-input input[type="tel"], input[type="tel"]')
    .first()
  await phoneInput.waitFor({ state: 'visible', timeout: 10000 })
  await phoneInput.fill(normalizedPhone)
  await phoneInput.evaluate((element) => {
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await sleep(300)
}

async function clickMidtransGoPayLinkAndPay(page: Page): Promise<void> {
  const candidates = [
    page.getByRole('button', { name: /link and pay/i }),
    page.locator('button:has-text("Link and pay")'),
    page.locator('.linking-cta button'),
  ]

  for (const locator of candidates) {
    const candidate = locator.first()
    const visible = await candidate.isVisible().catch(() => false)
    if (!visible) {
      continue
    }

    const enabled = await isLocatorEnabled(candidate).catch(() => true)
    if (!enabled) {
      continue
    }

    await candidate.scrollIntoViewIfNeeded().catch(() => undefined)
    await candidate.click()
    return
  }

  throw new Error('GoPay tokenization Link and pay button was not enabled.')
}

async function clickMidtransGoPayPayNow(page: Page): Promise<boolean> {
  const candidates = [
    page.getByRole('button', { name: /pay now|bayar/i }),
    page.locator('button:has-text("Pay now")'),
    page.locator('.button-down button.primary, .button-down button.btn'),
  ]

  for (const locator of candidates) {
    const candidate = locator.first()
    const visible = await candidate.isVisible().catch(() => false)
    if (!visible) {
      continue
    }

    const enabled = await isLocatorEnabled(candidate).catch(() => true)
    if (!enabled) {
      continue
    }

    await candidate.scrollIntoViewIfNeeded().catch(() => undefined)
    await candidate.click()
    await page.waitForLoadState('domcontentloaded').catch(() => undefined)
    return true
  }

  return false
}

async function isMidtransGoPayPhoneInputReady(page: Page): Promise<boolean> {
  return page
    .locator('.phone-number-input input[type="tel"], input[type="tel"]')
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false)
}

async function isMidtransGoPayPaymentPageReady(page: Page): Promise<boolean> {
  const payNowVisible = await page
    .getByRole('button', { name: /pay now|bayar/i })
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false)
  if (payNowVisible) {
    return true
  }

  return page
    .locator('.gopay-tokenization-balance-content, .masked-phone')
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false)
}

async function waitForMidtransGoPayPaymentPageReady(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs)

  do {
    await throwIfMidtransGoPayExpired(page)
    if (await isMidtransGoPayPaymentPageReady(page)) {
      return true
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      break
    }
    await sleep(Math.min(500, remainingMs))
  } while (Date.now() <= deadline)

  return isMidtransGoPayPaymentPageReady(page)
}

function getGoPayAuthorizationConsentButtonCandidates(page: Page): Locator[] {
  return [
    page.locator('button[data-testid="consent-button"]'),
    page.getByRole('button', {
      name: /hubungkan|connect|authorize|confirm|continue|lanjut/i,
    }),
    page.locator('button:has-text("Hubungkan")'),
    page.locator('button:has-text("Connect")'),
    page.locator('button:has-text("Authorize")'),
    page.locator('button:has-text("Confirm")'),
    page.locator('button:has-text("Continue")'),
    page.locator('button:has-text("Lanjut")'),
  ]
}

export async function clickGoPayAuthorizationConsentIfPresent(
  page: Page,
  options: {
    timeoutMs?: number
  } = {},
): Promise<boolean> {
  if (!isGoPayAuthorizationUrl(page.url())) {
    return false
  }

  const timeoutMs = Math.max(0, options.timeoutMs ?? 1000)
  const deadline = Date.now() + timeoutMs

  do {
    if (!isGoPayAuthorizationUrl(page.url())) {
      return false
    }

    for (const locator of getGoPayAuthorizationConsentButtonCandidates(page)) {
      const candidate = locator.first()
      const visible = await candidate.isVisible().catch(() => false)
      if (!visible) {
        continue
      }

      const enabled = await isLocatorEnabled(candidate).catch(() => true)
      if (!enabled) {
        continue
      }

      await candidate.scrollIntoViewIfNeeded().catch(() => undefined)
      await candidate.click()
      await page
        .waitForLoadState('domcontentloaded', { timeout: 10000 })
        .catch(() => undefined)
      await page
        .waitForLoadState('networkidle', { timeout: 10000 })
        .catch(() => undefined)
      await sleep(GOPAY_AUTHORIZATION_CONSENT_SETTLE_MS)
      return true
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      break
    }
    await sleep(Math.min(250, remainingMs))
  } while (Date.now() <= deadline)

  return false
}

function getGoPayAuthorizationOtpInput(page: Page): Locator {
  return page
    .locator(
      [
        'input[data-testid="pin-input-field"]',
        'input[inputmode="numeric"][pattern="\\d{6}"]',
        'input[inputmode="numeric"][placeholder*="•"]',
      ].join(', '),
    )
    .first()
}

async function isGoPayAuthorizationOtpReady(page: Page): Promise<boolean> {
  if (!isGoPayAuthorizationUrl(page.url())) {
    return false
  }

  const input = getGoPayAuthorizationOtpInput(page)
  const inputVisible = await input
    .isVisible({ timeout: 1000 })
    .catch(() => false)
  if (!inputVisible) {
    return false
  }

  const bodyText = await page
    .locator('body')
    .innerText({ timeout: 1000 })
    .catch(() => '')
  return /otp|whats\s*app|whatsapp|kode/i.test(bodyText)
}

async function fillGoPayAuthorizationOtp(
  page: Page,
  code: string,
): Promise<void> {
  const input = getGoPayAuthorizationOtpInput(page)
  await input.waitFor({ state: 'visible', timeout: 10000 })
  await input.fill(code)
  await input.evaluate((element) => {
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.keyboard.press('Enter').catch(() => undefined)
  await sleep(500)
}

export async function submitGoPayAuthorizationOtpIfPresent(
  page: Page,
  code: string,
): Promise<boolean> {
  if (!(await isGoPayAuthorizationOtpReady(page))) {
    return false
  }

  const normalizedOtpCode = normalizePhoneDigits(code)
  if (normalizedOtpCode.length !== GOPAY_PIN_LENGTH) {
    throw new Error(
      `GoPay WhatsApp OTP must contain ${GOPAY_PIN_LENGTH} digits when provided by Codey app.`,
    )
  }

  await fillGoPayAuthorizationOtp(page, normalizedOtpCode)
  return true
}

async function isGoPayAuthorizationPinReady(page: Page): Promise<boolean> {
  if (!isGoPayAuthorizationUrl(page.url())) {
    return false
  }

  const inputs = page.locator(
    '[data-testid^="pin-input-"], input[inputmode="numeric"][maxlength="1"]',
  )
  const count = await inputs.count().catch(() => 0)
  if (count >= GOPAY_PIN_LENGTH) {
    return true
  }

  return page
    .getByText(/6 digit PIN|PIN kamu|pin/i)
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false)
}

async function fillGoPayAuthorizationPin(
  page: Page,
  pin: string,
): Promise<void> {
  const inputs = page.locator(
    '[data-testid^="pin-input-"], input[inputmode="numeric"][maxlength="1"]',
  )
  const count = await inputs.count().catch(() => 0)
  if (count >= GOPAY_PIN_LENGTH) {
    for (let index = 0; index < GOPAY_PIN_LENGTH; index += 1) {
      const input = inputs.nth(index)
      await input.fill(pin[index])
      await sleep(50)
    }
    return
  }

  await page.keyboard.type(pin, { delay: 50 })
}

async function throwIfMidtransGoPayExpired(page: Page): Promise<void> {
  const bodyText = await page
    .locator('body')
    .innerText({ timeout: 1000 })
    .catch(() => '')
  if (
    /transaction has expired|payment on time|transaksi.*(?:kedaluwarsa|expired)/i.test(
      bodyText,
    )
  ) {
    throw new Error(
      'GoPay Midtrans payment link has expired; create a fresh ChatGPT trial checkout link and retry.',
    )
  }
}

async function buildGoPayPaymentContinuationResult(
  page: Page,
  redirect: GoPayPaymentRedirectLink,
  input: {
    status: GoPayPaymentContinuationStatus
    activationLinkUrl?: string
    accountStatus?: string
    statusCode?: string
    authorizationConsentClicked: boolean
    otpSubmitted: boolean
    pinSubmitted: boolean
    payNowClicked: boolean
  },
): Promise<GoPayPaymentContinuationResult> {
  const title = await page.title().catch(() => '')
  return {
    paymentMethod: 'gopay',
    redirectUrl: redirect.url,
    finalUrl: page.url(),
    title,
    status: input.status,
    ...(input.activationLinkUrl
      ? { activationLinkUrl: input.activationLinkUrl }
      : {}),
    ...(input.accountStatus ? { accountStatus: input.accountStatus } : {}),
    ...(input.statusCode ? { statusCode: input.statusCode } : {}),
    authorizationConsentClicked: input.authorizationConsentClicked,
    otpSubmitted: input.otpSubmitted,
    pinSubmitted: input.pinSubmitted,
    payNowClicked: input.payNowClicked,
  }
}

function isGoPayAuthorizationUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (
      parsed.protocol === 'https:' &&
      GOPAY_AUTHORIZATION_HOST_PATTERN.test(parsed.hostname)
    )
  } catch {
    return false
  }
}

function normalizePhoneDigits(value: string | undefined): string {
  return value?.replace(/\D/g, '') || ''
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = value ? JSON.parse(value) : undefined
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function readStringField(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const field = value?.[key]
  return typeof field === 'string' && field.trim() ? field.trim() : undefined
}

async function waitForStripeBillingAddressFrame(
  page: Page,
  timeoutMs: number,
): Promise<Frame | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs)

  do {
    for (const frame of page.frames()) {
      if (await isStripeBillingAddressFrameReady(frame)) {
        return frame
      }
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    await sleep(Math.min(250, remainingMs))
  } while (Date.now() <= deadline)

  return null
}

async function isStripeBillingAddressFrameReady(
  frame: Frame,
): Promise<boolean> {
  const frameUrl = frame.url()
  const looksLikeAddressFrame = STRIPE_ADDRESS_FRAME_URL_PATTERN.test(frameUrl)
  if (!looksLikeAddressFrame && frame.parentFrame() === null) {
    return false
  }

  for (const selector of STRIPE_ADDRESS_FIELD_SELECTORS) {
    const count = await frame
      .locator(selector)
      .count()
      .catch(() => 0)
    if (count > 0) {
      return looksLikeAddressFrame || selector.includes('address')
    }
  }

  return false
}

async function fillStripeBillingAddressFrame(
  frame: Frame,
  address: ChatGPTTeamTrialBillingAddress,
): Promise<Record<keyof ChatGPTTeamTrialBillingAddress, boolean>> {
  return frame.evaluate(async (input) => {
    type BillingField =
      | 'name'
      | 'country'
      | 'line1'
      | 'line2'
      | 'city'
      | 'state'
      | 'postalCode'

    const FIELD_WAIT_MS = 3000
    const SHORT_FIELD_WAIT_MS = 750
    const FIELD_SETTLE_MS = 200
    const FIELD_EXPAND_WAIT_MS = 600

    const fieldSelectors: Record<BillingField, string[]> = {
      name: [
        'input[name="billingName"]',
        'input[name="billing_details[name]"]',
        'input[name="billing_details[name]" i]',
        'input[name="name"]',
        'input[name="fullName"]',
        'input[name="full_name"]',
        'input[autocomplete*="name" i]',
        'input[id*="name" i]',
        'input[id*="fullName" i]',
        'input[aria-label*="全名" i]',
        'input[aria-label*="姓名" i]',
        'input[aria-label*="full name" i]',
        'input[placeholder*="全名" i]',
        'input[placeholder*="姓名" i]',
        'input[placeholder*="full name" i]',
      ],
      country: [
        'select[name="country"]',
        'select[name="billingCountry"]',
        'select[name="billing_details[address][country]"]',
        'select[name="billing_details[address][country]" i]',
        'select[id*="country" i]',
        'select[autocomplete*="country" i]',
        'input[name="country"]',
        'input[name="billingCountry"]',
        'input[name="billing_details[address][country]"]',
        'input[name="billing_details[address][country]" i]',
        'input[autocomplete*="country" i]',
        '[role="combobox"][aria-label*="country" i]',
        '[role="combobox"][aria-label*="国家" i]',
        '[role="combobox"][aria-label*="地区" i]',
      ],
      line1: [
        'input[name="addressLine1"]',
        'input[name="address_line1"]',
        'input[name="address-line1"]',
        'input[name="billingAddressLine1"]',
        'input[name="billing_details[address][line1]"]',
        'input[name="billing_details[address][line1]" i]',
        'input[name="line1"]',
        'input[name="address"]',
        'input[name="street"]',
        'input[autocomplete*="address-line1" i]',
        'input[autocomplete*="street-address" i]',
        'input[id*="addressLine1" i]',
        'input[id*="line1" i]',
        'input[aria-label*="地址第 1 行" i]',
        'input[aria-label*="地址第1行" i]',
        'input[aria-label*="address line 1" i]',
        'input[aria-label*="地址" i]',
        'input[aria-label*="address" i]',
        'input[placeholder*="地址第 1 行" i]',
        'input[placeholder*="地址第1行" i]',
        'input[placeholder*="address line 1" i]',
        'input[placeholder*="地址" i]',
        'input[placeholder*="address" i]',
        'textarea[aria-label*="地址" i]',
        'textarea[aria-label*="address" i]',
        'textarea[placeholder*="地址" i]',
        'textarea[placeholder*="address" i]',
      ],
      line2: [
        'input[name="addressLine2"]',
        'input[name="address_line2"]',
        'input[name="address-line2"]',
        'input[name="billingAddressLine2"]',
        'input[name="billing_details[address][line2]"]',
        'input[name="billing_details[address][line2]" i]',
        'input[name="line2"]',
        'input[autocomplete*="address-line2" i]',
        'input[id*="addressLine2" i]',
        'input[id*="address_line2" i]',
        'input[id*="address-line2" i]',
        'input[id*="line2" i]',
        'input[aria-label*="地址第 2 行" i]',
        'input[aria-label*="地址第2行" i]',
        'input[aria-label*="address line 2" i]',
        'input[aria-label*="apt" i]',
        'input[aria-label*="suite" i]',
        'input[placeholder*="地址第 2 行" i]',
        'input[placeholder*="地址第2行" i]',
        'input[placeholder*="address line 2" i]',
        'input[placeholder*="apt" i]',
        'input[placeholder*="suite" i]',
      ],
      city: [
        'input[name="locality"]',
        'input[name="addressLocality"]',
        'input[name="billingCity"]',
        'input[name="billing_details[address][city]"]',
        'input[name="billing_details[address][city]" i]',
        'input[name="city"]',
        'input[name="town"]',
        'input[autocomplete*="address-level2" i]',
        'input[id*="locality" i]',
        'input[id*="addressLocality" i]',
        'input[id*="city" i]',
        'input[id*="town" i]',
        'input[aria-label*="城市" i]',
        'input[aria-label*="city" i]',
        'input[aria-label*="town" i]',
        'input[aria-label*="suburb" i]',
        'input[placeholder*="城市" i]',
        'input[placeholder*="city" i]',
        'input[placeholder*="town" i]',
        'input[placeholder*="suburb" i]',
      ],
      state: [
        'input[name="administrativeArea"]',
        'select[name="administrativeArea"]',
        'input[name="billingState"]',
        'select[name="billingState"]',
        'input[name="billing_details[address][state]"]',
        'select[name="billing_details[address][state]"]',
        'input[name="billing_details[address][state]" i]',
        'select[name="billing_details[address][state]" i]',
        'input[name="state"]',
        'select[name="state"]',
        'input[autocomplete*="address-level1" i]',
        'select[autocomplete*="address-level1" i]',
        'input[id*="administrativeArea" i]',
        'select[id*="administrativeArea" i]',
        'input[id*="state" i]',
        'select[id*="state" i]',
        'input[aria-label*="州" i]',
        'input[aria-label*="省" i]',
        'input[aria-label*="state" i]',
        'input[placeholder*="州" i]',
        'input[placeholder*="省" i]',
        'input[placeholder*="state" i]',
      ],
      postalCode: [
        'input[name="postalCode"]',
        'input[name="postal_code"]',
        'input[name="postal-code"]',
        'input[name="billingPostalCode"]',
        'input[name="billing_details[address][postal_code]"]',
        'input[name="billing_details[address][postal_code]" i]',
        'input[name="zip"]',
        'input[autocomplete*="postal-code" i]',
        'input[id*="postalCode" i]',
        'input[id*="postal" i]',
        'input[id*="zip" i]',
        'input[aria-label*="邮编" i]',
        'input[aria-label*="邮政" i]',
        'input[aria-label*="postal" i]',
        'input[aria-label*="zip" i]',
        'input[placeholder*="邮编" i]',
        'input[placeholder*="邮政" i]',
        'input[placeholder*="postal" i]',
        'input[placeholder*="zip" i]',
      ],
    }

    const labelPatterns: Record<BillingField, RegExp[]> = {
      name: [/全名|姓名|名称|full name|name/i],
      country: [/国家|地区|country|region/i],
      line1: [/^地址$|地址.*1|address(?!.*2)|address line 1|street/i],
      line2: [/地址.*2|address.*2|address line 2|apt|suite|unit|公寓/i],
      city: [/城市|city|locality|town|suburb/i],
      state: [/州|省|state|province|administrative/i],
      postalCode: [/邮政|邮编|postal|zip/i],
    }

    const values: Record<BillingField, string | undefined> = {
      name: input.name,
      country: input.country,
      line1: input.line1,
      line2: input.line2,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
    }

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set
    const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      'value',
    )?.set

    function isVisible(element: Element | null): element is HTMLElement {
      if (!(element instanceof HTMLElement)) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        element.isConnected &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0
      )
    }

    function sleepInFrame(ms: number): Promise<void> {
      return new Promise((resolve) => {
        window.setTimeout(resolve, ms)
      })
    }

    function normalizeText(value: string | null | undefined): string {
      return value?.replace(/\s+/g, ' ').trim() || ''
    }

    function getAssociatedText(element: HTMLElement): string {
      const labelledBy = element.getAttribute('aria-labelledby')
      const ariaText = labelledBy
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent)
        .filter((text): text is string => Boolean(text))
        .join(' ')

      const explicitLabelText = element.id
        ? Array.from(document.querySelectorAll('label'))
            .filter((label) => label.getAttribute('for') === element.id)
            .map((label) => label.textContent || '')
            .join(' ')
        : ''

      return normalizeText(
        [ariaText, explicitLabelText, element.closest('label')?.textContent]
          .filter(Boolean)
          .join(' '),
      )
    }

    function getElementDescriptor(element: HTMLElement): string {
      return normalizeText(
        [
          element.tagName,
          element.getAttribute('name'),
          element.id,
          element.getAttribute('autocomplete'),
          element.getAttribute('aria-label'),
          element.getAttribute('placeholder'),
          element.getAttribute('title'),
          getAssociatedText(element),
        ]
          .filter(Boolean)
          .join(' '),
      )
    }

    function looksLikeLine2(text: string): boolean {
      return /address[-_\s]*line[-_\s]*2|addressline2|address_line2|address-line2|line[-_\s]*2|line2|地址\s*第?\s*2\s*行|地址.*2|apt|apartment|suite|unit|公寓|套房/i.test(
        text,
      )
    }

    function looksLikeLine1(text: string): boolean {
      return /address[-_\s]*line[-_\s]*1|addressline1|address_line1|address-line1|line[-_\s]*1|line1|地址\s*第?\s*1\s*行|地址.*1|street|street-address/i.test(
        text,
      )
    }

    function matchesFieldDescriptor(
      field: BillingField,
      element: HTMLElement,
    ): boolean {
      const descriptor = getElementDescriptor(element)

      if (field === 'line1') {
        return (
          !looksLikeLine2(descriptor) &&
          (looksLikeLine1(descriptor) ||
            /(^|\s)(地址|address)(\s|$)/i.test(descriptor))
        )
      }

      if (field === 'line2') {
        return looksLikeLine2(descriptor)
      }

      if (field === 'postalCode') {
        return /postal|zip|邮政|邮编/i.test(descriptor)
      }

      if (field === 'city') {
        return /city|locality|town|suburb|address-level2|城市/i.test(descriptor)
      }

      if (field === 'state') {
        return /administrative|address-level1|state|province|州|省/i.test(
          descriptor,
        )
      }

      if (field === 'country') {
        return (
          element instanceof HTMLSelectElement ||
          /country|region|国家|地区/i.test(descriptor)
        )
      }

      return /full[-_\s]*name|name|全名|姓名|名称/i.test(descriptor)
    }

    function getVisibleControls(root: ParentNode): HTMLElement[] {
      return Array.from(
        root.querySelectorAll(
          'input, select, textarea, [role="combobox"], [contenteditable="true"]',
        ),
      ).filter(isVisible)
    }

    function pickFieldControl(
      root: ParentNode,
      field: BillingField,
      allowSingleFallback = true,
    ): HTMLElement | null {
      const controls = getVisibleControls(root)
      const matched = controls.find((control) =>
        matchesFieldDescriptor(field, control),
      )
      if (matched) return matched
      if (allowSingleFallback && controls.length === 1) return controls[0]
      return null
    }

    function findByLabel(field: BillingField): HTMLElement | null {
      const patterns = labelPatterns[field]
      for (const label of Array.from(document.querySelectorAll('label'))) {
        const labelText = normalizeText(label.textContent)
        if (!patterns.some((pattern) => pattern.test(labelText))) {
          continue
        }

        const targetId = label.getAttribute('for')
        if (targetId) {
          const target = document.getElementById(targetId)
          if (isVisible(target) && matchesFieldDescriptor(field, target)) {
            return target
          }
        }

        const nested = pickFieldControl(label, field)
        if (nested) return nested

        const nearby = label.parentElement
          ? pickFieldControl(label.parentElement, field, false)
          : null
        if (nearby) return nearby
      }

      return null
    }

    function findByNearbyText(field: BillingField): HTMLElement | null {
      const patterns = labelPatterns[field]
      const textElements = Array.from(
        document.querySelectorAll('div, span, p'),
      ).filter((element) => {
        const text = normalizeText(element.textContent)
        return text && patterns.some((pattern) => pattern.test(text))
      })

      for (const element of textElements) {
        const containers = [
          element,
          element.parentElement,
          element.closest('label'),
          element.closest('div'),
        ].filter((entry): entry is HTMLElement => Boolean(entry))

        for (const container of containers) {
          const nearby = pickFieldControl(container, field, false)
          if (nearby) return nearby
        }
      }

      return null
    }

    function findField(field: BillingField): HTMLElement | null {
      for (const selector of fieldSelectors[field]) {
        const elements = Array.from(document.querySelectorAll(selector)).filter(
          isVisible,
        )
        const matched = elements.find((element) =>
          matchesFieldDescriptor(field, element),
        )
        if (matched) return matched
        if (
          field !== 'line2' &&
          elements.length === 1 &&
          (field !== 'line1' ||
            !looksLikeLine2(getElementDescriptor(elements[0])))
        ) {
          return elements[0]
        }
      }

      return findByLabel(field) || findByNearbyText(field)
    }

    async function waitForField(
      field: BillingField,
      timeoutMs = FIELD_WAIT_MS,
    ): Promise<HTMLElement | null> {
      const deadline = Date.now() + timeoutMs

      do {
        const element = findField(field)
        if (element) return element
        const remainingMs = deadline - Date.now()
        if (remainingMs <= 0) break
        await sleepInFrame(Math.min(100, remainingMs))
      } while (Date.now() <= deadline)

      return findField(field)
    }

    function dispatchValueEvents(element: HTMLElement, value: string): void {
      try {
        element.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: value,
            inputType: 'insertReplacementText',
          }),
        )
      } catch {}
      try {
        element.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: value,
            inputType: 'insertReplacementText',
          }),
        )
      } catch {
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }
      element.dispatchEvent(new Event('change', { bubbles: true }))
      element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      element.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    }

    function getCountryLabels(value: string): string[] {
      const normalized = normalizeCountry(value)
      if (normalized === 'NL') {
        return ['Netherlands', 'Nederland', '荷兰', '荷蘭']
      }
      if (normalized === 'ID') {
        return ['Indonesia', '印度尼西亚', '印尼']
      }
      if (normalized === 'SG') {
        return ['Singapore', '新加坡']
      }

      return []
    }

    function countryValueMatches(
      candidate: string | null | undefined,
      value: string,
    ): boolean {
      const normalizedCandidate = normalizeText(candidate).toLowerCase()
      if (!normalizedCandidate) return false

      const normalizedValue = normalizeCountry(value)
      if (normalizedCandidate === normalizedValue.toLowerCase()) {
        return true
      }

      return getCountryLabels(value).some(
        (label) =>
          normalizedCandidate === label.toLowerCase() ||
          normalizedCandidate.includes(label.toLowerCase()),
      )
    }

    function elementValueMatches(
      field: BillingField,
      element: HTMLElement,
      value: string,
    ): boolean {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        if (field === 'country') {
          return countryValueMatches(element.value, value)
        }

        return element.value.trim() === value.trim()
      }

      if (element.isContentEditable) {
        if (field === 'country') {
          return countryValueMatches(element.textContent, value)
        }

        return normalizeText(element.textContent) === value.trim()
      }

      if (field === 'country') {
        return (
          countryValueMatches(element.getAttribute('value'), value) ||
          countryValueMatches(element.textContent, value)
        )
      }

      return element.getAttribute('value')?.trim() === value.trim()
    }

    function normalizeCountry(value: string): string {
      return value.trim().toUpperCase()
    }

    async function selectCustomCountry(
      element: HTMLElement,
      value: string,
    ): Promise<boolean> {
      const normalized = normalizeCountry(value)
      const labels = getCountryLabels(value)
      const searchValues = [...labels, normalized]

      element.focus()
      element.click()
      await sleepInFrame(FIELD_SETTLE_MS)

      if (element instanceof HTMLInputElement && labels[0]) {
        nativeInputValueSetter?.call(element, labels[0])
        element.value = labels[0]
        dispatchValueEvents(element, labels[0])
        await sleepInFrame(FIELD_SETTLE_MS)
      }

      const options = Array.from(
        document.querySelectorAll(
          '[role="option"], [data-value], [data-radix-collection-item], option',
        ),
      ).filter(isVisible)

      const option = options.find((entry) => {
        const html = entry as HTMLElement
        const optionValue =
          html.getAttribute('value') || html.getAttribute('data-value') || ''
        const text = normalizeText(html.textContent)

        return (
          optionValue.toUpperCase() === normalized ||
          searchValues.some((label) => {
            const normalizedLabel = label.toLowerCase()
            const normalizedText = text.toLowerCase()
            return (
              normalizedText === normalizedLabel ||
              normalizedText.includes(normalizedLabel)
            )
          })
        )
      }) as HTMLElement | undefined

      if (option) {
        option.click()
        await sleepInFrame(FIELD_SETTLE_MS)
        dispatchValueEvents(element, value)
      }

      element.blur()
      return elementValueMatches('country', element, value)
    }

    async function setElementValue(
      field: BillingField,
      element: HTMLElement,
      value: string,
    ): Promise<boolean> {
      element.focus()

      if (element instanceof HTMLSelectElement) {
        const normalized = normalizeCountry(value)
        const option =
          Array.from(element.options).find(
            (entry) => entry.value.toUpperCase() === normalized,
          ) ||
          Array.from(element.options).find((entry) =>
            entry.textContent
              ?.trim()
              .toLowerCase()
              .includes(value.toLowerCase()),
          )

        const nextValue = option?.value || value
        nativeSelectValueSetter?.call(element, nextValue)
        element.value = nextValue
        dispatchValueEvents(element, nextValue)
        element.blur()
        return element.value === nextValue
      }

      if (field === 'country') {
        const selected = await selectCustomCountry(element, value)
        if (selected) {
          return true
        }
      }

      if (element instanceof HTMLInputElement) {
        const nextValue =
          field === 'country' ? getCountryLabels(value)[0] || value : value
        nativeInputValueSetter?.call(element, nextValue)
        element.value = nextValue
        dispatchValueEvents(element, nextValue)
        element.blur()
        return elementValueMatches(field, element, value)
      }

      if (element instanceof HTMLTextAreaElement) {
        nativeTextAreaValueSetter?.call(element, value)
        element.value = value
        dispatchValueEvents(element, value)
        element.blur()
        return elementValueMatches(field, element, value)
      }

      if (element.isContentEditable) {
        element.textContent = value
        dispatchValueEvents(element, value)
        element.blur()
        return elementValueMatches(field, element, value)
      }

      if (field === 'country') {
        element.blur()
        return false
      }

      element.setAttribute('value', value)
      dispatchValueEvents(element, value)
      element.blur()
      return elementValueMatches(field, element, value)
    }

    async function setField(
      field: BillingField,
      timeoutMs = FIELD_WAIT_MS,
    ): Promise<boolean> {
      const value = values[field]
      if (!value) {
        return false
      }

      const element = await waitForField(field, timeoutMs)
      if (!element || !(await setElementValue(field, element, value))) {
        return false
      }

      await sleepInFrame(FIELD_SETTLE_MS)
      return elementValueMatches(field, element, value)
    }

    const result: Record<BillingField, boolean> = {
      name: false,
      country: false,
      line1: false,
      line2: false,
      city: false,
      state: false,
      postalCode: false,
    }

    result.country = await setField('country', SHORT_FIELD_WAIT_MS)
    if (result.country) await sleepInFrame(FIELD_SETTLE_MS)

    result.name = await setField('name', SHORT_FIELD_WAIT_MS)
    result.line1 = await setField('line1', FIELD_WAIT_MS)
    if (result.line1) await sleepInFrame(FIELD_EXPAND_WAIT_MS)

    result.line2 = await setField(
      'line2',
      input.line2 ? FIELD_WAIT_MS : SHORT_FIELD_WAIT_MS,
    )
    result.postalCode = await setField('postalCode', FIELD_WAIT_MS)
    const cityRequired = input.city
      ? !['SG'].includes(normalizeCountry(input.country))
      : false
    result.city = await setField(
      'city',
      cityRequired ? FIELD_WAIT_MS : SHORT_FIELD_WAIT_MS,
    )
    result.state = await setField('state', SHORT_FIELD_WAIT_MS)

    if (!result.postalCode || (cityRequired && !result.city)) {
      await sleepInFrame(FIELD_SETTLE_MS)
      result.country ||= await setField('country', SHORT_FIELD_WAIT_MS)
      result.postalCode ||= await setField('postalCode', SHORT_FIELD_WAIT_MS)
      if (cityRequired) {
        result.city ||= await setField('city', SHORT_FIELD_WAIT_MS)
      }
    }

    if (input.line2 && !result.line2) {
      result.line2 = await setField('line2', SHORT_FIELD_WAIT_MS)
    }

    result.line1 ||= await setField('line1', SHORT_FIELD_WAIT_MS)
    result.country ||= await setField('country', FIELD_WAIT_MS)

    return result
  }, address)
}

function isBillingCityRequired(country: string): boolean {
  return !['SG'].includes(country.trim().toUpperCase())
}

function isBillingStateRequired(country: string): boolean {
  return [
    'AR',
    'AU',
    'BR',
    'CA',
    'CN',
    'ES',
    'HK',
    'IN',
    'JP',
    'MX',
    'US',
  ].includes(country.trim().toUpperCase())
}

export async function selectChatGPTCheckoutPaypalPaymentMethodIfPresent(
  page: Page,
  options: {
    timeoutMs?: number
  } = {},
): Promise<boolean> {
  return selectChatGPTCheckoutPaymentMethodIfPresent(page, 'paypal', options)
}

export async function selectChatGPTCheckoutPaymentMethodIfPresent(
  page: Page,
  paymentMethod: ChatGPTTrialPaymentMethod,
  options: {
    timeoutMs?: number
  } = {},
): Promise<boolean> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 0)
  const deadline = Date.now() + timeoutMs

  do {
    for (const scope of getPrioritizedCheckoutScopes(page)) {
      if (await isCheckoutPaymentMethodSelected(scope, paymentMethod)) {
        return true
      }

      for (const locator of getChatGPTCheckoutPaymentMethodLocators(
        scope,
        paymentMethod,
      )) {
        const remainingMs = deadline - Date.now()
        if (timeoutMs > 0 && remainingMs <= 0) {
          break
        }

        const settleTimeoutMs =
          timeoutMs > 0
            ? Math.min(PAYMENT_METHOD_SETTLE_MS, Math.max(1, remainingMs))
            : PAYMENT_METHOD_SETTLE_MS
        if (
          await clickPaymentMethodLocatorIfPresent(
            locator,
            scope,
            paymentMethod,
            settleTimeoutMs,
          )
        ) {
          await sleep(500)
          return true
        }
      }
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    await sleep(Math.min(PAYMENT_METHOD_POLL_MS, remainingMs))
  } while (Date.now() <= deadline)

  return false
}

function getPrioritizedCheckoutScopes(page: Page): CheckoutLocatorScope[] {
  return [...getPrioritizedCheckoutFrames(page), page]
}

function getPrioritizedCheckoutFrames(page: Page): Frame[] {
  const frames = page.frames()
  const paymentFrames = frames.filter(isStripePaymentFrame)
  const otherFrames = frames.filter((frame) => !paymentFrames.includes(frame))
  return [...paymentFrames, ...otherFrames]
}

function isStripePaymentFrame(frame: Frame): boolean {
  return STRIPE_PAYMENT_FRAME_URL_PATTERN.test(frame.url())
}

function getChatGPTCheckoutPaymentMethodLocators(
  scope: CheckoutLocatorScope,
  paymentMethod: ChatGPTTrialPaymentMethod,
): Locator[] {
  const labelPattern = PAYMENT_METHOD_LABEL_PATTERNS[paymentMethod]
  const labelText = PAYMENT_METHOD_TEXT_LABELS[paymentMethod]

  return [
    scope.getByRole('radio', { name: labelPattern }),
    scope.getByRole('tab', { name: labelPattern }),
    scope.getByRole('button', { name: labelPattern }),
    ...CHATGPT_CHECKOUT_PAYMENT_METHOD_SELECTORS[paymentMethod].map(
      (selector) => scope.locator(selector),
    ),
    scope.locator(`[role="radio"]:has-text("${labelText}")`),
    scope.locator(`[role="tab"]:has-text("${labelText}")`),
    scope.locator(`button:has-text("${labelText}")`),
    scope.getByText(labelPattern),
    scope.locator(`label:has-text("${labelText}")`),
  ]
}

async function clickPaymentMethodLocatorIfPresent(
  locator: Locator,
  scope: CheckoutLocatorScope,
  paymentMethod: ChatGPTTrialPaymentMethod,
  settleTimeoutMs = PAYMENT_METHOD_SETTLE_MS,
): Promise<boolean> {
  const count = await locator.count().catch(() => 0)
  if (count < 1) {
    return false
  }

  const candidate = locator.first()
  if (await isPaymentMethodLocatorSelected(candidate)) {
    return true
  }

  const visible = await candidate.isVisible().catch(() => false)
  if (!visible) {
    return false
  }

  const hadSelectionState = await hasPaymentMethodSelectionState(scope)
  await candidate.scrollIntoViewIfNeeded().catch(() => undefined)
  const clicked = await candidate
    .click()
    .then(() => true)
    .catch(() => false)
  if (!clicked) {
    return false
  }

  if (!hadSelectionState) {
    return true
  }

  if (
    await waitForCheckoutPaymentMethodSelected(
      scope,
      paymentMethod,
      settleTimeoutMs,
    )
  ) {
    return true
  }

  if (await hasPaymentMethodSelectionState(scope)) {
    return false
  }

  return true
}

async function waitForCheckoutPaymentMethodSelected(
  scope: CheckoutLocatorScope,
  paymentMethod: ChatGPTTrialPaymentMethod,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs)

  do {
    if (await isCheckoutPaymentMethodSelected(scope, paymentMethod)) {
      return true
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    await sleep(Math.min(PAYMENT_METHOD_POLL_MS, remainingMs))
  } while (Date.now() <= deadline)

  return isCheckoutPaymentMethodSelected(scope, paymentMethod)
}

async function isCheckoutPaymentMethodSelected(
  scope: CheckoutLocatorScope,
  paymentMethod: ChatGPTTrialPaymentMethod,
): Promise<boolean> {
  for (const selector of CHATGPT_CHECKOUT_SELECTED_PAYMENT_METHOD_SELECTORS[
    paymentMethod
  ]) {
    const locator = scope.locator(selector).first()
    const count = await locator.count().catch(() => 0)
    if (count < 1) continue
    const visible = await locator.isVisible().catch(() => false)
    if (visible) return true
  }

  const labelPattern = PAYMENT_METHOD_LABEL_PATTERNS[paymentMethod]
  for (const locator of [
    scope.getByRole('radio', { name: labelPattern }),
    scope.getByRole('tab', { name: labelPattern }),
  ]) {
    const candidate = locator.first()
    const count = await candidate.count().catch(() => 0)
    if (count < 1) continue
    const visible = await candidate.isVisible().catch(() => false)
    if (visible && (await isPaymentMethodLocatorSelected(candidate))) {
      return true
    }
  }

  return false
}

async function hasPaymentMethodSelectionState(
  scope: CheckoutLocatorScope,
): Promise<boolean> {
  for (const selector of CHATGPT_CHECKOUT_PAYMENT_METHOD_SELECTION_STATE_SELECTORS) {
    const locator = scope.locator(selector).first()
    const count = await locator.count().catch(() => 0)
    if (count < 1) continue
    const visible = await locator.isVisible().catch(() => false)
    if (visible) return true
  }

  return false
}

async function isPaymentMethodLocatorSelected(
  locator: Locator,
): Promise<boolean> {
  if (typeof locator.evaluate !== 'function') {
    return false
  }

  return locator
    .evaluate((element) => {
      const selectionRoot = element.closest(
        '[role="tab"], [role="radio"], button, input',
      ) as (HTMLElement & { checked?: boolean }) | null
      const candidate =
        selectionRoot ?? (element as HTMLElement & { checked?: boolean })
      const dataState = candidate.getAttribute('data-state')
      return (
        candidate.getAttribute('aria-selected') === 'true' ||
        candidate.getAttribute('aria-checked') === 'true' ||
        candidate.getAttribute('aria-pressed') === 'true' ||
        candidate.getAttribute('data-selected') === 'true' ||
        dataState === 'active' ||
        dataState === 'checked' ||
        dataState === 'selected' ||
        dataState === 'on' ||
        candidate.checked === true
      )
    })
    .catch(() => false)
}

async function clickChatGPTCheckoutSubscribe(page: Page): Promise<void> {
  for (const selector of CHATGPT_CHECKOUT_SUBSCRIBE_SELECTORS) {
    const locator = toLocator(page, selector).first()
    const visible = await locator.isVisible().catch(() => false)
    if (!visible) continue
    const enabled = await isLocatorEnabled(locator).catch(() => true)
    if (!enabled) continue

    await locator.scrollIntoViewIfNeeded().catch(() => undefined)
    await locator.click()
    return
  }

  await clickAny(page, CHATGPT_CHECKOUT_SUBSCRIBE_SELECTORS)
}

interface CheckoutPaymentLinkCapture {
  get(): ChatGPTCheckoutPaymentLink | undefined
  wait(timeoutMs: number): Promise<ChatGPTCheckoutPaymentLink>
  dispose(): void
}

export function extractPaypalBillingAgreementLink(
  value: string,
): PaypalBillingAgreementLink | undefined {
  try {
    const parsed = new URL(value)
    if (!PAYPAL_HOST_PATTERN.test(parsed.hostname)) {
      return undefined
    }

    const baTokenParam = parsed.searchParams.get('ba_token')?.trim()
    const tokenParam = parsed.searchParams.get('token')?.trim()
    const baToken = baTokenParam || tokenParam
    if (!baToken) {
      return undefined
    }
    if (!/^BA-/i.test(baToken)) {
      return undefined
    }

    return {
      url: value,
      paymentMethod: 'paypal',
      baToken,
      tokenParam: baTokenParam ? 'ba_token' : 'token',
      capturedAt: new Date().toISOString(),
    }
  } catch {
    return undefined
  }
}

export function extractGoPayPaymentRedirectLink(
  value: string,
): GoPayPaymentRedirectLink | undefined {
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:' ||
      !MIDTRANS_HOST_PATTERN.test(parsed.hostname) ||
      !GOPAY_MIDTRANS_REDIRECT_PATH_PATTERN.test(parsed.pathname) ||
      !GOPAY_MIDTRANS_REDIRECT_HASH_PATTERN.test(parsed.hash)
    ) {
      return undefined
    }

    return {
      url: value,
      paymentMethod: 'gopay',
      redirectId: parsed.pathname.split('/').pop() || undefined,
      capturedAt: new Date().toISOString(),
    }
  } catch {
    return undefined
  }
}

export function extractCheckoutPaymentLink(
  value: string,
  paymentMethod: ChatGPTTrialPaymentMethod,
): ChatGPTCheckoutPaymentLink | undefined {
  return paymentMethod === 'paypal'
    ? extractPaypalBillingAgreementLink(value)
    : extractGoPayPaymentRedirectLink(value)
}

function createCheckoutPaymentLinkCapture(
  page: Page,
  paymentMethod: ChatGPTTrialPaymentMethod,
): CheckoutPaymentLinkCapture {
  const context = page.context()
  let captured: ChatGPTCheckoutPaymentLink | undefined
  const pending = new Set<(value: ChatGPTCheckoutPaymentLink) => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const inspectUrl = (url: string | undefined) => {
    if (captured || !url) {
      return
    }

    const link = extractCheckoutPaymentLink(url, paymentMethod)
    if (!link) {
      return
    }

    captured = link
    for (const resolve of pending) {
      resolve(link)
    }
    pending.clear()
  }

  const inspectExistingPages = () => {
    for (const targetPage of context.pages()) {
      inspectUrl(targetPage.url())
      for (const frame of targetPage.frames()) {
        inspectUrl(frame.url())
      }
    }
  }

  const handleRequest = (request: Request) => {
    inspectUrl(request.url())
  }
  const handleFrameNavigated = (frame: Frame) => {
    inspectUrl(frame.url())
  }
  const handlePage = (targetPage: Page) => {
    inspectUrl(targetPage.url())
    targetPage.on('framenavigated', handleFrameNavigated)
  }

  context.on('request', handleRequest)
  context.on('page', handlePage)
  for (const targetPage of context.pages()) {
    targetPage.on('framenavigated', handleFrameNavigated)
  }
  inspectExistingPages()

  return {
    get() {
      inspectExistingPages()
      return captured
    },
    wait(timeoutMs: number) {
      inspectExistingPages()
      if (captured) {
        return Promise.resolve(captured)
      }

      return new Promise<ChatGPTCheckoutPaymentLink>((resolve, reject) => {
        const finish = (value: ChatGPTCheckoutPaymentLink) => {
          clearTimeout(timer)
          timers.delete(timer)
          pending.delete(finish)
          resolve(value)
        }
        const timer = setTimeout(
          () => {
            pending.delete(finish)
            timers.delete(timer)
            reject(
              new Error(`Timed out waiting for ${paymentMethod} payment link.`),
            )
          },
          Math.max(PAYMENT_CAPTURE_POLL_MS, timeoutMs),
        )

        timers.add(timer)
        pending.add(finish)
      })
    },
    dispose() {
      context.off('request', handleRequest)
      context.off('page', handlePage)
      for (const targetPage of context.pages()) {
        targetPage.off('framenavigated', handleFrameNavigated)
      }
      for (const timer of timers) {
        clearTimeout(timer)
      }
      timers.clear()
      pending.clear()
    },
  }
}

export async function clickLoginEntryIfPresent(page: Page): Promise<boolean> {
  return clickIfPresent(page, LOGIN_ENTRY_SELECTORS)
}

export async function typeRegistrationEmail(
  page: Page,
  email: string,
): Promise<boolean> {
  return typeIfPresent(
    page,
    REGISTRATION_EMAIL_SELECTORS,
    email,
    AUTH_INPUT_TYPING_OPTIONS,
  )
}

export async function clickRegistrationContinue(page: Page): Promise<void> {
  await sleep(200)
  await clickAny(page, REGISTRATION_CONTINUE_SELECTORS)
}

export async function typePassword(
  page: Page,
  password: string,
): Promise<boolean> {
  return typeIfPresent(
    page,
    ['input[type="password"]', 'input[name="password"]'],
    password,
    AUTH_INPUT_TYPING_OPTIONS,
  )
}

export async function clickPasswordSubmit(page: Page): Promise<void> {
  await sleep(200)
  await clickAny(page, PASSWORD_SUBMIT_SELECTORS)
}

export async function clickPasswordTimeoutRetry(page: Page): Promise<boolean> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    for (const selector of PASSWORD_TIMEOUT_RETRY_SELECTORS) {
      const locator = toLocator(page, selector).first()
      const visible = await locator.isVisible().catch(() => false)
      if (!visible) continue
      const enabled = await isLocatorEnabled(locator).catch(() => true)
      if (!enabled) continue
      await locator.scrollIntoViewIfNeeded().catch(() => undefined)
      const clicked = await locator
        .click()
        .then(() => true)
        .catch(() => false)
      if (clicked) return true
    }

    await sleep(
      (await hasPasswordTimeoutErrorState(page))
        ? 250
        : Math.min(250, Math.max(1, deadline - Date.now())),
    )
  }

  return false
}

export async function clickRetryButtonIfPresent(page: Page): Promise<boolean> {
  return clickPasswordTimeoutRetry(page)
}

export async function typeVerificationCode(
  page: Page,
  code: string,
): Promise<void> {
  const typed = await typeIfPresent(
    page,
    [
      'input#_r_5_-code',
      'input[autocomplete="one-time-code"]',
      'input[name="code"]',
      'input[name*="code"]',
      'input[id*="code"]',
    ],
    code,
    AUTH_INPUT_TYPING_OPTIONS,
  )
  if (!typed) {
    throw new Error(
      'ChatGPT verification code field was visible but could not be typed into.',
    )
  }
}

export async function clickVerificationContinue(page: Page): Promise<boolean> {
  return clickIfPresent(page, [
    { role: 'button', options: { name: /继续|continue|verify|验证/i } },
    { text: /继续|continue|verify|验证/i },
    'button[type="submit"]',
  ])
}

export async function waitForVerificationCodeUpdatesAfterSubmit(
  page: Page,
  options: {
    verificationProvider: VerificationProvider
    email: string
    startedAt: string
    timeoutMs: number
    currentCode: string
    onCodeUpdate?: (event: VerificationCodeUpdateEvent) => void | Promise<void>
  },
): Promise<string> {
  if (!options.verificationProvider.streamVerificationEvents) {
    return options.currentCode
  }

  const deadline = Date.now() + options.timeoutMs
  const streamStartedAt = new Date().toISOString()
  const abortController = new AbortController()
  const iterator = options.verificationProvider
    .streamVerificationEvents({
      email: options.email,
      startedAt: options.startedAt,
      signal: abortController.signal,
    })
    [Symbol.asyncIterator]()
  let currentCode = options.currentCode
  let nextEventPromise = iterator.next()

  try {
    while (Date.now() < deadline) {
      const verificationReady = await waitForVerificationCodeInputReady(
        page,
        750,
      )
      if (!verificationReady) {
        await throwIfChatGPTAccountDeactivated(page)
        return currentCode
      }

      const remainingMs = Math.max(1, deadline - Date.now())
      const result = await Promise.race([
        nextEventPromise.then((value) => ({
          kind: 'event' as const,
          value,
        })),
        sleep(Math.min(1000, remainingMs)).then(() => ({
          kind: 'tick' as const,
        })),
      ])

      if (result.kind === 'tick') {
        continue
      }

      nextEventPromise = iterator.next()

      if (result.value.done) {
        break
      }

      const event = result.value.value
      if (event.type !== 'verification_code' || !event.code) {
        continue
      }

      const shouldResubmitSameManualCode =
        event.source === 'MANUAL' &&
        event.code === currentCode &&
        Boolean(event.receivedAt) &&
        event.receivedAt > streamStartedAt
      const shouldSubmitNewCode =
        event.code !== currentCode || shouldResubmitSameManualCode
      if (!shouldSubmitNewCode) {
        continue
      }

      const inputReady = await waitForVerificationCodeInputReady(page, 5000)
      if (!inputReady) {
        await throwIfChatGPTAccountDeactivated(page)
        return currentCode
      }

      await typeVerificationCode(page, event.code)
      await clickVerificationContinue(page)
      currentCode = event.code
      await options.onCodeUpdate?.(event)
    }
  } finally {
    // A pending stream read may reject after we abort/return. Consume it so a
    // late provider shutdown never escapes as an unhandled rejection.
    void nextEventPromise.catch(() => undefined)
    abortController.abort()
    await iterator.return?.().catch(() => undefined)
  }

  const verificationReady = await waitForVerificationCodeInputReady(page, 1000)
  if (verificationReady) {
    throw new Error(
      'Verification step is still waiting for a new code after the latest submission.',
    )
  }

  await throwIfChatGPTAccountDeactivated(page)

  return currentCode
}

async function fillFirstAvailable(
  page: Page,
  selectors: SelectorTarget[],
  value: string,
): Promise<boolean> {
  return typeIfPresent(page, selectors, value, AUTH_INPUT_TYPING_OPTIONS)
}

export async function fillAgeGateName(
  page: Page,
  profileSeed?: string,
): Promise<boolean> {
  return fillFirstAvailable(
    page,
    AGE_GATE_NAME_SELECTORS,
    buildProfileName(profileSeed),
  )
}

export async function fillAgeGateAge(page: Page): Promise<boolean> {
  return fillFirstAvailable(page, AGE_GATE_AGE_SELECTORS, ADULT_AGE)
}

async function setBirthdayHiddenInputValue(
  page: Page,
  value: string,
): Promise<boolean> {
  for (const selector of AGE_GATE_BIRTHDAY_HIDDEN_INPUT_SELECTORS) {
    const updated = await page
      .evaluate(
        ({ selector, value: nextValue }) => {
          const input = document.querySelector(
            selector,
          ) as HTMLInputElement | null
          if (!input) return false
          input.value = nextValue
          input.setAttribute('value', nextValue)
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        },
        { selector: String(selector), value },
      )
      .catch(() => false)
    if (updated) return true
  }
  return false
}

async function waitForBirthdayHiddenInputValue(
  page: Page,
  expected: string,
  timeoutMs = 1000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const matches = await page
      .evaluate((nextValue) => {
        const input = document.querySelector(
          'input[name="birthday"]',
        ) as HTMLInputElement | null
        return input?.value === nextValue
      }, expected)
      .catch(() => false)
    if (matches) return true
    await sleep(100)
  }
  return false
}

async function waitForBirthdaySegmentsReady(
  page: Page,
  timeoutMs = 1500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  const yearReady = await waitForEditableSelector(
    page,
    AGE_GATE_BIRTH_YEAR_SELECTORS,
    Math.max(1, deadline - Date.now()),
  )
  if (!yearReady) return false

  const monthReady = await waitForEditableSelector(
    page,
    AGE_GATE_BIRTH_MONTH_SELECTORS,
    Math.max(1, deadline - Date.now()),
  )
  if (!monthReady) return false

  return waitForEditableSelector(
    page,
    AGE_GATE_BIRTH_DAY_SELECTORS,
    Math.max(1, deadline - Date.now()),
  )
}

async function revealAgeGateBirthdaySegments(page: Page): Promise<boolean> {
  if (await waitForBirthdaySegmentsReady(page, 300)) {
    return true
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const clicked = await clickAgeGateBirthdayTrigger(page)
    if (!clicked) break

    if (await waitForBirthdaySegmentsReady(page, 1200)) {
      return true
    }

    await sleep(150)
  }

  return waitForBirthdaySegmentsReady(page, 300)
}

async function clickAgeGateBirthdayTrigger(page: Page): Promise<boolean> {
  for (const selector of AGE_GATE_BIRTHDAY_TRIGGER_SELECTORS) {
    const locator = toLocator(page, selector).first()
    const visible = await locator.isVisible().catch(() => false)
    if (!visible) continue

    await locator.scrollIntoViewIfNeeded().catch(() => undefined)

    const box = await locator.boundingBox().catch(() => null)
    if (box && box.width > 0 && box.height > 0) {
      let attempted = false
      const positions = [
        { xRatio: 0.18, yRatio: 0.5 },
        { xRatio: 0.5, yRatio: 0.5 },
        { xRatio: 0.82, yRatio: 0.5 },
        { xRatio: 0.18, yRatio: 0.72 },
        { xRatio: 0.5, yRatio: 0.72 },
        { xRatio: 0.82, yRatio: 0.72 },
      ]

      for (const position of positions) {
        const localX = Math.max(
          1,
          Math.min(box.width - 1, box.width * position.xRatio),
        )
        const localY = Math.max(
          1,
          Math.min(box.height - 1, box.height * position.yRatio),
        )
        const pageX = box.x + localX
        const pageY = box.y + localY

        const clicked = await locator
          .click({
            force: true,
            position: {
              x: localX,
              y: localY,
            },
          })
          .then(() => true)
          .catch(() => false)
        attempted = attempted || clicked

        await page.mouse.move(pageX, pageY).catch(() => undefined)
        await sleep(50)
        await page.mouse.down().catch(() => undefined)
        await sleep(30)
        await page.mouse.up().catch(() => undefined)
        attempted = true

        await page
          .evaluate(
            ({ x, y }) => {
              const target = document.elementFromPoint(
                x,
                y,
              ) as HTMLElement | null
              if (!target) return false
              target.focus?.()

              for (const type of [
                'pointerdown',
                'mousedown',
                'pointerup',
                'mouseup',
                'click',
              ]) {
                target.dispatchEvent(
                  new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                  }),
                )
              }

              return true
            },
            { x: pageX, y: pageY },
          )
          .catch(() => false)

        await sleep(80)
      }

      if (attempted) return true
    }

    const clicked = await locator
      .click({ force: true })
      .then(() => true)
      .catch(() => false)
    if (clicked) return true
  }

  return false
}

export async function fillAgeGateBirthday(page: Page): Promise<boolean> {
  const birthdayGroupVisible = await waitForAnySelectorState(
    page,
    AGE_GATE_BIRTHDAY_GROUP_SELECTORS,
    'visible',
    1500,
  )
  if (!birthdayGroupVisible) {
    return setBirthdayHiddenInputValue(page, ADULT_BIRTHDAY)
  }

  const birthdaySegmentsReady = await revealAgeGateBirthdaySegments(page)
  if (!birthdaySegmentsReady) {
    return false
  }

  const yearFilled = await typeIfPresent(
    page,
    AGE_GATE_BIRTH_YEAR_SELECTORS,
    ADULT_BIRTH_YEAR,
  )
  const monthFilled = await typeIfPresent(
    page,
    AGE_GATE_BIRTH_MONTH_SELECTORS,
    ADULT_BIRTH_MONTH,
  )
  const dayFilled = await typeIfPresent(
    page,
    AGE_GATE_BIRTH_DAY_SELECTORS,
    ADULT_BIRTH_DAY,
  )

  if (!yearFilled || !monthFilled || !dayFilled) {
    return false
  }

  if (await waitForBirthdayHiddenInputValue(page, ADULT_BIRTHDAY, 1500)) {
    return true
  }

  return setBirthdayHiddenInputValue(page, ADULT_BIRTHDAY)
}

export async function confirmAgeDialogIfPresent(page: Page): Promise<boolean> {
  const confirmed = await clickIfPresent(page, AGE_CONFIRM_SELECTORS)
  if (confirmed) {
    await Promise.any([
      page.waitForLoadState('domcontentloaded', { timeout: 5000 }),
      sleep(500),
    ]).catch(() => undefined)
  }
  return confirmed
}

export async function clickCompleteAccountCreation(
  page: Page,
): Promise<boolean> {
  const clicked = await clickIfPresent(page, COMPLETE_ACCOUNT_SELECTORS)
  if (clicked) {
    await Promise.any([
      page.waitForLoadState('domcontentloaded', { timeout: 5000 }),
      sleep(500),
    ]).catch(() => undefined)
    await confirmAgeDialogIfPresent(page)
  }
  return clicked
}

export async function clickOnboardingAction(
  page: Page,
): Promise<string | null> {
  for (const candidate of ONBOARDING_ACTION_CANDIDATES) {
    const clicked = await clickIfPresent(page, candidate.selectors as never)
    if (clicked) return candidate.text
  }
  return null
}

export async function typeLoginEmail(
  page: Page,
  email: string,
): Promise<boolean> {
  return typeIfPresent(
    page,
    LOGIN_EMAIL_SELECTORS,
    email,
    AUTH_INPUT_TYPING_OPTIONS,
  )
}

export async function clickLoginContinue(page: Page): Promise<boolean> {
  return clickIfPresent(page, LOGIN_CONTINUE_SELECTORS)
}

export async function recoverLoginEmailSubmissionSurface(
  page: Page,
): Promise<boolean> {
  const retried = await clickPasswordTimeoutRetry(page)
  if (retried) {
    return waitForLoginEmailFormReady(page, 10000)
  }

  return waitForLoginEmailFormReady(page, 5000)
}

export interface SubmitLoginEmailOptions {
  maxAttempts?: number
  onRetry?: (
    attempt: number,
    reason: 'retry' | 'timeout',
  ) => void | Promise<void>
}

export async function submitLoginEmail(
  page: Page,
  email: string,
  options: SubmitLoginEmailOptions = {},
): Promise<void> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const formReady = await waitForLoginEmailFormReady(page, 15000)
    if (!formReady) {
      throw new Error(
        'ChatGPT login page did not finish rendering a stable email form.',
      )
    }

    const filled = await typeLoginEmail(page, email)
    if (!filled) {
      throw new Error(
        'ChatGPT login email field was visible but could not be filled.',
      )
    }

    const submitted = await clickLoginContinue(page)
    if (!submitted) {
      throw new Error(
        'ChatGPT login page did not expose a clickable continue button.',
      )
    }

    const outcome = await waitForLoginEmailSubmissionOutcome(page)
    let retryReason: 'retry' | 'timeout' | undefined
    if (outcome === 'next') {
      return
    }
    if (outcome === 'unknown') {
      const lateStep = await waitForPostEmailLoginStep(page, 5000)
      if (lateStep !== 'retry') {
        return
      }
      retryReason = 'retry'
    } else {
      retryReason = outcome
    }

    await options.onRetry?.(attempt, retryReason)
    const recovered = await recoverLoginEmailSubmissionSurface(page)
    if (!recovered) {
      throw new Error(
        retryReason === 'retry'
          ? 'Login email submission returned to the email step and could not be recovered.'
          : 'Login email submission timed out and retry button was not clickable.',
      )
    }
  }

  throw new Error('Login email submission timed out repeatedly.')
}

export interface CompletePasswordOrVerificationLoginFallbackOptions {
  email: string
  password: string
  step: Extract<ChatGPTPostEmailLoginStep, 'password' | 'verification'>
  startedAt: string
  verificationProvider?: VerificationProvider
  getVerificationProvider?: () =>
    | VerificationProvider
    | Promise<VerificationProvider>
  verificationTimeoutMs?: number
  pollIntervalMs?: number
}

export interface CompletePasswordOrVerificationLoginFallbackResult {
  method: 'password' | 'verification'
  verificationCode?: string
}

export async function completePasswordOrVerificationLoginFallback(
  page: Page,
  options: CompletePasswordOrVerificationLoginFallbackOptions,
): Promise<CompletePasswordOrVerificationLoginFallbackResult> {
  let verificationProvider = options.verificationProvider

  const requireVerificationProvider =
    async (): Promise<VerificationProvider> => {
      verificationProvider ??= await options.getVerificationProvider?.()
      if (!verificationProvider) {
        throw new Error(
          'A verification provider is required when ChatGPT login fallback requests a verification code.',
        )
      }

      return verificationProvider
    }

  const completeVerificationStep = async (): Promise<string> => {
    const verificationReady = await waitForVerificationCodeInputReady(
      page,
      10000,
    )
    if (!verificationReady) {
      await throwIfChatGPTAccountDeactivated(page)
      throw new Error('ChatGPT verification code input did not become ready.')
    }

    const verificationCode = await waitForVerificationCode({
      verificationProvider: await requireVerificationProvider(),
      email: options.email,
      startedAt: options.startedAt,
      timeoutMs: options.verificationTimeoutMs ?? 180000,
      pollIntervalMs: options.pollIntervalMs ?? 5000,
    })
    await typeVerificationCode(page, verificationCode)
    await clickVerificationContinue(page)
    return waitForVerificationCodeUpdatesAfterSubmit(page, {
      verificationProvider: await requireVerificationProvider(),
      email: options.email,
      startedAt: options.startedAt,
      timeoutMs: options.verificationTimeoutMs ?? 180000,
      currentCode: verificationCode,
    })
  }

  if (options.step === 'verification') {
    return {
      method: 'verification',
      verificationCode: await completeVerificationStep(),
    }
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const passwordReady = await waitForPasswordInputReady(page, 10000)
    if (!passwordReady) {
      throw new Error('ChatGPT password step did not become ready.')
    }

    const passwordTyped = await typePassword(page, options.password)
    if (!passwordTyped) {
      throw new Error(
        'ChatGPT password field was visible but could not be typed into.',
      )
    }

    await clickPasswordSubmit(page)
    const outcome = await waitForPasswordSubmissionOutcome(page)
    if (outcome === 'timeout') {
      const retried = await clickPasswordTimeoutRetry(page)
      if (!retried) {
        throw new Error(
          'Password submission timed out and retry button was not clickable.',
        )
      }
      continue
    }

    if (outcome === 'verification') {
      return {
        method: 'verification',
        verificationCode: await completeVerificationStep(),
      }
    }

    const nextStep = await waitForPostEmailLoginStep(page, 5000)
    if (nextStep === 'password') continue
    if (nextStep === 'verification') {
      return {
        method: 'verification',
        verificationCode: await completeVerificationStep(),
      }
    }

    return { method: 'password' }
  }

  throw new Error('Password submission timed out repeatedly.')
}

async function selectOpenAIWorkspaceIdControl(
  page: Page,
  workspaceIndex: number,
  preferredWorkspaceId?: string,
) {
  return page.evaluate(
    ({ requestedIndex, preferredWorkspaceId: preferredId }) => {
      const normalizedPreferredId =
        typeof preferredId === 'string' ? preferredId.trim() : ''

      const radioInputs = (
        Array.from(
          document.querySelectorAll('input[type="radio"][name="workspace_id"]'),
        ) as HTMLInputElement[]
      ).filter((radio) => !radio.disabled && radio.value.trim())

      if (radioInputs.length > 0) {
        const matchedIndex = normalizedPreferredId
          ? radioInputs.findIndex(
              (radio) => radio.value === normalizedPreferredId,
            ) + 1
          : 0
        const selectedIndex = matchedIndex || requestedIndex

        if (selectedIndex > radioInputs.length) {
          return {
            availableWorkspaces: radioInputs.length,
            selectedWorkspaceIndex: 0,
            selectionStrategy: 'index' as const,
            status: 'out_of_range' as const,
          }
        }

        const radio = radioInputs[selectedIndex - 1]
        radio.checked = true
        radio.dispatchEvent(new Event('input', { bubbles: true }))
        radio.dispatchEvent(new Event('change', { bubbles: true }))
        radio.click()

        return {
          availableWorkspaces: radioInputs.length,
          selectedWorkspaceIndex: selectedIndex,
          selectedWorkspaceId: radio.value || undefined,
          selectionStrategy: matchedIndex
            ? ('workspace_id' as const)
            : ('index' as const),
          status: 'selected' as const,
        }
      }

      const select = document.querySelector(
        'select[name="workspace_id"]',
      ) as HTMLSelectElement | null
      if (select) {
        const options = Array.from(select.options).filter(
          (option) => !option.disabled && option.value.trim(),
        )
        const availableWorkspaces = options.length
        const matchedIndex = normalizedPreferredId
          ? options.findIndex(
              (option) => option.value === normalizedPreferredId,
            ) + 1
          : 0
        const selectedIndex = matchedIndex || requestedIndex

        if (selectedIndex > availableWorkspaces) {
          return {
            availableWorkspaces,
            selectedWorkspaceIndex: 0,
            selectionStrategy: 'index' as const,
            status: 'out_of_range' as const,
          }
        }

        select.value = options[selectedIndex - 1]?.value || ''
        select.dispatchEvent(new Event('input', { bubbles: true }))
        select.dispatchEvent(new Event('change', { bubbles: true }))

        return {
          availableWorkspaces,
          selectedWorkspaceIndex: selectedIndex,
          selectedWorkspaceId: select.value || undefined,
          selectionStrategy: matchedIndex
            ? ('workspace_id' as const)
            : ('index' as const),
          status: 'selected' as const,
        }
      }

      const workspaceButtons = (
        Array.from(
          document.querySelectorAll('button[name="workspace_id"][value]'),
        ) as HTMLButtonElement[]
      ).filter(
        (button) =>
          !button.disabled &&
          button.getAttribute('aria-disabled') !== 'true' &&
          button.value.trim(),
      )

      if (workspaceButtons.length > 0) {
        const matchedIndex = normalizedPreferredId
          ? workspaceButtons.findIndex(
              (button) => button.value === normalizedPreferredId,
            ) + 1
          : 0
        const selectedIndex = matchedIndex || requestedIndex

        if (selectedIndex > workspaceButtons.length) {
          return {
            availableWorkspaces: workspaceButtons.length,
            selectedWorkspaceIndex: 0,
            selectionStrategy: 'index' as const,
            status: 'out_of_range' as const,
          }
        }

        const button = workspaceButtons[selectedIndex - 1]
        return {
          availableWorkspaces: workspaceButtons.length,
          selectedWorkspaceIndex: selectedIndex,
          selectedWorkspaceId: button.value || undefined,
          selectionStrategy: matchedIndex
            ? ('workspace_id' as const)
            : ('index' as const),
          status: 'selected' as const,
          submitKind: 'selected-button' as const,
        }
      }

      const hiddenInput = document.querySelector(
        'input[name="workspace_id"]',
      ) as HTMLInputElement | null
      if (hiddenInput?.value) {
        const matchedIndex =
          normalizedPreferredId && hiddenInput.value === normalizedPreferredId
            ? 1
            : 0
        const selectedIndex = matchedIndex || requestedIndex

        return {
          availableWorkspaces: 1,
          selectedWorkspaceIndex: selectedIndex === 1 ? 1 : 0,
          selectedWorkspaceId: hiddenInput.value || undefined,
          selectionStrategy: matchedIndex
            ? ('workspace_id' as const)
            : ('index' as const),
          status:
            selectedIndex === 1
              ? ('selected' as const)
              : ('out_of_range' as const),
        }
      }

      return {
        availableWorkspaces: 0,
        selectedWorkspaceIndex: 0,
        selectionStrategy: 'index' as const,
        status: 'missing' as const,
      }
    },
    {
      requestedIndex: workspaceIndex,
      preferredWorkspaceId,
    },
  ) as Promise<WorkspaceIdControlSelection>
}

function escapeCssAttributeValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\d ')
    .replace(/\n/g, '\\a ')
    .replace(/\f/g, '\\c ')
}

function buildWorkspaceButtonSelector(workspaceId: string): string {
  return `button[name="workspace_id"][value="${escapeCssAttributeValue(workspaceId)}"]`
}

async function continueWorkspaceSelection(
  page: Page,
  workspaceIndex: number,
  preferredWorkspaceId: string | undefined,
  labels: {
    name: string
    indexError: string
    notReadyError: string
    missingInputError: string
    submitNotReadyError: string
  },
): Promise<OpenAIWorkspaceSelectionResult> {
  if (!Number.isInteger(workspaceIndex) || workspaceIndex < 1) {
    throw new Error(labels.indexError)
  }

  const ready =
    labels.name === 'Codex'
      ? await isCodexWorkspacePickerReady(page)
      : await isOpenAIWorkspacePickerReady(page)
  if (!ready) {
    throw new Error(labels.notReadyError)
  }

  const selected = await selectOpenAIWorkspaceIdControl(
    page,
    workspaceIndex,
    preferredWorkspaceId,
  )

  if (selected.status === 'missing') {
    throw new Error(labels.missingInputError)
  }

  if (selected.status === 'out_of_range') {
    throw new Error(
      `Requested workspace #${workspaceIndex}, but only ${selected.availableWorkspaces} workspaces were available.`,
    )
  }

  if (selected.submitKind === 'selected-button') {
    if (!selected.selectedWorkspaceId) {
      throw new Error(labels.missingInputError)
    }

    const workspaceButtonSelector = buildWorkspaceButtonSelector(
      selected.selectedWorkspaceId,
    )
    const buttonReady = await waitForEnabledSelector(
      page,
      [workspaceButtonSelector],
      5000,
    )
    if (!buttonReady) {
      throw new Error(labels.submitNotReadyError)
    }

    await clickAny(page, [workspaceButtonSelector])

    return {
      availableWorkspaces: selected.availableWorkspaces,
      selectedWorkspaceIndex: selected.selectedWorkspaceIndex,
      selectedWorkspaceId: selected.selectedWorkspaceId,
      selectionStrategy: selected.selectionStrategy,
    }
  }

  const submitReady = await waitForEnabledSelector(
    page,
    CODEX_WORKSPACE_SUBMIT_SELECTORS,
    5000,
  )
  if (!submitReady) {
    throw new Error(labels.submitNotReadyError)
  }

  await clickAny(page, CODEX_WORKSPACE_SUBMIT_SELECTORS)

  return {
    availableWorkspaces: selected.availableWorkspaces,
    selectedWorkspaceIndex: selected.selectedWorkspaceIndex,
    selectedWorkspaceId: selected.selectedWorkspaceId,
    selectionStrategy: selected.selectionStrategy,
  }
}

export async function continueOpenAIWorkspaceSelection(
  page: Page,
  workspaceIndex = 1,
  preferredWorkspaceId?: string,
): Promise<OpenAIWorkspaceSelectionResult> {
  return continueWorkspaceSelection(
    page,
    workspaceIndex,
    preferredWorkspaceId,
    {
      name: 'OpenAI',
      indexError:
        'OpenAI workspace selection requires a positive 1-based workspace index.',
      notReadyError: 'OpenAI workspace picker was not ready.',
      missingInputError:
        'OpenAI workspace picker did not expose a workspace_id input.',
      submitNotReadyError:
        'OpenAI workspace submit button did not become enabled.',
    },
  )
}

export async function continueCodexWorkspaceSelection(
  page: Page,
  workspaceIndex = 1,
  preferredWorkspaceId?: string,
): Promise<CodexWorkspaceSelectionResult> {
  return continueWorkspaceSelection(
    page,
    workspaceIndex,
    preferredWorkspaceId,
    {
      name: 'Codex',
      indexError:
        'Codex workspace selection requires a positive 1-based workspace index.',
      notReadyError: 'Codex workspace picker was not ready.',
      missingInputError:
        'Codex workspace picker did not expose a workspace_id input.',
      submitNotReadyError:
        'Codex workspace submit button did not become enabled.',
    },
  )
}

async function setNamedCodexSelection(
  page: Page,
  fieldName: 'organization_id' | 'project_id',
  requestedIndex: number,
): Promise<NamedSelectionResult> {
  return page.evaluate(
    ({ fieldName: name, requestedIndex: index }) => {
      const radioInputs = Array.from(
        document.querySelectorAll(`input[type="radio"][name="${name}"]`),
      ) as HTMLInputElement[]

      if (radioInputs.length > 0) {
        if (index > radioInputs.length) {
          return {
            availableOptions: radioInputs.length,
            selectedOptionIndex: 0,
            status: 'out_of_range' as const,
          }
        }

        const radio = radioInputs[index - 1]
        radio.checked = true
        radio.dispatchEvent(new Event('input', { bubbles: true }))
        radio.dispatchEvent(new Event('change', { bubbles: true }))
        radio.click()

        return {
          availableOptions: radioInputs.length,
          selectedOptionIndex: index,
          status: 'selected' as const,
        }
      }

      const select = document.querySelector(
        `select[name="${name}"]`,
      ) as HTMLSelectElement | null
      if (select) {
        const availableOptions = select.options.length
        if (index > availableOptions) {
          return {
            availableOptions,
            selectedOptionIndex: 0,
            status: 'out_of_range' as const,
          }
        }

        select.value = select.options[index - 1]?.value || ''
        select.dispatchEvent(new Event('input', { bubbles: true }))
        select.dispatchEvent(new Event('change', { bubbles: true }))

        return {
          availableOptions,
          selectedOptionIndex: index,
          status: 'selected' as const,
        }
      }

      const hiddenInput = document.querySelector(
        `input[name="${name}"]`,
      ) as HTMLInputElement | null
      if (hiddenInput?.value) {
        return {
          availableOptions: 1,
          selectedOptionIndex: index === 1 ? 1 : 0,
          status:
            index === 1 ? ('selected' as const) : ('out_of_range' as const),
        }
      }

      return {
        availableOptions: 0,
        selectedOptionIndex: 0,
        status: 'missing' as const,
      }
    },
    { fieldName, requestedIndex },
  )
}

async function waitForNamedCodexSelection(
  page: Page,
  fieldName: 'organization_id' | 'project_id',
  requestedIndex: number,
  timeoutMs = 5000,
): Promise<NamedSelectionResult> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const selection = await setNamedCodexSelection(
      page,
      fieldName,
      requestedIndex,
    )
    if (selection.status !== 'missing') {
      return selection
    }
    await sleep(100)
  }

  return setNamedCodexSelection(page, fieldName, requestedIndex)
}

export async function continueCodexOrganizationSelection(
  page: Page,
  organizationIndex = 1,
  projectIndex = 1,
): Promise<CodexOrganizationSelectionResult> {
  if (!Number.isInteger(organizationIndex) || organizationIndex < 1) {
    throw new Error(
      'Codex organization selection requires a positive 1-based organization index.',
    )
  }

  if (!Number.isInteger(projectIndex) || projectIndex < 1) {
    throw new Error(
      'Codex organization selection requires a positive 1-based project index.',
    )
  }

  if (!(await isCodexOrganizationPickerReady(page))) {
    throw new Error('Codex organization picker was not ready.')
  }

  const selectedOrganization = await waitForNamedCodexSelection(
    page,
    'organization_id',
    organizationIndex,
  )

  if (selectedOrganization.status === 'missing') {
    throw new Error(
      'Codex organization picker did not expose an organization_id input.',
    )
  }

  if (selectedOrganization.status === 'out_of_range') {
    throw new Error(
      `Requested organization #${organizationIndex}, but only ${selectedOrganization.availableOptions} organizations were available.`,
    )
  }

  const selectedProject = await waitForNamedCodexSelection(
    page,
    'project_id',
    projectIndex,
  )

  let availableProjects = selectedProject.availableOptions
  let selectedProjectIndex = selectedProject.selectedOptionIndex
  let submitReady = false

  if (selectedProject.status === 'missing') {
    if (projectIndex !== 1) {
      throw new Error(
        'Codex organization picker did not expose a project_id input.',
      )
    }

    submitReady = await waitForEnabledSelector(
      page,
      CODEX_ORGANIZATION_SUBMIT_SELECTORS,
      5000,
    )

    if (!submitReady) {
      throw new Error(
        'Codex organization picker did not expose a project_id input, and the submit button did not become enabled for the default project.',
      )
    }

    availableProjects = 1
    selectedProjectIndex = 1
  }

  if (selectedProject.status === 'out_of_range') {
    throw new Error(
      `Requested project #${projectIndex}, but only ${selectedProject.availableOptions} projects were available.`,
    )
  }

  if (!submitReady) {
    submitReady = await waitForEnabledSelector(
      page,
      CODEX_ORGANIZATION_SUBMIT_SELECTORS,
      5000,
    )
  }

  if (!submitReady) {
    throw new Error('Codex organization submit button did not become enabled.')
  }

  await clickAny(page, CODEX_ORGANIZATION_SUBMIT_SELECTORS)

  return {
    availableOrganizations: selectedOrganization.availableOptions,
    selectedOrganizationIndex: selectedOrganization.selectedOptionIndex,
    availableProjects,
    selectedProjectIndex,
  }
}

export async function continueCodexOAuthConsent(page: Page): Promise<void> {
  if (!(await isCodexConsentReady(page))) {
    throw new Error('Codex OAuth consent page was not ready.')
  }

  const submitReady = await waitForEnabledSelector(
    page,
    CODEX_CONSENT_SUBMIT_SELECTORS,
    5000,
  )
  if (!submitReady) {
    throw new Error('Codex OAuth consent button did not become enabled.')
  }

  await clickAny(page, CODEX_CONSENT_SUBMIT_SELECTORS)
}

async function clearOriginStorage(
  page: Page,
  originUrl: string,
): Promise<void> {
  await page
    .goto(originUrl, { waitUntil: 'domcontentloaded' })
    .catch(() => undefined)
  await page
    .evaluate(async () => {
      try {
        window.localStorage.clear()
      } catch {}
      try {
        window.sessionStorage.clear()
      } catch {}
      try {
        const cacheKeys = await caches.keys()
        await Promise.all(cacheKeys.map((key) => caches.delete(key)))
      } catch {}
      try {
        const dbs = await indexedDB.databases?.()
        if (dbs?.length) {
          await Promise.all(
            dbs
              .map((db) => db.name)
              .filter((name): name is string => Boolean(name))
              .map(
                (name) =>
                  new Promise<void>((resolve) => {
                    const request = indexedDB.deleteDatabase(name)
                    request.onsuccess = () => resolve()
                    request.onerror = () => resolve()
                    request.onblocked = () => resolve()
                  }),
              ),
          )
        }
      } catch {}
    })
    .catch(() => undefined)
}

export async function clearAuthenticatedSessionState(
  page: Page,
): Promise<void> {
  await page
    .context()
    .clearCookies()
    .catch(() => undefined)
  await clearOriginStorage(page, CHATGPT_HOME_URL)
  await clearOriginStorage(page, CHATGPT_LOGIN_URL)
  await clearOriginStorage(page, CHATGPT_ENTRY_LOGIN_URL)
}
