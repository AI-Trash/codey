import type { Page } from 'patchright'
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
  waitForAnySelectorState,
  waitForEnabledSelector,
  waitForEditableSelector,
  waitForLoginEmailFormReady,
  waitForLoginEmailSubmissionOutcome,
  waitForPasswordInputReady,
  waitForPasswordSubmissionOutcome,
  waitForPostEmailLoginStep,
  waitForVerificationCode,
  waitForVerificationCodeInputReady,
} from './queries'

const AUTH_INPUT_TYPING_OPTIONS = {
  settleMs: 500,
  strategy: 'sequential',
} as const

interface CodexWorkspaceSelectionResult {
  availableWorkspaces: number
  selectedWorkspaceIndex: number
}

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

export async function clickSignupEntry(page: Page): Promise<void> {
  await clickAny(page, SIGNUP_ENTRY_SELECTORS)
}

export async function gotoLoginEntry(page: Page): Promise<void> {
  await page.goto(CHATGPT_ENTRY_LOGIN_URL, { waitUntil: 'domcontentloaded' })
  await page.locator('body').waitFor({ state: 'visible' })
  await page.waitForLoadState('networkidle').catch(() => undefined)
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
        return currentCode
      }

      await typeVerificationCode(page, event.code)
      await clickVerificationContinue(page)
      currentCode = event.code
      await options.onCodeUpdate?.(event)
    }
  } finally {
    abortController.abort()
    await iterator.return?.().catch(() => undefined)
  }

  const verificationReady = await waitForVerificationCodeInputReady(page, 1000)
  if (verificationReady) {
    throw new Error(
      'Verification step is still waiting for a new code after the latest submission.',
    )
  }

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

export async function continueCodexWorkspaceSelection(
  page: Page,
  workspaceIndex = 1,
): Promise<CodexWorkspaceSelectionResult> {
  if (!Number.isInteger(workspaceIndex) || workspaceIndex < 1) {
    throw new Error(
      'Codex workspace selection requires a positive 1-based workspace index.',
    )
  }

  if (!(await isCodexWorkspacePickerReady(page))) {
    throw new Error('Codex workspace picker was not ready.')
  }

  const selected = await page.evaluate(
    ({ requestedIndex }) => {
      const radioInputs = Array.from(
        document.querySelectorAll('input[type="radio"][name="workspace_id"]'),
      ) as HTMLInputElement[]

      if (radioInputs.length > 0) {
        if (requestedIndex > radioInputs.length) {
          return {
            availableWorkspaces: radioInputs.length,
            selectedWorkspaceIndex: 0,
            status: 'out_of_range' as const,
          }
        }

        const radio = radioInputs[requestedIndex - 1]
        radio.checked = true
        radio.dispatchEvent(new Event('input', { bubbles: true }))
        radio.dispatchEvent(new Event('change', { bubbles: true }))
        radio.click()

        return {
          availableWorkspaces: radioInputs.length,
          selectedWorkspaceIndex: requestedIndex,
          status: 'selected' as const,
        }
      }

      const select = document.querySelector(
        'select[name="workspace_id"]',
      ) as HTMLSelectElement | null
      if (select) {
        const availableWorkspaces = select.options.length
        if (requestedIndex > availableWorkspaces) {
          return {
            availableWorkspaces,
            selectedWorkspaceIndex: 0,
            status: 'out_of_range' as const,
          }
        }

        select.value = select.options[requestedIndex - 1]?.value || ''
        select.dispatchEvent(new Event('input', { bubbles: true }))
        select.dispatchEvent(new Event('change', { bubbles: true }))

        return {
          availableWorkspaces,
          selectedWorkspaceIndex: requestedIndex,
          status: 'selected' as const,
        }
      }

      const hiddenInput = document.querySelector(
        'input[name="workspace_id"]',
      ) as HTMLInputElement | null
      if (hiddenInput?.value) {
        return {
          availableWorkspaces: 1,
          selectedWorkspaceIndex: requestedIndex === 1 ? 1 : 0,
          status:
            requestedIndex === 1
              ? ('selected' as const)
              : ('out_of_range' as const),
        }
      }

      return {
        availableWorkspaces: 0,
        selectedWorkspaceIndex: 0,
        status: 'missing' as const,
      }
    },
    { requestedIndex: workspaceIndex },
  )

  if (selected.status === 'missing') {
    throw new Error(
      'Codex workspace picker did not expose a workspace_id input.',
    )
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
    throw new Error('Codex workspace submit button did not become enabled.')
  }

  await clickAny(page, CODEX_WORKSPACE_SUBMIT_SELECTORS)

  return {
    availableWorkspaces: selected.availableWorkspaces,
    selectedWorkspaceIndex: selected.selectedWorkspaceIndex,
  }
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
    const selection = await setNamedCodexSelection(page, fieldName, requestedIndex)
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

  if (selectedProject.status === 'missing') {
    throw new Error(
      'Codex organization picker did not expose a project_id input.',
    )
  }

  if (selectedProject.status === 'out_of_range') {
    throw new Error(
      `Requested project #${projectIndex}, but only ${selectedProject.availableOptions} projects were available.`,
    )
  }

  const submitReady = await waitForEnabledSelector(
    page,
    CODEX_ORGANIZATION_SUBMIT_SELECTORS,
    5000,
  )
  if (!submitReady) {
    throw new Error(
      'Codex organization submit button did not become enabled.',
    )
  }

  await clickAny(page, CODEX_ORGANIZATION_SUBMIT_SELECTORS)

  return {
    availableOrganizations: selectedOrganization.availableOptions,
    selectedOrganizationIndex: selectedOrganization.selectedOptionIndex,
    availableProjects: selectedProject.availableOptions,
    selectedProjectIndex: selectedProject.selectedOptionIndex,
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
