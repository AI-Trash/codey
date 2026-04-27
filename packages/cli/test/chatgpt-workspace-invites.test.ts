import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseFlowCliArgs } from '../src/modules/flow-cli/parse-argv'
import {
  extractInviteEmailsFromCsv,
  extractInviteEmailsFromJson,
  inviteWorkspaceMembers,
  planUnmanagedWorkspaceInviteRemovals,
  planUnmanagedWorkspaceMemberRemovals,
  planWorkspaceMemberRemovals,
  resolveInviteEmails,
  selectInviteCapableAccount,
} from '../src/modules/chatgpt/workspace-invites'

const tempPaths: string[] = []

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { force: true })
  }
})

class FakeInvitePage {
  readonly fetchCalls: Array<{
    url: string
    method: string
    headers: Record<string, string>
    body?: string
  }> = []

  readonly responses: Array<{
    ok: boolean
    status: number
    url: string
    text: string
  }> = []

  context(): {
    cookies: () => Promise<Array<{ name: string; value: string }>>
  } {
    return {
      cookies: async () => [
        {
          name: '_account',
          value: 'workspace-123',
        },
      ],
    }
  }

  async evaluate(
    _fn: unknown,
    input?: {
      url: string
      method?: string
      headers?: Record<string, string>
      body?: string
    },
  ): Promise<unknown> {
    if (!input) {
      return 0
    }

    this.fetchCalls.push({
      url: input.url,
      method: input.method || 'GET',
      headers: input.headers || {},
      body: input.body,
    })

    return (
      this.responses.shift() || {
        ok: false,
        status: 500,
        url: input.url,
        text: '',
      }
    )
  }
}

function jsonApiResponse(data: unknown): {
  ok: boolean
  status: number
  url: string
  text: string
} {
  return {
    ok: true,
    status: 200,
    url: 'https://chatgpt.com/backend-api/test',
    text: JSON.stringify(data),
  }
}

