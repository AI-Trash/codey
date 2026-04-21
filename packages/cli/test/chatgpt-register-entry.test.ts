import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  waitForRegistrationEntryCandidates,
  waitForLoginEmailFormReady,
  clickSignupEntry,
} = vi.hoisted(() => ({
  waitForRegistrationEntryCandidates: vi.fn(),
  waitForLoginEmailFormReady: vi.fn(),
  clickSignupEntry: vi.fn(),
}))

vi.mock('../src/modules/chatgpt/shared', async () => {
  const actual = await vi.importActual('../src/modules/chatgpt/shared')
  return {
    ...actual,
    waitForRegistrationEntryCandidates,
    waitForLoginEmailFormReady,
    clickSignupEntry,
  }
})

import {
  createChatGPTRegistrationMachine,
  resolveRegistrationEntrySurface,
} from '../src/flows/chatgpt-register'

class FakePage {
  currentUrl = 'https://auth.openai.com/log-in'

  url(): string {
    return this.currentUrl
  }
}

describe('resolveRegistrationEntrySurface', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('re-samples entry candidates after the signup branch fails recoverably', async () => {
    waitForRegistrationEntryCandidates
      .mockResolvedValueOnce(['signup'])
      .mockResolvedValueOnce(['email'])
    waitForLoginEmailFormReady
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    clickSignupEntry.mockResolvedValue(undefined)

    const machine = createChatGPTRegistrationMachine()
    machine.start({
      email: 'person@example.com',
    })

    const page = new FakePage()
    await expect(
      resolveRegistrationEntrySurface(page as never, {
        email: 'person@example.com',
        machine,
        maxAttempts: 2,
      }),
    ).resolves.toBe('email')

    expect(clickSignupEntry).toHaveBeenCalledTimes(1)
    expect(waitForRegistrationEntryCandidates).toHaveBeenNthCalledWith(
      1,
      page,
      15000,
    )
    expect(waitForRegistrationEntryCandidates).toHaveBeenNthCalledWith(
      2,
      page,
      10000,
    )
    expect(waitForLoginEmailFormReady).toHaveBeenNthCalledWith(1, page, 15000)
    expect(waitForLoginEmailFormReady).toHaveBeenNthCalledWith(2, page, 5000)
    expect(machine.getSnapshot()).toMatchObject({
      state: 'email-step',
      context: {
        email: 'person@example.com',
        retryCount: 1,
        retryReason: 'entry:signup',
        lastMessage: 'Registration email surface ready',
      },
    })
  })

  it('retries a slow direct email surface instead of failing on the first timeout', async () => {
    waitForRegistrationEntryCandidates
      .mockResolvedValueOnce(['email'])
      .mockResolvedValueOnce(['email'])
    waitForLoginEmailFormReady
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const machine = createChatGPTRegistrationMachine()
    machine.start({
      email: 'person@example.com',
    })

    const page = new FakePage()
    await expect(
      resolveRegistrationEntrySurface(page as never, {
        email: 'person@example.com',
        machine,
        maxAttempts: 2,
      }),
    ).resolves.toBe('email')

    expect(clickSignupEntry).not.toHaveBeenCalled()
    expect(machine.getSnapshot()).toMatchObject({
      state: 'email-step',
      context: {
        email: 'person@example.com',
        retryCount: 1,
        retryReason: 'entry:email',
        lastMessage: 'Registration email surface ready',
      },
    })
  })
})
