import type { Locator, Page } from 'patchright'
import { toLocator } from '../../utils/selectors'
import type { SelectorTarget } from '../../types'
import { sleep } from '../../utils/wait'
import type { VerificationProvider } from '../verification'
import {
  ACCOUNT_DEACTIVATED_ERROR_SELECTORS,
  AGE_GATE_AGE_SELECTORS,
  AGE_GATE_BIRTHDAY_GROUP_SELECTORS,
  AGE_GATE_BIRTHDAY_HIDDEN_INPUT_SELECTORS,
  CODEX_CONSENT_SUBMIT_SELECTORS,
  CODEX_ORGANIZATION_SELECTORS,
  CODEX_ORGANIZATION_SUBMIT_SELECTORS,
  CODEX_WORKSPACE_SELECTORS,
  CODEX_WORKSPACE_SUBMIT_SELECTORS,
  CHATGPT_AUTHENTICATED_SELECTORS,
  CHATGPT_HOME_URL,
  CHATGPT_TEAM_PRICING_PROMO_URL,
  DEFAULT_EVENT_TIMEOUT_MS,
  isChatGPTCodexAccountConsentUrl,
  isChatGPTCodexConsentUrl,
  isChatGPTCodexOrganizationUrl,
  LOGIN_CONTINUE_SELECTORS,
  LOGIN_EMAIL_SELECTORS,
  LOGIN_ENTRY_SELECTORS,
  MIN_ONBOARDING_CLICKS,
  ONBOARDING_IDLE_POLL_MS,
  ONBOARDING_IDLE_WAIT_AFTER_MIN_CLICKS_MS,
  ONBOARDING_IDLE_WAIT_BEFORE_MIN_CLICKS_MS,
  ONBOARDING_SIGNAL_SELECTORS,
  PASSWORD_INPUT_SELECTORS,
  PASSWORD_TIMEOUT_ERROR_SELECTORS,
  PASSWORD_TIMEOUT_ERROR_TITLE_PATTERN,
  PASSWORD_TIMEOUT_RETRY_SELECTORS,
  SIGNUP_ENTRY_SELECTORS,
  TEAM_PRICING_FREE_TRIAL_SELECTORS,
  VERIFICATION_CODE_INPUT_SELECTORS,
} from './common'
import { ChatGPTAccountDeactivatedError } from './errors'

export type ChatGPTPostEmailLoginStep =
  | 'authenticated'
  | 'password'
  | 'verification'
  | 'retry'
  | 'unknown'

export type ChatGPTLoginSurface = 'authenticated' | 'email' | 'unknown'

export type ChatGPTLoginEntrySurface =
  | 'authenticated'
  | 'login'
  | 'email'
  | 'unknown'

export type ChatGPTCodexOAuthSurface =
  | ChatGPTLoginEntrySurface
  | 'workspace'
  | 'organization'
  | 'consent'

export type ChatGPTRegistrationEntrySurface =
  | 'authenticated'
  | 'email'
  | 'signup'
  | 'unknown'

export type ChatGPTAgeGateFieldMode = 'age' | 'birthday'

const CHATGPT_NEW_USER_ONBOARDING_ANNOUNCEMENT_KEYS = [
  'oai/apps/hasSeenOnboardingFlow',
  'oai/apps/hasSeenOnboarding',
  'oai/apps/hasSeenStaticOnboarding',
  'oai/apps/hasSeenPromptOnboarding',
] as const

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
      if (await isLocatorEnabled(locator)) return true
    }

    await sleep(Math.min(200, Math.max(1, deadline - Date.now())))
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
    await throwIfChatGPTAccountDeactivated(page)
    if (await isAnySelectorVisible(page, VERIFICATION_CODE_INPUT_SELECTORS))
      return 'verification'
    if (await hasPasswordTimeoutErrorState(page)) {
      return 'timeout'
    }
    await sleep(500)
  }
  await throwIfChatGPTAccountDeactivated(page)
  return 'unknown'
}

