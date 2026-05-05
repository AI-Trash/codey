import { beforeEach, describe, expect, it, vi } from 'vitest'

const clickCompleteAccountCreation = vi.fn()
const clickRetryButtonIfPresent = vi.fn()
const confirmAgeDialogIfPresent = vi.fn()
const fillAgeGateAge = vi.fn()
const fillAgeGateBirthday = vi.fn()
const fillAgeGateName = vi.fn()
const getAgeGateFieldCandidates = vi.fn()
const waitForAgeGateFieldCandidates = vi.fn()
const waitForAnySelectorState = vi.fn()
const waitForEnabledSelector = vi.fn()

vi.mock('../src/modules/chatgpt/shared', () => ({
  AGE_GATE_INPUT_SELECTORS: ['age-gate-input'],
  COMPLETE_ACCOUNT_SELECTORS: ['complete-account'],
  DEFAULT_EVENT_TIMEOUT_MS: 5000,
  PASSWORD_TIMEOUT_RETRY_SELECTORS: ['retry-button'],
  clickCompleteAccountCreation,
  clickRetryButtonIfPresent,
  confirmAgeDialogIfPresent,
  fillAgeGateAge,
  fillAgeGateBirthday,
  fillAgeGateName,
  getAgeGateFieldCandidates,
  waitForAgeGateFieldCandidates,
  waitForAnySelectorState,
  waitForEnabledSelector,
}))

describe('registration age gate helper', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    clickCompleteAccountCreation.mockResolvedValue(true)
    clickRetryButtonIfPresent.mockResolvedValue(true)
    confirmAgeDialogIfPresent.mockResolvedValue(false)
    fillAgeGateAge.mockResolvedValue(true)
    fillAgeGateBirthday.mockResolvedValue(true)
    fillAgeGateName.mockResolvedValue(true)
    getAgeGateFieldCandidates.mockResolvedValue([])
    waitForAgeGateFieldCandidates.mockResolvedValue(['age'])
    waitForAnySelectorState.mockImplementation(
      async (_page: unknown, selectors: string[]) =>
        selectors[0] === 'age-gate-input',
    )
    waitForEnabledSelector.mockResolvedValue(true)
  })

  function page() {
    return {
      url: vi.fn(() => 'https://auth.openai.com/about-you'),
    }
  }

  it('fills profile fields and completes when age gate disappears', async () => {
    const onOutcomeObserved = vi.fn()
    const { completeRegistrationAgeGate } =
      await import('../src/flows/chatgpt-registration-age-gate')

    await expect(
      completeRegistrationAgeGate(page() as never, {
        email: 'person@example.com',
        onOutcomeObserved,
      }),
    ).resolves.toBeUndefined()

    expect(fillAgeGateName).toHaveBeenCalledWith(
      expect.anything(),
      'person@example.com',
    )
    expect(fillAgeGateAge).toHaveBeenCalledOnce()
    expect(clickCompleteAccountCreation).toHaveBeenCalledOnce()
    expect(onOutcomeObserved).toHaveBeenCalledWith({
      outcome: 'advanced',
      url: 'https://auth.openai.com/about-you',
    })
  })

  it('clicks retry and refills fields when submission asks for retry', async () => {
    let retryChecks = 0
    waitForAnySelectorState.mockImplementation(
      async (_page: unknown, selectors: string[]) =>
        selectors[0] === 'retry-button'
          ? retryChecks++ === 0
          : selectors[0] === 'age-gate-input',
    )
    const onOutcomeObserved = vi.fn()

    const { completeRegistrationAgeGate } =
      await import('../src/flows/chatgpt-registration-age-gate')

    await expect(
      completeRegistrationAgeGate(page() as never, {
        onOutcomeObserved,
      }),
    ).resolves.toBeUndefined()

    expect(clickRetryButtonIfPresent).toHaveBeenCalledOnce()
    expect(fillAgeGateAge).toHaveBeenCalledTimes(2)
    expect(onOutcomeObserved).toHaveBeenCalledWith({
      outcome: 'retry',
      url: 'https://auth.openai.com/about-you',
    })
  })

  it('fills combined verification profile fields', async () => {
    const { fillRegistrationCombinedVerificationProfileFields } =
      await import('../src/flows/chatgpt-registration-age-gate')

    await expect(
      fillRegistrationCombinedVerificationProfileFields(
        page() as never,
        'person@example.com',
      ),
    ).resolves.toBeUndefined()

    expect(waitForAnySelectorState).toHaveBeenCalledWith(
      expect.anything(),
      ['age-gate-input'],
      'visible',
      5000,
    )
    expect(fillAgeGateName).toHaveBeenCalledWith(
      expect.anything(),
      'person@example.com',
    )
  })
})
