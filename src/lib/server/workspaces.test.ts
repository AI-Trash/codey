import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}))

vi.mock('./db/client', () => ({
  getDb: mocks.getDb,
}))

import { listAdminManagedWorkspaceSummaries } from './workspaces'
import { resetManagedWorkspaceAuthorizationStatuses } from './workspaces'

describe('managed workspace authorization summaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
              expiresAt: new Date('2026-04-24T00:00:00.000Z'),
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
          expiresAt: new Date('2026-04-24T00:00:00.000Z'),
          lastSeenAt: now,
        },
        {
          identityId: 'identity-2',
          workspaceId: 'ws_alpha',
          status: 'ACTIVE',
          expiresAt: new Date('2026-04-24T00:00:00.000Z'),
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
          expiresAt: new Date('2026-04-24T00:00:00.000Z'),
          lastSeenAt: now,
        },
        {
          identityId: 'identity-2',
          workspaceId: 'ws_alpha',
          status: 'ACTIVE',
          expiresAt: new Date('2026-04-24T00:00:00.000Z'),
          lastSeenAt: now,
        },
      ])
      .mockResolvedValueOnce([
        {
          identityId: 'identity-1',
          workspaceId: 'ws_alpha',
          status: 'ACTIVE',
          expiresAt: new Date('2026-04-24T00:00:00.000Z'),
          lastSeenAt: later,
        },
      ])
    const deleteReturning = vi.fn().mockResolvedValue([{ id: 'session-member' }])

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
})
