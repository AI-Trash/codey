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
  AGE_GATE_AGE_SELECTORS,
  AGE_GATE_BIRTHDAY_GROUP_SELECTORS,
  AGE_GATE_BIRTHDAY_HIDDEN_INPUT_SELECTORS,
  CODEX_CONSENT_SUBMIT_SELECTORS,
  CODEX_WORKSPACE_SELECTORS,
  CODEX_WORKSPACE_SUBMIT_SELECTORS,
  CHATGPT_AUTHENTICATED_SELECTORS,
  CHATGPT_HOME_URL,
  DEFAULT_EVENT_TIMEOUT_MS,
  isChatGPTCodexAccountConsentUrl,
  isChatGPTCodexConsentUrl,
  LOGIN_CONTINUE_SELECTORS,
  LOGIN_EMAIL_SELECTORS,
  LOGIN_ENTRY_SELECTORS,
  LOGIN_NEXT_STEP_SELECTORS,
  ONBOARDING_SIGNAL_SELECTORS,
  PASSKEY_ENTRY_SELECTORS,
  PASSWORD_INPUT_SELECTORS,
  PASSWORD_TIMEOUT_ERROR_SELECTORS,
  PASSWORD_TIMEOUT_ERROR_TITLE_PATTERN,
  PASSWORD_TIMEOUT_RETRY_SELECTORS,
  SECURITY_READY_SELECTORS,
  SIGNUP_ENTRY_SELECTORS,
  VERIFICATION_CODE_INPUT_SELECTORS,
} from './common'

export type ChatGPTPostEmailLoginStep =
  | 'authenticated'
  | 'passkey'
  | 'password'
  | 'verification'
  | 'retry'
  | 'unknown'

export type ChatGPTLoginSurface =
  | 'authenticated'
  | 'email'
  | 'passkey'
  | 'unknown'

export type ChatGPTLoginEntrySurface =
  | 'authenticated'
  | 'login'
  | 'email'
  | 'passkey'
  | 'unknown'

export type ChatGPTCodexOAuthSurface =
  | ChatGPTLoginEntrySurface
  | 'workspace'
  | 'consent'

export type ChatGPTPasskeyTrigger = 'retry' | 'passkey' | 'none'

export type ChatGPTRegistrationEntrySurface =
  | 'authenticated'
  | 'email'
  | 'signup'
  | 'unknown'

export type ChatGPTAgeGateFieldMode = 'age' | 'birthday'