export async function getPendingOnboardingAnnouncementKeys(
  page: Page,
): Promise<string[]> {
  try {
    const pendingKeys = await page.evaluate(
      async (onboardingKeys) => {
        const response = await fetch('/backend-api/settings/user', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
          },
        })

        if (!response.ok) {
          return []
        }

        const payload = (await response.json()) as {
          eligible_announcements?: unknown
        }
        const eligible = Array.isArray(payload.eligible_announcements)
          ? payload.eligible_announcements.filter(
              (value): value is string => typeof value === 'string',
            )
          : []

        return eligible.filter((value) => onboardingKeys.includes(value))
      },
      [...CHATGPT_NEW_USER_ONBOARDING_ANNOUNCEMENT_KEYS],
    )

    return Array.isArray(pendingKeys)
      ? pendingKeys.filter((value): value is string => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

export async function waitUntilChatGPTHomeReady(
  page: Page,
  clickOnboardingAction: (page: Page) => Promise<string | null>,
  rounds = 20,
): Promise<boolean> {
  let onboardingClicks = 0
  let authenticatedIdleStartedAt: number | null = null
  const longIdleRounds = Math.ceil(
    ONBOARDING_IDLE_WAIT_BEFORE_MIN_CLICKS_MS / ONBOARDING_IDLE_POLL_MS,
  )
  const maxRounds = Math.max(
    rounds,
    longIdleRounds + MIN_ONBOARDING_CLICKS + 2,
  )

  for (let round = 0; round < maxRounds; round += 1) {
    const onboardingVisible = await isAnySelectorVisible(
      page,
      ONBOARDING_SIGNAL_SELECTORS,
    )

    const action = await clickOnboardingAction(page)
    if (action) {
      onboardingClicks += 1
      authenticatedIdleStartedAt = null
      await sleep(ONBOARDING_IDLE_POLL_MS)
      continue
    }

    if (onboardingVisible) {
      authenticatedIdleStartedAt = null
      await sleep(ONBOARDING_IDLE_POLL_MS)
      continue
    }

    const authenticated = await waitForAuthenticatedSession(page, 250)
    const pendingOnboardingAnnouncementKeys = authenticated
      ? await getPendingOnboardingAnnouncementKeys(page)
      : []
    if (pendingOnboardingAnnouncementKeys.length > 0) {
      authenticatedIdleStartedAt = null
      await sleep(ONBOARDING_IDLE_POLL_MS)
      continue
    }

    if (authenticated) {
      const requiredIdleMs =
        onboardingClicks >= MIN_ONBOARDING_CLICKS
          ? ONBOARDING_IDLE_WAIT_AFTER_MIN_CLICKS_MS
          : ONBOARDING_IDLE_WAIT_BEFORE_MIN_CLICKS_MS
      authenticatedIdleStartedAt ??= Date.now()
      const idleElapsedMs = Date.now() - authenticatedIdleStartedAt
      if (idleElapsedMs >= requiredIdleMs) return true
      await sleep(Math.min(ONBOARDING_IDLE_POLL_MS, requiredIdleMs - idleElapsedMs))
      continue
    }

    authenticatedIdleStartedAt = null
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
    await throwIfChatGPTAccountDeactivated(page)
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

  await throwIfChatGPTAccountDeactivated(page)
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

export async function hasChatGPTAccountDeactivatedErrorState(
  page: Page,
): Promise<boolean> {
  if (await isAnySelectorVisible(page, ACCOUNT_DEACTIVATED_ERROR_SELECTORS)) {
    return true
  }

  const title =
    typeof (page as Page & { title?: () => Promise<string> }).title ===
    'function'
      ? await page.title().catch(() => '')
      : ''
  if (!PASSWORD_TIMEOUT_ERROR_TITLE_PATTERN.test(title)) {
    return false
  }

  return isAnySelectorVisible(page, ACCOUNT_DEACTIVATED_ERROR_SELECTORS)
}

export async function throwIfChatGPTAccountDeactivated(
  page: Page,
): Promise<void> {
  if (await hasChatGPTAccountDeactivatedErrorState(page)) {
    throw new ChatGPTAccountDeactivatedError()
  }
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
  await throwIfChatGPTAccountDeactivated(page)
  const candidates: Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[] = []

  if (await waitForAuthenticatedSession(page, 250)) {
    pushUniqueCandidate(candidates, 'authenticated')
  }
  if (await isAnySelectorVisible(page, CHATGPT_AUTHENTICATED_SELECTORS)) {
    pushUniqueCandidate(candidates, 'authenticated')
  }
  if (await isAnySelectorVisible(page, VERIFICATION_CODE_INPUT_SELECTORS)) {
    pushUniqueCandidate(candidates, 'verification')
  }
  if (await hasEnabledSelector(page, PASSWORD_INPUT_SELECTORS)) {
    pushUniqueCandidate(candidates, 'password')
  }
  if (await isAnySelectorVisible(page, PASSWORD_INPUT_SELECTORS)) {
    pushUniqueCandidate(candidates, 'password')
  }
  if ((await getExplicitLoginEmailRetryState(page)) !== 'none') {
    pushUniqueCandidate(candidates, 'retry')
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

export async function waitForAuthenticatedSession(
  page: Page,
  timeoutMs = 30000,
): Promise<boolean> {
  await throwIfChatGPTAccountDeactivated(page)
  const ready = await waitForAnySelectorState(
    page,
    CHATGPT_AUTHENTICATED_SELECTORS,
    'visible',
    timeoutMs,
  )
  if (ready) return true
  await throwIfChatGPTAccountDeactivated(page)
  return isProfileReady(page)
}

export function isChatGPTTeamPricingPromoUrl(url: string): boolean {
  return url.startsWith(CHATGPT_TEAM_PRICING_PROMO_URL)
}

export async function waitForTeamPricingFreeTrialReady(
  page: Page,
  timeoutMs = 30000,
): Promise<boolean> {
  return waitForAnySelectorState(
    page,
    TEAM_PRICING_FREE_TRIAL_SELECTORS,
    'visible',
    timeoutMs,
  )
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
  const birthdayHiddenPresent =
    birthdayVisible ||
    (await waitForAnySelectorState(
      page,
      AGE_GATE_BIRTHDAY_HIDDEN_INPUT_SELECTORS,
      'attached',
      1,
    ))

  if (birthdayHiddenPresent) {
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
    await sleep(Math.min(100, Math.max(1, deadline - Date.now())))
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
  if (await isLoginEmailFieldReady(page)) {
    pushUniqueCandidate(candidates, 'email')
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
  if (await isLoginEmailFieldReady(page)) {
    pushUniqueCandidate(candidates, 'email')
  }
  if (await isAnySelectorVisible(page, LOGIN_ENTRY_SELECTORS)) {
    pushUniqueCandidate(candidates, 'login')
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

export async function isCodexOrganizationPickerReady(
  page: Page,
): Promise<boolean> {
  if (!isChatGPTCodexOrganizationUrl(page.url())) {
    return false
  }

  return (
    (await isAnySelectorVisible(page, CODEX_ORGANIZATION_SELECTORS)) ||
    (await hasEnabledSelector(page, CODEX_ORGANIZATION_SUBMIT_SELECTORS))
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
  if (await isCodexOrganizationPickerReady(page)) {
    pushUniqueCandidate(candidates, 'organization')
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

export async function waitForCodexOAuthSurfaceCandidates(
  page: Page,
  timeoutMs = 15000,
): Promise<Exclude<ChatGPTCodexOAuthSurface, 'unknown'>[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const candidates = await getCodexOAuthSurfaceCandidates(page)
    if (candidates.length > 0) {
      return candidates
    }
    await sleep(250)
  }

  return getCodexOAuthSurfaceCandidates(page)
}

export async function waitForCodexOAuthSurface(
  page: Page,
  timeoutMs = 15000,
): Promise<ChatGPTCodexOAuthSurface> {
  return (
    (await waitForCodexOAuthSurfaceCandidates(page, timeoutMs))[0] ?? 'unknown'
  )
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
