import type { Locator, Page } from 'patchright'
import { toLocator } from '../../utils/selectors'
import type { SelectorTarget } from '../../types'
import { sleep } from '../../utils/wait'
import type { VerificationProvider } from '../verification'
import {
  captureVirtualPasskeyStore,
  type VirtualPasskeyStore,
} from '../webauthn/virtual-authenticator'
import {
  CHATGPT_AUTHENTICATED_SELECTORS,
  CHATGPT_HOME_URL,
  DEFAULT_EVENT_TIMEOUT_MS,
  LOGIN_EMAIL_SELECTORS,
  LOGIN_NEXT_STEP_SELECTORS,
  ONBOARDING_SIGNAL_SELECTORS,
  PASSKEY_ENTRY_SELECTORS,
  PASSWORD_INPUT_SELECTORS,
  PASSWORD_TIMEOUT_ERROR_SELECTORS,
  PASSWORD_TIMEOUT_RETRY_SELECTORS,
  SECURITY_READY_SELECTORS,
  VERIFICATION_CODE_INPUT_SELECTORS,
  isChatGPTLoginUrl,
} from './common'

export type ChatGPTPostEmailLoginStep =
  | 'authenticated'
  | 'passkey'
  | 'password'
  | 'verification'
  | 'unknown'

export function isChatGPTHomeUrl(url: string): boolean {
  return (
    /^https:\/\/chatgpt\.com\/?(#.*)?$/i.test(url) ||
    url.startsWith(CHATGPT_HOME_URL)
  )
}

export async function waitForAnySelectorState(
  page: Page,
  selectors: SelectorTarget[],
  state: 'visible' | 'hidden' | 'attached' | 'detached',
  timeoutMs = DEFAULT_EVENT_TIMEOUT_MS,
): Promise<boolean> {
  if (!selectors.length) return false
  try {
    await Promise.any(
      selectors.map((selector) =>
        toLocator(page, selector)
          .first()
          .waitFor({ state, timeout: timeoutMs }),
      ),
    )
    return true
  } catch {
    return false
  }
}

export async function waitForUrlMatch(
  page: Page,
  predicate: (url: string) => boolean,
  timeoutMs = DEFAULT_EVENT_TIMEOUT_MS,
): Promise<boolean> {
  if (predicate(page.url())) return true
  try {
    await page.waitForURL((url) => predicate(String(url)), {
      timeout: timeoutMs,
    })
    return true
  } catch {
    return false
  }
}

export async function isLocatorEnabled(locator: Locator): Promise<boolean> {
  return locator
    .evaluate((element) => {
      const candidate = element as HTMLElement & { disabled?: boolean }
      return (
        !candidate.disabled &&
        candidate.getAttribute('aria-disabled') !== 'true'
      )
    })
    .catch(async () => locator.isEnabled().catch(() => false))
}

export async function hasEnabledSelector(
  page: Page,
  selectors: SelectorTarget[],
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = toLocator(page, selector).first()
    const visible = await locator.isVisible().catch(() => false)
    if (!visible) continue
    if (await isLocatorEnabled(locator)) return true
  }
  return false
}

export async function isLocatorEditable(locator: Locator): Promise<boolean> {
  return locator
    .evaluate((element) => {
      const candidate = element as HTMLInputElement | HTMLTextAreaElement
      const htmlElement = element as HTMLElement & { disabled?: boolean }
      const style = window.getComputedStyle(htmlElement)
      const rect = htmlElement.getBoundingClientRect()
      return (
        htmlElement.isConnected &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        !candidate.readOnly &&
        !htmlElement.disabled &&
        htmlElement.getAttribute('aria-disabled') !== 'true'
      )
    })
    .catch(async () => locator.isEditable().catch(() => false))
}

export async function hasEditableSelector(
  page: Page,
  selectors: SelectorTarget[],
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = toLocator(page, selector).first()
    const visible = await locator.isVisible().catch(() => false)
    if (!visible) continue
    if (await isLocatorEditable(locator)) return true
  }
  return false
}

export async function isAnySelectorVisible(
  page: Page,
  selectors: SelectorTarget[],
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = toLocator(page, selector).first()
    if (await locator.isVisible().catch(() => false)) return true
  }
  return false
}

