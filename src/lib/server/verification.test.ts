import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createId: vi.fn(() => 'generated-id'),
  deleteManagedWorkspace: vi.fn(),
  findAdminManagedWorkspaceSummaryByOwnerIdentity: vi.fn(),
  getDb: vi.fn(),
  hasAdminVerificationMessageSubscribers: vi.fn(() => false),
  listAdminCliConnectionState: vi.fn(),
  removeDisabledSub2ApiAccountsForWorkspace: vi.fn(),
  sendAstrBotWorkspaceRemovalNotification: vi.fn(),
  publishAdminVerificationMessageEvent: vi.fn(),
  publishVerificationCodeEvent: vi.fn(),
  dispatchCliFlowTasks: vi.fn(),
}))

vi.mock('./db/client', () => ({
  getDb: mocks.getDb,
}))

vi.mock('./security', () => ({
  createId: mocks.createId,
}))

vi.mock('./admin-inbox-events', () => ({
  hasAdminVerificationMessageSubscribers:
    mocks.hasAdminVerificationMessageSubscribers,
  publishAdminVerificationMessageEvent:
    mocks.publishAdminVerificationMessageEvent,
}))

vi.mock('./verification-events', () => ({
  publishVerificationCodeEvent: mocks.publishVerificationCodeEvent,
}))

vi.mock('./workspaces', () => ({
  deleteManagedWorkspace: mocks.deleteManagedWorkspace,
  findAdminManagedWorkspaceSummaryByOwnerIdentity:
    mocks.findAdminManagedWorkspaceSummaryByOwnerIdentity,
}))

vi.mock('./sub2api-codex-oauth', () => ({
  removeDisabledSub2ApiAccountsForWorkspace:
    mocks.removeDisabledSub2ApiAccountsForWorkspace,
}))

vi.mock('./astrbot', () => ({
  sendAstrBotWorkspaceRemovalNotification:
    mocks.sendAstrBotWorkspaceRemovalNotification,
}))

vi.mock('./cli-connections', () => ({
  listAdminCliConnectionState: mocks.listAdminCliConnectionState,
}))

vi.mock('./cli-tasks', () => ({
  dispatchCliFlowTasks: mocks.dispatchCliFlowTasks,
}))

import {
  ingestCloudflareEmail,
  ingestWhatsAppNotification,
  isChatGptBusinessTrialEndedSubject,
  isChatGptPlusSubscriptionSuccessEmail,
  reserveVerificationEmailTarget,
} from './verification'

function createEmailInsertChain(emailRecord: unknown) {
  const returning = vi.fn().mockResolvedValue([emailRecord])
  const values = vi.fn(() => ({
    returning,
  }))

  return {
    insert: vi.fn(() => ({
      values,
    })),
    returning,
    values,
  }
}

function createInsertChain(record: unknown) {
  const returning = vi.fn().mockResolvedValue(record ? [record] : [])
  const onConflictDoNothing = vi.fn(() => ({
    returning,
  }))
  const values = vi.fn(() => ({
    onConflictDoNothing,
    returning,
  }))

  return {
    returning,
    onConflictDoNothing,
    values,
  }
}

function createReservationInsertChain(records: unknown[]) {
  const returning = vi.fn().mockResolvedValue(records)
  const onConflictDoNothing = vi.fn(() => ({
    returning,
  }))
  const values = vi.fn(() => ({
    onConflictDoNothing,
  }))

  return {
    returning,
    onConflictDoNothing,
    values,
  }
}

function createCliConnectionSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'connection-1',
    workerId: 'worker-1',
    sessionRef: null,
    userId: null,
    authClientId: 'service-client-1',
    cliName: 'CLI 1',
    target: null,
    userAgent: 'codey-test',
    registeredFlows: ['codex-oauth'],
    storageStateIdentityIds: [],
    storageStateEmails: [],
    browserLimit: 10,
    connectionPath: '/tmp/codey',
    status: 'active',
    connectedAt: '2026-05-03T00:00:00.000Z',
    lastSeenAt: '2026-05-03T00:00:10.000Z',
    disconnectedAt: null,
    githubLogin: null,
    email: null,
    userLabel: 'Service client',
    runtimeFlowId: null,
    runtimeTaskId: null,
    runtimeFlowStatus: null,
    runtimeFlowMessage: null,
    runtimeFlowStartedAt: null,
    runtimeFlowCompletedAt: null,
    runtimeFlowUpdatedAt: null,
    ...overrides,
  }
}

