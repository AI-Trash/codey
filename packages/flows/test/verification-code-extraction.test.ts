import { describe, expect, it } from 'vitest'
import { extractChatGPTVerificationCodeFromSubject } from '../src/modules/chatgpt/common'

describe('ChatGPT verification code extraction', () => {
  it('extracts the trailing six digits from the subject', () => {
    expect(
      extractChatGPTVerificationCodeFromSubject(
        'ChatGPT verification code 123456',
      ),
    ).toBe('123456')
    expect(
      extractChatGPTVerificationCodeFromSubject(
        'ChatGPT verification code 123 456',
      ),
    ).toBe('123456')
  })

  it('ignores numbers that are not at the end of the subject', () => {
    expect(
      extractChatGPTVerificationCodeFromSubject(
        'ChatGPT verification code 123456 expires soon',
      ),
    ).toBeNull()
  })
})
