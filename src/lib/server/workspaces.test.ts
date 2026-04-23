import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}))

vi.mock('./db/client', () => ({
  getDb: mocks.getDb,
}))

import { listAdminManagedWorkspaceSummaries } from './workspaces'

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
})
