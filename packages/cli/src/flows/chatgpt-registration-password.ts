import type { Page } from 'patchright'
import {
  clickPasswordTimeoutRetry,
  submitPasswordOnce,
  waitForPasswordSubmissionOutcome,
} from '../modules/chatgpt/shared'

export type ChatGPTRegistrationPasswordRetryReason = 'timeout'

export interface ChatGPTRegistrationPasswordRetryObservation {
  attempt: number
  reason: ChatGPTRegistrationPasswordRetryReason
  url: string
}

export interface SubmitRegistrationPasswordUntilObservedOptions {
  maxAttempts?: number
  onRetryObserved?: (
    observation: ChatGPTRegistrationPasswordRetryObservation,
  ) => void | Promise<void>
}

export async function submitRegistrationPasswordUntilVerification(
  page: Page,
  password: string,
  options: SubmitRegistrationPasswordUntilObservedOptions = {},
): Promise<void> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await submitPasswordOnce(page, password)
    const outcome = await waitForPasswordSubmissionOutcome(page)
    if (outcome === 'verification' || outcome === 'unknown') return

    await options.onRetryObserved?.({
      attempt,
      reason: 'timeout',
      url: page.url(),
    })

    const retried = await clickPasswordTimeoutRetry(page)
    if (!retried) {
      throw new Error(
        'Password submission timed out and retry button was not clickable.',
      )
    }
  }

  throw new Error('Password submission timed out repeatedly.')
}
