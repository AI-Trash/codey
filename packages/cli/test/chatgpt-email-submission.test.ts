import { beforeEach, describe, expect, it, vi } from 'vitest'

const recoverLoginEmailSubmissionSurface = vi.fn()
const submitLoginEmailOnce = vi.fn()
const waitForLoginEmailSubmissionOutcome = vi.fn()
const waitForPostEmailLoginCandidates = vi.fn()

vi.mock('../src/modules/chatgpt/shared', () => ({
  recoverLoginEmailSubmissionSurface,
  submitLoginEmailOnce,
  waitForLoginEmailSubmissionOutcome,
  waitForPostEmailLoginCandidates,
}))

function createPage() {
  return {
    url: vi.fn(() => 'https://auth.openai.com/log-in-or-create-account'),
  }
}

describe('submitLoginEmailUntilPostEmailCandidates', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    recoverLoginEmailSubmissionSurface.mockResolvedValue(true)
  })

  it('returns observed post-email candidates after one email submit action', async () => {
    waitForLoginEmailSubmissionOutcome.mockResolvedValueOnce('next')
    waitForPostEmailLoginCandidates.mockResolvedValueOnce(['password'])

    const { submitLoginEmailUntilPostEmailCandidates } =
      await import('../src/flows/chatgpt-email-submission')

    await expect(
      submitLoginEmailUntilPostEmailCandidates(
        createPage() as never,
        'person@example.com',
      ),
    ).resolves.toEqual(['password'])
    expect(submitLoginEmailOnce).toHaveBeenCalledOnce()
    expect(recoverLoginEmailSubmissionSurface).not.toHaveBeenCalled()
  })

  it('reports retry observations and lets the next attempt provide candidates', async () => {
    const onRetryObserved = vi.fn()
    waitForLoginEmailSubmissionOutcome
      .mockResolvedValueOnce('retry')
      .mockResolvedValueOnce('next')
    waitForPostEmailLoginCandidates.mockResolvedValueOnce(['verification'])

    const { submitLoginEmailUntilPostEmailCandidates } =
      await import('../src/flows/chatgpt-email-submission')

    await expect(
      submitLoginEmailUntilPostEmailCandidates(
        createPage() as never,
        'person@example.com',
        { onRetryObserved },
      ),
    ).resolves.toEqual(['verification'])
    expect(onRetryObserved).toHaveBeenCalledWith({
      attempt: 1,
      reason: 'retry',
      candidates: ['retry'],
      url: 'https://auth.openai.com/log-in-or-create-account',
    })
    expect(recoverLoginEmailSubmissionSurface).toHaveBeenCalledOnce()
    expect(submitLoginEmailOnce).toHaveBeenCalledTimes(2)
  })

  it('fails with the timeout recovery message when the email form cannot be restored', async () => {
    waitForLoginEmailSubmissionOutcome.mockResolvedValueOnce('timeout')
    recoverLoginEmailSubmissionSurface.mockResolvedValueOnce(false)

    const { submitLoginEmailUntilPostEmailCandidates } =
      await import('../src/flows/chatgpt-email-submission')

    await expect(
      submitLoginEmailUntilPostEmailCandidates(
        createPage() as never,
        'person@example.com',
      ),
    ).rejects.toThrow(
      'Login email submission timed out and retry button was not clickable.',
    )
  })
})
