import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createId: vi.fn(() => 'generated-session-id'),
  getDb: vi.fn(),
}))

vi.mock('./db/client', () => ({
  getDb: mocks.getDb,
}))

vi.mock('./security', () => ({
  createId: mocks.createId,
}))

import { syncManagedSession } from './managed-sessions'

function createInsertChain(returnedRows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnedRows)
  const values = vi.fn(() => ({
    returning,
  }))

  return {
    insert: vi.fn(() => ({
      values,
    })),
    values,
  }
}

describe('managed session workspace sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists workspace ids for workspace-scoped codex sessions', async () => {
    const seenAt = new Date('2026-04-23T00:00:00.000Z')
    const insertChain = createInsertChain([
      {
        id: 'generated-session-id',
        identityId: 'identity-1',
        email: 'owner@example.com',
        clientId: 'client-1',
        authMode: 'codex-oauth',
        flowType: 'codex-oauth',
        workspaceId: 'ws_123',
        accountId: null,
        sessionId: null,
        status: 'ACTIVE',
        sessionData: {},
        lastRefreshAt: null,
        expiresAt: null,
        lastSeenAt: seenAt,
        createdAt: seenAt,
        updatedAt: seenAt,
      },
    ])

    mocks.getDb.mockReturnValue({
      query: {
        managedIdentitySessions: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      insert: insertChain.insert,
    })

    await expect(
      syncManagedSession({
        identityId: 'identity-1',
        email: 'owner@example.com',
        clientId: 'client-1',
        authMode: 'codex-oauth',
        flowType: 'codex-oauth',
        workspaceId: 'ws_123',
        sessionData: {},
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'generated-session-id',
        workspaceId: 'ws_123',
      }),
    )

    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws_123',
      }),
    )
  })
})
