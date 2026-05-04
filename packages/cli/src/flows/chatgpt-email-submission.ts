import type { Page } from 'patchright'
import {
  recoverLoginEmailSubmissionSurface,
  submitLoginEmailOnce,
  type ChatGPTPostEmailLoginStep,
  waitForLoginEmailSubmissionOutcome,
  waitForPostEmailLoginCandidates,
} from '../modules/chatgpt/shared'

export type ChatGPTLoginEmailRetryReason = 'retry' | 'timeout'

export interface ChatGPTLoginEmailRetryObservation {
  attempt: number
  reason: ChatGPTLoginEmailRetryReason
  candidates: ['retry']
  url: string
}

export interface SubmitLoginEmailUntilObservedOptions {
  maxAttempts?: number
  postEmailTimeoutMs?: number
  lateCandidateTimeoutMs?: number
  onAttemptStarted?: (attempt: number) => void | Promise<void>
  onRetryObserved?: (
    observation: ChatGPTLoginEmailRetryObservation,
  ) => void | Promise<void>
}

export async function submitLoginEmailUntilPostEmailCandidates(
  page: Page,
  email: string,
  options: SubmitLoginEmailUntilObservedOptions = {},
): Promise<Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[]> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const postEmailTimeoutMs = options.postEmailTimeoutMs ?? 20000
  const lateCandidateTimeoutMs = options.lateCandidateTimeoutMs ?? 5000

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await options.onAttemptStarted?.(attempt)
    await submitLoginEmailOnce(page, email)

    const outcome = await waitForLoginEmailSubmissionOutcome(page)
    const candidates = await resolvePostEmailCandidatesForOutcome(page, {
      outcome,
      postEmailTimeoutMs,
      lateCandidateTimeoutMs,
    })
    const retryReason = resolveLoginEmailRetryReason(outcome, candidates)
    if (!retryReason) {
      return candidates
    }

    await options.onRetryObserved?.({
      attempt,
      reason: retryReason,
      candidates: ['retry'],
      url: page.url(),
    })

    if (attempt >= maxAttempts) {
      break
    }

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

async function resolvePostEmailCandidatesForOutcome(
  page: Page,
  options: {
    outcome: Awaited<ReturnType<typeof waitForLoginEmailSubmissionOutcome>>
    postEmailTimeoutMs: number
    lateCandidateTimeoutMs: number
  },
): Promise<Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[]> {
  if (options.outcome === 'next') {
    return waitForPostEmailLoginCandidates(page, options.postEmailTimeoutMs)
  }

  if (options.outcome === 'unknown') {
    const lateCandidates = await waitForPostEmailLoginCandidates(
      page,
      options.lateCandidateTimeoutMs,
    )
    if (lateCandidates.length > 0) {
      return lateCandidates
    }

    return waitForPostEmailLoginCandidates(page, options.postEmailTimeoutMs)
  }

  return ['retry']
}

function resolveLoginEmailRetryReason(
  outcome: Awaited<ReturnType<typeof waitForLoginEmailSubmissionOutcome>>,
  candidates: Exclude<ChatGPTPostEmailLoginStep, 'unknown'>[],
): ChatGPTLoginEmailRetryReason | undefined {
  if (outcome === 'retry' || outcome === 'timeout') {
    return outcome
  }

  return candidates.length === 1 && candidates[0] === 'retry'
    ? 'retry'
    : undefined
}