describe('verification email reservations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createId.mockImplementation(() => 'reservation-id')
    process.env.DATABASE_URL = 'postgresql://codey:codey@localhost:5432/codey'
    process.env.VERIFICATION_RESERVATION_TTL_MINUTES = '15'
    delete process.env.VERIFICATION_DOMAIN
    delete process.env.VERIFICATION_MAILBOX
  })

  it('does not prepend a mailbox prefix when the selected domain has none', async () => {
    const reservation = {
      id: 'reservation-id',
      email: 'memorable-name@example.com',
      prefix: null,
      mailbox: 'memorable-name@example.com',
      expiresAt: new Date('2026-05-03T00:15:00.000Z'),
    }
    const reservationInsert = createReservationInsertChain([reservation])

    mocks.getDb.mockReturnValue({
      query: {
        verificationDomains: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'domain-1',
              domain: 'example.com',
              mailboxPrefix: null,
              registrationEnabled: true,
              isDefault: true,
              createdAt: new Date('2026-05-03T00:00:00.000Z'),
            },
          ]),
        },
      },
      insert: vi.fn(() => ({
        values: reservationInsert.values,
      })),
    })
    await expect(reserveVerificationEmailTarget()).resolves.toMatchObject({
      reservationId: 'reservation-id',
      email: 'memorable-name@example.com',
      mailbox: 'memorable-name@example.com',
    })

    expect(reservationInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        email: expect.stringMatching(/^[a-z]+-[a-z]+-\d+@example\.com$/),
        prefix: undefined,
        mailbox: expect.not.stringMatching(/^codey-/),
      }),
    )
  })

  it('prepends the domain mailbox prefix only when it is configured', async () => {
    const reservation = {
      id: 'reservation-id',
      email: 'codey-memorable-name@example.com',
      prefix: 'codey',
      mailbox: 'codey-memorable-name@example.com',
      expiresAt: new Date('2026-05-03T00:15:00.000Z'),
    }
    const reservationInsert = createReservationInsertChain([reservation])

    mocks.getDb.mockReturnValue({
      query: {
        verificationDomains: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'domain-1',
              domain: 'example.com',
              mailboxPrefix: ' Codey ',
              registrationEnabled: true,
              isDefault: true,
              createdAt: new Date('2026-05-03T00:00:00.000Z'),
            },
          ]),
        },
      },
      insert: vi.fn(() => ({
        values: reservationInsert.values,
      })),
    })
    await expect(reserveVerificationEmailTarget()).resolves.toMatchObject({
      reservationId: 'reservation-id',
      email: 'codey-memorable-name@example.com',
      prefix: 'codey',
      mailbox: 'codey-memorable-name@example.com',
    })

    expect(reservationInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        email: expect.stringMatching(/^codey-[a-z]+-[a-z]+-\d+@example\.com$/),
        prefix: 'codey',
        mailbox: expect.stringMatching(
          /^codey-[a-z]+-[a-z]+-\d+@example\.com$/,
        ),
      }),
    )
  })

  it('uses plus-address aliases when the selected registration mailbox is outlook', async () => {
    const reservation = {
      id: 'reservation-id',
      email: 'codey+qa-memorable-name@outlook.example.com',
      prefix: 'qa',
      mailbox: 'codey@outlook.example.com',
      expiresAt: new Date('2026-05-03T00:15:00.000Z'),
    }
    const reservationInsert = createReservationInsertChain([reservation])

    mocks.getDb.mockReturnValue({
      query: {
        verificationDomains: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'mailbox-cloudflare',
              domain: 'example.com',
              mailboxType: 'cloudflare',
              mailboxPrefix: null,
              registrationEnabled: false,
              isDefault: true,
              createdAt: new Date('2026-05-03T00:00:00.000Z'),
            },
            {
              id: 'mailbox-1',
              domain: 'codey@outlook.example.com',
              mailboxType: 'outlook',
              mailboxPrefix: 'qa',
              registrationEnabled: true,
              isDefault: true,
              createdAt: new Date('2026-05-03T00:00:00.000Z'),
            },
          ]),
        },
      },
      insert: vi.fn(() => ({
        values: reservationInsert.values,
      })),
    })

    await expect(reserveVerificationEmailTarget()).resolves.toMatchObject({
      reservationId: 'reservation-id',
      email: 'codey+qa-memorable-name@outlook.example.com',
      prefix: 'qa',
      mailbox: 'codey@outlook.example.com',
    })

    expect(reservationInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        email: expect.stringMatching(
          /^codey\+qa-[a-z]+-[a-z]+-\d+@outlook\.example\.com$/,
        ),
        prefix: 'qa',
        mailbox: 'codey@outlook.example.com',
      }),
    )
  })
})

