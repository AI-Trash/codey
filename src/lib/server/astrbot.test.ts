import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAstrBotPayPalNotificationConfig: vi.fn(),
}))

vi.mock('./external-service-configs', () => ({
  getAstrBotPayPalNotificationConfig: mocks.getAstrBotPayPalNotificationConfig,
}))

describe('AstrBot trial payment notifications', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it('skips sending when no managed AstrBot target is configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    mocks.getAstrBotPayPalNotificationConfig.mockResolvedValue(null)

    const { sendAstrBotPayPalNotification } = await import('./astrbot')

    await expect(
      sendAstrBotPayPalNotification({
        paypalUrl: 'https://www.paypal.com/pay?token=BA-123ABC',
      }),
    ).resolves.toBeNull()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends captured PayPal links to AstrBot with the API key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    mocks.getAstrBotPayPalNotificationConfig.mockResolvedValue({
      baseUrl: 'http://astrbot:6185',
      messagePath: '/api/v1/im/message',
      umo: 'webchat:FriendMessage:operator',
      timeoutMs: 5_000,
      apiKey: 'astrbot-key',
    })

    const { sendAstrBotPayPalNotification } = await import('./astrbot')

    const result = await sendAstrBotPayPalNotification({
      paypalUrl: 'https://www.paypal.com/pay?token=BA-123ABC',
      workspace: {
        id: 'workspace-record-1',
        workspaceId: 'ws_alpha',
        label: 'Alpha',
        teamTrialPaypalUrl: 'https://www.paypal.com/pay?token=BA-123ABC',
        teamTrialPaypalCapturedAt: '2026-04-28T00:00:00.000Z',
        teamTrialPaypalExpiresAt: '2026-04-28T00:10:00.000Z',
        owner: {
          identityId: 'identity-1',
          email: 'owner@example.com',
          identityLabel: 'Owner',
          authorization: {
            state: 'missing',
            expiresAt: null,
            lastSeenAt: null,
          },
        },
        memberCount: 0,
        members: [],
        createdAt: '2026-04-28T00:00:00.000Z',
        updatedAt: '2026-04-28T00:00:00.000Z',
      },
      capturedAt: new Date('2026-04-28T00:00:00.000Z'),
    })

    expect(result).toEqual({
      endpoint: 'http://astrbot:6185/api/v1/im/message',
      umo: 'webchat:FriendMessage:operator',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://astrbot:6185/api/v1/im/message',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-API-Key': 'astrbot-key',
        },
      }),
    )
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body)
    expect(body).toEqual(
      expect.objectContaining({
        umo: 'webchat:FriendMessage:operator',
        message: expect.stringContaining(
          'https://www.paypal.com/pay?token=BA-123ABC',
        ),
      }),
    )
    expect(body.message).toContain('owner@example.com')
  })

  it('supports bearer token auth and message templates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    mocks.getAstrBotPayPalNotificationConfig.mockResolvedValue({
      baseUrl: 'http://astrbot:6185',
      messagePath: '/api/v1/im/message',
      umo: 'webchat:FriendMessage:operator',
      timeoutMs: 5_000,
      bearerToken: 'bearer-token',
      messageTemplate: 'Pay {ownerEmail}: {paypalUrl}',
    })

    const { sendAstrBotPayPalNotification } = await import('./astrbot')

    await sendAstrBotPayPalNotification({
      paypalUrl: 'https://www.paypal.com/pay?token=BA-123ABC',
      workspace: null,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://astrbot:6185/api/v1/im/message',
      expect.objectContaining({
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer bearer-token',
        },
      }),
    )
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body)
    expect(body.message).toBe(
      'Pay unknown owner: https://www.paypal.com/pay?token=BA-123ABC',
    )
  })

  it('sends captured GoPay links to AstrBot with generic template placeholders', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    mocks.getAstrBotPayPalNotificationConfig.mockResolvedValue({
      baseUrl: 'http://astrbot:6185',
      messagePath: '/api/v1/im/message',
      umo: 'webchat:FriendMessage:operator',
      timeoutMs: 5_000,
      apiKey: 'astrbot-key',
      messageTemplate: '{paymentLabel}: {paymentUrl}',
    })

    const { sendAstrBotTrialPaymentNotification } = await import('./astrbot')

    await sendAstrBotTrialPaymentNotification({
      paymentMethod: 'gopay',
      paymentUrl:
        'https://app.midtrans.com/snap/v4/redirection/gopay-1#/gopay-tokenization/linking',
      workspace: null,
    })

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body)
    expect(body.message).toBe(
      'GoPay: https://app.midtrans.com/snap/v4/redirection/gopay-1#/gopay-tokenization/linking',
    )
  })

  it('sends workspace removal notifications with the cleanup reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    mocks.getAstrBotPayPalNotificationConfig.mockResolvedValue({
      baseUrl: 'http://astrbot:6185',
      messagePath: '/api/v1/im/message',
      umo: 'webchat:FriendMessage:operator',
      timeoutMs: 5_000,
      apiKey: 'astrbot-key',
    })

    const { sendAstrBotWorkspaceRemovalNotification } =
      await import('./astrbot')

    await expect(
      sendAstrBotWorkspaceRemovalNotification({
        workspace: {
          id: 'workspace-record-1',
          workspaceId: 'ws_alpha',
          label: 'Alpha',
          teamTrialPaypalUrl: null,
          teamTrialPaypalCapturedAt: null,
          teamTrialPaypalExpiresAt: null,
          owner: {
            identityId: 'identity-1',
            email: 'owner@example.com',
            identityLabel: 'Owner',
            authorization: {
              state: 'missing',
              expiresAt: null,
              lastSeenAt: null,
            },
          },
          memberCount: 0,
          members: [],
          createdAt: '2026-04-28T00:00:00.000Z',
          updatedAt: '2026-04-28T00:00:00.000Z',
        },
        reason:
          'Received ChatGPT Business trial-ended email: Your ChatGPT Business trial has ended',
        removedAt: new Date('2026-04-28T00:00:00.000Z'),
        sub2ApiCleanup: {
          removedAccounts: [
            {
              accountId: 501,
              name: 'owner@example.com + ws_alpha',
              status: 'disabled',
            },
          ],
        },
      }),
    ).resolves.toEqual({
      endpoint: 'http://astrbot:6185/api/v1/im/message',
      umo: 'webchat:FriendMessage:operator',
    })

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body)
    expect(body.message).toContain(
      'Reason: Received ChatGPT Business trial-ended email: Your ChatGPT Business trial has ended',
    )
    expect(body.message).toContain('Workspace ID: ws_alpha')
    expect(body.message).toContain('Owner: owner@example.com')
    expect(body.message).toContain('Sub2API disabled accounts removed: 1 (501)')
  })
})
