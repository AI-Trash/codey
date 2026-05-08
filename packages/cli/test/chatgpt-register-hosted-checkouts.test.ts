import { describe, expect, it } from 'vitest'

import {
  createChatGPTRegisterHostedCheckoutsMachine,
  isRecoverableHostedCheckoutCountryError,
  resolveHostedCheckoutCountrySpecs,
} from '../src/flows/chatgpt-register-hosted-checkouts'
import { resolveChatGPTTeamTrialPromoCoupon } from '../src/flows/chatgpt-team-trial'

describe('chatgpt register hosted checkouts flow', () => {
  it('normalizes hosted checkout country aliases and currencies', () => {
    expect(
      resolveHostedCheckoutCountrySpecs([
        ' us2 ',
        'EU',
        'JP',
        'MA',
        'IE',
        'GP',
        'ZZ',
      ]),
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
        requestedCountry: 'MA',
        billingCountry: 'MA',
        billingCurrency: 'USD',
      },
      {
        requestedCountry: 'IE',
        billingCountry: 'IE',
        billingCurrency: 'EUR',
      },
      {
        requestedCountry: 'GP',
        billingCountry: 'FR',
        billingCurrency: 'EUR',
      },
      {
        requestedCountry: 'ZZ',
        billingCountry: 'ZZ',
        billingCurrency: 'USD',
      },
    ])
  })

  it('resolves default hosted checkout countries to accepted checkout currencies', () => {
    const acceptedCurrencies = new Set([
      'USD',
      'AUD',
      'CAD',
      'GBP',
      'EUR',
      'CLP',
      'JPY',
      'INR',
      'IDR',
      'PKR',
      'THB',
      'MYR',
      'TWD',
      'VND',
      'PHP',
      'NGN',
      'ZAR',
      'KZT',
      'TZS',
      'EGP',
      'BRL',
      'SEK',
      'CZK',
      'PLN',
      'DKK',
      'NOK',
      'KRW',
      'COP',
      'MXN',
      'PEN',
      'HUF',
      'QAR',
      'RON',
      'ILS',
      'AED',
      'SGD',
      'NZD',
      'CHF',
      'SAR',
    ])
    const currencies = resolveHostedCheckoutCountrySpecs().map(
      (spec) => spec.billingCurrency,
    )

    expect(
      currencies.every((currency) => acceptedCurrencies.has(currency)),
    ).toBe(true)
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

  it('keeps creating links after a recoverable country skip', async () => {
    const machine = createChatGPTRegisterHostedCheckoutsMachine()

    machine.start()
    await machine.send('chatgpt.registration.started')
    await machine.send('chatgpt.registration.completed')
    await machine.send('chatgpt.coupon.selected')
    await machine.send('chatgpt.checkout_link.creating', {
      patch: {
        currentCountry: 'XK',
        currentIndex: 3,
        totalCountries: 4,
      },
    })
    await machine.send('chatgpt.checkout_link.skipped', {
      patch: {
        currentCountry: 'XK',
        currentIndex: 3,
        totalCountries: 4,
        skippedCheckouts: [
          {
            requestedCountry: 'XK',
            billingCountry: 'XK',
            billingCurrency: 'USD',
            reason:
              'ChatGPT trial checkout link could not be generated (HTTP 400): invalid billing details provided',
            skippedAt: '2026-05-06T00:00:00.000Z',
          },
        ],
      },
    })

    expect(machine.getSnapshot()).toMatchObject({
      state: 'checkout-link-creating',
      context: {
        currentCountry: 'XK',
        currentIndex: 3,
        totalCountries: 4,
        skippedCheckouts: [
          {
            requestedCountry: 'XK',
            reason:
              'ChatGPT trial checkout link could not be generated (HTTP 400): invalid billing details provided',
          },
        ],
      },
    })
  })

  it('classifies invalid hosted checkout billing details as recoverable', () => {
    expect(
      isRecoverableHostedCheckoutCountryError(
        new Error(
          'ChatGPT trial checkout link could not be generated (HTTP 400): invalid billing details provided',
        ),
      ),
    ).toBe(true)
    expect(
      isRecoverableHostedCheckoutCountryError(
        new Error(
          'ChatGPT trial checkout link could not be generated (HTTP 403): ChatGPT session access token was not available.',
        ),
      ),
    ).toBe(false)
  })

  it('defaults GoPay checkout coupon selection to Plus', () => {
    expect(resolveChatGPTTeamTrialPromoCoupon()).toBe('plus-1-month-free')
  })
})