describe('ChatGPT Business trial-ended email handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasAdminVerificationMessageSubscribers.mockReturnValue(false)
  })

  it('matches ended ChatGPT Business trial subjects without matching warnings', () => {
    expect(
      isChatGptBusinessTrialEndedSubject('你的 ChatGPT Business 试用期已结束'),
    ).toBe(true)
    expect(
      isChatGptBusinessTrialEndedSubject(
        'Your ChatGPT Business trial has ended',
      ),
    ).toBe(true)
    expect(
      isChatGptBusinessTrialEndedSubject(
        'Your ChatGPT Team free trial expired',
      ),
    ).toBe(true)
    expect(
      isChatGptBusinessTrialEndedSubject(
        'Your ChatGPT Business trial ends soon',
      ),
    ).toBe(false)
    expect(
      isChatGptBusinessTrialEndedSubject('Your ChatGPT Plus trial has ended'),
    ).toBe(false)
  })

  it('deletes the owner workspace when the matched recipient reservation has an owner identity', async () => {
    const receivedAt = new Date('2026-04-28T00:00:00.000Z')
    const emailRecord = {
      id: 'email-record-1',
      reservationId: 'reservation-1',
      messageId: 'message-1',
      recipient: 'owner@example.com',
      subject: 'Your ChatGPT Business trial has ended',
      textBody: 'The trial is over.',
      htmlBody: null,
      rawPayload: null,
      verificationCode: null,
      receivedAt,
      createdAt: receivedAt,
    }
    const insertChain = createEmailInsertChain(emailRecord)

    const workspace = {
      id: 'workspace-record-1',
      workspaceId: 'ws_alpha',
      label: 'Alpha',
      teamTrialPaypalUrl: null,
      teamTrialPaypalCapturedAt: null,
      teamTrialPaypalExpiresAt: null,
      owner: {
        identityId: 'owner-identity-1',
        email: 'owner@example.com',
        identityLabel: 'Owner',
        authorization: {
          state: 'missing' as const,
          expiresAt: null,
          lastSeenAt: null,
        },
      },
      memberCount: 0,
      members: [],
      createdAt: '2026-04-28T00:00:00.000Z',
      updatedAt: '2026-04-28T00:00:00.000Z',
    }
    const sub2ApiCleanup = {
      workspaceId: 'ws_alpha',
      removedAccounts: [
        {
          accountId: 501,
          name: 'owner@example.com + ws_alpha',
          status: 'disabled',
        },
      ],
    }
    mocks.findAdminManagedWorkspaceSummaryByOwnerIdentity.mockResolvedValue(
      workspace,
    )
    mocks.deleteManagedWorkspace.mockResolvedValue({
      id: 'workspace-record-1',
    })
    mocks.removeDisabledSub2ApiAccountsForWorkspace.mockResolvedValue(
      sub2ApiCleanup,
    )
    mocks.sendAstrBotWorkspaceRemovalNotification.mockResolvedValue({
      endpoint: 'http://astrbot:6185/api/v1/im/message',
      umo: 'webchat:FriendMessage:operator',
    })
    mocks.getDb.mockReturnValue({
      query: {
        verificationEmailReservations: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'reservation-1',
            email: 'owner@example.com',
            identityId: 'owner-identity-1',
          }),
        },
        managedIdentities: {
          findFirst: vi.fn(),
        },
      },
      insert: insertChain.insert,
    })

    await expect(
      ingestCloudflareEmail({
        recipient: 'owner@example.com',
        subject: 'Your ChatGPT Business trial has ended',
        textBody: 'The trial is over.',
        messageId: 'message-1',
        receivedAt: receivedAt.toISOString(),
      }),
    ).resolves.toMatchObject({
      emailRecord,
      codeRecord: null,
      workspaceCleanup: {
        reason: 'chatgpt_business_trial_ended',
        reasonMessage:
          'Received ChatGPT Business trial-ended email: Your ChatGPT Business trial has ended',
        ownerIdentityId: 'owner-identity-1',
        workspaceId: 'ws_alpha',
        deletedWorkspaceId: 'workspace-record-1',
        sub2ApiCleanup,
        astrbotNotification: {
          endpoint: 'http://astrbot:6185/api/v1/im/message',
          umo: 'webchat:FriendMessage:operator',
        },
      },
    })

    expect(
      mocks.findAdminManagedWorkspaceSummaryByOwnerIdentity,
    ).toHaveBeenCalledWith('owner-identity-1')
    expect(mocks.deleteManagedWorkspace).toHaveBeenCalledWith(
      'workspace-record-1',
    )
    expect(
      mocks.removeDisabledSub2ApiAccountsForWorkspace,
    ).toHaveBeenCalledWith({
      workspaceId: 'ws_alpha',
    })
    expect(mocks.sendAstrBotWorkspaceRemovalNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace,
        reason:
          'Received ChatGPT Business trial-ended email: Your ChatGPT Business trial has ended',
        sub2ApiCleanup,
      }),
    )
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: 'owner@example.com',
        subject: 'Your ChatGPT Business trial has ended',
      }),
    )
  })

  it('falls back to the recipient managed identity when no reservation identity is attached', async () => {
    const receivedAt = new Date('2026-04-28T00:00:00.000Z')
    const emailRecord = {
      id: 'email-record-2',
      reservationId: null,
      messageId: null,
      recipient: 'owner@example.com',
      subject: 'Your ChatGPT Business trial has ended',
      textBody: null,
      htmlBody: null,
      rawPayload: null,
      verificationCode: null,
      receivedAt,
      createdAt: receivedAt,
    }
    const findManagedIdentity = vi.fn().mockResolvedValue({
      identityId: 'owner-identity-2',
    })
    const insertChain = createEmailInsertChain(emailRecord)

    mocks.findAdminManagedWorkspaceSummaryByOwnerIdentity.mockResolvedValue(
      null,
    )
    mocks.getDb.mockReturnValue({
      query: {
        verificationEmailReservations: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        managedIdentities: {
          findFirst: findManagedIdentity,
        },
      },
      insert: insertChain.insert,
    })

    await expect(
      ingestCloudflareEmail({
        recipient: 'OWNER@example.com',
        subject: 'Your ChatGPT Business trial has ended',
      }),
    ).resolves.toMatchObject({
      workspaceCleanup: {
        ownerIdentityId: 'owner-identity-2',
        workspaceId: null,
        deletedWorkspaceId: null,
      },
    })

    expect(findManagedIdentity).toHaveBeenCalledTimes(1)
    expect(
      mocks.findAdminManagedWorkspaceSummaryByOwnerIdentity,
    ).toHaveBeenCalledWith('owner-identity-2')
    expect(mocks.deleteManagedWorkspace).not.toHaveBeenCalled()
  })

  it('does not cleanup workspaces for unrelated email subjects', async () => {
    const receivedAt = new Date('2026-04-28T00:00:00.000Z')
    const emailRecord = {
      id: 'email-record-3',
      reservationId: 'reservation-3',
      messageId: null,
      recipient: 'owner@example.com',
      subject: 'Your verification code',
      textBody: 'No trial signal.',
      htmlBody: null,
      rawPayload: null,
      verificationCode: null,
      receivedAt,
      createdAt: receivedAt,
    }
    const insertChain = createEmailInsertChain(emailRecord)

    mocks.getDb.mockReturnValue({
      query: {
        verificationEmailReservations: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'reservation-3',
            email: 'owner@example.com',
            identityId: 'owner-identity-3',
          }),
        },
        managedIdentities: {
          findFirst: vi.fn(),
        },
      },
      insert: insertChain.insert,
    })

    await expect(
      ingestCloudflareEmail({
        recipient: 'owner@example.com',
        subject: 'Your verification code',
        textBody: 'No trial signal.',
      }),
    ).resolves.toMatchObject({
      workspaceCleanup: null,
    })

    expect(
      mocks.findAdminManagedWorkspaceSummaryByOwnerIdentity,
    ).not.toHaveBeenCalled()
    expect(mocks.deleteManagedWorkspace).not.toHaveBeenCalled()
  })

  it('matches an outlook-forwarded message to the original reservation recipient', async () => {
    const receivedAt = new Date('2026-04-28T00:00:00.000Z')
    const emailRecord = {
      id: 'email-record-outlook',
      reservationId: 'reservation-outlook',
      messageId: 'message-outlook',
      recipient: 'codey+qa-solar-pine-42@outlook.example.com',
      subject: 'Your verification code',
      textBody: 'Your verification code is 123456',
      htmlBody: null,
      rawPayload: null,
      verificationCode: '123456',
      receivedAt,
      createdAt: receivedAt,
    }
    const reservation = {
      id: 'reservation-outlook',
      email: 'codey+qa-solar-pine-42@outlook.example.com',
      identityId: null,
    }
    const codeRecord = {
      id: 'code-record-outlook',
      reservationId: reservation.id,
      code: '123456',
      source: 'CLOUDFLARE_EMAIL',
      messageId: 'message-outlook',
      receivedAt,
    }
    const emailInsert = createEmailInsertChain(emailRecord)
    const codeInsert = createInsertChain(codeRecord)
    const findReservation = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(reservation)
    const rawPayload = [
      'From: OpenAI <noreply@tm.openai.com>',
      'To: codey+qa-solar-pine-42@outlook.example.com',
      'Subject: Your verification code',
      'Message-Id: <message-outlook@example.com>',
      '',
      'Your verification code is 123456',
    ].join('\r\n')

    mocks.getDb.mockReturnValue({
      query: {
        verificationEmailReservations: {
          findFirst: findReservation,
        },
      },
      insert: vi
        .fn()
        .mockReturnValueOnce({ values: emailInsert.values })
        .mockReturnValueOnce({ values: codeInsert.values }),
    })

    await expect(
      ingestCloudflareEmail({
        recipient: 'codey@outlook.example.com',
        rawPayload,
        messageId: 'message-outlook',
        receivedAt: receivedAt.toISOString(),
      }),
    ).resolves.toMatchObject({
      emailRecord,
      codeRecord,
    })

    expect(findReservation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.anything(),
      }),
    )
    expect(emailInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: reservation.id,
        recipient: reservation.email,
        textBody: 'Your verification code is 123456',
        verificationCode: '123456',
      }),
    )
    expect(codeInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: reservation.id,
        code: '123456',
      }),
    )
  })
})

