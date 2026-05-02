import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createId: vi.fn(),
  getDb: vi.fn(),
  syncIdentityMaintenanceRunFromFlowTask: vi.fn(),
}))

vi.mock('@tanstack/react-start/server-only', () => ({}))

vi.mock('./astrbot', () => ({
  sendAstrBotPayPalNotification: vi.fn(),
}))

vi.mock('./db/client', () => ({
  getDb: mocks.getDb,
}))

vi.mock('./identity-maintenance', () => ({
  cancelBlockingIdentityMaintenanceTasksForWorker: vi.fn(),
  cancelQueuedIdentityMaintenanceTasksForWorkers: vi.fn(),
  nonIdentityMaintenanceTaskFilter: vi.fn(() => undefined),
  syncIdentityMaintenanceRunFromFlowTask:
    mocks.syncIdentityMaintenanceRunFromFlowTask,
}))

vi.mock('./security', () => ({
  createId: mocks.createId,
}))

vi.mock('./workspace-invite-authorize', () => ({
  advanceWorkspaceInviteAuthorizeWorkflowFromFlowTask: vi.fn(),
}))

vi.mock('./workspaces', () => ({
  normalizeTeamTrialPaypalUrl: vi.fn((value: string | null) => value),
  recordWorkspaceInvitesFromFlowTask: vi.fn(),
  recordWorkspaceTeamTrialPaypalUrlFromFlowTask: vi.fn(),
}))

import { completeFlowTask } from './flow-tasks'
import type { CliConnectionRow, FlowTaskRow } from './db/schema'

const now = new Date('2026-05-03T00:00:00.000Z')

function createConnection(
  overrides: Partial<CliConnectionRow> = {},
): CliConnectionRow {
  return {
    id: 'connection-1',
    workerId: 'worker-1',
    sessionRef: null,
    userId: 'user-1',
    authClientId: null,
    cliName: 'CLI 1',
    target: 'target-1',
    userAgent: 'codey-test',
    registeredFlows: ['chatgpt-register'],
    storageStateIdentityIds: [],
    storageStateEmails: [],
    browserLimit: 10,
    connectionPath: '/tmp/codey',
    runtimeFlowId: null,
    runtimeTaskId: null,
    runtimeFlowStatus: null,
    runtimeFlowMessage: null,
    runtimeFlowStartedAt: null,
    runtimeFlowCompletedAt: null,
    runtimeFlowUpdatedAt: null,
    connectedAt: now,
    lastSeenAt: now,
    disconnectedAt: null,
    ...overrides,
  }
}

function createTask(overrides: Partial<FlowTaskRow> = {}): FlowTaskRow {
  return {
    id: 'task-1',
    workerId: 'worker-1',
    title: 'Dispatch chatgpt-register',
    body: 'Run chatgpt-register',
    flowType: 'chatgpt-register',
    target: 'target-1',
    cliConnectionId: 'connection-1',
    payload: {
      kind: 'flow_task',
      flowId: 'chatgpt-register',
      config: {
        claimTrial: 'gopay',
      },
    },
    status: 'RUNNING',
    attemptCount: 3,
    leaseClaimedAt: now,
    leaseExpiresAt: now,
    startedAt: now,
    completedAt: null,
    lastMessage: 'Running',
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function createDbMock(input: {
  connection?: CliConnectionRow | null
  currentTask?: FlowTaskRow | null
}) {
  const updatePatches: Array<Record<string, unknown>> = []
  const insertedEvents: Array<Record<string, unknown>> = []
  const connection = input.connection ?? createConnection()
  const currentTask = input.currentTask ?? createTask()
  const updatedTask = currentTask
    ? {
        ...currentTask,
        status: 'QUEUED' as const,
        cliConnectionId: null,
      }
    : null
  const set = vi.fn((patch: Record<string, unknown>) => {
    updatePatches.push(patch)
    return {
      where: vi.fn(() => ({
        returning: vi.fn(async () => (updatedTask ? [updatedTask] : [])),
      })),
    }
  })
  const insertValues = vi.fn((value: Record<string, unknown>) => {
    insertedEvents.push(value)
  })

  mocks.getDb.mockReturnValue({
    query: {
      cliConnections: {
        findFirst: vi.fn(async () => connection),
      },
      flowTasks: {
        findFirst: vi.fn(async () => currentTask),
      },
    },
    update: vi.fn(() => ({
      set,
    })),
    insert: vi.fn(() => ({
      values: insertValues,
    })),
  })

  return {
    insertedEvents,
    updatePatches,
  }
}

describe('flow task completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createId.mockReturnValue('event-1')
  })

  it('re-queues failed ChatGPT registration tasks with the same payload until success', async () => {
    const task = createTask()
    const { insertedEvents, updatePatches } = createDbMock({
      currentTask: task,
    })

    await expect(
      completeFlowTask({
        connectionId: 'connection-1',
        taskId: 'task-1',
        status: 'FAILED',
        error: 'Browser failed',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'task-1',
        payload: task.payload,
        status: 'QUEUED',
      }),
    )

    expect(updatePatches[0]).toMatchObject({
      status: 'QUEUED',
      cliConnectionId: null,
      lastError: null,
    })
    expect(insertedEvents[0]).toMatchObject({
      taskId: 'task-1',
      cliConnectionId: 'connection-1',
      type: 'QUEUED',
      status: 'QUEUED',
      payload: {
        retry: {
          reason: 'chatgpt-register:auto-retry-after-failure',
          previousStatus: 'RUNNING',
          previousAttempt: 3,
          nextAttempt: 4,
          maxAttempts: 'unlimited',
          error: 'Browser failed',
        },
      },
    })
    expect(mocks.syncIdentityMaintenanceRunFromFlowTask).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'QUEUED',
        error: 'Browser failed',
      }),
    )
  })

  it('keeps non-registration failures final', async () => {
    const task = createTask({
      flowType: 'chatgpt-login',
      payload: {
        kind: 'flow_task',
        flowId: 'chatgpt-login',
        config: {},
      },
    })
    const updatedFailedTask = {
      ...task,
      status: 'FAILED' as const,
      lastError: 'Login failed',
    }
    const updatePatches: Array<Record<string, unknown>> = []
    const insertedEvents: Array<Record<string, unknown>> = []
    const set = vi.fn((patch: Record<string, unknown>) => {
      updatePatches.push(patch)
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => [updatedFailedTask]),
        })),
      }
    })

    mocks.getDb.mockReturnValue({
      query: {
        cliConnections: {
          findFirst: vi.fn(async () => createConnection()),
        },
        flowTasks: {
          findFirst: vi.fn(async () => task),
        },
      },
      update: vi.fn(() => ({
        set,
      })),
      insert: vi.fn(() => ({
        values: vi.fn((value: Record<string, unknown>) => {
          insertedEvents.push(value)
        }),
      })),
    })

    await expect(
      completeFlowTask({
        connectionId: 'connection-1',
        taskId: 'task-1',
        status: 'FAILED',
        error: 'Login failed',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'FAILED',
      }),
    )

    expect(updatePatches[0]).toMatchObject({
      status: 'FAILED',
      lastError: 'Login failed',
    })
    expect(insertedEvents[0]).toMatchObject({
      type: 'FAILED',
      status: 'FAILED',
      message: 'Login failed',
    })
  })
})
