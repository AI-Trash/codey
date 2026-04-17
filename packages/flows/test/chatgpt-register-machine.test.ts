import { describe, expect, it } from 'vitest'
import { createChatGPTRegistrationMachine } from '../src/flows/chatgpt-register'
import { OPENAI_ADD_PHONE_ERROR_MESSAGE } from '../src/state-machine'

describe('chatgpt registration machine', () => {
  it('selects guarded entry surfaces for direct email and legacy signup flows', async () => {
    const machine = createChatGPTRegistrationMachine()

    machine.start({
      email: 'person@example.com',
    })

    await machine.send('chatgpt.login.surface.ready', {
      step: 'signup',
      url: 'https://chatgpt.com/auth/login',
      patch: {
        email: 'person@example.com',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'login-surface',
      context: {
        email: 'person@example.com',
        lastMessage: 'Registration signup surface ready',
        url: 'https://chatgpt.com/auth/login',
      },
    })

    await machine.send('chatgpt.login.surface.ready', {
      step: 'email',
      url: 'https://chatgpt.com/auth/login',
      patch: {
        email: 'person@example.com',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'email-step',
      context: {
        email: 'person@example.com',
        lastMessage: 'Registration email surface ready',
        url: 'https://chatgpt.com/auth/login',
      },
    })
  })

  it('selects the post-email transition with guards', async () => {
    const machine = createChatGPTRegistrationMachine()

    machine.start({
      email: 'person@example.com',
    })

    await machine.send('chatgpt.email.started', {
      target: 'email-step',
      patch: {
        email: 'person@example.com',
      },
    })

    await machine.send('chatgpt.email.submitted', {
      step: 'verification',
      url: 'https://auth.openai.com/u/signup/password',
      patch: {
        email: 'person@example.com',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'verification-polling',
      context: {
        email: 'person@example.com',
        postEmailStep: 'verification',
        method: 'verification',
        lastMessage:
          'Verification step detected after registration email submission',
      },
    })
  })

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

  it('moves into the add-phone failure state from any registration step', async () => {
    const machine = createChatGPTRegistrationMachine()

    machine.start({
      email: 'person@example.com',
    })

    await machine.send('chatgpt.email.started', {
      target: 'email-step',
      patch: {
        email: 'person@example.com',
      },
    })

    await expect(
      machine.send('chatgpt.retry.requested', {
        reason: 'registration:add-phone',
        patch: {
          url: 'https://auth.openai.com/add-phone',
        },
      }),
    ).rejects.toThrow(OPENAI_ADD_PHONE_ERROR_MESSAGE)

    expect(machine.getSnapshot()).toMatchObject({
      state: 'add-phone-required',
      context: {
        email: 'person@example.com',
        url: 'https://auth.openai.com/add-phone',
        lastMessage: OPENAI_ADD_PHONE_ERROR_MESSAGE,
      },
    })
  })
})
