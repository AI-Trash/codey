import { describe, expect, it } from 'vitest'
import {
  extractVerificationCode,
  extractVerificationCodeFromMessage,
} from '../src/modules/chatgpt/common'

describe('verification code extraction', () => {
  it('prefers the visible verification code in HTML over unrelated six-digit values', () => {
    const htmlBody = `
      <html>
        <head>
          <style>
            .accent { color: #480799; }
          </style>
        </head>
        <body>
          <p>ChatGPT verification code</p>
          <table>
            <tr>
              <td data-track-id="834211">
                <strong>123 456</strong>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `

    expect(extractVerificationCode(htmlBody)).toBe('123456')
    expect(
      extractVerificationCodeFromMessage({
        subject: 'ChatGPT verification code',
        htmlBody,
      }),
    ).toBe('123456')
  })

  it('accepts templates that place the code on the line after the label', () => {
    expect(
      extractVerificationCodeFromMessage({
        textBody: 'Verification code\n654321\nExpires in 10 minutes.',
      }),
    ).toBe('654321')
  })
})
