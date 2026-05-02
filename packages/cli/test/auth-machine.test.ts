import { describe, expect, it } from 'vitest'
import { OPENAI_ADD_PHONE_ERROR_MESSAGE } from '../src/state-machine'
import {
  createLoginMachine,
  createRegistrationMachine,
} from '../src/modules/auth-machine'

describe('auth machine', () => {
  it('seeds the login machine with the initial email context', () => {
    const machine = createLoginMachine({
      options: {
        email: 'person@example.com',
      },
    })

    machine.start({
      email: 'person@example.com',
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'idle',
      context: {
        kind: 'login',
        email: 'person@example.com',
      },
    })
  })

  it('seeds the registration machine with organization context', () => {
    const machine = createRegistrationMachine({
      options: {
        email: 'person@example.com',
        organizationName: 'Codey Labs',
      },
    })

    machine.start({
      email: 'person@example.com',
      organizationName: 'Codey Labs',
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'idle',
      context: {
        kind: 'registration',
        email: 'person@example.com',
        organizationName: 'Codey Labs',
      },
    })
  })

  it('can move into a global retrying state from any auth step', async () => {
    const machine = createLoginMachine({
      options: {
        email: 'person@example.com',
      },
    })

    machine.start({
      email: 'person@example.com',
    })

    await machine.send('auth.email.typed', {
      target: 'completed',
      patch: {
        lastMessage: 'Typing login email',
      },
    })
    expect(machine.getSnapshot().state).toBe('typing-email')

    await machine.send('auth.retry.requested', {
      reason: 'email:retry',
      message: 'Retrying login email submission',
      patch: {
        url: 'https://auth.openai.com/oauth/authorize',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'retrying',
      context: {
        retryCount: 1,
        retryReason: 'email:retry',
        retryFromState: 'typing-email',
        lastAttempt: 1,
        lastMessage: 'Retrying login email submission',
        url: 'https://auth.openai.com/oauth/authorize',
      },
    })
  })

  it('fails immediately when the flow is redirected to the add-phone page', async () => {
    const machine = createLoginMachine({
      options: {
        email: 'person@example.com',
      },
    })

    machine.start({
      email: 'person@example.com',
    })

    await expect(
      machine.send('context.updated', {
        patch: {
          url: 'https://auth.openai.com/add-phone',
        },
      }),
    ).rejects.toThrow(OPENAI_ADD_PHONE_ERROR_MESSAGE)

    expect(machine.getSnapshot()).toMatchObject({
      state: 'add-phone-required',
      context: {
        url: 'https://auth.openai.com/add-phone',
        lastMessage: OPENAI_ADD_PHONE_ERROR_MESSAGE,
      },
    })
  })
})