export async function waitForEnabledSelector(
  page: Page,
  selectors: SelectorTarget[],
  timeoutMs = 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now())
    const visible = await waitForAnySelectorState(
      page,
      selectors,
      'visible',
      remainingMs,
    )
    if (!visible) break

    for (const selector of selectors) {
      const locator = toLocator(page, selector).first()
      const isVisible = await locator.isVisible().catch(() => false)
      if (!isVisible) continue
      const handle = await locator.elementHandle().catch(() => null)
      if (!handle) continue
      try {
        const perSelectorTimeoutMs = Math.min(
          1000,
          Math.max(1, deadline - Date.now()),
        )
        await page.waitForFunction(
          (element) => {
            const candidate = element as HTMLElement & { disabled?: boolean }
            const style = window.getComputedStyle(candidate)
            const rect = candidate.getBoundingClientRect()
            return (
              candidate.isConnected &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity || '1') > 0 &&
              rect.width > 0 &&
              rect.height > 0 &&
              !candidate.disabled &&
              candidate.getAttribute('aria-disabled') !== 'true'
            )
          },
          handle,
          { timeout: perSelectorTimeoutMs },
        )
        return true
      } catch {
        // try next selector
      } finally {
        await handle.dispose().catch(() => undefined)
      }
    }
  }

  return hasEnabledSelector(page, selectors)
}

export async function waitForEditableSelector(
  page: Page,
  selectors: SelectorTarget[],
  timeoutMs = 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now())
    const visible = await waitForAnySelectorState(
      page,
      selectors,
      'visible',
      remainingMs,
    )
    if (!visible) break
    if (await hasEditableSelector(page, selectors)) return true
    await sleep(Math.min(200, Math.max(1, deadline - Date.now())))
  }

  return hasEditableSelector(page, selectors)
}

export async function isProfileReady(page: Page): Promise<boolean> {
  const locator = page.locator('[data-testid="accounts-profile-button"]')
  const count = await locator.count().catch(() => 0)
  if (count === 0) return false
  const visible = await locator
    .first()
    .isVisible()
    .catch(() => false)
  if (visible) return true
  return page
    .evaluate(() => {
      const el = document.querySelector(
        '[data-testid="accounts-profile-button"]',
      ) as HTMLElement | null
      if (!el) return false
      const style = window.getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0
      )
    })
    .catch(() => false)
}

export async function waitForProfileReady(
  page: Page,
  timeoutMs = DEFAULT_EVENT_TIMEOUT_MS,
): Promise<boolean> {
  if (await isProfileReady(page)) return true
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="accounts-profile-button"]',
        ) as HTMLElement | null
        if (!el) return false
        const style = window.getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || '1') > 0 &&
          rect.width > 0 &&
          rect.height > 0
        )
      },
      undefined,
      { timeout: timeoutMs },
    )
    return true
  } catch {
    return false
  }
}

export async function waitForHomeInteractionSignal(
  page: Page,
  timeoutMs = 10000,
): Promise<boolean> {
  if (await isAnySelectorVisible(page, CHATGPT_AUTHENTICATED_SELECTORS)) {
    return true
  }

  const waiters: Array<Promise<void>> = []

  if (!isChatGPTHomeUrl(page.url())) {
    waiters.push(
      waitForUrlMatch(page, isChatGPTHomeUrl, timeoutMs).then((ready) => {
        if (!ready) throw new Error('chatgpt home url not ready')
      }),
    )
  }

  if (!(await isProfileReady(page))) {
    waiters.push(
      waitForProfileReady(page, timeoutMs).then((ready) => {
        if (!ready) throw new Error('profile not ready')
      }),
    )
  }

  waiters.push(
    waitForAnySelectorState(
      page,
      CHATGPT_AUTHENTICATED_SELECTORS,
      'visible',
      timeoutMs,
    ).then((ready) => {
      if (!ready) throw new Error('authenticated home signal not ready')
    }),
  )

  waiters.push(
    waitForAnySelectorState(
      page,
      ONBOARDING_SIGNAL_SELECTORS,
      'visible',
      timeoutMs,
    ).then((ready) => {
      if (!ready) throw new Error('onboarding action not ready')
    }),
  )

  if (!waiters.length) {
    await sleep(Math.min(timeoutMs, 250))
    return true
  }

  return Promise.any(waiters)
    .then(() => true)
    .catch(() => false)
}

export async function waitForPasswordSubmissionOutcome(
  page: Page,
  timeoutMs = 15000,
): Promise<'verification' | 'timeout' | 'unknown'> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isAnySelectorVisible(page, VERIFICATION_CODE_INPUT_SELECTORS))
      return 'verification'
    if (
      (await isAnySelectorVisible(page, PASSWORD_TIMEOUT_ERROR_SELECTORS)) &&
      (await isAnySelectorVisible(page, PASSWORD_TIMEOUT_RETRY_SELECTORS))
    ) {
      return 'timeout'
    }
    await sleep(500)
  }
  return 'unknown'
}

