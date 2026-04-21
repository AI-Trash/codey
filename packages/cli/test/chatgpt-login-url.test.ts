import { describe, expect, it } from 'vitest'
import { isChatGPTLoginUrl } from '../src/modules/chatgpt/common'

describe('isChatGPTLoginUrl', () => {
  it('matches the OAuth login challenge page', () => {
    expect(
      isChatGPTLoginUrl(
        'https://auth.openai.com/api/accounts/login?login_challenge=test-challenge',
      ),
    ).toBe(true)
  })

  it('matches the standard ChatGPT login entry pages', () => {
    expect(isChatGPTLoginUrl('https://chatgpt.com/auth/login')).toBe(true)
    expect(isChatGPTLoginUrl('https://auth.openai.com/log-in')).toBe(true)
    expect(
      isChatGPTLoginUrl(
        'https://auth.openai.com/log-in-or-create-account?login=1',
      ),
    ).toBe(true)
    expect(
      isChatGPTLoginUrl(
        'https://auth.openai.com/oauth/authorize?client_id=codex-client-id',
      ),
    ).toBe(true)
  })

  it('rejects unrelated pages', () => {
    expect(isChatGPTLoginUrl('https://chatgpt.com/')).toBe(false)
    expect(isChatGPTLoginUrl('https://auth.openai.com/')).toBe(false)
  })
})
