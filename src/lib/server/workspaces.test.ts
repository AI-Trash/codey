import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}))

vi.mock('./db/client', () => ({
  getDb: mocks.getDb,
}))

import {
  managedIdentities,
  managedWorkspaceMembers,
  managedWorkspaces,
} from './db/schema'
import {
  createManagedWorkspace,
  deleteManagedWorkspace,
  getTeamTrialPaypalLinkExpiresAt,
  listAdminManagedWorkspaceAssociationsForIdentity,
  listAdminManagedWorkspaceSummaries,
  normalizeTeamTrialPaypalUrl,
  resetManagedWorkspaceAuthorizationStatuses,
  resolveTeamTrialPaypalLinkState,
  syncManagedWorkspaceInvite,
} from './workspaces'

describe('managed workspace authorization summaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes PayPal Team trial approval URLs with BA tokens', () => {
    expect(
      normalizeTeamTrialPaypalUrl(
        ' https://www.paypal.com/pay?ssrt=1777211592082&token=BA-5YL10191GX878080G&ul=1 ',
      ),
    ).toBe(
      'https://www.paypal.com/pay?ssrt=1777211592082&token=BA-5YL10191GX878080G&ul=1',
    )
    expect(
      normalizeTeamTrialPaypalUrl(
        'https://www.paypal.com/checkoutnow?ba_token=BA-123ABC',
      ),
    ).toBe('https://www.paypal.com/checkoutnow?ba_token=BA-123ABC')
    expect(
      normalizeTeamTrialPaypalUrl('https://example.com/pay?token=BA-123ABC'),
    ).toBeNull()
    expect(
      normalizeTeamTrialPaypalUrl('https://www.paypal.com/pay?token=no'),
    ).toBeNull()
  })

  it('keeps PayPal Team trial links active for only ten minutes', () => {
    const capturedAt = new Date('2026-04-23T00:00:00.000Z')

    expect(getTeamTrialPaypalLinkExpiresAt(capturedAt)?.toISOString()).toBe(
      '2026-04-23T00:10:00.000Z',
    )
    expect(
      resolveTeamTrialPaypalLinkState({
        paypalUrl: 'https://www.paypal.com/pay?token=BA-123ABC',
        capturedAt,
        now: new Date('2026-04-23T00:09:59.999Z'),
      }).url,
    ).toBe('https://www.paypal.com/pay?token=BA-123ABC')
    expect(
      resolveTeamTrialPaypalLinkState({
        paypalUrl: 'https://www.paypal.com/pay?token=BA-123ABC',
        capturedAt,
        now: new Date('2026-04-23T00:10:00.000Z'),
      }).url,
    ).toBeNull()
    expect(
      resolveTeamTrialPaypalLinkState({
        paypalUrl: 'https://www.paypal.com/pay?token=BA-123ABC',
        now: new Date('2026-04-23T00:00:00.000Z'),
      }).url,
    ).toBeNull()
  })

  it('creates a managed workspace without an OpenAI workspace ID', async () => {
    const now = new Date('2026-04-23T00:00:00.000Z')
    const insertedWorkspace = {
      id: 'workspace-record-1',
      workspaceId: null,
      label: 'Alpha',
      ownerIdentityId: 'identity-1',
      createdAt: now,
      updatedAt: now,
    }
    const ownerIdentity = {
      identityId: 'identity-1',
      email: 'owner@example.com',
      label: 'Owner',
    }
    const findFirstWorkspace = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...insertedWorkspace,
        ownerIdentity,
        members: [],
      })
    const insertValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([insertedWorkspace]),
    })
    const deleteMemberWhere = vi.fn().mockResolvedValue(undefined)

    mocks.getDb.mockReturnValue({
      query: {
        managedIdentities: {
          findFirst: vi.fn().mockResolvedValue(ownerIdentity),
        },
        managedWorkspaces: {
          findFirst: findFirstWorkspace,
        },
        managedWorkspaceMembers: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        managedIdentitySessions: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
      insert: vi.fn((table: unknown) => {
        if (table === managedWorkspaces) {
          return {
            values: insertValues,
          }
        }

        throw new Error('Unexpected insert table')
      }),
      delete: vi.fn((table: unknown) => {
        if (table === managedWorkspaceMembers) {
          return {
            where: deleteMemberWhere,
          }
        }

        throw new Error('Unexpected delete table')
      }),
    })

    await expect(
      createManagedWorkspace({
        workspaceId: '',
        label: 'Alpha',
        ownerIdentityId: 'identity-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        workspaceId: null,
        owner: expect.objectContaining({
          identityId: 'identity-1',
        }),
      }),
    )

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: null,
        label: 'Alpha',
        ownerIdentityId: 'identity-1',
      }),
    )
  })

  it('rejects a workspace owner that is already a member of another workspace', async () => {
    const ownerIdentity = {
      identityId: 'identity-1',
      email: 'owner@example.com',
      label: 'Owner',
    }
    const findMemberWorkspace = vi.fn().mockResolvedValue({
      id: 'member-row-1',
      workspace: {
        id: 'workspace-record-2',
        workspaceId: 'ws_beta',
        label: 'Beta',
      },
    })
    const insertRecord = vi.fn()

    mocks.getDb.mockReturnValue({
      query: {
        managedIdentities: {
          findFirst: vi.fn().mockResolvedValue(ownerIdentity),
        },
        managedWorkspaces: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        managedWorkspaceMembers: {
          findFirst: findMemberWorkspace,
        },
      },
      insert: insertRecord,
    })

    await expect(
      createManagedWorkspace({
        label: 'Alpha',
        ownerIdentityId: 'identity-1',
      }),
    ).rejects.toThrow('This identity already belongs to workspace Beta.')

    expect(findMemberWorkspace).toHaveBeenCalledTimes(1)
    expect(insertRecord).not.toHaveBeenCalled()
  })

  it('rejects an archived workspace owner identity', async () => {
    const ownerIdentity = {
      identityId: 'identity-archived',
      email: 'archived-owner@example.com',
      label: 'Archived Owner',
      status: 'ARCHIVED' as const,
    }
    const findWorkspace = vi.fn()
    const insertRecord = vi.fn()

    mocks.getDb.mockReturnValue({
      query: {
        managedIdentities: {
          findFirst: vi.fn().mockResolvedValue(ownerIdentity),
        },
        managedWorkspaces: {
          findFirst: findWorkspace,
        },
        managedWorkspaceMembers: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      insert: insertRecord,
    })

    await expect(
      createManagedWorkspace({
        label: 'Alpha',
        ownerIdentityId: 'identity-archived',
      }),
    ).rejects.toThrow('Archived identities cannot own workspaces')

    expect(findWorkspace).not.toHaveBeenCalled()
    expect(insertRecord).not.toHaveBeenCalled()
  })

  it('fills an existing owner workspace with the synced OpenAI workspace ID', async () => {
    const now = new Date('2026-04-23T00:00:00.000Z')
    const ownerIdentity = {
      identityId: 'identity-1',
      email: 'owner@example.com',
      label: 'Owner',
    }
    const existingWorkspace = {
      id: 'workspace-record-1',
      workspaceId: null,
      label: 'Alpha',
      ownerIdentityId: 'identity-1',
    }
    const findFirstWorkspace = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingWorkspace)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...existingWorkspace,
        workspaceId: 'ws_alpha',
        ownerIdentity,
        createdAt: now,
        updatedAt: now,
        members: [],
      })
    const updateSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    })
    const deleteMemberWhere = vi.fn().mockResolvedValue(undefined)

    mocks.getDb.mockReturnValue({
      query: {
        managedIdentities: {
          findFirst: vi.fn().mockResolvedValue(ownerIdentity),
        },
        managedWorkspaces: {
          findFirst: findFirstWorkspace,
        },
        managedWorkspaceMembers: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([]),
        },
        managedIdentitySessions: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
      update: vi.fn().mockReturnValue({
        set: updateSet,
      }),
      delete: vi.fn((table: unknown) => {
        if (table === managedWorkspaceMembers) {
          return {
            where: deleteMemberWhere,
          }
        }

        throw new Error('Unexpected delete table')
      }),
    })

    await expect(
      syncManagedWorkspaceInvite({
        workspaceId: 'ws_alpha',
        ownerIdentityId: 'identity-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'workspace-record-1',
        workspaceId: 'ws_alpha',
      }),
    )

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws_alpha',
        ownerIdentityId: 'identity-1',
      }),
    )
    expect(deleteMemberWhere).toHaveBeenCalledTimes(1)
  })

  it('keeps authorization state scoped to the matching workspace', async () => {
    const now = new Date('2026-04-23T00:00:00.000Z')

    mocks.getDb.mockReturnValue({
      query: {
        managedWorkspaces: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'workspace-record-1',
              workspaceId: 'ws_alpha',
              label: 'Alpha',
              ownerIdentity: {
                identityId: 'identity-1',
                email: 'owner@example.com',
                label: 'Owner',
              },
              createdAt: now,
              updatedAt: now,
              members: [],
            },
            {
              id: 'workspace-record-2',
              workspaceId: 'ws_beta',
              label: 'Beta',
              ownerIdentity: {
                identityId: 'identity-1',
                email: 'owner@example.com',
                label: 'Owner',
              },
              createdAt: now,
              updatedAt: now,
              members: [],
            },
          ]),
        },
        managedIdentitySessions: {
          findMany: vi.fn().mockResolvedValue([
            {
              identityId: 'identity-1',
              workspaceId: 'ws_alpha',
              status: 'ACTIVE',
              expiresAt: new Date('2999-05-24T00:00:00.000Z'),
              lastSeenAt: now,
            },
          ]),
        },
      },
    })

    await expect(listAdminManagedWorkspaceSummaries()).resolves.toEqual([
      expect.objectContaining({
        workspaceId: 'ws_alpha',
        owner: expect.objectContaining({
          authorization: expect.objectContaining({
            state: 'authorized',
          }),
        }),
      }),
      expect.objectContaining({
        workspaceId: 'ws_beta',
        owner: expect.objectContaining({
          authorization: expect.objectContaining({
            state: 'missing',
          }),
        }),
      }),
    ])
  })

  it('keeps authorization state scoped by workspace record when the OpenAI workspace ID is missing', async () => {
    const now = new Date('2026-04-23T00:00:00.000Z')

    mocks.getDb.mockReturnValue({
      query: {
        managedWorkspaces: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'workspace-record-1',
              workspaceId: null,
              label: 'Alpha',
              ownerIdentity: {
                identityId: 'identity-1',
                email: 'owner@example.com',
                label: 'Owner',
              },
              createdAt: now,
              updatedAt: now,
              members: [],
            },
            {
              id: 'workspace-record-2',
              workspaceId: null,
              label: 'Beta',
              ownerIdentity: {
                identityId: 'identity-1',
                email: 'owner@example.com',
                label: 'Owner',
              },
              createdAt: now,
              updatedAt: now,
              members: [],
            },
          ]),
        },
        managedIdentitySessions: {
          findMany: vi.fn().mockResolvedValue([
            {
              identityId: 'identity-1',
              workspaceId: null,
              workspaceRecordId: 'workspace-record-1',
              status: 'ACTIVE',
              expiresAt: new Date('2999-05-24T00:00:00.000Z'),
              lastSeenAt: now,
            },
          ]),
        },
      },
    })

    await expect(listAdminManagedWorkspaceSummaries()).resolves.toEqual([
      expect.objectContaining({
        id: 'workspace-record-1',
        owner: expect.objectContaining({
          authorization: expect.objectContaining({
            state: 'authorized',
          }),
        }),
      }),
      expect.objectContaining({
        id: 'workspace-record-2',
        owner: expect.objectContaining({
          authorization: expect.objectContaining({
            state: 'missing',
          }),
        }),
      }),
    ])
  })

  it('ignores legacy unscoped default authorization when a workspace has no OpenAI workspace ID yet', async () => {
    const now = new Date('2026-04-23T00:00:00.000Z')

    mocks.getDb.mockReturnValue({
      query: {
        managedWorkspaces: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'workspace-record-1',
              workspaceId: null,
              label: 'Alpha',
              ownerIdentity: {
                identityId: 'identity-1',
                email: 'owner@example.com',
                label: 'Owner',
              },
              createdAt: now,
              updatedAt: now,
              members: [],
            },
          ]),
        },
        managedIdentitySessions: {
          findMany: vi.fn().mockResolvedValue([
            {
              identityId: 'identity-1',
              workspaceId: null,
              workspaceRecordId: null,
              status: 'ACTIVE',
              expiresAt: new Date('2999-05-24T00:00:00.000Z'),
              lastSeenAt: now,
            },
          ]),
        },
      },
    })

    await expect(listAdminManagedWorkspaceSummaries()).resolves.toEqual([
      expect.objectContaining({
        id: 'workspace-record-1',
        owner: expect.objectContaining({
          authorization: expect.objectContaining({
            state: 'missing',
          }),
        }),
      }),
    ])
  })

  it('lists workspaces owned by and joined by a managed identity', async () => {
    const now = new Date('2026-04-23T00:00:00.000Z')

    mocks.getDb.mockReturnValue({
      query: {
        managedIdentities: {
          findFirst: vi.fn().mockResolvedValue({
            email: 'member@example.com',
          }),
        },
        managedWorkspaces: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'workspace-record-owner',
              workspaceId: 'ws_owner',
              label: 'Owner workspace',
              ownerIdentity: {
                identityId: 'identity-1',
                email: 'member@example.com',
                label: 'Target identity',
              },
              createdAt: now,
              updatedAt: now,
              members: [],
            },
            {
              id: 'workspace-record-member',
              workspaceId: 'ws_member',
              label: 'Member workspace',
              ownerIdentity: {
                identityId: 'owner-2',
                email: 'owner@example.com',
                label: 'Owner',
              },
              createdAt: now,
              updatedAt: now,
              members: [
                {
                  id: 'member-row-1',
                  email: 'member@example.com',
                  identityId: 'identity-1',
                  identity: {
                    identityId: 'identity-1',
                    email: 'member@example.com',
                    label: 'Target identity',
                  },
                },
              ],
            },
            {
              id: 'workspace-record-email-member',
              workspaceId: 'ws_email_member',
              label: 'Email-linked workspace',
              ownerIdentity: {
                identityId: 'owner-3',
                email: 'owner-3@example.com',
                label: 'Owner 3',
              },
              createdAt: now,
              updatedAt: now,
              members: [
                {
                  id: 'member-row-2',
                  email: 'member@example.com',
                  identityId: null,
                  identity: null,
                },
              ],
            },
            {
              id: 'workspace-record-unrelated',
              workspaceId: 'ws_unrelated',
              label: 'Unrelated workspace',
              ownerIdentity: {
                identityId: 'owner-4',
                email: 'owner-4@example.com',
                label: 'Owner 4',
              },
              createdAt: now,
              updatedAt: now,
              members: [],
            },
          ]),
        },
        managedIdentitySessions: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
    })

    await expect(
      listAdminManagedWorkspaceAssociationsForIdentity('identity-1'),
    ).resolves.toEqual({
      ownedWorkspaces: [
        expect.objectContaining({
          id: 'workspace-record-owner',
        }),
      ],
      memberWorkspaces: [
        expect.objectContaining({
          workspace: expect.objectContaining({
            id: 'workspace-record-member',
          }),
          member: expect.objectContaining({
            id: 'member-row-1',
          }),
        }),
        expect.objectContaining({
          workspace: expect.objectContaining({
            id: 'workspace-record-email-member',
          }),
          member: expect.objectContaining({
            id: 'member-row-2',
          }),
        }),
      ],
    })
  })

  it('resets all stored workspace authorization statuses for the owner and members', async () => {
    const now = new Date('2026-04-23T00:00:00.000Z')
    const later = new Date('2026-04-23T00:05:00.000Z')
    const findFirstWorkspace = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'workspace-record-1',
        workspaceId: 'ws_alpha',
        label: 'Alpha',
        ownerIdentity: {
          identityId: 'identity-1',
          email: 'owner@example.com',
          label: 'Owner',
        },
        createdAt: now,
        updatedAt: now,
        members: [
          {
            id: 'member-row-1',
            email: 'member@example.com',
            identityId: 'identity-2',
            identity: {
              identityId: 'identity-2',
              email: 'member@example.com',
              label: 'Member',
            },
          },
          {
            id: 'member-row-2',
            email: 'legacy@example.com',
            identityId: null,
            identity: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'workspace-record-1',
        workspaceId: 'ws_alpha',
        label: 'Alpha',
        ownerIdentity: {
          identityId: 'identity-1',
          email: 'owner@example.com',
          label: 'Owner',
        },
        createdAt: now,
        updatedAt: later,
        members: [
          {
            id: 'member-row-1',
            email: 'member@example.com',
            identityId: 'identity-2',
            identity: {
              identityId: 'identity-2',
              email: 'member@example.com',
              label: 'Member',
            },
          },
          {
            id: 'member-row-2',
            email: 'legacy@example.com',
            identityId: null,
            identity: null,
          },
        ],
      })
    const findManySessions = vi
      .fn()
      .mockResolvedValueOnce([
        {
          identityId: 'identity-1',
          workspaceId: 'ws_alpha',
          status: 'ACTIVE',
          expiresAt: new Date('2999-05-24T00:00:00.000Z'),
          lastSeenAt: now,
        },
        {
          identityId: 'identity-2',
          workspaceId: 'ws_alpha',
          status: 'ACTIVE',
          expiresAt: new Date('2999-05-24T00:00:00.000Z'),
          lastSeenAt: now,
        },
      ])
      .mockResolvedValueOnce([])
    const deleteReturning = vi
      .fn()
      .mockResolvedValue([{ id: 'session-owner' }, { id: 'session-member' }])
    const deleteWhere = vi.fn().mockReturnValue({
      returning: deleteReturning,
    })
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const updateSet = vi.fn().mockReturnValue({
      where: updateWhere,
    })

    mocks.getDb.mockReturnValue({
      query: {
        managedWorkspaces: {
          findFirst: findFirstWorkspace,
        },
        managedIdentitySessions: {
          findMany: findManySessions,
        },
      },
      delete: vi.fn().mockReturnValue({
        where: deleteWhere,
      }),
      update: vi.fn().mockReturnValue({
        set: updateSet,
      }),
    })

    await expect(
      resetManagedWorkspaceAuthorizationStatuses({
        id: 'workspace-record-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        resetCount: 2,
        workspace: expect.objectContaining({
          owner: expect.objectContaining({
            authorization: expect.objectContaining({
              state: 'missing',
            }),
          }),
          members: expect.arrayContaining([
            expect.objectContaining({
              id: 'member-row-1',
              authorization: expect.objectContaining({
                state: 'missing',
              }),
            }),
          ]),
        }),
      }),
    )

    expect(deleteReturning).toHaveBeenCalledTimes(1)
    expect(updateWhere).toHaveBeenCalledTimes(1)
  })

  it('can reset a single member authorization without clearing the owner status', async () => {
    const now = new Date('2026-04-23T00:00:00.000Z')
    const later = new Date('2026-04-23T00:05:00.000Z')
    const findFirstWorkspace = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'workspace-record-1',
        workspaceId: 'ws_alpha',
        label: 'Alpha',
        ownerIdentity: {
          identityId: 'identity-1',
          email: 'owner@example.com',
          label: 'Owner',
        },
        createdAt: now,
        updatedAt: now,
        members: [
          {
            id: 'member-row-1',
            email: 'member@example.com',
            identityId: 'identity-2',
            identity: {
              identityId: 'identity-2',
              email: 'member@example.com',
              label: 'Member',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'workspace-record-1',
        workspaceId: 'ws_alpha',
        label: 'Alpha',
        ownerIdentity: {
          identityId: 'identity-1',
          email: 'owner@example.com',
          label: 'Owner',
        },
        createdAt: now,
        updatedAt: later,
        members: [
          {
            id: 'member-row-1',
            email: 'member@example.com',
            identityId: 'identity-2',
            identity: {
              identityId: 'identity-2',
              email: 'member@example.com',
              label: 'Member',
            },
          },
        ],
      })
    const findManySessions = vi
      .fn()
      .mockResolvedValueOnce([
        {
          identityId: 'identity-1',
          workspaceId: 'ws_alpha',
          status: 'ACTIVE',
          expiresAt: new Date('2999-05-24T00:00:00.000Z'),
          lastSeenAt: now,
        },
        {
          identityId: 'identity-2',
          workspaceId: 'ws_alpha',
          status: 'ACTIVE',
          expiresAt: new Date('2999-05-24T00:00:00.000Z'),
          lastSeenAt: now,
        },
      ])
      .mockResolvedValueOnce([
        {
          identityId: 'identity-1',
          workspaceId: 'ws_alpha',
          status: 'ACTIVE',
          expiresAt: new Date('2999-05-24T00:00:00.000Z'),
          lastSeenAt: later,
        },
      ])
    const deleteReturning = vi
      .fn()
      .mockResolvedValue([{ id: 'session-member' }])

    mocks.getDb.mockReturnValue({
      query: {
        managedWorkspaces: {
          findFirst: findFirstWorkspace,
        },
        managedIdentitySessions: {
          findMany: findManySessions,
        },
      },
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: deleteReturning,
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    })

    await expect(
      resetManagedWorkspaceAuthorizationStatuses({
        id: 'workspace-record-1',
        memberIds: ['member-row-1'],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        resetCount: 1,
        workspace: expect.objectContaining({
          owner: expect.objectContaining({
            authorization: expect.objectContaining({
              state: 'authorized',
            }),
          }),
          members: expect.arrayContaining([
            expect.objectContaining({
              id: 'member-row-1',
              authorization: expect.objectContaining({
                state: 'missing',
              }),
            }),
          ]),
        }),
      }),
    )

    expect(deleteReturning).toHaveBeenCalledTimes(1)
  })

  it('archives the owner and removes remaining workspace associations when deleting a workspace', async () => {
    const now = new Date('2026-04-23T00:00:00.000Z')
    const deletedWorkspace = {
      id: 'workspace-record-1',
      workspaceId: 'ws_alpha',
      label: 'Alpha',
      ownerIdentityId: 'owner-identity-1',
      createdAt: now,
      updatedAt: now,
    }

    const deleteWorkspaceReturning = vi
      .fn()
      .mockResolvedValue([deletedWorkspace])
    const deleteWorkspaceWhere = vi.fn().mockReturnValue({
      returning: deleteWorkspaceReturning,
    })
    const deleteMemberWhere = vi.fn().mockResolvedValue(undefined)
    const deleteRecord = vi.fn((table: unknown) => {
      if (table === managedWorkspaces) {
        return {
          where: deleteWorkspaceWhere,
        }
      }

      if (table === managedWorkspaceMembers) {
        return {
          where: deleteMemberWhere,
        }
      }

      throw new Error('Unexpected delete table')
    })

    const archiveWhere = vi.fn().mockResolvedValue(undefined)
    const archiveSet = vi.fn().mockReturnValue({
      where: archiveWhere,
    })

    const workspaceWhere = vi.fn().mockResolvedValue(undefined)
    const workspaceSet = vi.fn().mockReturnValue({
      where: workspaceWhere,
    })
    const updateRecord = vi.fn((table: unknown) => {
      if (table === managedIdentities) {
        return {
          set: archiveSet,
        }
      }

      if (table === managedWorkspaces) {
        return {
          set: workspaceSet,
        }
      }

      throw new Error('Unexpected update table')
    })
    const findOwnerWorkspaceRows = vi.fn().mockResolvedValue([
      {
        id: 'other-workspace',
      },
    ])
    const findMemberWorkspaceRows = vi.fn().mockResolvedValue([
      {
        id: 'member-row-1',
        managedWorkspaceId: 'other-workspace',
      },
    ])
    const findOwnerIdentity = vi.fn().mockResolvedValue({
      identityId: 'owner-identity-1',
      email: 'owner@example.com',
      status: 'ACTIVE',
    })

    mocks.getDb.mockReturnValue({
      query: {
        managedIdentities: {
          findFirst: findOwnerIdentity,
        },
        managedWorkspaces: {
          findMany: findOwnerWorkspaceRows,
        },
        managedWorkspaceMembers: {
          findMany: findMemberWorkspaceRows,
        },
      },
      delete: deleteRecord,
      update: updateRecord,
    })

    await expect(deleteManagedWorkspace('workspace-record-1')).resolves.toEqual(
      deletedWorkspace,
    )

    expect(archiveSet).toHaveBeenCalledWith({
      status: 'ARCHIVED',
      updatedAt: expect.any(Date),
    })
    expect(findOwnerIdentity).toHaveBeenCalledTimes(1)
    expect(findOwnerWorkspaceRows).toHaveBeenCalledTimes(1)
    expect(findMemberWorkspaceRows).toHaveBeenCalledTimes(1)
    expect(deleteRecord).toHaveBeenCalledWith(managedWorkspaceMembers)
    expect(workspaceSet).toHaveBeenNthCalledWith(1, {
      ownerIdentityId: null,
      updatedAt: expect.any(Date),
    })
    expect(workspaceSet).toHaveBeenNthCalledWith(2, {
      updatedAt: expect.any(Date),
    })
  })
})
