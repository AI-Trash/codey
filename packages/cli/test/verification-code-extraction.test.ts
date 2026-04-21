import { describe, expect, it } from 'vitest'
import {
  extractChatGPTVerificationCodeFromBody,
  extractChatGPTVerificationCodeFromEmail,
  extractChatGPTVerificationCodeFromSubject,
} from '../src/modules/chatgpt/common'

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

  it('extracts a verification code from an English email body', () => {
    expect(
      extractChatGPTVerificationCodeFromBody(
        'Your verification code is 654321. Enter it to continue.',
      ),
    ).toBe('654321')
  })

  it('extracts a trailing Chinese verification code from the message tail', () => {
    expect(
      extractChatGPTVerificationCodeFromBody(
        '欢迎使用 ChatGPT\n请在页面输入以下验证码\n321654',
      ),
    ).toBe('321654')
  })

  it('checks the subject before falling back to the body', () => {
    expect(
      extractChatGPTVerificationCodeFromEmail({
        subject: 'ChatGPT verification code 135790',
        textBody: 'Your verification code is 246810.',
      }),
    ).toBe('135790')
  })
})
