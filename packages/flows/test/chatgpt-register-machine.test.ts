import { describe, expect, it } from 'vitest'
import { createChatGPTRegistrationMachine } from '../src/flows/chatgpt-register'

describe('chatgpt registration machine', () => {
  it('tracks age-gate retries in context and clears the active flag on completion', async () => {
    const machine = createChatGPTRegistrationMachine()

    machine.start({
      email: 'person@example.com',
    })

    await machine.send('chatgpt.verification.submitted', {
      verificationCode: '123456',
      url: 'https://auth.openai.com/about-you',
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'age-gate',
      context: {
        verificationCode: '123456',
        ageGateActive: true,
        lastMessage: 'Verification code submitted',
      },
    })

    await machine.send('chatgpt.age-gate.outcome', {
      outcome: 'retry',
      url: 'https://auth.openai.com/about-you',
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'age-gate',
      context: {
        ageGateActive: true,
        ageGateRetryCount: 1,
        lastAttempt: 1,
        lastMessage: 'Retrying age gate submission',
      },
    })

    await machine.send('chatgpt.age-gate.outcome', {
      outcome: 'advanced',
      url: 'https://chatgpt.com/',
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'post-signup-home',
      context: {
        ageGateActive: false,
        ageGateRetryCount: 0,
        lastMessage: 'Age gate completed',
        url: 'https://chatgpt.com/',
      },
    })
  })

  it('can move into retrying from a non-age-gate step', async () => {
    const machine = createChatGPTRegistrationMachine()

    machine.start({
      email: 'person@example.com',
    })

    await machine.send('chatgpt.email.started', {
      target: 'email-step',
      patch: {
        email: 'person@example.com',
        lastMessage: 'Typing registration email',
      },
    })

    await machine.send('chatgpt.retry.requested', {
      reason: 'registration-email:retry',
      message: 'Retrying registration email submission',
      patch: {
        url: 'https://auth.openai.com/oauth/authorize',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'retrying',
      context: {
        retryCount: 1,
        retryReason: 'registration-email:retry',
        retryFromState: 'email-step',
        lastAttempt: 1,
        lastMessage: 'Retrying registration email submission',
        url: 'https://auth.openai.com/oauth/authorize',
      },
    })
  })
})
