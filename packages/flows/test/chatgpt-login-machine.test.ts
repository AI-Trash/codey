import { describe, expect, it } from 'vitest'
import { createChatGPTLoginMachine } from '../src/flows/chatgpt-login'

describe('chatgpt login machine', () => {
  it('selects password and retry post-email transitions with guards', async () => {
    const machine = createChatGPTLoginMachine()

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
      step: 'password',
      url: 'https://auth.openai.com/u/login/password',
      patch: {
        email: 'person@example.com',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'password-step',
      context: {
        email: 'person@example.com',
        postEmailStep: 'password',
        lastMessage: 'Password step detected after email submission',
      },
    })

    await machine.send('chatgpt.email.submitted', {
      step: 'retry',
      url: 'https://auth.openai.com/log-in-or-create-account',
      patch: {
        email: 'person@example.com',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'retrying',
      context: {
        email: 'person@example.com',
        postEmailStep: 'retry',
        retryCount: 1,
        retryReason: 'post-email:retry',
        retryFromState: 'password-step',
        lastAttempt: 1,
        lastMessage: 'Retry step detected after email submission',
      },
    })
  })
})
