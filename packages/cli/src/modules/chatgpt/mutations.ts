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
  CHATGPT_CHECKOUT_PAYPAL_SELECTORS,
  CHATGPT_CHECKOUT_SUBSCRIBE_SELECTORS,
  CHATGPT_TEAM_PRICING_PROMO_URL,
  COMPLETE_ACCOUNT_SELECTORS,
  LOGIN_CONTINUE_SELECTORS,
  LOGIN_EMAIL_SELECTORS,
  LOGIN_ENTRY_SELECTORS,
  ONBOARDING_ACTION_CANDIDATES,
  PASSWORD_SUBMIT_SELECTORS,
  PASSWORD_TIMEOUT_RETRY_SELECTORS,
  buildProfileName,
  REGISTRATION_CONTINUE_SELECTORS,
  REGISTRATION_EMAIL_SELECTORS,
  SIGNUP_ENTRY_SELECTORS,
  TEAM_PRICING_FREE_TRIAL_SELECTORS,
  CHATGPT_HOME_URL,
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
  waitForTeamPricingFreeTrialReady,
  waitForVerificationCode,
  waitForVerificationCodeInputReady,
} from './queries'

const AUTH_INPUT_TYPING_OPTIONS = {
  settleMs: 500,
  strategy: 'sequential',
} as const
const STRIPE_ADDRESS_FRAME_URL_PATTERN = /elements-inner-address/i
const STRIPE_ADDRESS_FIELD_SELECTORS = [
  'input[name="addressLine1"]',
  'input[name="line1"]',
  'input[autocomplete*="address-line1" i]',
  'select[name="country"]',
] as const
const PAYPAL_HOST_PATTERN = /(^|\.)paypal\.com$/i
const PAYPAL_CAPTURE_POLL_MS = 250

export interface OpenAIWorkspaceSelectionResult {
  availableWorkspaces: number
  selectedWorkspaceIndex: number
  selectedWorkspaceId?: string
  selectionStrategy: 'index' | 'workspace_id'
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
  city: string
  state?: string
  postalCode: string
}

export interface PaypalBillingAgreementLink {
  url: string
  baToken: string
  tokenParam: 'ba_token' | 'token'
  capturedAt: string
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
  await page.goto(CHATGPT_TEAM_PRICING_PROMO_URL, {
    waitUntil: 'domcontentloaded',
  })
  await page.locator('body').waitFor({ state: 'visible' })
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

export async function clickTeamPricingFreeTrial(page: Page): Promise<void> {
  const ready = await waitForTeamPricingFreeTrialReady(page, 30000)
  if (!ready) {
    throw new Error(
      'ChatGPT Team pricing free trial button did not become ready.',
    )
  }

  await clickAny(page, TEAM_PRICING_FREE_TRIAL_SELECTORS)
  await page.waitForLoadState('domcontentloaded').catch(() => undefined)
}

export async function fillChatGPTCheckoutBillingAddress(
  page: Page,
  address: ChatGPTTeamTrialBillingAddress,
): Promise<void> {
  const checkoutReady = await waitForChatGPTCheckoutReady(page, 60000)
  if (!checkoutReady) {
    throw new Error('ChatGPT Team trial checkout did not become ready.')
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
    fillResult.city ? undefined : 'city',
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
  const timeoutMs = Math.max(1, options.timeoutMs ?? 90000)
  const deadline = Date.now() + timeoutMs
  const capture = createPaypalBillingAgreementLinkCapture(page)

  try {
    await selectChatGPTCheckoutPaypalPaymentMethodIfPresent(page)

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
        await selectChatGPTCheckoutPaypalPaymentMethodIfPresent(page)
        const observed = await capture
          .wait(Math.min(1500, Math.max(1, deadline - Date.now())))
          .catch(() => undefined)
        if (observed) return observed
        continue
      }

      await selectChatGPTCheckoutPaypalPaymentMethodIfPresent(page)
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
    'PayPal billing agreement link with BA token was not captured.',
  )
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
        'select[id*="country" i]',
        'select[autocomplete*="country" i]',
        'input[name="country"]',
        'input[autocomplete*="country" i]',
        '[role="combobox"][aria-label*="country" i]',
        '[role="combobox"][aria-label*="国家" i]',
        '[role="combobox"][aria-label*="地区" i]',
      ],
      line1: [
        'input[name="addressLine1"]',
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
        'input[name="line2"]',
        'input[autocomplete*="address-line2" i]',
        'input[id*="addressLine2" i]',
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
        'input[name="city"]',
        'input[autocomplete*="address-level2" i]',
        'input[id*="locality" i]',
        'input[id*="city" i]',
        'input[aria-label*="城市" i]',
        'input[aria-label*="city" i]',
        'input[placeholder*="城市" i]',
        'input[placeholder*="city" i]',
      ],
      state: [
        'input[name="administrativeArea"]',
        'select[name="administrativeArea"]',
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
      city: [/城市|city|locality/i],
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
        return /city|locality|town|address-level2|城市/i.test(descriptor)
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

    function elementValueMatches(element: HTMLElement, value: string): boolean {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        return element.value.trim() === value.trim()
      }

      if (element.isContentEditable) {
        return normalizeText(element.textContent) === value.trim()
      }

      return element.getAttribute('value')?.trim() === value.trim()
    }

