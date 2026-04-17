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
      target: 'starting-oauth',
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
})
