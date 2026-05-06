import { describe, expect, it } from 'vitest'

import {
  createChatGPTRegisterHostedCheckoutsMachine,
  resolveHostedCheckoutCountrySpecs,
} from '../src/flows/chatgpt-register-hosted-checkouts'

describe('chatgpt register hosted checkouts flow', () => {
  it('normalizes hosted checkout country aliases and currencies', () => {
    expect(
      resolveHostedCheckoutCountrySpecs([' us2 ', 'EU', 'JP', 'ZZ']),
    ).toEqual([
      {
        requestedCountry: 'US2',
        billingCountry: 'US',
        billingCurrency: 'USD',
      },
      {
        requestedCountry: 'EU',
        billingCountry: 'IE',
        billingCurrency: 'EUR',
      },
      {
        requestedCountry: 'JP',
        billingCountry: 'JP',
        billingCurrency: 'JPY',
      },
      {
        requestedCountry: 'ZZ',
        billingCountry: 'ZZ',
        billingCurrency: 'USD',
      },
    ])
  })

  it('rejects runner-provided target overrides', async () => {
    const machine = createChatGPTRegisterHostedCheckoutsMachine()

    machine.start()
    await machine.send('chatgpt.registration.started', {
      target: 'completed',
      patch: {
        lastMessage: 'registering',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'registering',
      context: {
        lastMessage: 'registering',
      },
    })

    await machine.send('context.updated', {
      target: 'completed',
      patch: {
        lastMessage: 'still registering',
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'registering',
      context: {
        lastMessage: 'still registering',
      },
    })
  })

  it('re-enters checkout link creation after each reviewed checkout page', async () => {
    const machine = createChatGPTRegisterHostedCheckoutsMachine()

    machine.start()
    await machine.send('chatgpt.registration.started')
    await machine.send('chatgpt.registration.completed')
    await machine.send('chatgpt.coupon.selected')
    expect(machine.getSnapshot().state).toBe('checkout-link-creating')

    await machine.send('chatgpt.checkout_link.creating', {
      patch: {
        currentCountry: 'US',
        currentIndex: 1,
        totalCountries: 2,
      },
    })
    expect(machine.getSnapshot()).toMatchObject({
      state: 'checkout-link-creating',
      context: {
        currentCountry: 'US',
        currentIndex: 1,
        totalCountries: 2,
      },
    })

    await machine.send('chatgpt.checkout_link.created')
    await machine.send('chatgpt.checkout_page.opened')
    await machine.send('chatgpt.checkout_page.closed')

    expect(machine.getSnapshot().state).toBe('checkout-link-creating')
  })
})
