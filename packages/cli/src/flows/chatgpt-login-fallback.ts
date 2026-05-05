import type { Page } from 'patchright'
import {
  clickPasswordTimeoutRetry,
  submitPasswordOnce,
  submitVerificationCodeOnce,
  throwIfChatGPTAccountDeactivated,
  waitForPasswordSubmissionOutcome,
  waitForPostEmailLoginStep,
  waitForVerificationCode,
  waitForVerificationCodeInputReady,
  waitForVerificationCodeUpdatesAfterSubmit,
  type ChatGPTPostEmailLoginStep,
} from '../modules/chatgpt/shared'
import type { VerificationProvider } from '../modules/verification'

type PasswordOrVerificationStep = Extract<
  ChatGPTPostEmailLoginStep,
  'password' | 'verification'
>

export interface CompletePasswordOrVerificationLoginFallbackOptions {
  email: string
  password: string
  step: PasswordOrVerificationStep
  startedAt: string
  verificationProvider?: VerificationProvider
  getVerificationProvider?: () =>
    | VerificationProvider
    | Promise<VerificationProvider>
  verificationTimeoutMs?: number
  pollIntervalMs?: number
  maxPasswordAttempts?: number
}

export interface CompletePasswordOrVerificationLoginFallbackResult {
  method: 'password' | 'verification'
  verificationCode?: string
}

export async function completePasswordOrVerificationLoginFallback(
  page: Page,
  options: CompletePasswordOrVerificationLoginFallbackOptions,
): Promise<CompletePasswordOrVerificationLoginFallbackResult> {
  const session = createVerificationSession(options)

  if (options.step === 'verification') {
    return {
      method: 'verification',
      verificationCode: await completeVerificationStep(page, session),
    }
  }

  return submitPasswordUntilResolved(page, options, session)
}

function createVerificationSession(
  options: CompletePasswordOrVerificationLoginFallbackOptions,
) {
  let verificationProvider = options.verificationProvider

  return {
    email: options.email,
    startedAt: options.startedAt,
    verificationTimeoutMs: options.verificationTimeoutMs ?? 180000,
    pollIntervalMs: options.pollIntervalMs ?? 5000,
    requireVerificationProvider: async (): Promise<VerificationProvider> => {
      verificationProvider ??= await options.getVerificationProvider?.()
      if (!verificationProvider) {
        throw new Error(
          'A verification provider is required when ChatGPT login fallback requests a verification code.',
        )
      }

      return verificationProvider
    },
  }
}

async function submitPasswordUntilResolved(
  page: Page,
  options: CompletePasswordOrVerificationLoginFallbackOptions,
  session: ReturnType<typeof createVerificationSession>,
): Promise<CompletePasswordOrVerificationLoginFallbackResult> {
  const maxAttempts = Math.max(1, options.maxPasswordAttempts ?? 3)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await submitPasswordOnce(page, options.password)

    const result = await resolvePasswordSubmissionResult(page, session)
    if (result.status === 'password-complete') {
      return {
        method: 'password',
      }
    }
    if (result.status === 'verification-complete') {
      return {
        method: 'verification',
        verificationCode: result.verificationCode,
      }
    }

    if (
      result.recovery === 'click-timeout-retry' &&
      !(await clickPasswordTimeoutRetry(page))
    ) {
      throw new Error(
        'Password submission timed out and retry button was not clickable.',
      )
    }

    if (attempt >= maxAttempts) {
      break
    }
  }

  throw new Error('Password submission timed out repeatedly.')
}

async function resolvePasswordSubmissionResult(
  page: Page,
  session: ReturnType<typeof createVerificationSession>,
): Promise<
  | { status: 'password-complete' }
  | {
      status: 'password-retry'
      recovery: 'click-timeout-retry' | 'resubmit'
    }
  | { status: 'verification-complete'; verificationCode: string }
> {
  const outcome = await waitForPasswordSubmissionOutcome(page)
  if (outcome === 'timeout') {
    return {
      status: 'password-retry',
      recovery: 'click-timeout-retry',
    }
  }

  if (outcome === 'verification') {
    return {
      status: 'verification-complete',
      verificationCode: await completeVerificationStep(page, session),
    }
  }

  const nextStep = await waitForPostEmailLoginStep(page, 5000)
  if (nextStep === 'password') {
    return {
      status: 'password-retry',
      recovery: 'resubmit',
    }
  }
  if (nextStep === 'verification' || nextStep === 'verification-profile') {
    return {
      status: 'verification-complete',
      verificationCode: await completeVerificationStep(page, session),
    }
  }

  return {
    status: 'password-complete',
  }
}

async function completeVerificationStep(
  page: Page,
  session: ReturnType<typeof createVerificationSession>,
): Promise<string> {
  const verificationReady = await waitForVerificationCodeInputReady(page, 10000)
  if (!verificationReady) {
    await throwIfChatGPTAccountDeactivated(page)
    throw new Error('ChatGPT verification code input did not become ready.')
  }

  const verificationProvider = await session.requireVerificationProvider()
  const verificationCode = await waitForVerificationCode({
    verificationProvider,
    email: session.email,
    startedAt: session.startedAt,
    timeoutMs: session.verificationTimeoutMs,
    pollIntervalMs: session.pollIntervalMs,
  })
  await submitVerificationCodeOnce(page, verificationCode)
  return waitForVerificationCodeUpdatesAfterSubmit(page, {
    verificationProvider: await session.requireVerificationProvider(),
    email: session.email,
    startedAt: session.startedAt,
    timeoutMs: session.verificationTimeoutMs,
    currentCode: verificationCode,
  })
}
