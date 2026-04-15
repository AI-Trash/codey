import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseFlowCliArgs } from '../src/modules/flow-cli/parse-argv'
import {
  extractInviteEmailsFromCsv,
  extractInviteEmailsFromJson,
  resolveInviteEmails,
  selectInviteCapableAccount,
} from '../src/modules/chatgpt/workspace-invites'

const tempPaths: string[] = []

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { force: true })
  }
})

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
})
