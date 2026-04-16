import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppVerificationProviderClient } from '../src/modules/verification/app-client'

describe('AppVerificationProviderClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the ChatGPT code from the email subject before trusting the server code field', async () => {
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
                subject: 'ChatGPT verification code 123456',
                textBody: 'Body can contain anything, it is ignored.',
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
  })

  it('can resolve from the subject even when the endpoint stays pending', async () => {
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
                subject: 'ChatGPT verification code 246810',
                textBody: 'Verification code\n999999',
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
