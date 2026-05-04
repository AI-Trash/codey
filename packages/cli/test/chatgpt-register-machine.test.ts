import { describe, expect, it } from 'vitest'
import {
  createChatGPTRegistrationMachine,
  resolveRegistrationTrialOptions,
} from '../src/flows/chatgpt-register'
import { buildProfileName } from '../src/modules/chatgpt/common'
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

  it('selects observed entry and post-email candidates by machine priority', async () => {
    const machine = createChatGPTRegistrationMachine()

    machine.start({
      email: 'person@example.com',
    })

    await machine.send('chatgpt.entry.observed', {
      candidates: ['signup', 'email'],
      url: 'https://chatgpt.com/auth/login',
      patch: {
        email: 'person@example.com',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'email-step',
      context: {
        entrySurface: 'email',
        lastMessage: 'Registration email surface ready',
      },
    })

    await machine.send('chatgpt.email.observed', {
      candidates: ['retry', 'verification'],
      url: 'https://auth.openai.com/u/signup/verify-email',
      patch: {
        email: 'person@example.com',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'verification-polling',
      context: {
        postEmailStep: 'verification',
        method: 'verification',
        lastMessage:
          'Verification step detected after registration email submission',
      },
    })
  })

  it('prioritizes combined verification and profile fields when both signals are present', async () => {
    const machine = createChatGPTRegistrationMachine()

    machine.start({
      email: 'person@example.com',
    })

    await machine.send('chatgpt.email.observed', {
      candidates: ['verification', 'verification-profile'],
      url: 'https://auth.openai.com/email-verification/register',
      patch: {
        email: 'person@example.com',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'verification-polling',
      context: {
        postEmailStep: 'verification-profile',
        method: 'verification',
        ageGateActive: true,
        submitProfileWithVerification: true,
        lastMessage:
          'Combined verification and profile step detected after registration email submission',
      },
    })

    await machine.send('chatgpt.verification.submitted', {
      verificationCode: '123456',
      profileSubmitted: true,
      url: 'https://chatgpt.com/',
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'post-signup-home',
      context: {
        verificationCode: '123456',
        ageGateActive: false,
        ageGateRetryCount: 0,
        lastMessage: 'Verification code and profile submitted',
      },
    })
  })

  it('keeps verification entry state when observing combined profile fields', async () => {
    const machine = createChatGPTRegistrationMachine()

    machine.start({
      email: 'person@example.com',
    })

    await machine.send('chatgpt.verification.code-found', {
      verificationCode: '123456',
      url: 'https://auth.openai.com/email-verification/register',
    })

    await machine.send('chatgpt.verification.surface.observed', {
      candidates: ['verification-profile', 'verification'],
      url: 'https://auth.openai.com/email-verification/register',
      patch: {
        email: 'person@example.com',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'verification-code-entry',
      context: {
        postEmailStep: 'verification-profile',
        submitProfileWithVerification: true,
        lastMessage:
          'Combined verification and profile step observed during verification entry',
      },
    })
  })

  it('selects the post-email transition with guards', async () => {
    const machine = createChatGPTRegistrationMachine()

    machine.start({
      email: 'person@example.com',
    })

    await machine.send('chatgpt.email.started', {
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

  it('uses the about-you profile name as the registration trial billing default', () => {
    const email = 'codey+trial-name@example.com'

    expect(resolveRegistrationTrialOptions({}, email)).toMatchObject({
      billingName: buildProfileName(email),
    })
  })

  it('keeps an explicit registration trial billing name override', () => {
    expect(
      resolveRegistrationTrialOptions(
        {
          billingName: ' CLI Name ',
        },
        'codey+trial-name@example.com',
      ),
    ).toMatchObject({
      billingName: ' CLI Name ',
    })
  })

  it('preserves the checkout default country for registration GoPay trials', () => {
    expect(
      resolveRegistrationTrialOptions(
        {
          claimTrial: 'gopay',
          billingCountry: 'SG',
        },
        'codey+trial-name@example.com',
      ),
    ).toMatchObject({
      billingName: buildProfileName('codey+trial-name@example.com'),
      billingCountry: 'SG',
      preserveCheckoutBillingCountry: true,
    })
  })
})
