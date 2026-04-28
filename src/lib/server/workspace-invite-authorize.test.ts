import { describe, expect, it, vi } from 'vitest'

vi.mock('./db/client', () => ({
  getDb: vi.fn(),
}))

vi.mock('./cli-connections', () => ({
  isSharedCliConnection: vi.fn(),
  listAdminCliConnectionStateForActor: vi.fn(),
}))

vi.mock('./cli-tasks', () => ({
  dispatchCliFlowTasks: vi.fn(),
}))

vi.mock('./identities', () => ({
  updateManagedIdentity: vi.fn(),
}))

vi.mock('./security', () => ({
  createId: vi.fn(),
}))

vi.mock('./workspaces', () => ({
  ensureManagedWorkspaceMemberIdentityCount: vi.fn(),
  findAdminManagedWorkspaceSummary: vi.fn(),
  markManagedWorkspaceMemberInviteStatus: vi.fn(),
}))

import {
  createWorkspaceInviteAuthorizeMachine,
  type WorkspaceInviteAuthorizeMachineSnapshot,
} from './workspace-invite-authorize'
import type { WorkspaceInviteAuthorizeWorkflowRow } from './db/schema'

function createWorkflow(
  overrides: Partial<WorkspaceInviteAuthorizeWorkflowRow> = {},
): WorkspaceInviteAuthorizeWorkflowRow {
  const now = new Date('2026-04-28T00:00:00.000Z')

  return {
    id: 'workflow-1',
    managedWorkspaceId: 'workspace-1',
    connectionId: 'connection-1',
    status: 'RUNNING',
    phase: 'INVITE',
    targetMemberCount: 9,
    lastMessage: null,
    lastError: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('workspace invite authorize machine', () => {
  it('starts queued workflows in the invite state', async () => {
    const machine = createWorkspaceInviteAuthorizeMachine(createWorkflow())

    machine.start()
    const snapshot = await machine.send('workflow.started', {
      patch: {
        workflowId: 'workflow-1',
        phase: 'INVITE',
        status: 'RUNNING',
        lastMessage: 'Queued invite',
      },
    })

    expect(snapshot).toMatchObject({
      state: 'invite',
      context: {
        workflowId: 'workflow-1',
        phase: 'INVITE',
        status: 'RUNNING',
        lastMessage: 'Queued invite',
      },
    } satisfies Partial<WorkspaceInviteAuthorizeMachineSnapshot>)
  })

  it('moves invite success into authorization', async () => {
    const machine = createWorkspaceInviteAuthorizeMachine(createWorkflow())

    machine.start()
    const snapshot = await machine.send('workflow.invite.completed', {
      outcome: 'authorize',
      message: 'Workspace invite completed; queuing Codex OAuth authorization.',
    })

    expect(snapshot).toMatchObject({
      state: 'authorize',
      context: {
        phase: 'AUTHORIZE',
        status: 'RUNNING',
        lastMessage:
          'Workspace invite completed; queuing Codex OAuth authorization.',
      },
    })
  })

  it('can return from authorization to invite when members change', async () => {
    const machine = createWorkspaceInviteAuthorizeMachine(
      createWorkflow({
        phase: 'AUTHORIZE',
      }),
    )

    machine.start()
    const snapshot = await machine.send('workflow.authorize.completed', {
      outcome: 'invite',
      message:
        'Workspace members changed during authorization; queuing refreshed ChatGPT invite.',
    })

    expect(snapshot).toMatchObject({
      state: 'invite',
      context: {
        phase: 'INVITE',
        status: 'RUNNING',
      },
    })
  })

  it('persists terminal failure details in context', async () => {
    const machine = createWorkspaceInviteAuthorizeMachine(
      createWorkflow({
        phase: 'AUTHORIZE',
      }),
    )

    machine.start()
    const snapshot = await machine.send('workflow.authorize.completed', {
      outcome: 'failed',
      message:
        'Workspace authorization is incomplete after the allowed Codex OAuth attempts.',
    })

    expect(snapshot).toMatchObject({
      state: 'failed',
      context: {
        phase: 'FAILED',
        status: 'FAILED',
        lastError:
          'Workspace authorization is incomplete after the allowed Codex OAuth attempts.',
      },
    })
  })
})