export function isChatGPTHomeUrl(url: string): boolean {
  return (
    /^https:\/\/chatgpt\.com\/?(#.*)?$/i.test(url) ||
    url.startsWith(CHATGPT_HOME_URL)
  )
}

async function isLoginEmailFieldReady(page: Page): Promise<boolean> {
  return hasEditableSelector(page, LOGIN_EMAIL_SELECTORS)
}

async function hasVisibleLoginAction(page: Page): Promise<boolean> {
  return (
    (await isAnySelectorVisible(page, LOGIN_CONTINUE_SELECTORS)) ||
    (await isAnySelectorVisible(page, PASSKEY_ENTRY_SELECTORS)) ||
    (await isAnySelectorVisible(page, LOGIN_ENTRY_SELECTORS))
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
  const count =
    typeof (locator as { count?: () => Promise<number> }).count === 'function'
      ? await locator.count().catch(() => 0)
      : undefined
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
    if (await hasPasswordTimeoutErrorState(page)) {
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
): Promise<'next' | 'retry' | 'timeout' | 'unknown'> {
  const deadline = Date.now() + timeoutMs
  let emailSurfaceLeft = false
  let emailSurfaceReturnedAt: number | null = null
  while (Date.now() < deadline) {
    const step = await detectPostEmailLoginStep(page)
    if (step === 'retry') {
      const retryState = await getExplicitLoginEmailRetryState(page)
      return retryState === 'none' ? 'retry' : retryState
    }
    if (step !== 'unknown') return 'next'

    const retryState = await getExplicitLoginEmailRetryState(page)
    if (retryState !== 'none') {
      return retryState
    }

    const emailSurfaceReady = await isLoginEmailSurfaceReady(page)
    if (!emailSurfaceReady) {
      emailSurfaceLeft = true
      emailSurfaceReturnedAt = null
    } else if (emailSurfaceLeft) {
      emailSurfaceReturnedAt ??= Date.now()
      if (Date.now() - emailSurfaceReturnedAt >= 750) {
        return 'retry'
      }
    }

    await sleep(500)
  }

  const retryState = await getExplicitLoginEmailRetryState(page)
  if (retryState !== 'none') {
    return retryState
  }

  return (await isLoginEmailSurfaceReady(page)) ? 'retry' : 'unknown'
}

export async function hasPasswordTimeoutErrorState(
  page: Page,
): Promise<boolean> {
  if (await isAnySelectorVisible(page, PASSWORD_TIMEOUT_ERROR_SELECTORS)) {
    return true
  }

  const title = await page.title().catch(() => '')
  return PASSWORD_TIMEOUT_ERROR_TITLE_PATTERN.test(title)
}

async function isLoginEmailSurfaceReady(page: Page): Promise<boolean> {
  if (!(await hasEditableSelector(page, LOGIN_EMAIL_SELECTORS))) {
    return false
  }

  if (await hasEnabledSelector(page, LOGIN_CONTINUE_SELECTORS)) {
    return true
  }

  return isAnySelectorVisible(page, LOGIN_CONTINUE_SELECTORS)
}

async function getExplicitLoginEmailRetryState(
  page: Page,
): Promise<'retry' | 'timeout' | 'none'> {
  if (await hasEnabledSelector(page, PASSWORD_TIMEOUT_RETRY_SELECTORS)) {
    return 'retry'
  }

  if (await hasPasswordTimeoutErrorState(page)) {
    return 'timeout'
  }

  return 'none'
}

function pushUniqueCandidate<T extends string>(list: T[], candidate: T): void {
  if (!list.includes(candidate)) {
    list.push(candidate)
  }
}

export async function getPostEmailLoginStepCandidates(
  page: Page,
): Promise<Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[]> {
  const candidates: Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[] = []

  if (await waitForAuthenticatedSession(page, 250)) {
    pushUniqueCandidate(candidates, 'authenticated')
  }
  if (await hasEnabledSelector(page, PASSKEY_ENTRY_SELECTORS)) {
    pushUniqueCandidate(candidates, 'passkey')
  }
  if (await isAnySelectorVisible(page, VERIFICATION_CODE_INPUT_SELECTORS)) {
    pushUniqueCandidate(candidates, 'verification')
  }
  if (await hasEnabledSelector(page, PASSWORD_INPUT_SELECTORS)) {
    pushUniqueCandidate(candidates, 'password')
  }
  if (await isAnySelectorVisible(page, PASSKEY_ENTRY_SELECTORS)) {
    pushUniqueCandidate(candidates, 'passkey')
  }
  if (await isAnySelectorVisible(page, PASSWORD_INPUT_SELECTORS)) {
    pushUniqueCandidate(candidates, 'password')
  }
  if ((await getExplicitLoginEmailRetryState(page)) !== 'none') {
    pushUniqueCandidate(candidates, 'retry')
  }
  if (await isAnySelectorVisible(page, LOGIN_NEXT_STEP_SELECTORS)) {
    pushUniqueCandidate(candidates, 'passkey')
  }

  return candidates
}

export async function detectPostEmailLoginStep(
  page: Page,
): Promise<ChatGPTPostEmailLoginStep> {
  return (await getPostEmailLoginStepCandidates(page))[0] ?? 'unknown'
}

export async function waitForPostEmailLoginCandidates(
  page: Page,
  timeoutMs = 15000,
): Promise<Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const candidates = await getPostEmailLoginStepCandidates(page)
    if (candidates.length > 0) {
      return candidates
    }
    await sleep(250)
  }

  return getPostEmailLoginStepCandidates(page)
}

export async function waitForPostEmailLoginStep(
  page: Page,
  timeoutMs = 15000,
): Promise<ChatGPTPostEmailLoginStep> {
  return (
    (await waitForPostEmailLoginCandidates(page, timeoutMs))[0] ?? 'unknown'
  )
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
  return isProfileReady(page)
}

export async function getRegistrationEntryCandidates(
  page: Page,
): Promise<Exclude<ChatGPTRegistrationEntrySurface, 'unknown'>[]> {
  const candidates: Exclude<ChatGPTRegistrationEntrySurface, 'unknown'>[] = []

  if (await waitForAuthenticatedSession(page, 250)) {
    pushUniqueCandidate(candidates, 'authenticated')
  }
  if (await isLoginEmailSurfaceReady(page)) {
    pushUniqueCandidate(candidates, 'email')
  }
  if (await isAnySelectorVisible(page, SIGNUP_ENTRY_SELECTORS)) {
    pushUniqueCandidate(candidates, 'signup')
  }

  return candidates
}

export async function waitForRegistrationEntryCandidates(
  page: Page,
  timeoutMs = 15000,
): Promise<Exclude<ChatGPTRegistrationEntrySurface, 'unknown'>[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const candidates = await getRegistrationEntryCandidates(page)
    if (candidates.length > 0) {
      return candidates
    }
    await sleep(250)
  }

  return getRegistrationEntryCandidates(page)
}

