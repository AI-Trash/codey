import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppVerificationProviderClient } from '../src/modules/verification/app-client'

describe('AppVerificationProviderClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the ChatGPT code from the email subject before trusting the server code field', async () => {
    const fetchMock = vi.fn<typeof fetch>()
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
    const fetchMock = vi.fn<typeof fetch>()
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

  it('prefers a manually updated server code over stale email content', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issuer: 'http://localhost:4316/oidc',
            token_endpoint: 'http://localhost:4316/oidc/token',
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
            code: '654321',
            source: 'MANUAL',
            receivedAt: '2026-04-16T06:36:40.000Z',
            emails: [
              {
                subject: 'ChatGPT verification code 123456',
                htmlBody:
                  '<p>Your verification code is <strong>123456</strong>.</p>',
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
      baseUrl: 'http://localhost:4316',
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
    ).resolves.toBe('654321')
  })

  it('falls back to the English email body when the subject does not contain the code', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issuer: 'http://localhost:4313/oidc',
            token_endpoint: 'http://localhost:4313/oidc/token',
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
                subject: 'Finish signing in to ChatGPT',
                textBody: 'Use verification code 112233 to continue.',
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
      baseUrl: 'http://localhost:4313',
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
    ).resolves.toBe('112233')
  })

  it('falls back to a trailing Chinese code when the message is still pending', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issuer: 'http://localhost:4314/oidc',
            token_endpoint: 'http://localhost:4314/oidc/token',
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
                subject: 'ChatGPT 安全验证',
                textBody: '欢迎使用 ChatGPT\n请在页面输入以下验证码\n445566',
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
      baseUrl: 'http://localhost:4314',
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
    ).resolves.toBe('445566')
  })

  it('can sync a managed identity to the Codey app', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issuer: 'http://localhost:4318/oidc',
            token_endpoint: 'http://localhost:4318/oidc/token',
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
            scope: 'verification:read verification:reserve',
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
            ok: true,
            id: 'managed-identity-123',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const client = new AppVerificationProviderClient({
      baseUrl: 'http://localhost:4318',
      clientId: 'codey_client',
      clientSecret: 'codey_secret',
    })

    await expect(
      client.upsertManagedIdentity({
        identityId: 'identity-123',
        email: 'user@example.com',
        credentialCount: 1,
        reservationId: 'reservation-123',
      }),
    ).resolves.toEqual({
      ok: true,
      id: 'managed-identity-123',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:4318/api/managed-identities',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          identityId: 'identity-123',
          email: 'user@example.com',
          label: undefined,
          credentialCount: 1,
          reservationId: 'reservation-123',
        }),
      }),
    )
  })

  it('can sync a managed session to the Codey app with a client id', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issuer: 'http://localhost:4317/oidc',
            token_endpoint: 'http://localhost:4317/oidc/token',
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
            scope: 'verification:read verification:reserve',
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
            ok: true,
            id: 'managed-session-123',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const client = new AppVerificationProviderClient({
      baseUrl: 'http://localhost:4317',
      clientId: 'codey_client',
      clientSecret: 'codey_secret',
    })

    await expect(
      client.upsertManagedSession({
        identityId: 'identity-123',
        email: 'user@example.com',
        flowType: 'chatgpt-login',
        clientId: 'app_X8zY6vW2pQ9tR3dE7nK1jL5gH',
        authMode: 'chatgpt',
        sessionId: 'authsess_123',
        accountId: 'acct_123',
        lastRefreshAt: '2026-04-18T17:52:36.000Z',
        expiresAt: '2026-04-19T17:52:36.000Z',
        sessionData: {
          auth_mode: 'chatgpt',
          client_id: 'app_X8zY6vW2pQ9tR3dE7nK1jL5gH',
          tokens: {
            access_token: 'jwt-access',
          },
        },
      }),
    ).resolves.toEqual({
      ok: true,
      id: 'managed-session-123',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:4317/api/managed-sessions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          identityId: 'identity-123',
          email: 'user@example.com',
          flowType: 'chatgpt-login',
          clientId: 'app_X8zY6vW2pQ9tR3dE7nK1jL5gH',
          authMode: 'chatgpt',
          accountId: 'acct_123',
          sessionId: 'authsess_123',
          expiresAt: '2026-04-19T17:52:36.000Z',
          lastRefreshAt: '2026-04-18T17:52:36.000Z',
          sessionData: {
            auth_mode: 'chatgpt',
            client_id: 'app_X8zY6vW2pQ9tR3dE7nK1jL5gH',
            tokens: {
              access_token: 'jwt-access',
            },
          },
        }),
      }),
    )
  })

  it('includes a managed identity status when provided', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issuer: 'http://localhost:4315/oidc',
            token_endpoint: 'http://localhost:4315/oidc/token',
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
            scope: 'verification:read verification:reserve',
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
            ok: true,
            id: 'managed-identity-456',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const client = new AppVerificationProviderClient({
      baseUrl: 'http://localhost:4315',
      clientId: 'codey_client',
      clientSecret: 'codey_secret',
    })

    await expect(
      client.upsertManagedIdentity({
        identityId: 'identity-456',
        email: 'banned@example.com',
        status: 'BANNED',
      }),
    ).resolves.toEqual({
      ok: true,
      id: 'managed-identity-456',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:4315/api/managed-identities',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          identityId: 'identity-456',
          email: 'banned@example.com',
          label: undefined,
          status: 'BANNED',
        }),
      }),
    )
  })

  it('can ingest WhatsApp notifications with the ingest scope', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issuer: 'http://localhost:4327/oidc',
            token_endpoint: 'http://localhost:4327/oidc/token',
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
            scope: 'verification:ingest',
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
            ok: true,
            notificationRecordId: 'notification-1',
            codeRecordId: 'code-1',
            match: {
              matched: true,
              reservationId: 'reservation-1',
              email: 'codey+otp@example.com',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const client = new AppVerificationProviderClient({
      baseUrl: 'http://localhost:4327',
      clientId: 'codey_client',
      clientSecret: 'codey_secret',
    })

    await expect(
      client.ingestWhatsAppNotification({
        reservationId: 'reservation-1',
        packageName: 'com.whatsapp',
        body: 'Use code 123456.',
        extractedCode: '123456',
      }),
    ).resolves.toMatchObject({
      ok: true,
      notificationRecordId: 'notification-1',
      codeRecordId: 'code-1',
    })

    const tokenBody = fetchMock.mock.calls[1]?.[1]?.body as URLSearchParams
    expect(tokenBody.get('scope')).toBe('verification:ingest')
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:4327/api/ingest/whatsapp-notification',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          reservationId: 'reservation-1',
          packageName: 'com.whatsapp',
          body: 'Use code 123456.',
          extractedCode: '123456',
        }),
      }),
    )
  })
})
