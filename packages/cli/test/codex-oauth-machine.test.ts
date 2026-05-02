import { describe, expect, it } from 'vitest'
import { createCodexOAuthMachine } from '../src/flows/codex-oauth'
import { OPENAI_ADD_PHONE_ERROR_MESSAGE } from '../src/state-machine'

describe('codex oauth machine', () => {
  it('moves into the add-phone failure state from any oauth step', async () => {
    const machine = createCodexOAuthMachine()

    machine.start({
      redirectUri: 'http://localhost:1455/auth/callback',
    })

    await machine.send('codex.oauth.started', {
      patch: {
        redirectUri: 'http://localhost:1455/auth/callback',
        url: 'https://auth.openai.com/oauth/authorize',
      },
    })

    await expect(
      machine.send('codex.oauth.surface.ready', {
        surface: 'email',
        url: 'https://auth.openai.com/add-phone',
        patch: {
          redirectUri: 'http://localhost:1455/auth/callback',
        },
      }),
    ).rejects.toThrow(OPENAI_ADD_PHONE_ERROR_MESSAGE)

    expect(machine.getSnapshot()).toMatchObject({
      state: 'add-phone-required',
      context: {
        redirectUri: 'http://localhost:1455/auth/callback',
        url: 'https://auth.openai.com/add-phone',
        lastMessage: OPENAI_ADD_PHONE_ERROR_MESSAGE,
      },
    })
  })

  it('selects oauth surface states without caller-provided targets', async () => {
    const machine = createCodexOAuthMachine()

    machine.start({
      redirectUri: 'http://localhost:1455/auth/callback',
    })

    await machine.send('codex.oauth.surface.ready', {
      surface: 'workspace',
      url: 'https://auth.openai.com/sign-in-with-chatgpt/codex/workspace',
      patch: {
        redirectUri: 'http://localhost:1455/auth/callback',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'workspace-step',
      context: {
        surface: 'workspace',
        redirectUri: 'http://localhost:1455/auth/callback',
        lastMessage: 'Codex workspace selection ready',
      },
    })

    await machine.send('codex.oauth.surface.ready', {
      surface: 'consent',
      url: 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent',
      patch: {
        redirectUri: 'http://localhost:1455/auth/callback',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'consent-step',
      context: {
        surface: 'consent',
        redirectUri: 'http://localhost:1455/auth/callback',
        lastMessage: 'Codex OAuth consent ready',
      },
    })
  })

  it('selects stored login and callback states from semantic events', async () => {
    const machine = createCodexOAuthMachine()

    machine.start({
      redirectUri: 'http://localhost:1455/auth/callback',
    })

    await machine.send('codex.oauth.email.submitting', {
      patch: {
        email: 'person@example.com',
        redirectUri: 'http://localhost:1455/auth/callback',
        lastMessage: 'Submitting stored email',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'email-step',
      context: {
        email: 'person@example.com',
        lastMessage: 'Submitting stored email',
      },
    })

    await machine.send('codex.oauth.password.submitting', {
      patch: {
        email: 'person@example.com',
        lastMessage: 'Submitting stored password',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'password-step',
      context: {
        email: 'person@example.com',
        lastMessage: 'Submitting stored password',
      },
    })

    await machine.send('codex.oauth.callback.waiting', {
      patch: {
        lastMessage: 'Waiting for callback',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'waiting-for-callback',
      context: {
        lastMessage: 'Waiting for callback',
      },
    })
  })
})
