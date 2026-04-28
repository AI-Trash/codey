import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createId: vi.fn(),
  getAppEnv: vi.fn(),
  getDb: vi.fn(),
  listAdminCliConnectionState: vi.fn(),
}))

vi.mock('@tanstack/react-start/server-only', () => ({}))

vi.mock('./cli-connections', () => ({
  listAdminCliConnectionState: mocks.listAdminCliConnectionState,
}))

vi.mock('./db/client', () => ({
  getDb: mocks.getDb,
}))

vi.mock('./env', () => ({
  getAppEnv: mocks.getAppEnv,
}))

vi.mock('./security', () => ({
  createId: mocks.createId,
}))

import { runIdentityMaintenanceScheduler } from './identity-maintenance'

function createDbMock() {
  const insertedTasks: Array<Record<string, unknown>> = []
  const insertedMaintenanceRuns: Array<Record<string, unknown>> = []

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => [{ count: 0 }]),
    })),
  }))
  const query = {
    managedWorkspaces: {
      findMany: vi.fn(async () => []),
    },
    identityMaintenanceRuns: {
      findMany: vi.fn(async () => []),
    },
    managedIdentities: {
      findMany: vi.fn(async () => [
        {
          identityId: 'identity-1',
          email: 'Person@example.com',
        },
      ]),
    },
  }
  const insert = vi
    .fn()
    .mockImplementationOnce(() => ({
      values: vi.fn((values: Array<Record<string, unknown>>) => {
        insertedTasks.push(...values)
        return {
          returning: vi.fn(async () => values),
        }
      }),
    }))
    .mockImplementationOnce(() => ({
      values: vi.fn(async () => undefined),
    }))
    .mockImplementationOnce(() => ({
      values: vi.fn((values: Array<Record<string, unknown>>) => {
        insertedMaintenanceRuns.push(...values)
      }),
    }))
  const transaction = vi.fn(
    async (callback: (tx: { insert: typeof insert }) => unknown) =>
      callback({ insert }),
  )

  mocks.getDb.mockReturnValue({
    select,
    query,
    transaction,
  })

  return {
    insertedMaintenanceRuns,
    insertedTasks,
  }
}

describe('identity maintenance scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    let nextId = 0
    mocks.createId.mockImplementation(() => `generated-${++nextId}`)
    mocks.getAppEnv.mockReturnValue({
      identityMaintenanceEnabled: true,
      identityMaintenanceSchedulerIntervalMs: 1,
      identityMaintenanceMinIntervalMs: 12 * 60 * 60 * 1000,
      identityMaintenanceMaxAssignedTasksPerCli: 0,
      identityMaintenanceMinIdleBrowserSlots: 0,
      identityMaintenanceMaxTasksPerCli: 1,
      identityMaintenanceMaxTasksPerTick: 1,
    })
    mocks.listAdminCliConnectionState.mockResolvedValue({
      snapshotAt: '2026-04-28T00:00:00.000Z',
      activeConnections: [
        {
          id: 'connection-1',
          workerId: 'worker-1',
          status: 'active',
          registeredFlows: ['chatgpt-login'],
          browserLimit: 1,
          target: 'target-1',
          lastSeenAt: '2026-04-28T00:00:00.000Z',
        },
      ],
    })
  })

  it('queues ChatGPT login maintenance in headless mode', async () => {
    const { insertedMaintenanceRuns, insertedTasks } = createDbMock()

    await expect(runIdentityMaintenanceScheduler()).resolves.toEqual({
      queuedCount: 1,
    })

    expect(insertedTasks).toHaveLength(1)
    expect(insertedTasks[0]?.payload).toMatchObject({
      kind: 'flow_task',
      flowId: 'chatgpt-login',
      config: {
        identityId: 'identity-1',
        email: 'person@example.com',
        headless: true,
        restoreStorageState: true,
      },
      metadata: {
        identityMaintenance: {
          kind: 'identity-maintenance',
          identityId: 'identity-1',
        },
      },
    })
    expect(insertedMaintenanceRuns).toHaveLength(1)
  })
})
