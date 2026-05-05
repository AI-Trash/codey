import type { Page } from 'patchright'
import {
  type ChatGPTAgeGateFieldMode,
  AGE_GATE_INPUT_SELECTORS,
  COMPLETE_ACCOUNT_SELECTORS,
  DEFAULT_EVENT_TIMEOUT_MS,
  clickCompleteAccountCreation,
  clickRetryButtonIfPresent,
  confirmAgeDialogIfPresent,
  fillAgeGateAge,
  fillAgeGateBirthday,
  fillAgeGateName,
  getAgeGateFieldCandidates,
  waitForAgeGateFieldCandidates,
  waitForAgeGateSubmissionSignal,
  waitForAnySelectorState,
  waitForEnabledSelector,
} from '../modules/chatgpt/shared'

export type ChatGPTRegistrationAgeGateOutcome =
  | 'advanced'
  | 'retry'
  | 'age-gate'

export interface ChatGPTRegistrationAgeGateObservation {
  outcome: ChatGPTRegistrationAgeGateOutcome
  url: string
}

export interface CompleteRegistrationAgeGateOptions {
  email?: string
  maxSubmitAttempts?: number
  onOutcomeObserved?: (
    observation: ChatGPTRegistrationAgeGateObservation,
  ) => boolean | void | Promise<boolean | void>
}

export async function fillRegistrationCombinedVerificationProfileFields(
  page: Page,
  email?: string,
): Promise<void> {
  const ageGateReady = await waitForAnySelectorState(
    page,
    AGE_GATE_INPUT_SELECTORS,
    'visible',
    5000,
  )
  if (!ageGateReady) {
    throw new Error(
      'Combined registration profile fields did not become ready.',
    )
  }

  const filledMode = await fillRegistrationAgeGateFields(page, email)
  if (!filledMode) {
    throw new Error(
      'Combined registration profile fields were visible but could not be filled.',
    )
  }
}

export async function completeRegistrationAgeGate(
  page: Page,
  options: CompleteRegistrationAgeGateOptions = {},
): Promise<void> {
  const ageGateReady = await waitForAnySelectorState(
    page,
    AGE_GATE_INPUT_SELECTORS,
    'visible',
    20000,
  )
  if (!ageGateReady) {
    throw new Error('Age gate did not become ready.')
  }

  await ensureRegistrationAgeGateFieldsFilled(page, options.email)

  const maxSubmitAttempts = Math.max(1, options.maxSubmitAttempts ?? 3)
  for (let attempt = 1; attempt <= maxSubmitAttempts; attempt += 1) {
    const outcome = await submitRegistrationAgeGateOnce(page)
    const shouldStop = await options.onOutcomeObserved?.({
      outcome,
      url: page.url(),
    })

    if (outcome === 'advanced' || shouldStop === true) {
      return
    }

    if (outcome === 'retry') {
      const retried = await clickRetryButtonIfPresent(page)
      if (!retried) {
        throw new Error(
          'Age gate retry button became visible but could not be clicked.',
        )
      }
    }

    if (!(await waitForRegistrationAgeGateRefillSurface(page))) {
      return
    }

    const refilledMode = await fillRegistrationAgeGateFields(
      page,
      options.email,
    )
    if (!refilledMode) {
      throw new Error('Age gate fields reappeared but could not be refilled.')
    }
  }

  throw new Error('Age gate submission did not complete successfully.')
}

async function ensureRegistrationAgeGateFieldsFilled(
  page: Page,
  email?: string,
): Promise<void> {
  let filledMode = await fillRegistrationAgeGateFields(page, email)
  if (!filledMode) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await clickCompleteAccountCreation(page)
      await waitForAnySelectorState(
        page,
        AGE_GATE_INPUT_SELECTORS,
        'visible',
        DEFAULT_EVENT_TIMEOUT_MS,
      )
      filledMode = await fillRegistrationAgeGateFields(page, email)
      if (filledMode) break
    }
  }

  if (!filledMode) {
    throw new Error('Age gate fields were visible but could not be filled.')
  }
}

async function fillRegistrationAgeGateFields(
  page: Page,
  email?: string,
): Promise<'birthday' | 'age' | null> {
  await fillAgeGateName(page, email)
  const candidates = await waitForAgeGateFieldCandidates(page, 3000)
  const mode = selectRegistrationAgeGateFieldMode(candidates)
  if (!mode) return null

  const filled =
    mode === 'age'
      ? await fillAgeGateAge(page)
      : await fillAgeGateBirthday(page)
  if (!filled) {
    throw new Error(
      mode === 'age'
        ? 'Age gate age field could not be filled.'
        : 'Age gate birthday field could not be filled.',
    )
  }

  return mode
}

function selectRegistrationAgeGateFieldMode(
  candidates: ChatGPTAgeGateFieldMode[],
): ChatGPTAgeGateFieldMode | null {
  if (candidates.includes('age')) return 'age'
  if (candidates.includes('birthday')) return 'birthday'
  return null
}

async function submitRegistrationAgeGateOnce(
  page: Page,
): Promise<ChatGPTRegistrationAgeGateOutcome> {
  await waitForEnabledSelector(page, COMPLETE_ACCOUNT_SELECTORS, 5000)
  const submitted = await clickCompleteAccountCreation(page)
  if (!submitted) {
    throw new Error('Age gate submit button was not clickable.')
  }
  await confirmAgeDialogIfPresent(page)

  return waitForAgeGateSubmissionOutcome(page)
}

async function waitForRegistrationAgeGateRefillSurface(
  page: Page,
): Promise<boolean> {
  const ageGateVisible = await waitForAnySelectorState(
    page,
    AGE_GATE_INPUT_SELECTORS,
    'visible',
    DEFAULT_EVENT_TIMEOUT_MS,
  )

  return ageGateVisible || (await isRegistrationAgeGateActive(page))
}

async function isRegistrationAgeGateActive(page: Page): Promise<boolean> {
  return (await getAgeGateFieldCandidates(page)).length > 0
}

async function waitForAgeGateSubmissionOutcome(
  page: Page,
  timeoutMs = 10000,
): Promise<ChatGPTRegistrationAgeGateOutcome> {
  const signal = await waitForAgeGateSubmissionSignal(page, timeoutMs)
  if (signal) return signal

  return (await isRegistrationAgeGateActive(page)) ? 'age-gate' : 'advanced'
}