export async function getAgeGateFieldCandidates(
  page: Page,
): Promise<ChatGPTAgeGateFieldMode[]> {
  const candidates: ChatGPTAgeGateFieldMode[] = []

  if (await hasEditableSelector(page, AGE_GATE_AGE_SELECTORS)) {
    pushUniqueCandidate(candidates, 'age')
  }

  const birthdayVisible = await isAnySelectorVisible(
    page,
    AGE_GATE_BIRTHDAY_GROUP_SELECTORS,
  )
  const birthdayHiddenPresent = await waitForAnySelectorState(
    page,
    AGE_GATE_BIRTHDAY_HIDDEN_INPUT_SELECTORS,
    'attached',
    250,
  )

  if (birthdayVisible || birthdayHiddenPresent) {
    pushUniqueCandidate(candidates, 'birthday')
  }

  return candidates
}

export async function waitForAgeGateFieldCandidates(
  page: Page,
  timeoutMs = 3000,
): Promise<ChatGPTAgeGateFieldMode[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const candidates = await getAgeGateFieldCandidates(page)
    if (candidates.length > 0) {
      return candidates
    }
    await sleep(250)
  }

  return getAgeGateFieldCandidates(page)
}

export async function waitForLoginEmailFormReady(
  page: Page,
  timeoutMs = 15000,
): Promise<boolean> {
  const formSelectors: SelectorTarget[] = [
    'form[action="/log-in-or-create-account"]',
    ...LOGIN_CONTINUE_SELECTORS,
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
    const emailReady = await isLoginEmailFieldReady(page)
    if (emailReady) {
      await sleep(500)
      return true
    }
    await sleep(200)
  }

  return isLoginEmailFieldReady(page)
}

export async function getLoginSurfaceCandidates(
  page: Page,
): Promise<Exclude<ChatGPTLoginSurface, 'unknown'>[]> {
  const candidates: Exclude<ChatGPTLoginSurface, 'unknown'>[] = []

  if (await waitForAuthenticatedSession(page, 500)) {
    pushUniqueCandidate(candidates, 'authenticated')
  }
  if (await hasEnabledSelector(page, PASSKEY_ENTRY_SELECTORS)) {
    pushUniqueCandidate(candidates, 'passkey')
  }
  if (await isLoginEmailFieldReady(page)) {
    pushUniqueCandidate(candidates, 'email')
  }
  if (await isAnySelectorVisible(page, PASSKEY_ENTRY_SELECTORS)) {
    pushUniqueCandidate(candidates, 'passkey')
  }
  if (
    candidates.length === 0 &&
    (await isLoginEmailFieldReady(page)) &&
    (await hasVisibleLoginAction(page))
  ) {
    pushUniqueCandidate(candidates, 'email')
  }

  return candidates
}

export async function getLoginEntryCandidates(
  page: Page,
): Promise<Exclude<ChatGPTLoginEntrySurface, 'unknown'>[]> {
  const candidates: Exclude<ChatGPTLoginEntrySurface, 'unknown'>[] = []

  if (await waitForAuthenticatedSession(page, 500)) {
    pushUniqueCandidate(candidates, 'authenticated')
  }
  if (await hasEnabledSelector(page, LOGIN_ENTRY_SELECTORS)) {
    pushUniqueCandidate(candidates, 'login')
  }
  if (await hasEnabledSelector(page, PASSKEY_ENTRY_SELECTORS)) {
    pushUniqueCandidate(candidates, 'passkey')
  }
  if (await isLoginEmailFieldReady(page)) {
    pushUniqueCandidate(candidates, 'email')
  }
  if (await isAnySelectorVisible(page, LOGIN_ENTRY_SELECTORS)) {
    pushUniqueCandidate(candidates, 'login')
  }
  if (await isAnySelectorVisible(page, PASSKEY_ENTRY_SELECTORS)) {
    pushUniqueCandidate(candidates, 'passkey')
  }
  if (
    candidates.length === 0 &&
    (await isLoginEmailFieldReady(page)) &&
    (await hasVisibleLoginAction(page))
  ) {
    pushUniqueCandidate(candidates, 'email')
  }

  return candidates
}

export async function isCodexWorkspacePickerReady(
  page: Page,
): Promise<boolean> {
  if (!isChatGPTCodexConsentUrl(page.url())) {
    return false
  }

  return (
    (await isAnySelectorVisible(page, CODEX_WORKSPACE_SELECTORS)) ||
    (await hasEnabledSelector(page, CODEX_WORKSPACE_SUBMIT_SELECTORS))
  )
}