describe('ChatGPT Plus subscription email handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasAdminVerificationMessageSubscribers.mockReturnValue(false)
    mocks.createId.mockImplementation(() => 'generated-id')
  })

  it('matches ChatGPT Plus subscription success emails', () => {
    expect(
      isChatGptPlusSubscriptionSuccessEmail({
        subject: 'ChatGPT - 你的新套餐',
      }),
    ).toBe(true)
    expect(
      isChatGptPlusSubscriptionSuccessEmail({
        subject: '=?UTF-8?B?Q2hhdEdQVCAtIOS9oOeahOaWsOWll+mkkA==?=',
      }),
    ).toBe(true)
    expect(
      isChatGptPlusSubscriptionSuccessEmail({
        subject: 'Your new ChatGPT plan',
      }),
    ).toBe(true)
    expect(
      isChatGptPlusSubscriptionSuccessEmail({
        subject: 'Receipt from OpenAI',
        textBody: '你已成功订阅 ChatGPT Plus。',
      }),
    ).toBe(true)
    expect(
      isChatGptPlusSubscriptionSuccessEmail({
        subject: 'Your ChatGPT Business trial has ended',
        textBody: 'No Plus subscription.',
      }),
    ).toBe(false)
  })

  it('dispatches Codex OAuth for the managed identity email when Plus subscription succeeds', async () => {
    const receivedAt = new Date('2026-05-03T00:00:00.000Z')
    const emailRecord = {
      id: 'email-record-plus-1',
      reservationId: 'reservation-plus-1',
      messageId: 'message-plus-1',
      recipient: 'alias@example.com',
      subject: 'ChatGPT - 你的新套餐',
      textBody: '你已成功订阅 ChatGPT Plus。',
      htmlBody: null,
      rawPayload: null,
      verificationCode: null,
      receivedAt,
      createdAt: receivedAt,
    }
    const insertChain = createEmailInsertChain(emailRecord)
    const reservation = {
      id: 'reservation-plus-1',
      email: 'alias@example.com',
      identityId: 'identity-plus-1',
    }
    const findManagedIdentity = vi.fn().mockResolvedValueOnce({
      email: 'owner@example.com',
    })
    const preferredConnection = createCliConnectionSummary({
      id: 'connection-preferred',
      storageStateEmails: ['owner@example.com'],
      lastSeenAt: '2026-05-03T00:00:20.000Z',
    })
    const fallbackConnection = createCliConnectionSummary({
      id: 'connection-fallback',
      storageStateEmails: [],
      lastSeenAt: '2026-05-03T00:00:30.000Z',
    })

    mocks.listAdminCliConnectionState.mockResolvedValue({
      snapshotAt: '2026-05-03T00:00:30.000Z',
      activeConnections: [fallbackConnection, preferredConnection],
    })
    mocks.dispatchCliFlowTasks.mockResolvedValue({
      tasks: [{ id: 'codex-oauth-task-1' }],
      connection: preferredConnection,
      assignedCliCount: 1,
    })
    mocks.getDb.mockReturnValue({
      query: {
        verificationEmailReservations: {
          findFirst: vi.fn().mockResolvedValue(reservation),
        },
        managedIdentities: {
          findFirst: findManagedIdentity,
        },
        flowTasks: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      insert: insertChain.insert,
    })

    await expect(
      ingestCloudflareEmail({
        recipient: 'alias@example.com',
        subject: 'ChatGPT - 你的新套餐',
        textBody: '你已成功订阅 ChatGPT Plus。',
        messageId: 'message-plus-1',
        receivedAt: receivedAt.toISOString(),
      }),
    ).resolves.toMatchObject({
      subscriptionCodexOAuth: {
        status: 'queued',
        targetEmail: 'owner@example.com',
        connectionId: 'connection-preferred',
        queuedCount: 1,
        taskIds: ['codex-oauth-task-1'],
      },
    })

    expect(mocks.dispatchCliFlowTasks).toHaveBeenCalledWith({
      connectionId: 'connection-preferred',
      flowId: 'codex-oauth',
      config: {
        email: 'owner@example.com',
      },
    })
  })

  it('dispatches Codex OAuth when the subscription subject is MIME-encoded', async () => {
    const receivedAt = new Date('2026-05-03T00:00:00.000Z')
    const emailRecord = {
      id: 'email-record-plus-encoded',
      reservationId: null,
      messageId: 'message-plus-encoded',
      recipient: 'owner@example.com',
      subject: 'ChatGPT - 你的新套餐',
      textBody: null,
      htmlBody: null,
      rawPayload: null,
      verificationCode: null,
      receivedAt,
      createdAt: receivedAt,
    }
    const connection = createCliConnectionSummary({
      id: 'connection-encoded',
    })
    const insertChain = createEmailInsertChain(emailRecord)

    mocks.listAdminCliConnectionState.mockResolvedValue({
      snapshotAt: '2026-05-03T00:00:30.000Z',
      activeConnections: [connection],
    })
    mocks.dispatchCliFlowTasks.mockResolvedValue({
      tasks: [{ id: 'codex-oauth-task-encoded' }],
      connection,
      assignedCliCount: 1,
    })
    mocks.getDb.mockReturnValue({
      query: {
        verificationEmailReservations: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        managedIdentities: {
          findFirst: vi.fn().mockResolvedValue({
            email: 'owner@example.com',
          }),
        },
        flowTasks: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      insert: insertChain.insert,
    })

    await expect(
      ingestCloudflareEmail({
        recipient: 'owner@example.com',
        subject: '=?UTF-8?B?Q2hhdEdQVCAtIOS9oOeahOaWsOWll+mkkA==?=',
        messageId: 'message-plus-encoded',
        receivedAt: receivedAt.toISOString(),
      }),
    ).resolves.toMatchObject({
      subscriptionCodexOAuth: {
        status: 'queued',
        targetEmail: 'owner@example.com',
        connectionId: 'connection-encoded',
        taskIds: ['codex-oauth-task-encoded'],
      },
    })

    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'ChatGPT - 你的新套餐',
      }),
    )
  })

  it('skips Codex OAuth dispatch when a recent task already exists for the email', async () => {
    const receivedAt = new Date('2026-05-03T00:00:00.000Z')
    const emailRecord = {
      id: 'email-record-plus-2',
      reservationId: null,
      messageId: null,
      recipient: 'owner@example.com',
      subject: 'Receipt',
      textBody: '你已成功订阅 ChatGPT Plus。',
      htmlBody: null,
      rawPayload: null,
      verificationCode: null,
      receivedAt,
      createdAt: receivedAt,
    }
    const insertChain = createEmailInsertChain(emailRecord)
    mocks.getDb.mockReturnValue({
      query: {
        verificationEmailReservations: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        managedIdentities: {
          findFirst: vi.fn().mockResolvedValue({
            email: 'owner@example.com',
          }),
        },
        flowTasks: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'existing-codex-oauth-task',
          }),
        },
      },
      insert: insertChain.insert,
    })

    await expect(
      ingestCloudflareEmail({
        recipient: 'owner@example.com',
        subject: 'Receipt',
        textBody: '你已成功订阅 ChatGPT Plus。',
      }),
    ).resolves.toMatchObject({
      subscriptionCodexOAuth: {
        status: 'skipped',
        reason: 'existing_codex_oauth_task',
        targetEmail: 'owner@example.com',
        taskId: 'existing-codex-oauth-task',
      },
    })

    expect(mocks.listAdminCliConnectionState).not.toHaveBeenCalled()
    expect(mocks.dispatchCliFlowTasks).not.toHaveBeenCalled()
  })
})

