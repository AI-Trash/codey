import { beforeEach, describe, expect, it, vi } from 'vitest'

const clickPasswordTimeoutRetry = vi.fn()
const submitPasswordOnce = vi.fn()
const waitForPasswordSubmissionOutcome = vi.fn()

vi.mock('../src/modules/chatgpt/shared', () => ({
  clickPasswordTimeoutRetry,
  submitPasswordOnce,
  waitForPasswordSubmissionOutcome,
}))

describe('submitRegistrationPasswordUntilVerification', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    clickPasswordTimeoutRetry.mockResolvedValue(true)
    submitPasswordOnce.mockResolvedValue(undefined)
    waitForPasswordSubmissionOutcome.mockResolvedValue('verification')
  })

  function page() {
    return {
      url: vi.fn(() => 'https://auth.openai.com/u/signup/password'),
    }
  }

  it('submits once when verification appears', async () => {
    const { submitRegistrationPasswordUntilVerification } =
      await import('../src/flows/chatgpt-registration-password')

    await expect(
      submitRegistrationPasswordUntilVerification(
        page() as never,
        'secret-password',
      ),
    ).resolves.toBeUndefined()

    expect(submitPasswordOnce).toHaveBeenCalledOnce()
    expect(clickPasswordTimeoutRetry).not.toHaveBeenCalled()
  })

  it('records a retry and submits again after timeout', async () => {
    waitForPasswordSubmissionOutcome
      .mockResolvedValueOnce('timeout')
      .mockResolvedValueOnce('verification')
    const onRetryObserved = vi.fn()
    const fakePage = page()

    const { submitRegistrationPasswordUntilVerification } =
      await import('../src/flows/chatgpt-registration-password')

    await expect(
      submitRegistrationPasswordUntilVerification(
        fakePage as never,
        'secret-password',
        {
          onRetryObserved,
        },
      ),
    ).resolves.toBeUndefined()

    expect(submitPasswordOnce).toHaveBeenCalledTimes(2)
    expect(clickPasswordTimeoutRetry).toHaveBeenCalledOnce()
    expect(onRetryObserved).toHaveBeenCalledWith({
      attempt: 1,
      reason: 'timeout',
      url: 'https://auth.openai.com/u/signup/password',
    })
  })

  it('fails when timeout retry cannot recover the password form', async () => {
    waitForPasswordSubmissionOutcome.mockResolvedValueOnce('timeout')
    clickPasswordTimeoutRetry.mockResolvedValueOnce(false)

    const { submitRegistrationPasswordUntilVerification } =
      await import('../src/flows/chatgpt-registration-password')

    await expect(
      submitRegistrationPasswordUntilVerification(
        page() as never,
        'secret-password',
      ),
    ).rejects.toThrow(/retry button was not clickable/i)
  })
})
