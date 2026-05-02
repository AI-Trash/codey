import { beforeEach, describe, expect, it, vi } from 'vitest'

const loginChatGPT = vi.fn()
const inviteWorkspaceMembers = vi.fn()
const resolveInviteEmails = vi.fn()
const syncManagedWorkspaceToCodeyApp = vi.fn()

vi.mock('../src/flows/chatgpt-login', () => ({
  loginChatGPT,
}))

vi.mock('../src/modules/chatgpt/workspace-invites', () => ({
  inviteWorkspaceMembers,
  resolveInviteEmails,
}))

vi.mock('../src/modules/app-auth/workspaces', () => ({
  syncManagedWorkspaceToCodeyApp,
}))

describe('inviteChatGPTWorkspaceMembers', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    resolveInviteEmails.mockReturnValue({
      emails: ['a@example.com', 'b@example.com'],
      directInputEmails: ['a@example.com', 'b@example.com'],
      fileEmails: [],
    })
    loginChatGPT.mockResolvedValue({
      pageName: 'chatgpt-login',
      url: 'https://chatgpt.com',
      title: 'ChatGPT',
      email: 'owner@example.com',
      authenticated: true,
      method: 'password',
      storedIdentity: {
        id: 'identity-123',
        email: 'owner@example.com',
      },
    })
    inviteWorkspaceMembers.mockResolvedValue({
      strategy: 'api',
      accountId: 'workspace-123',
      requestedEmails: ['a@example.com', 'b@example.com'],
      invitedEmails: ['a@example.com'],
      skippedEmails: [],
      erroredEmails: ['b@example.com'],
    })
    syncManagedWorkspaceToCodeyApp.mockResolvedValue({
      id: 'workspace-record-1',
      workspaceId: 'workspace-123',
      memberCount: 1,
      members: [],
      createdAt: '2026-04-17T00:00:00.000Z',
      updatedAt: '2026-04-17T00:00:00.000Z',
    })
  })

  it('syncs the invited workspace association back to the Codey app', async () => {
    const page = {
      url: vi.fn(() => 'https://chatgpt.com/admin'),
      title: vi.fn(async () => 'ChatGPT Admin'),
    } as never

    const { inviteChatGPTWorkspaceMembers } =
      await import('../src/flows/chatgpt-invite')

    const result = await inviteChatGPTWorkspaceMembers(page, {
      inviteEmail: ['a@example.com', 'b@example.com'],
    })

    expect(loginChatGPT).toHaveBeenCalledWith(
      page,
      expect.objectContaining({
        autoSelectFirstWorkspace: true,
      }),
    )
    expect(syncManagedWorkspaceToCodeyApp).toHaveBeenCalledWith({
      workspaceId: 'workspace-123',
      ownerIdentityId: 'identity-123',
      memberEmails: ['a@example.com'],
      confirmedInviteEmails: ['a@example.com'],
      failedInviteEmails: ['b@example.com'],
    })
    expect(result.invites.accountId).toBe('workspace-123')
    expect(result.machine).toMatchObject({
      state: 'completed',
      context: {
        workspaceId: 'workspace-123',
        lastMessage: 'ChatGPT workspace invite flow completed',
      },
    })
  })

  it('tracks retry bookkeeping on the invite machine', async () => {
    const { createChatGPTInviteMachine } =
      await import('../src/flows/chatgpt-invite')
    const machine = createChatGPTInviteMachine()

    machine.start()
    await machine.send('chatgpt.invites.started', {
      target: 'completed',
      patch: {
        workspaceId: 'workspace-123',
      },
    })
    expect(machine.getSnapshot().state).toBe('inviting-members')

    const snapshot = await machine.send('chatgpt.retry.requested', {
      reason: 'storage-state-save',
      message: 'Continuing after storage save failed',
      patch: {
        workspaceId: 'workspace-123',
      },
    })

    expect(snapshot).toMatchObject({
      state: 'retrying',
      context: {
        workspaceId: 'workspace-123',
        retryCount: 1,
        retryReason: 'storage-state-save',
        retryFromState: 'inviting-members',
        lastMessage: 'Continuing after storage save failed',
      },
    })
  })

  it('reports a selected workspace id before the invite API finishes resolving account id', async () => {
    loginChatGPT.mockResolvedValueOnce({
      pageName: 'chatgpt-login',
      url: 'https://chatgpt.com',
      title: 'ChatGPT',
      email: 'owner@example.com',
      authenticated: true,
      method: 'password',
      selectedWorkspaceId: 'workspace-selected',
      storedIdentity: {
        id: 'identity-123',
        email: 'owner@example.com',
      },
    })
    inviteWorkspaceMembers.mockResolvedValueOnce({
      strategy: 'api',
      requestedEmails: ['a@example.com', 'b@example.com'],
      invitedEmails: ['a@example.com', 'b@example.com'],
      skippedEmails: [],
      erroredEmails: [],
    })

    const page = {
      url: vi.fn(() => 'https://chatgpt.com/admin'),
      title: vi.fn(async () => 'ChatGPT Admin'),
    } as never

    const { inviteChatGPTWorkspaceMembers } =
      await import('../src/flows/chatgpt-invite')

    const result = await inviteChatGPTWorkspaceMembers(page, {
      inviteEmail: ['a@example.com', 'b@example.com'],
    })

    expect(syncManagedWorkspaceToCodeyApp).toHaveBeenNthCalledWith(1, {
      workspaceId: 'workspace-selected',
      ownerIdentityId: 'identity-123',
      memberEmails: [],
      confirmedInviteEmails: [],
      failedInviteEmails: [],
    })
    expect(syncManagedWorkspaceToCodeyApp).toHaveBeenNthCalledWith(2, {
      workspaceId: 'workspace-selected',
      ownerIdentityId: 'identity-123',
      memberEmails: ['a@example.com', 'b@example.com'],
      confirmedInviteEmails: ['a@example.com', 'b@example.com'],
      failedInviteEmails: [],
    })
    expect(result.workspaceId).toBe('workspace-selected')
  })
})