    function normalizeCountry(value: string): string {
      return value.trim().toUpperCase()
    }

    function setElementValue(element: HTMLElement, value: string): boolean {
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

      if (element instanceof HTMLInputElement) {
        nativeInputValueSetter?.call(element, value)
        element.value = value
        dispatchValueEvents(element, value)
        element.blur()
        return elementValueMatches(element, value)
      }

      if (element instanceof HTMLTextAreaElement) {
        nativeTextAreaValueSetter?.call(element, value)
        element.value = value
        dispatchValueEvents(element, value)
        element.blur()
        return elementValueMatches(element, value)
      }

      if (element.isContentEditable) {
        element.textContent = value
        dispatchValueEvents(element, value)
        element.blur()
        return elementValueMatches(element, value)
      }

      element.setAttribute('value', value)
      dispatchValueEvents(element, value)
      element.blur()
      return elementValueMatches(element, value)
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
      if (!element || !setElementValue(element, value)) {
        return false
      }

      await sleepInFrame(FIELD_SETTLE_MS)
      return elementValueMatches(element, value)
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
    result.city = await setField('city', FIELD_WAIT_MS)
    result.state = await setField('state', SHORT_FIELD_WAIT_MS)

    if (!result.postalCode || !result.city) {
      await sleepInFrame(FIELD_SETTLE_MS)
      result.postalCode ||= await setField('postalCode', SHORT_FIELD_WAIT_MS)
      result.city ||= await setField('city', SHORT_FIELD_WAIT_MS)
    }

    if (input.line2 && !result.line2) {
      result.line2 = await setField('line2', SHORT_FIELD_WAIT_MS)
    }

    result.line1 ||= await setField('line1', SHORT_FIELD_WAIT_MS)

    return result
  }, address)
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

async function selectChatGPTCheckoutPaypalPaymentMethodIfPresent(
  page: Page,
): Promise<boolean> {
  if (await clickIfPresent(page, CHATGPT_CHECKOUT_PAYPAL_SELECTORS)) {
    await sleep(500)
    return true
  }

  for (const frame of page.frames()) {
    if (
      await clickPaypalLocatorIfPresent(
        frame.getByRole('radio', { name: /paypal/i }),
      )
    ) {
      await sleep(500)
      return true
    }

    if (
      await clickPaypalLocatorIfPresent(
        frame.getByRole('button', { name: /paypal/i }),
      )
    ) {
      await sleep(500)
      return true
    }

    if (
      await clickPaypalLocatorIfPresent(
        frame.locator('label:has-text("PayPal")'),
      )
    ) {
      await sleep(500)
      return true
    }
  }

  return false
}

async function clickPaypalLocatorIfPresent(locator: Locator): Promise<boolean> {
  const count = await locator.count().catch(() => 0)
  if (count < 1) {
    return false
  }

  const candidate = locator.first()
  const visible = await candidate.isVisible().catch(() => false)
  if (!visible) {
    return false
  }

  await candidate.scrollIntoViewIfNeeded().catch(() => undefined)
  return candidate
    .click()
    .then(() => true)
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

interface PaypalBillingAgreementCapture {
  get(): PaypalBillingAgreementLink | undefined
  wait(timeoutMs: number): Promise<PaypalBillingAgreementLink>
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
      baToken,
      tokenParam: baTokenParam ? 'ba_token' : 'token',
      capturedAt: new Date().toISOString(),
    }
  } catch {
    return undefined
  }
}

function createPaypalBillingAgreementLinkCapture(
  page: Page,
): PaypalBillingAgreementCapture {
  const context = page.context()
  let captured: PaypalBillingAgreementLink | undefined
  const pending = new Set<(value: PaypalBillingAgreementLink) => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const inspectUrl = (url: string | undefined) => {
    if (captured || !url) {
      return
    }

    const link = extractPaypalBillingAgreementLink(url)
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

      return new Promise<PaypalBillingAgreementLink>((resolve, reject) => {
        const finish = (value: PaypalBillingAgreementLink) => {
          clearTimeout(timer)
          timers.delete(timer)
          pending.delete(finish)
          resolve(value)
        }
        const timer = setTimeout(
          () => {
            pending.delete(finish)
            timers.delete(timer)
            reject(new Error('Timed out waiting for PayPal BA token link.'))
          },
          Math.max(PAYPAL_CAPTURE_POLL_MS, timeoutMs),
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
  )
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
