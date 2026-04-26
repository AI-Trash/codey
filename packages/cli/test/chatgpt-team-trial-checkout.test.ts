import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig, setRuntimeConfig } from '../src/config'
import {
  DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME,
  DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_ADDRESS,
  resolveChatGPTTeamTrialBillingAddress,
} from '../src/flows/chatgpt-team-trial'
import { extractPaypalBillingAgreementLink } from '../src/modules/chatgpt/mutations'

const baseConfig = resolveConfig()

afterEach(() => {
  setRuntimeConfig(baseConfig)
})

describe('chatgpt team trial checkout defaults', () => {
  it('uses the configured Netherlands billing address by default', () => {
    setRuntimeConfig({
      ...baseConfig,
      chatgptTeamTrial: undefined,
    })

    const address = resolveChatGPTTeamTrialBillingAddress()

    expect(address).toMatchObject(DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_ADDRESS)
    expect(address.name).toBe(DEFAULT_CHATGPT_TEAM_TRIAL_BILLING_NAME)
    expect(address.country).toBe('NL')
    expect(address.line1).toBe('Bertha von Suttnerlaan 97')
    expect(address.line2).toBe('762 Effertz Stream')
    expect(address.postalCode).toBe('1187 ST')
    expect(address.city).toBe('Amstelveen')
  })

  it('lets CLI billing options override runtime config values', () => {
    setRuntimeConfig({
      ...baseConfig,
      chatgptTeamTrial: {
        billingAddress: {
          name: 'Runtime Name',
          country: 'IE',
          line1: 'Runtime line 1',
          line2: 'Runtime line 2',
          city: 'Runtime city',
          postalCode: 'RUNTIME',
        },
      },
    })

    const address = resolveChatGPTTeamTrialBillingAddress({
      billingName: 'CLI Name',
      billingAddressLine1: 'CLI line 1',
      billingCity: 'CLI city',
      billingPostalCode: 'CLI POST',
    })

    expect(address).toMatchObject({
      name: 'CLI Name',
      country: 'IE',
      line1: 'CLI line 1',
      line2: 'Runtime line 2',
      city: 'CLI city',
      postalCode: 'CLI POST',
    })
  })
})

describe('paypal billing agreement link extraction', () => {
  it('captures PayPal approval URLs that contain a ba_token', () => {
    const url =
      'https://www.paypal.com/agreements/approve?ba_token=BA-123456789&country.x=NL'

    expect(extractPaypalBillingAgreementLink(url)).toMatchObject({
      url,
      baToken: 'BA-123456789',
      tokenParam: 'ba_token',
    })
  })

  it('captures PayPal pay URLs that contain a BA token parameter', () => {
    const url =
      'https://www.paypal.com/pay?ssrt=1777211592082&token=BA-5YL10191GX878080G&ul=1'

    expect(extractPaypalBillingAgreementLink(url)).toMatchObject({
      url,
      baToken: 'BA-5YL10191GX878080G',
      tokenParam: 'token',
    })
  })

  it('ignores non-PayPal hosts and PayPal URLs without BA tokens', () => {
    expect(
      extractPaypalBillingAgreementLink(
        'https://paypal.example.com/agreements/approve?ba_token=BA-123',
      ),
    ).toBeUndefined()
    expect(
      extractPaypalBillingAgreementLink('https://www.paypal.com/checkoutnow'),
    ).toBeUndefined()
    expect(
      extractPaypalBillingAgreementLink(
        'https://www.paypal.com/pay?token=EC-123456789',
      ),
    ).toBeUndefined()
  })
})
