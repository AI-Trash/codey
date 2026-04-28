import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createId: vi.fn(() => 'generated-id'),
  deleteManagedWorkspace: vi.fn(),
  findAdminManagedWorkspaceSummaryByOwnerIdentity: vi.fn(),
  getDb: vi.fn(),
  hasAdminInboxEmailSubscribers: vi.fn(() => false),
  removeDisabledSub2ApiAccountsForWorkspace: vi.fn(),
  sendAstrBotWorkspaceRemovalNotification: vi.fn(),
  publishAdminInboxEmailEvent: vi.fn(),
  publishVerificationCodeEvent: vi.fn(),
}))

vi.mock('./db/client', () => ({
  getDb: mocks.getDb,
}))

vi.mock('./security', () => ({
  createId: mocks.createId,
}))

vi.mock('./admin-inbox-events', () => ({
  hasAdminInboxEmailSubscribers: mocks.hasAdminInboxEmailSubscribers,
  publishAdminInboxEmailEvent: mocks.publishAdminInboxEmailEvent,
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

import {
  ingestCloudflareEmail,
  isChatGptBusinessTrialEndedSubject,
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

describe('ChatGPT Business trial-ended email handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasAdminInboxEmailSubscribers.mockReturnValue(false)
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
})
