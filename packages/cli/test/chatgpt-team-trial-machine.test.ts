import { describe, expect, it } from 'vitest'
import {
  createChatGPTTeamTrialMachine,
  type ChatGPTTeamTrialGoPayUnlinkCompanion,
} from '../src/flows/chatgpt-team-trial'

describe('chatgpt team trial machine', () => {
  it('tracks login, pricing, and trial claim states', async () => {
    const machine = createChatGPTTeamTrialMachine()

    machine.start({
      email: 'person@example.com',
    })

    await machine.send('chatgpt.login.started', {
      target: 'logging-in',
      patch: {
        email: 'person@example.com',
        lastMessage: 'Logging in before opening pricing promo',
      },
    })

    await machine.send('chatgpt.login.completed', {
      target: 'home-ready',
      patch: {
        email: 'person@example.com',
        url: 'https://chatgpt.com/',
        lastMessage: 'ChatGPT login completed',
      },
    })

    await machine.send('chatgpt.pricing.ready', {
      target: 'pricing-ready',
      patch: {
        url: 'https://chatgpt.com/?promo_campaign=team-1-month-free#pricing',
        lastMessage: 'ChatGPT team pricing free trial button is ready',
      },
    })

    await machine.send('chatgpt.trial.claimed', {
      target: 'trial-claimed',
      patch: {
        url: 'https://chatgpt.com/business/checkout',
        lastMessage: 'ChatGPT team free trial button clicked',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'trial-claimed',
      context: {
        email: 'person@example.com',
        url: 'https://chatgpt.com/business/checkout',
        lastMessage: 'ChatGPT team free trial button clicked',
      },
    })
  })

  it('records retry bookkeeping globally', async () => {
    const machine = createChatGPTTeamTrialMachine()

    machine.start({
      email: 'person@example.com',
    })

    await machine.send('chatgpt.pricing.opening', {
      target: 'opening-pricing',
    })
    await machine.send('chatgpt.retry.requested', {
      reason: 'pricing:not-ready',
      message: 'Retrying pricing page',
      patch: {
        url: 'https://chatgpt.com/?promo_campaign=team-1-month-free#pricing',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'retrying',
      context: {
        retryCount: 1,
        retryReason: 'pricing:not-ready',
        retryFromState: 'opening-pricing',
        lastAttempt: 1,
        lastMessage: 'Retrying pricing page',
      },
    })
  })

  it('tracks GoPay unlink companion progress without moving the primary flow state', async () => {
    const machine = createChatGPTTeamTrialMachine()

    machine.start({
      email: 'person@example.com',
    })
    await machine.send('chatgpt.checkout.ready', {
      target: 'checkout-ready',
      patch: {
        email: 'person@example.com',
      },
    })
    await machine.send('chatgpt.gopay_unlink.started', {
      patch: {
        gopayUnlinkStatus: 'running',
        lastMessage: 'GoPay unlink companion is running in Appium',
      },
    })
    await machine.send('chatgpt.gopay_unlink.completed', {
      patch: {
        gopayUnlinkStatus: 'already-unlinked',
        gopayUnlinkCompleted: true,
        gopayUnlinkAppiumSessionId: 'appium-1',
        lastMessage: 'GoPay had no linked apps before OpenAI authorization',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'checkout-ready',
      context: {
        gopayUnlinkStatus: 'already-unlinked',
        gopayUnlinkCompleted: true,
        gopayUnlinkAppiumSessionId: 'appium-1',
        lastMessage: 'GoPay had no linked apps before OpenAI authorization',
      },
    })
  })

  it('records failed GoPay unlink companions without entering the waiting state', async () => {
    const machine = createChatGPTTeamTrialMachine()
    const failedCompanion: ChatGPTTeamTrialGoPayUnlinkCompanion = {
      status: 'failed',
      async wait() {
        throw new Error('Appium connection refused')
      },
    }

    machine.start({
      email: 'person@example.com',
    })
    await machine.send('chatgpt.checkout.ready', {
      target: 'checkout-ready',
      patch: {
        email: 'person@example.com',
      },
    })

    const events: string[] = []
    await (async function beforeAuthorizationOpen() {
      if (failedCompanion.status === 'failed') {
        events.push('chatgpt.gopay_unlink.failed')
        await machine.send('chatgpt.gopay_unlink.failed', {
          patch: {
            gopayUnlinkStatus: 'failed',
            lastMessage:
              'GoPay unlink companion failed; continuing authorization without unlink',
          },
        })
        return
      }

      events.push('chatgpt.gopay_unlink.waiting')
      await machine.send('chatgpt.gopay_unlink.waiting', {
        patch: {
          gopayUnlinkStatus: 'waiting',
        },
      })
      await failedCompanion.wait()
    })()

    expect(events).toEqual(['chatgpt.gopay_unlink.failed'])
    expect(machine.getSnapshot()).toMatchObject({
      state: 'checkout-ready',
      context: {
        gopayUnlinkStatus: 'failed',
        lastMessage:
          'GoPay unlink companion failed; continuing authorization without unlink',
      },
    })
  })
})
