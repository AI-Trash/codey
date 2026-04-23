import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createId: vi.fn(),
  getAdminCliConnectionSummaryById: vi.fn(),
  getDb: vi.fn(),
  isCliConnectionOwnedByActor: vi.fn(),
  isSharedCliConnection: vi.fn(),
  listAdminCliConnectionStateForActor: vi.fn(),
}))

vi.mock('./db/client', () => ({
  getDb: mocks.getDb,
}))

vi.mock('./security', () => ({
  createId: mocks.createId,
}))

vi.mock('./cli-connections', () => ({
  getAdminCliConnectionSummaryById: mocks.getAdminCliConnectionSummaryById,
  isCliConnectionOwnedByActor: mocks.isCliConnectionOwnedByActor,
  isSharedCliConnection: mocks.isSharedCliConnection,
  listAdminCliConnectionStateForActor: mocks.listAdminCliConnectionStateForActor,
}))

import { dispatchCliFlowTasks } from './cli-tasks'

function createCliConnectionSummary(
  overrides: Partial<{
    id: string
    workerId: string | null
    sessionRef: string | null
    userId: string | null
    authClientId: string | null
    cliName: string | null
    target: string | null
    userAgent: string | null
    registeredFlows: string[]
    connectionPath: string
    status: 'active' | 'offline'
    connectedAt: string
    lastSeenAt: string
    disconnectedAt: string | null
    githubLogin: string | null
    email: string | null
    userLabel: string
    runtimeFlowId: string | null
    runtimeTaskId: string | null
    runtimeFlowStatus: string | null
    runtimeFlowMessage: string | null
    runtimeFlowStartedAt: string | null
    runtimeFlowCompletedAt: string | null
    runtimeFlowUpdatedAt: string | null
  }> = {},
) {
  return {
    id: 'connection-default',
    workerId: 'worker-default',
    sessionRef: null,
    userId: 'user-1',
    authClientId: null,
    cliName: 'CLI default',
    target: 'target-default',
    userAgent: 'codey-test',
    registeredFlows: ['chatgpt-register'],
    connectionPath: '/tmp/codey',
    status: 'active' as const,
    connectedAt: '2026-04-24T00:00:00.000Z',
    lastSeenAt: '2026-04-24T00:00:00.000Z',
    disconnectedAt: null,
    githubLogin: 'octocat',
    email: 'octocat@example.com',
    userLabel: 'Octocat',
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

function createTransactionRecorder() {
  const insertedTasks: Array<Record<string, unknown>> = []
  const insertedEvents: Array<Record<string, unknown>> = []
  const taskReturning = vi.fn().mockResolvedValue(insertedTasks)
  const taskValues = vi.fn((values: Array<Record<string, unknown>>) => {
    insertedTasks.push(...values)
    return {
      returning: taskReturning,
    }
  })
  const eventValues = vi.fn(async (values: Array<Record<string, unknown>>) => {
    insertedEvents.push(...values)
  })
  const insert = vi
    .fn()
    .mockImplementationOnce(() => ({
      values: taskValues,
    }))
    .mockImplementationOnce(() => ({
      values: eventValues,
    }))
  const transaction = vi.fn(async (callback: (tx: { insert: typeof insert }) => unknown) =>
    callback({ insert }),
  )

  mocks.getDb.mockReturnValue({
    transaction,
  })

  return {
    insertedEvents,
    insertedTasks,
  }
}

describe('cli flow task dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    let nextId = 0
    mocks.createId.mockImplementation(() => `generated-${++nextId}`)
    mocks.isCliConnectionOwnedByActor.mockReturnValue(true)
    mocks.isSharedCliConnection.mockReturnValue(false)
  })

  it('spreads batch work across unique eligible CLI workers', async () => {
    const anchorConnection = createCliConnectionSummary({
      id: 'connection-a',
      workerId: 'worker-a',
      cliName: 'CLI A',
      lastSeenAt: '2026-04-24T00:00:05.000Z',
    })
    const connectionB = createCliConnectionSummary({
      id: 'connection-b',
      workerId: 'worker-b',
      cliName: 'CLI B',
      lastSeenAt: '2026-04-24T00:00:04.000Z',
    })
    const duplicateWorkerConnection = createCliConnectionSummary({
      id: 'connection-b-duplicate',
      workerId: 'worker-b',
      cliName: 'CLI B duplicate',
      lastSeenAt: '2026-04-24T00:00:03.500Z',
    })
    const connectionC = createCliConnectionSummary({
      id: 'connection-c',
      workerId: 'worker-c',
      cliName: 'CLI C',
      lastSeenAt: '2026-04-24T00:00:03.000Z',
    })
    const { insertedEvents, insertedTasks } = createTransactionRecorder()

    mocks.getAdminCliConnectionSummaryById.mockResolvedValue(anchorConnection)
    mocks.listAdminCliConnectionStateForActor.mockResolvedValue({
      snapshotAt: '2026-04-24T00:00:06.000Z',
      activeConnections: [
        connectionB,
        duplicateWorkerConnection,
        connectionC,
        anchorConnection,
      ],
    })

    const result = await dispatchCliFlowTasks({
      connectionId: anchorConnection.id,
      flowId: 'chatgpt-register',
      count: 5,
      parallelism: 3,
      actor: {
        userId: 'user-1',
      },
    })

    expect(result.assignedCliCount).toBe(3)
    expect(result.assignedConnections.map((connection) => connection.id)).toEqual([
      'connection-a',
      'connection-b',
      'connection-c',
    ])
    expect(insertedTasks.map((task) => task.workerId)).toEqual([
      'worker-a',
      'worker-b',
      'worker-c',
      'worker-a',
      'worker-b',
    ])
    expect(
      insertedTasks.map(
        (task) =>
          (
            task.payload as {
              batch?: {
                parallelism?: number
              }
            }
          ).batch?.parallelism,
      ),
    ).toEqual([undefined, undefined, undefined, undefined, undefined])
    expect(insertedEvents).toHaveLength(5)
  })

  it('splits requested parallelism across the available CLI workers', async () => {
    const anchorConnection = createCliConnectionSummary({
      id: 'connection-a',
      workerId: 'worker-a',
      cliName: 'CLI A',
      lastSeenAt: '2026-04-24T00:00:05.000Z',
    })
    const connectionB = createCliConnectionSummary({
      id: 'connection-b',
      workerId: 'worker-b',
      cliName: 'CLI B',
      lastSeenAt: '2026-04-24T00:00:04.000Z',
    })
    const { insertedTasks } = createTransactionRecorder()

    mocks.getAdminCliConnectionSummaryById.mockResolvedValue(anchorConnection)
    mocks.listAdminCliConnectionStateForActor.mockResolvedValue({
      snapshotAt: '2026-04-24T00:00:06.000Z',
      activeConnections: [connectionB, anchorConnection],
    })

    const result = await dispatchCliFlowTasks({
      connectionId: anchorConnection.id,
      flowId: 'chatgpt-register',
      count: 4,
      parallelism: 3,
      actor: {
        userId: 'user-1',
      },
    })

    expect(result.assignedCliCount).toBe(2)
    expect(insertedTasks.map((task) => task.workerId)).toEqual([
      'worker-a',
      'worker-b',
      'worker-a',
      'worker-b',
    ])

    const workerParallelism = Object.fromEntries(
      insertedTasks.map((task) => [
        String(task.workerId),
        (
          task.payload as {
            batch?: {
              parallelism?: number
            }
          }
        ).batch?.parallelism || 1,
      ]),
    )

    expect(workerParallelism).toEqual({
      'worker-a': 2,
      'worker-b': 1,
    })
  })
})