describe('workspace invite helpers', () => {
  it('collects repeated inviteEmail flags from single-file argv parsing', () => {
    expect(
      parseFlowCliArgs([
        '--inviteEmail',
        'one@example.com',
        '--inviteEmail',
        'two@example.com',
      ]),
    ).toMatchObject({
      inviteEmail: ['one@example.com', 'two@example.com'],
    })
  })

  it('extracts invite emails from JSON-like payloads', () => {
    expect(
      extractInviteEmailsFromJson({
        members: [
          'first@example.com',
          { email: 'second@example.com' },
          { nested: { value: 'third@example.com, fourth@example.com' } },
        ],
      }),
    ).toEqual([
      'first@example.com',
      'second@example.com',
      'third@example.com',
      'fourth@example.com',
    ])
  })

  it('extracts invite emails from CSV content', () => {
    const content = [
      'email,name',
      'first@example.com,First',
      '"second@example.com, third@example.com",Second',
    ].join('\n')

    expect(extractInviteEmailsFromCsv(content)).toEqual([
      'first@example.com',
      'second@example.com',
      'third@example.com',
    ])
  })

  it('resolves invite emails from direct input and file input together', () => {
    const filePath = path.join(
      os.tmpdir(),
      `codey-flow-invites-${process.pid}-${Date.now()}.json`,
    )
    tempPaths.push(filePath)
    fs.writeFileSync(
      filePath,
      JSON.stringify(['file@example.com', { email: 'repeat@example.com' }]),
    )

    expect(
      resolveInviteEmails({
        inviteEmail: ['direct@example.com, repeat@example.com'],
        inviteFile: filePath,
      }),
    ).toMatchObject({
      emails: ['direct@example.com', 'repeat@example.com', 'file@example.com'],
      directInputEmails: ['direct@example.com', 'repeat@example.com'],
      fileEmails: ['file@example.com', 'repeat@example.com'],
      inviteFilePath: filePath,
    })
  })

  it('prefers the current workspace account when it can accept invites', () => {
    expect(
      selectInviteCapableAccount(
        {
          account_ordering: ['workspace-1', 'personal-1'],
          accounts: {
            'workspace-1': {
              account: {
                account_id: 'workspace-1',
                structure: 'workspace',
                plan_type: 'team',
              },
              can_access_with_session: true,
            },
            'personal-1': {
              account: {
                account_id: 'personal-1',
                structure: 'personal',
                plan_type: 'free',
              },
              can_access_with_session: true,
            },
          },
        },
        'workspace-1',
      ),
    ).toBe('workspace-1')
  })

  it('falls back to the first invite-capable workspace account', () => {
    expect(
      selectInviteCapableAccount(
        {
          account_ordering: ['personal-1', 'workspace-2'],
          accounts: {
            'personal-1': {
              account: {
                account_id: 'personal-1',
                structure: 'personal',
                plan_type: 'free',
              },
              can_access_with_session: true,
            },
            'workspace-2': {
              account: {
                account_id: 'workspace-2',
                structure: 'workspace',
                plan_type: 'team',
              },
              can_access_with_session: true,
            },
          },
        },
        'personal-1',
      ),
    ).toBe('workspace-2')
  })

  it('plans removals by prioritizing deactivated non-owners first', () => {
    expect(
      planWorkspaceMemberRemovals({
        inviteCount: 2,
        memberLimit: 4,
        members: [
          {
            id: 'owner-1',
            email: 'owner@example.com',
            role: 'account-owner',
            created_time: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'member-new',
            email: 'member-new@example.com',
            role: 'standard-user',
            created_time: '2026-03-01T00:00:00.000Z',
          },
          {
            id: 'member-old',
            email: 'member-old@example.com',
            role: 'standard-user',
            created_time: '2026-02-01T00:00:00.000Z',
          },
          {
            id: 'deactivated-new',
            email: 'deactivated-new@example.com',
            role: 'standard-user',
            created_time: '2026-04-01T00:00:00.000Z',
            deactivated_time: '2026-04-10T00:00:00.000Z',
          },
          {
            id: 'deactivated-old',
            email: 'deactivated-old@example.com',
            role: 'standard-user',
            created_time: '2026-01-15T00:00:00.000Z',
            deactivated_time: '2026-04-09T00:00:00.000Z',
          },
        ],
      }).map((member) => member.id),
    ).toEqual(['deactivated-old', 'deactivated-new', 'member-old'])
  })

  it('plans unmanaged workspace removals without removing managed or protected users', () => {
    expect(
      planUnmanagedWorkspaceMemberRemovals({
        managedEmails: ['managed@example.com'],
        protectedEmails: ['owner@example.com'],
        members: [
          {
            id: 'owner-1',
            email: 'owner@example.com',
            role: 'account-owner',
          },
          {
            id: 'managed-1',
            email: 'managed@example.com',
            role: 'standard-user',
          },
          {
            id: 'stale-1',
            email: 'stale@example.com',
            role: 'standard-user',
            created_time: '2026-03-01T00:00:00.000Z',
          },
          {
            id: 'stale-admin',
            email: 'stale-admin@example.com',
            role: 'admin',
            created_time: '2026-02-01T00:00:00.000Z',
          },
        ],
      }).map((member) => member.id),
    ).toEqual(['stale-1', 'stale-admin'])
  })

  it('plans unmanaged pending invite removals without removing managed invites', () => {
    expect(
      planUnmanagedWorkspaceInviteRemovals({
        managedEmails: ['managed@example.com'],
        invites: [
          {
            id: 'managed-invite',
            email_address: 'managed@example.com',
          },
          {
            id: 'stale-old',
            email_address: 'stale-old@example.com',
            created_time: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'stale-new',
            email_address: 'stale-new@example.com',
            created_time: '2026-03-01T00:00:00.000Z',
          },
          {
            email_address: 'missing-id@example.com',
            created_time: '2026-02-01T00:00:00.000Z',
          },
        ],
      }).map((invite) => invite.email_address),
    ).toEqual([
      'stale-old@example.com',
      'missing-id@example.com',
      'stale-new@example.com',
    ])
  })

  it('lists pending invites with page sizes accepted by the ChatGPT API', async () => {
    const page = new FakeInvitePage()
    const firstPendingInvitePage = Array.from({ length: 100 }, (_, index) => ({
      email_address: `pending-${index}@example.com`,
    }))

    page.responses.push(
      jsonApiResponse({
        account_ordering: ['workspace-123'],
        accounts: {
          'workspace-123': {
            account: {
              account_id: 'workspace-123',
              structure: 'workspace',
              plan_type: 'team',
            },
            can_access_with_session: true,
          },
        },
      }),
      jsonApiResponse({
        items: [],
      }),
      jsonApiResponse({
        account_invites: firstPendingInvitePage,
        total: 101,
      }),
      jsonApiResponse({
        account_invites: [
          {
            email_address: 'repeat@example.com',
          },
        ],
        total: 101,
      }),
    )

    const result = await inviteWorkspaceMembers(page as never, [
      'repeat@example.com',
    ])

    const inviteListCalls = page.fetchCalls.filter((call) =>
      call.url.includes('/invites?'),
    )
    const invitePostCall = page.fetchCalls.find(
      (call) => call.url.endsWith('/invites') && call.method === 'POST',
    )

    expect(
      inviteListCalls.map((call) =>
        new URL(call.url).searchParams.get('limit'),
      ),
    ).toEqual(['100', '100'])
    expect(
      inviteListCalls.map((call) =>
        new URL(call.url).searchParams.get('offset'),
      ),
    ).toEqual(['0', '100'])
    expect(
      inviteListCalls.every(
        (call) => Number(new URL(call.url).searchParams.get('limit')) <= 100,
      ),
    ).toBe(true)
    expect(invitePostCall).toBeUndefined()
    expect(result.invitedEmails).toEqual([])
    expect(result.skippedEmails).toEqual(['repeat@example.com'])
  })

  it('recognizes pending invites returned as list items', async () => {
    const page = new FakeInvitePage()

    page.responses.push(
      jsonApiResponse({
        account_ordering: ['workspace-123'],
        accounts: {
          'workspace-123': {
            account: {
              account_id: 'workspace-123',
              structure: 'workspace',
              plan_type: 'team',
            },
            can_access_with_session: true,
          },
        },
      }),
      jsonApiResponse({
        items: [],
      }),
      jsonApiResponse({
        items: [
          {
            email: 'repeat@example.com',
          },
        ],
        total: 1,
      }),
    )

    const result = await inviteWorkspaceMembers(page as never, [
      'repeat@example.com',
    ])
    const invitePostCall = page.fetchCalls.find(
      (call) => call.url.endsWith('/invites') && call.method === 'POST',
    )

    expect(invitePostCall).toBeUndefined()
    expect(result.invitedEmails).toEqual([])
    expect(result.skippedEmails).toEqual(['repeat@example.com'])
  })

  it('removes unmanaged workspace members before sending new invites', async () => {
    const page = new FakeInvitePage()

    page.responses.push(
      jsonApiResponse({
        account_ordering: ['workspace-123'],
        accounts: {
          'workspace-123': {
            account: {
              account_id: 'workspace-123',
              structure: 'workspace',
              plan_type: 'team',
            },
            can_access_with_session: true,
          },
        },
      }),
      jsonApiResponse({
        items: [
          {
            id: 'owner-1',
            email: 'owner@example.com',
            role: 'account-owner',
          },
          {
            id: 'managed-1',
            email: 'managed@example.com',
            role: 'standard-user',
          },
          {
            id: 'stale-1',
            email: 'stale@example.com',
            role: 'standard-user',
          },
        ],
      }),
      jsonApiResponse({
        account_invites: [],
        total: 0,
      }),
      jsonApiResponse({
        success: true,
      }),
      jsonApiResponse({
        account_invites: [
          {
            email_address: 'new@example.com',
          },
        ],
        errored_emails: [],
      }),
    )

    const result = await inviteWorkspaceMembers(
      page as never,
      ['managed@example.com', 'new@example.com'],
      {
        pruneUnmanagedWorkspaceMembers: true,
        protectedEmails: ['owner@example.com'],
      },
    )
    const deleteCallIndex = page.fetchCalls.findIndex(
      (call) => call.method === 'DELETE',
    )
    const invitePostCallIndex = page.fetchCalls.findIndex(
      (call) => call.url.endsWith('/invites') && call.method === 'POST',
    )
    const deleteCall = page.fetchCalls[deleteCallIndex]
    const invitePostCall = page.fetchCalls[invitePostCallIndex]

    expect(deleteCall?.url).toContain('/users/stale-1')
    expect(deleteCallIndex).toBeGreaterThan(-1)
    expect(invitePostCallIndex).toBeGreaterThan(deleteCallIndex)
    expect(JSON.parse(invitePostCall?.body || '{}')).toMatchObject({
      email_addresses: ['new@example.com'],
    })
    expect(result.removedMemberEmails).toEqual(['stale@example.com'])
    expect(result.skippedEmails).toEqual(['managed@example.com'])
    expect(result.invitedEmails).toEqual(['new@example.com'])
  })

  it('removes unmanaged pending invites before sending new invites', async () => {
    const page = new FakeInvitePage()

    page.responses.push(
      jsonApiResponse({
        account_ordering: ['workspace-123'],
        accounts: {
          'workspace-123': {
            account: {
              account_id: 'workspace-123',
              structure: 'workspace',
              plan_type: 'team',
            },
            can_access_with_session: true,
          },
        },
      }),
      jsonApiResponse({
        items: [
          {
            id: 'owner-1',
            email: 'owner@example.com',
            role: 'account-owner',
          },
        ],
      }),
      jsonApiResponse({
        account_invites: [
          {
            id: 'managed-invite',
            email_address: 'managed@example.com',
          },
          {
            id: 'stale-invite',
            email_address: 'stale@example.com',
          },
        ],
        total: 2,
      }),
      jsonApiResponse({
        success: true,
      }),
      jsonApiResponse({
        account_invites: [
          {
            email_address: 'new@example.com',
          },
        ],
        errored_emails: [],
      }),
    )

    const result = await inviteWorkspaceMembers(
      page as never,
      ['managed@example.com', 'new@example.com'],
      {
        pruneUnmanagedWorkspaceMembers: true,
        protectedEmails: ['owner@example.com'],
      },
    )
    const deleteCallIndex = page.fetchCalls.findIndex(
      (call) => call.method === 'DELETE',
    )
    const invitePostCallIndex = page.fetchCalls.findIndex(
      (call) => call.url.endsWith('/invites') && call.method === 'POST',
    )
    const deleteCall = page.fetchCalls[deleteCallIndex]
    const invitePostCall = page.fetchCalls[invitePostCallIndex]

    expect(deleteCall?.url).toMatch(/\/invites$/)
    expect(JSON.parse(deleteCall?.body || '{}')).toMatchObject({
      email_address: 'stale@example.com',
    })
    expect(deleteCallIndex).toBeGreaterThan(-1)
    expect(invitePostCallIndex).toBeGreaterThan(deleteCallIndex)
    expect(JSON.parse(invitePostCall?.body || '{}')).toMatchObject({
      email_addresses: ['new@example.com'],
    })
    expect(result.removedInviteEmails).toEqual(['stale@example.com'])
    expect(result.skippedEmails).toEqual(['managed@example.com'])
    expect(result.invitedEmails).toEqual(['new@example.com'])
  })

  it('removes hidden matching pending invites and retries after seat-limit responses', async () => {
    const page = new FakeInvitePage()

    page.responses.push(
      jsonApiResponse({
        account_ordering: ['workspace-123'],
        accounts: {
          'workspace-123': {
            account: {
              account_id: 'workspace-123',
              structure: 'workspace',
              plan_type: 'team',
            },
            can_access_with_session: true,
          },
        },
      }),
      jsonApiResponse({
        items: [
          {
            id: 'owner-1',
            email: 'owner@example.com',
            role: 'account-owner',
          },
        ],
      }),
      jsonApiResponse({
        account_invites: [],
        total: 0,
      }),
      {
        ok: false,
        status: 401,
        url: 'https://chatgpt.com/backend-api/test',
        text: JSON.stringify({
          detail:
            'Workspace has reached maximum number of seats allowed for a free trial.',
        }),
      },
      jsonApiResponse({
        success: true,
      }),
      jsonApiResponse({
        account_invites: [
          {
            email_address: 'new@example.com',
          },
        ],
        errored_emails: [],
      }),
    )

    const result = await inviteWorkspaceMembers(
      page as never,
      ['new@example.com'],
      {
        pruneUnmanagedWorkspaceMembers: true,
        protectedEmails: ['owner@example.com'],
      },
    )
    const invitePostCalls = page.fetchCalls.filter(
      (call) => call.url.endsWith('/invites') && call.method === 'POST',
    )
    const deleteCallIndex = page.fetchCalls.findIndex(
      (call) => call.method === 'DELETE',
    )
    const secondInvitePostIndex = page.fetchCalls.findIndex(
      (call, index) =>
        index > deleteCallIndex &&
        call.url.endsWith('/invites') &&
        call.method === 'POST',
    )
    const deleteCall = page.fetchCalls[deleteCallIndex]

    expect(invitePostCalls).toHaveLength(2)
    expect(deleteCallIndex).toBeGreaterThan(-1)
    expect(secondInvitePostIndex).toBeGreaterThan(deleteCallIndex)
    expect(JSON.parse(deleteCall?.body || '{}')).toMatchObject({
      email_address: 'new@example.com',
    })
    expect(result.removedInviteEmails).toEqual(['new@example.com'])
    expect(result.invitedEmails).toEqual(['new@example.com'])
  })
})
