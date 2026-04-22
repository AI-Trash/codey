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

describe('loginChatGPTAndInviteMembers', () => {
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

    const { loginChatGPTAndInviteMembers } = await import(
      '../src/flows/chatgpt-login-invite'
    )

    const result = await loginChatGPTAndInviteMembers(page, {
      inviteEmail: ['a@example.com', 'b@example.com'],
    })

    expect(syncManagedWorkspaceToCodeyApp).toHaveBeenCalledWith({
      workspaceId: 'workspace-123',
      memberEmails: ['a@example.com'],
    })
    expect(result.invites.accountId).toBe('workspace-123')
  })
})
