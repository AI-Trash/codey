import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  decryptSecret: vi.fn(),
  encryptSecret: vi.fn((value: string) => `encrypted:${value}`),
  createId: vi.fn(() => 'generated-id'),
  linkWorkspaceMembersToManagedIdentity: vi.fn(),
  removeManagedIdentityFromAllWorkspaces: vi.fn(),
}))

vi.mock('./db/client', () => ({
  getDb: mocks.getDb,
}))

vi.mock('./encrypted-secrets', () => ({
  decryptSecret: mocks.decryptSecret,
  encryptSecret: mocks.encryptSecret,
}))

vi.mock('./security', () => ({
  createId: mocks.createId,
}))

vi.mock('./workspaces', () => ({
  linkWorkspaceMembersToManagedIdentity:
    mocks.linkWorkspaceMembersToManagedIdentity,
  removeManagedIdentityFromAllWorkspaces:
    mocks.removeManagedIdentityFromAllWorkspaces,
}))

import { syncManagedIdentity, updateManagedIdentity } from './identities'

function createUpdateChain(returnedRows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnedRows)
  const where = vi.fn(() => ({
    returning,
  }))
  const set = vi.fn(() => ({
    where,
  }))

  return {
    update: vi.fn(() => ({
      set,
    })),
    set,
    where,
    returning,
  }
}

describe('managed identity workspace cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes a synced banned identity from all workspaces', async () => {
    const existingIdentity = {
      id: 'managed-identity-1',
      identityId: 'identity-1',
      email: 'banned@example.com',
      label: 'Banned Identity',
      passwordCiphertext: null,
      credentialMetadata: null,
      credentialCount: 2,
      status: 'ACTIVE' as const,
      lastSeenAt: new Date('2026-04-20T00:00:00.000Z'),
      createdAt: new Date('2026-04-20T00:00:00.000Z'),
      updatedAt: new Date('2026-04-20T00:00:00.000Z'),
    }
    const updatedIdentity = {
      ...existingIdentity,
      status: 'BANNED' as const,
      updatedAt: new Date('2026-04-23T00:00:00.000Z'),
    }
    const updateChain = createUpdateChain([updatedIdentity])

    mocks.getDb.mockReturnValue({
      query: {
        managedIdentities: {
          findFirst: vi.fn().mockResolvedValue(existingIdentity),
        },
      },
      update: updateChain.update,
    })

    await expect(
      syncManagedIdentity({
        identityId: 'identity-1',
        email: 'banned@example.com',
        status: 'BANNED',
      }),
    ).resolves.toEqual(updatedIdentity)

    expect(mocks.removeManagedIdentityFromAllWorkspaces).toHaveBeenCalledWith({
      identityId: 'identity-1',
      email: 'banned@example.com',
    })
    expect(mocks.linkWorkspaceMembersToManagedIdentity).not.toHaveBeenCalled()
  })

  it('removes a manually banned identity from all workspaces', async () => {
    const existingIdentity = {
      id: 'managed-identity-2',
      identityId: 'identity-2',
      email: 'manual-ban@example.com',
      label: 'Manual Ban',
      passwordCiphertext: null,
      credentialMetadata: null,
      credentialCount: 0,
      status: 'ACTIVE' as const,
      lastSeenAt: new Date('2026-04-20T00:00:00.000Z'),
      createdAt: new Date('2026-04-20T00:00:00.000Z'),
      updatedAt: new Date('2026-04-20T00:00:00.000Z'),
    }
    const updatedIdentity = {
      ...existingIdentity,
      status: 'BANNED' as const,
      updatedAt: new Date('2026-04-23T00:00:00.000Z'),
    }
    const updateChain = createUpdateChain([updatedIdentity])

    mocks.getDb.mockReturnValue({
      query: {
        managedIdentities: {
          findFirst: vi.fn().mockResolvedValue(existingIdentity),
        },
      },
      update: updateChain.update,
    })

    await expect(
      updateManagedIdentity({
        identityId: 'identity-2',
        status: 'BANNED',
      }),
    ).resolves.toEqual(updatedIdentity)

    expect(mocks.removeManagedIdentityFromAllWorkspaces).toHaveBeenCalledWith({
      identityId: 'identity-2',
      email: 'manual-ban@example.com',
    })
    expect(mocks.linkWorkspaceMembersToManagedIdentity).not.toHaveBeenCalled()
  })
})