export async function waitUntilChatGPTHomeReady(
  page: Page,
  clickOnboardingAction: (page: Page) => Promise<string | null>,
  rounds = 20,
): Promise<boolean> {
  let sawOnboarding = false
  let onboardingClicks = 0
  let authenticatedIdleRounds = 0
  for (let round = 0; round < rounds; round += 1) {
    const url = page.url()
    const onChatGPT = isChatGPTHomeUrl(url)

    if (!onChatGPT) {
      authenticatedIdleRounds = 0
      await waitForHomeInteractionSignal(page, 10000)
      continue
    }

    const onboardingVisible = await isAnySelectorVisible(
      page,
      ONBOARDING_SIGNAL_SELECTORS,
    )
    if (onboardingVisible) sawOnboarding = true

    const action = await clickOnboardingAction(page)
    if (action) {
      sawOnboarding = true
      onboardingClicks += 1
      authenticatedIdleRounds = 0
      await waitForHomeInteractionSignal(page, DEFAULT_EVENT_TIMEOUT_MS)
      continue
    }

    if (onboardingVisible) {
      authenticatedIdleRounds = 0
      await waitForHomeInteractionSignal(page, DEFAULT_EVENT_TIMEOUT_MS)
      continue
    }

    const authenticated = await waitForAuthenticatedSession(page, 250)
    if (authenticated && (!sawOnboarding || onboardingClicks > 0)) {
      authenticatedIdleRounds += 1
      if (authenticatedIdleRounds >= 2) return true
      await waitForHomeInteractionSignal(page, DEFAULT_EVENT_TIMEOUT_MS)
      continue
    }

    authenticatedIdleRounds = 0
    await waitForHomeInteractionSignal(page, DEFAULT_EVENT_TIMEOUT_MS)
  }

  return false
}

export async function waitForLoginEmailSubmissionOutcome(
  page: Page,
  timeoutMs = 15000,
): Promise<'next' | 'timeout' | 'unknown'> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await detectPostEmailLoginStep(page)) !== 'unknown') return 'next'
    if (
      (await isAnySelectorVisible(page, PASSWORD_TIMEOUT_ERROR_SELECTORS)) &&
      (await isAnySelectorVisible(page, PASSWORD_TIMEOUT_RETRY_SELECTORS))
    ) {
      return 'timeout'
    }
    await sleep(500)
  }
  return 'unknown'
}

export async function detectPostEmailLoginStep(
  page: Page,
): Promise<ChatGPTPostEmailLoginStep> {
  if (await waitForAuthenticatedSession(page, 250)) return 'authenticated'
  if (await hasEnabledSelector(page, PASSKEY_ENTRY_SELECTORS)) return 'passkey'
  if (await isAnySelectorVisible(page, VERIFICATION_CODE_INPUT_SELECTORS))
    return 'verification'
  if (await hasEnabledSelector(page, PASSWORD_INPUT_SELECTORS))
    return 'password'
  if (await isAnySelectorVisible(page, PASSKEY_ENTRY_SELECTORS))
    return 'passkey'
  if (await isAnySelectorVisible(page, PASSWORD_INPUT_SELECTORS))
    return 'password'
  if (await isAnySelectorVisible(page, LOGIN_NEXT_STEP_SELECTORS))
    return 'passkey'
  return 'unknown'
}

export async function waitForPostEmailLoginStep(
  page: Page,
  timeoutMs = 15000,
): Promise<ChatGPTPostEmailLoginStep> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const step = await detectPostEmailLoginStep(page)
    if (step !== 'unknown') return step
    await sleep(250)
  }

  return detectPostEmailLoginStep(page)
}

export async function waitForPasskeyCreation(
  page: Page,
  session: Awaited<
    ReturnType<
      typeof import('../webauthn/virtual-authenticator').loadVirtualPasskeyStore
    >
  >['session'],
  authenticatorId: string,
  timeoutMs = 20000,
): Promise<VirtualPasskeyStore> {
  const deadline = Date.now() + timeoutMs
  let pauseMs = 100
  while (Date.now() < deadline) {
    const store = await captureVirtualPasskeyStore(
      session as never,
      authenticatorId,
    )
    if (store.credentials.length > 0) return store
    await Promise.any([
      page.waitForLoadState('domcontentloaded', {
        timeout: Math.min(pauseMs, Math.max(1, deadline - Date.now())),
      }),
      sleep(Math.min(pauseMs, Math.max(1, deadline - Date.now()))),
    ]).catch(() => undefined)
    pauseMs = Math.min(pauseMs * 2, 1000)
  }
  return captureVirtualPasskeyStore(session as never, authenticatorId)
}

