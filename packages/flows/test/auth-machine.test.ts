import { describe, expect, it } from 'vitest'
import {
  createLoginMachine,
  resolveAuthMethod,
} from '../src/modules/auth-machine'

describe('auth machine', () => {
  it('prefers passkey when the machine context and guard input allow it', async () => {
    const machine = createLoginMachine({
      options: {
        email: 'person@example.com',
        preferPasskey: true,
      },
    })

    machine.start({
      email: 'person@example.com',
      preferPasskey: true,
    })

    const method = await resolveAuthMethod(machine, {
      supportsPasskey: true,
      passkeySelectors: ['button.passkey'],
      emailSelectors: ['input[type="email"]'],
    })

    expect(method).toBe('passkey')
    expect(machine.getSnapshot()).toMatchObject({
      state: 'choosing-passkey',
      context: {
        method: 'passkey',
        lastSelectors: ['button.passkey'],
        lastMessage: 'Trying passkey login',
      },
    })
  })

  it('falls back to password when passkey is unavailable', async () => {
    const machine = createLoginMachine({
      options: {
        email: 'person@example.com',
        preferPasskey: true,
      },
    })

    machine.start({
      email: 'person@example.com',
      preferPasskey: true,
    })

    const method = await resolveAuthMethod(machine, {
      supportsPasskey: false,
      passkeySelectors: ['button.passkey'],
      emailSelectors: ['input[type="email"]'],
    })

    expect(method).toBe('password')
    expect(machine.getSnapshot()).toMatchObject({
      state: 'typing-email',
      context: {
        method: 'password',
        lastSelectors: ['input[type="email"]'],
        lastMessage: 'Typing login email',
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
      target: 'typing-email',
      patch: {
        lastMessage: 'Typing login email',
      },
    })

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
})