describe('WhatsApp notification ingest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createId.mockReset()
    mocks.createId.mockImplementation(() => 'generated-id')
    mocks.createId
      .mockReturnValueOnce('notification-record-1')
      .mockReturnValueOnce('code-record-1')
  })

  it('stores and publishes a WhatsApp code for an explicit reservation id', async () => {
    const receivedAt = new Date('2026-04-30T00:00:00.000Z')
    const reservation = {
      id: 'reservation-1',
      email: 'codey@example.com',
      prefix: null,
      mailbox: null,
      identityId: null,
      createdAt: receivedAt,
      expiresAt: new Date('2026-04-30T00:15:00.000Z'),
      updatedAt: receivedAt,
    }
    const notificationRecord = {
      id: 'notification-record-1',
      reservationId: reservation.id,
      verificationCode: '123456',
      receivedAt,
    }
    const codeRecord = {
      id: 'code-record-1',
      reservationId: reservation.id,
      code: '123456',
      source: 'WHATSAPP_NOTIFICATION',
      messageId: notificationRecord.id,
      receivedAt,
    }
    const notificationInsert = createInsertChain(notificationRecord)
    const codeInsert = createInsertChain(codeRecord)
    const insert = vi
      .fn()
      .mockReturnValueOnce({ values: notificationInsert.values })
      .mockReturnValueOnce({ values: codeInsert.values })

    mocks.getDb.mockReturnValue({
      query: {
        verificationEmailReservations: {
          findFirst: vi.fn().mockResolvedValue(reservation),
        },
      },
      insert,
    })

    await expect(
      ingestWhatsAppNotification({
        reservationId: reservation.id,
        packageName: 'com.whatsapp',
        title: 'OpenAI',
        body: 'Your verification code is 123456',
        receivedAt: receivedAt.toISOString(),
      }),
    ).resolves.toMatchObject({
      notificationRecord,
      codeRecord,
      match: {
        status: 'matched',
        strategy: 'reservation_id',
        reservationId: reservation.id,
        email: reservation.email,
      },
    })

    expect(notificationInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'notification-record-1',
        reservationId: reservation.id,
        mobileDeviceId: undefined,
        packageName: 'com.whatsapp',
        verificationCode: '123456',
      }),
    )
    expect(codeInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'code-record-1',
        reservationId: reservation.id,
        code: '123456',
        source: 'WHATSAPP_NOTIFICATION',
        messageId: notificationRecord.id,
      }),
    )
    expect(mocks.publishVerificationCodeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: reservation.id,
        email: reservation.email,
        code: '123456',
        source: 'WHATSAPP_NOTIFICATION',
      }),
    )
  })

  it('auto-attaches a WhatsApp code when exactly one reservation is active', async () => {
    const receivedAt = new Date('2026-04-30T00:00:00.000Z')
    const reservation = {
      id: 'reservation-2',
      email: 'single@example.com',
      prefix: null,
      mailbox: 'single@example.com',
      identityId: null,
      createdAt: receivedAt,
      expiresAt: new Date('2026-04-30T00:15:00.000Z'),
      updatedAt: receivedAt,
    }
    const notificationRecord = {
      id: 'notification-record-1',
      reservationId: reservation.id,
      verificationCode: '654321',
      receivedAt,
    }
    const codeRecord = {
      id: 'code-record-1',
      reservationId: reservation.id,
      code: '654321',
      source: 'WHATSAPP_NOTIFICATION',
      messageId: notificationRecord.id,
      receivedAt,
    }
    const notificationInsert = createInsertChain(notificationRecord)
    const codeInsert = createInsertChain(codeRecord)

    mocks.getDb.mockReturnValue({
      query: {
        verificationEmailReservations: {
          findMany: vi.fn().mockResolvedValue([reservation]),
        },
      },
      insert: vi
        .fn()
        .mockReturnValueOnce({ values: notificationInsert.values })
        .mockReturnValueOnce({ values: codeInsert.values }),
    })

    await expect(
      ingestWhatsAppNotification({
        body: '654321 is your code',
        receivedAt: receivedAt.toISOString(),
      }),
    ).resolves.toMatchObject({
      codeRecord,
      match: {
        status: 'matched',
        strategy: 'single_active_reservation',
        reservationId: reservation.id,
      },
    })
  })

  it('extracts WhatsApp fields and code from the raw notification payload', async () => {
    const receivedAt = new Date('2026-04-30T00:00:00.000Z')
    const reservation = {
      id: 'reservation-raw',
      email: 'raw@example.com',
      prefix: null,
      mailbox: 'raw@example.com',
      identityId: null,
      createdAt: receivedAt,
      expiresAt: new Date('2026-04-30T00:15:00.000Z'),
      updatedAt: receivedAt,
    }
    const notificationRecord = {
      id: 'notification-record-1',
      reservationId: reservation.id,
      verificationCode: '811997',
      receivedAt,
    }
    const codeRecord = {
      id: 'code-record-1',
      reservationId: reservation.id,
      code: '811997',
      source: 'WHATSAPP_NOTIFICATION',
      messageId: notificationRecord.id,
      receivedAt,
    }
    const notificationInsert = createInsertChain(notificationRecord)
    const codeInsert = createInsertChain(codeRecord)

    mocks.getDb.mockReturnValue({
      query: {
        verificationEmailReservations: {
          findFirst: vi.fn().mockResolvedValue(reservation),
        },
      },
      insert: vi
        .fn()
        .mockReturnValueOnce({ values: notificationInsert.values })
        .mockReturnValueOnce({ values: codeInsert.values }),
    })

    await expect(
      ingestWhatsAppNotification({
        reservationId: reservation.id,
        rawPayload: {
          source: 'codey-app',
          deviceId: 'emulator-5554',
          packageName: 'com.whatsapp',
          notificationId: 'wa-raw-1',
          title: 'GoPay',
          body: '811997 is your verification code. For your security, do not share this code.',
          receivedAt: receivedAt.getTime(),
        },
      }),
    ).resolves.toMatchObject({
      notificationRecord,
      codeRecord,
      match: {
        status: 'matched',
        strategy: 'reservation_id',
        reservationId: reservation.id,
      },
    })

    expect(notificationInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'notification-record-1',
        reservationId: reservation.id,
        deviceId: 'emulator-5554',
        notificationId: 'wa-raw-1',
        packageName: 'com.whatsapp',
        title: 'GoPay',
        body: '811997 is your verification code. For your security, do not share this code.',
        verificationCode: '811997',
        receivedAt,
      }),
    )
    expect(codeInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        code: '811997',
        receivedAt,
      }),
    )
  })

  it('keeps an ambiguous WhatsApp code unmatched when multiple reservations are active', async () => {
    const receivedAt = new Date('2026-04-30T00:00:00.000Z')
    const notificationRecord = {
      id: 'notification-record-1',
      reservationId: null,
      verificationCode: '777888',
      receivedAt,
    }
    const notificationInsert = createInsertChain(notificationRecord)

    mocks.getDb.mockReturnValue({
      query: {
        verificationEmailReservations: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'reservation-a', email: 'a@example.com' },
            { id: 'reservation-b', email: 'b@example.com' },
          ]),
        },
      },
      insert: vi
        .fn()
        .mockReturnValueOnce({ values: notificationInsert.values }),
    })

    await expect(
      ingestWhatsAppNotification({
        body: 'Use 777888 to verify your account',
        receivedAt: receivedAt.toISOString(),
      }),
    ).resolves.toMatchObject({
      notificationRecord,
      codeRecord: null,
      match: {
        status: 'unmatched',
        reason: 'multiple_active_reservations',
      },
    })

    expect(mocks.publishVerificationCodeEvent).not.toHaveBeenCalled()
  })

  it('stores the authenticated mobile device id on WhatsApp notifications', async () => {
    const receivedAt = new Date('2026-04-30T00:00:00.000Z')
    const notificationRecord = {
      id: 'notification-record-1',
      reservationId: null,
      mobileDeviceId: 'mobile-device-1',
      deviceId: 'android-abc',
      verificationCode: '424242',
      receivedAt,
    }
    const notificationInsert = createInsertChain(notificationRecord)

    mocks.getDb.mockReturnValue({
      query: {
        verificationEmailReservations: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
      insert: vi
        .fn()
        .mockReturnValueOnce({ values: notificationInsert.values }),
    })

    await expect(
      ingestWhatsAppNotification({
        mobileDeviceId: 'mobile-device-1',
        deviceId: 'android-abc',
        body: 'Use 424242 to verify your account',
        receivedAt: receivedAt.toISOString(),
      }),
    ).resolves.toMatchObject({
      notificationRecord,
      codeRecord: null,
      match: {
        status: 'unmatched',
        reason: 'no_active_reservation',
      },
    })

    expect(notificationInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        mobileDeviceId: 'mobile-device-1',
        deviceId: 'android-abc',
        verificationCode: '424242',
      }),
    )
  })
})
