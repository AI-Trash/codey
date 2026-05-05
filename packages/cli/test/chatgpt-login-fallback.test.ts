import { beforeEach, describe, expect, it, vi } from 'vitest'

const clickPasswordTimeoutRetry = vi.fn()
const submitPasswordOnce = vi.fn()
const submitVerificationCodeOnce = vi.fn()
const throwIfChatGPTAccountDeactivated = vi.fn()
const waitForPasswordSubmissionOutcome = vi.fn()
const waitForPostEmailLoginStep = vi.fn()
const waitForVerificationCode = vi.fn()
const waitForVerificationCodeInputReady = vi.fn()
const waitForVerificationCodeUpdatesAfterSubmit = vi.fn()

vi.mock('../src/modules/chatgpt/shared', () => ({
  clickPasswordTimeoutRetry,
  submitPasswordOnce,
  submitVerificationCodeOnce,
  throwIfChatGPTAccountDeactivated,
  waitForPasswordSubmissionOutcome,
  waitForPostEmailLoginStep,
  waitForVerificationCode,
  waitForVerificationCodeInputReady,
  waitForVerificationCodeUpdatesAfterSubmit,
}))

describe('completePasswordOrVerificationLoginFallback', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    clickPasswordTimeoutRetry.mockResolvedValue(true)
    submitPasswordOnce.mockResolvedValue(undefined)
    submitVerificationCodeOnce.mockResolvedValue(undefined)
    throwIfChatGPTAccountDeactivated.mockResolvedValue(undefined)
    waitForPasswordSubmissionOutcome.mockResolvedValue('unknown')
    waitForPostEmailLoginStep.mockResolvedValue('authenticated')
    waitForVerificationCode.mockResolvedValue('123456')
    waitForVerificationCodeInputReady.mockResolvedValue(true)
    waitForVerificationCodeUpdatesAfterSubmit.mockImplementation(
      async (_page: unknown, options: { currentCode: string }) =>
        options.currentCode,
    )
  })

  function options() {
    return {
      email: 'person@example.com',
      password: 'secret-password',
      step: 'password' as const,
      startedAt: '2026-05-05T00:00:00.000Z',
      verificationProvider: {
        waitForVerificationCode: vi.fn(),
      },
    }
  }

  it('submits a password once when the page advances past password', async () => {
    const { completePasswordOrVerificationLoginFallback } =
      await import('../src/flows/chatgpt-login-fallback')

    await expect(
      completePasswordOrVerificationLoginFallback({} as never, options()),
    ).resolves.toEqual({
      method: 'password',
    })

    expect(submitPasswordOnce).toHaveBeenCalledOnce()
    expect(clickPasswordTimeoutRetry).not.toHaveBeenCalled()
  })

  it('clicks timeout retry before resubmitting password', async () => {
    waitForPasswordSubmissionOutcome
      .mockResolvedValueOnce('timeout')
      .mockResolvedValueOnce('unknown')
    waitForPostEmailLoginStep.mockResolvedValueOnce('authenticated')

    const { completePasswordOrVerificationLoginFallback } =
      await import('../src/flows/chatgpt-login-fallback')

    await expect(
      completePasswordOrVerificationLoginFallback({} as never, options()),
    ).resolves.toEqual({
      method: 'password',
    })

    expect(submitPasswordOnce).toHaveBeenCalledTimes(2)
    expect(clickPasswordTimeoutRetry).toHaveBeenCalledOnce()
  })

  it('resubmits directly when the password step reappears without a timeout retry surface', async () => {
    waitForPostEmailLoginStep
      .mockResolvedValueOnce('password')
      .mockResolvedValueOnce('authenticated')

    const { completePasswordOrVerificationLoginFallback } =
      await import('../src/flows/chatgpt-login-fallback')

    await expect(
      completePasswordOrVerificationLoginFallback({} as never, options()),
    ).resolves.toEqual({
      method: 'password',
    })

    expect(submitPasswordOnce).toHaveBeenCalledTimes(2)
    expect(clickPasswordTimeoutRetry).not.toHaveBeenCalled()
  })

  it('uses the verification provider when password submission reaches verification', async () => {
    waitForPasswordSubmissionOutcome.mockResolvedValueOnce('verification')
    waitForVerificationCodeUpdatesAfterSubmit.mockResolvedValueOnce('654321')

    const { completePasswordOrVerificationLoginFallback } =
      await import('../src/flows/chatgpt-login-fallback')

    await expect(
      completePasswordOrVerificationLoginFallback({} as never, options()),
    ).resolves.toEqual({
      method: 'verification',
      verificationCode: '654321',
    })

    expect(waitForVerificationCodeInputReady).toHaveBeenCalledWith({}, 10000)
    expect(waitForVerificationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'person@example.com',
        startedAt: '2026-05-05T00:00:00.000Z',
        timeoutMs: 180000,
        pollIntervalMs: 5000,
      }),
    )
    expect(submitVerificationCodeOnce).toHaveBeenCalledWith({}, '123456')
  })

  it('fails when a verification branch has no provider', async () => {
    const { completePasswordOrVerificationLoginFallback } =
      await import('../src/flows/chatgpt-login-fallback')

    await expect(
      completePasswordOrVerificationLoginFallback({} as never, {
        ...options(),
        step: 'verification',
        verificationProvider: undefined,
      }),
    ).rejects.toThrow(/verification provider is required/i)
  })
})