export async function isCodexConsentReady(page: Page): Promise<boolean> {
  if (!isChatGPTCodexAccountConsentUrl(page.url())) {
    return false
  }

  return (
    (await hasEnabledSelector(page, CODEX_CONSENT_SUBMIT_SELECTORS)) ||
    (await isAnySelectorVisible(page, CODEX_CONSENT_SUBMIT_SELECTORS))
  )
}

export async function getCodexOAuthSurfaceCandidates(
  page: Page,
): Promise<Exclude<ChatGPTCodexOAuthSurface, 'unknown'>[]> {
  const candidates: Exclude<ChatGPTCodexOAuthSurface, 'unknown'>[] = []

  if (await isCodexWorkspacePickerReady(page)) {
    pushUniqueCandidate(candidates, 'workspace')
  }
  if (await isCodexConsentReady(page)) {
    pushUniqueCandidate(candidates, 'consent')
  }

  for (const candidate of await getLoginEntryCandidates(page)) {
    pushUniqueCandidate(candidates, candidate)
  }

  return candidates
}

export async function waitForLoginEntryCandidates(
  page: Page,
  timeoutMs = 15000,
): Promise<Exclude<ChatGPTLoginEntrySurface, 'unknown'>[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const candidates = await getLoginEntryCandidates(page)
    if (candidates.length > 0) {
      return candidates
    }
    await sleep(250)
  }

  return getLoginEntryCandidates(page)
}

export async function waitForLoginEntrySurface(
  page: Page,
  timeoutMs = 15000,
): Promise<ChatGPTLoginEntrySurface> {
  return (await waitForLoginEntryCandidates(page, timeoutMs))[0] ?? 'unknown'
}

export async function waitForCodexOAuthSurface(
  page: Page,
  timeoutMs = 15000,
): Promise<ChatGPTCodexOAuthSurface> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const candidates = await getCodexOAuthSurfaceCandidates(page)
    if (candidates.length > 0) {
      return candidates[0]
    }
    await sleep(250)
  }

  return (await getCodexOAuthSurfaceCandidates(page))[0] ?? 'unknown'
}

export async function waitForLoginSurfaceCandidates(
  page: Page,
  timeoutMs = 15000,
): Promise<Exclude<ChatGPTLoginSurface, 'unknown'>[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const candidates = await getLoginSurfaceCandidates(page)
    if (candidates.length > 0) {
      return candidates
    }
    await sleep(250)
  }

  return getLoginSurfaceCandidates(page)
}

export async function waitForLoginSurface(
  page: Page,
  timeoutMs = 15000,
): Promise<ChatGPTLoginSurface> {
  return (await waitForLoginSurfaceCandidates(page, timeoutMs))[0] ?? 'unknown'
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

export async function getRetryOrPasskeyEntryCandidates(
  page: Page,
  allowPasskeyEntry = true,
): Promise<Exclude<ChatGPTPasskeyTrigger, 'none'>[]> {
  const candidates: Exclude<ChatGPTPasskeyTrigger, 'none'>[] = []

  if (
    (await hasEnabledSelector(page, PASSWORD_TIMEOUT_RETRY_SELECTORS)) ||
    (await hasPasswordTimeoutErrorState(page))
  ) {
    pushUniqueCandidate(candidates, 'retry')
  }
  if (
    allowPasskeyEntry &&
    (await hasEnabledSelector(page, PASSKEY_ENTRY_SELECTORS))
  ) {
    pushUniqueCandidate(candidates, 'passkey')
  }

  return candidates
}

export async function waitForRetryOrPasskeyEntryCandidates(
  page: Page,
  timeoutMs = 10000,
  allowPasskeyEntry = true,
): Promise<Exclude<ChatGPTPasskeyTrigger, 'none'>[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const candidates = await getRetryOrPasskeyEntryCandidates(
      page,
      allowPasskeyEntry,
    )
    if (candidates.length > 0) {
      return candidates
    }
    await sleep(250)
  }

  return getRetryOrPasskeyEntryCandidates(page, allowPasskeyEntry)
}

export async function waitForRetryOrPasskeyEntryReady(
  page: Page,
  timeoutMs = 10000,
  allowPasskeyEntry = true,
): Promise<ChatGPTPasskeyTrigger> {
  return (
    (
      await waitForRetryOrPasskeyEntryCandidates(
        page,
        timeoutMs,
        allowPasskeyEntry,
      )
    )[0] ?? 'none'
  )
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