export async function waitForAuthenticatedSession(
  page: Page,
  timeoutMs = 30000,
): Promise<boolean> {
  const ready = await waitForAnySelectorState(
    page,
    CHATGPT_AUTHENTICATED_SELECTORS,
    'visible',
    timeoutMs,
  )
  if (ready) return true
  return isChatGPTHomeUrl(page.url()) && (await isProfileReady(page))
}

export async function waitForLoginEmailFormReady(
  page: Page,
  timeoutMs = 15000,
): Promise<boolean> {
  const formSelectors: SelectorTarget[] = [
    'form[action="/log-in-or-create-account"]',
    ...LOGIN_EMAIL_SELECTORS,
  ]
  const visible = await waitForAnySelectorState(
    page,
    formSelectors,
    'visible',
    timeoutMs,
  )
  if (!visible) return false

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const emailReady = await hasEditableSelector(page, LOGIN_EMAIL_SELECTORS)
    if (isChatGPTLoginUrl(page.url()) && emailReady) {
      await sleep(500)
      return true
    }
    await sleep(200)
  }

  return false
}

export async function waitForLoginSurface(
  page: Page,
  timeoutMs = 15000,
): Promise<'authenticated' | 'email' | 'passkey' | 'unknown'> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await waitForAuthenticatedSession(page, 500)) return 'authenticated'
    if (await hasEnabledSelector(page, PASSKEY_ENTRY_SELECTORS))
      return 'passkey'
    if (await hasEnabledSelector(page, LOGIN_EMAIL_SELECTORS)) return 'email'
    if (isChatGPTLoginUrl(page.url())) {
      if (await isAnySelectorVisible(page, PASSKEY_ENTRY_SELECTORS))
        return 'passkey'
      if (await isAnySelectorVisible(page, LOGIN_EMAIL_SELECTORS))
        return 'email'
    }
    await sleep(250)
  }

  return 'unknown'
}

export async function waitForPasskeyEntryReady(
  page: Page,
  timeoutMs = 20000,
): Promise<boolean> {
  const ready = await waitForAnySelectorState(
    page,
    PASSKEY_ENTRY_SELECTORS,
    'visible',
    timeoutMs,
  )
  if (!ready) return false
  return waitForEnabledSelector(page, PASSKEY_ENTRY_SELECTORS, timeoutMs)
}

export async function waitForRetryOrPasskeyEntryReady(
  page: Page,
  timeoutMs = 10000,
  allowPasskeyEntry = true,
): Promise<'retry' | 'passkey' | 'none'> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await hasEnabledSelector(page, PASSWORD_TIMEOUT_RETRY_SELECTORS)) {
      return 'retry'
    }
    if (
      allowPasskeyEntry &&
      (await hasEnabledSelector(page, PASSKEY_ENTRY_SELECTORS))
    ) {
      return 'passkey'
    }
    await sleep(250)
  }

  return 'none'
}

export async function waitForVerificationCode(params: {
  verificationProvider: VerificationProvider
  email: string
  startedAt: string
  timeoutMs: number
  pollIntervalMs: number
  onPollAttempt?: (attempt: number) => void
}): Promise<string> {
  return params.verificationProvider.waitForVerificationCode({
    email: params.email,
    startedAt: params.startedAt,
    timeoutMs: params.timeoutMs,
    pollIntervalMs: params.pollIntervalMs,
    onPollAttempt: params.onPollAttempt,
  })
}

export async function isSecuritySettingsReady(page: Page): Promise<boolean> {
  const addVisible = await page
    .locator('button')
    .filter({ hasText: /安全密钥和通行密钥|security keys and passkeys/i })
    .first()
    .isVisible()
    .catch(() => false)
  if (addVisible) return true
  return waitForAnySelectorState(page, SECURITY_READY_SELECTORS, 'visible', 250)
}

export async function waitForPasswordInputReady(
  page: Page,
  timeoutMs = 10000,
): Promise<boolean> {
  return waitForEditableSelector(page, PASSWORD_INPUT_SELECTORS, timeoutMs)
}

export async function waitForVerificationCodeInputReady(
  page: Page,
  timeoutMs = 10000,
): Promise<boolean> {
  return waitForEditableSelector(
    page,
    VERIFICATION_CODE_INPUT_SELECTORS,
    timeoutMs,
  )
}
