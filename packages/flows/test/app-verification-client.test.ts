import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppVerificationProviderClient } from '../src/modules/verification/app-client'

describe('AppVerificationProviderClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('extracts the verification code from returned emails before trusting the server code field', async () => {
    const htmlBody = `
      <html>
        <head>
          <style>.accent { color: #480799; }</style>
        </head>
        <body>
          <p>Verification code</p>
          <div data-render-id="834211">123 456</div>
        </body>
      </html>
    `

    const fetchMock = vi.fn<
      Parameters<typeof fetch>,
      ReturnType<typeof fetch>
    >()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issuer: 'http://localhost:4311/oidc',
            token_endpoint: 'http://localhost:4311/oidc/token',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'token-123',
            token_type: 'Bearer',
            scope: 'verification:read',
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'resolved',
            code: '480799',
            receivedAt: '2026-04-16T06:36:35.000Z',
            emails: [
              {
                subject: 'ChatGPT verification code',
                htmlBody,
                receivedAt: '2026-04-16T06:36:35.000Z',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const client = new AppVerificationProviderClient({
      baseUrl: 'http://localhost:4311',
      clientId: 'codey_client',
      clientSecret: 'codey_secret',
    })

    await expect(
      client.waitForVerificationCode({
        email: 'codey+otp@example.com',
        startedAt: '2026-04-16T06:36:30.000Z',
        timeoutMs: 1000,
        pollIntervalMs: 10,
      }),
    ).resolves.toBe('123456')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      '/api/verification/codes',
    )
  })

  it('can resolve directly from email payloads even when the endpoint stays pending', async () => {
    const fetchMock = vi.fn<
      Parameters<typeof fetch>,
      ReturnType<typeof fetch>
    >()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issuer: 'http://localhost:4312/oidc',
            token_endpoint: 'http://localhost:4312/oidc/token',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'token-123',
            token_type: 'Bearer',
            scope: 'verification:read',
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'pending',
            emails: [
              {
                textBody: 'Your verification code\n246810',
                receivedAt: '2026-04-16T06:36:35.000Z',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const client = new AppVerificationProviderClient({
      baseUrl: 'http://localhost:4312',
      clientId: 'codey_client',
      clientSecret: 'codey_secret',
    })

    await expect(
      client.waitForVerificationCode({
        email: 'codey+otp@example.com',
        startedAt: '2026-04-16T06:36:30.000Z',
        timeoutMs: 1000,
        pollIntervalMs: 10,
      }),
    ).resolves.toBe('246810')
  })
})
