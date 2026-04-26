import { describe, expect, it } from 'vitest'

import {
  getLatestWorkspaceOwnerIdentity,
  getRandomWorkspaceMemberSelection,
} from './workspace-editor-random'

describe('workspace owner selection', () => {
  it('ignores archived and banned identities', () => {
    const selection = getLatestWorkspaceOwnerIdentity({
      identities: [
        {
          id: 'owner-archived',
          label: 'Archived Owner',
          status: 'archived',
        },
        {
          id: 'owner-banned',
          label: 'Banned Owner',
          status: 'banned',
        },
        {
          id: 'owner-active',
          label: 'Active Owner',
          status: 'active',
        },
      ],
      ownerWorkspaceByIdentityId: new Map(),
      memberWorkspacesByIdentityId: new Map(),
    })

    expect(selection?.id).toBe('owner-active')
  })

  it('only selects identities without other workspace ownership or membership', () => {
    const selection = getLatestWorkspaceOwnerIdentity({
      identities: [
        {
          id: 'owner-other-workspace',
          label: 'Other Owner',
        },
        {
          id: 'member-other-workspace',
          label: 'Other Member',
        },
        {
          id: 'owner-clean',
          label: 'Clean Owner',
        },
      ],
      ownerWorkspaceByIdentityId: new Map([
        [
          'owner-other-workspace',
          {
            id: 'workspace-owner',
            label: 'Owner Workspace',
          },
        ],
      ]),
      memberWorkspacesByIdentityId: new Map([
        [
          'member-other-workspace',
          [
            {
              id: 'workspace-member',
              label: 'Member Workspace',
            },
          ],
        ],
      ]),
    })

    expect(selection?.id).toBe('owner-clean')
  })

  it('selects the newest created eligible identity', () => {
    const selection = getLatestWorkspaceOwnerIdentity({
      identities: [
        {
          id: 'owner-older',
          label: 'Older Owner',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'owner-newest',
          label: 'Newest Owner',
          createdAt: '2026-01-03T00:00:00.000Z',
        },
        {
          id: 'owner-newer',
          label: 'Newer Owner',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      ownerWorkspaceByIdentityId: new Map(),
      memberWorkspacesByIdentityId: new Map(),
    })

    expect(selection?.id).toBe('owner-newest')
  })

  it('does not fall back to identities that are members elsewhere', () => {
    const selection = getLatestWorkspaceOwnerIdentity({
      identities: [
        {
          id: 'member-other-workspace',
          label: 'Other Member',
        },
      ],
      ownerWorkspaceByIdentityId: new Map(),
      memberWorkspacesByIdentityId: new Map([
        [
          'member-other-workspace',
          [
            {
              id: 'workspace-member',
              label: 'Member Workspace',
            },
          ],
        ],
      ]),
    })

    expect(selection).toBeUndefined()
  })
})

describe('workspace member random selection', () => {
  it('ignores archived and banned identities', () => {
    const selection = getRandomWorkspaceMemberSelection({
      identities: [
        {
          id: 'owner',
          label: 'Owner',
        },
        {
          id: 'member-archived',
          label: 'Archived Member',
          status: 'archived',
        },
        {
          id: 'member-banned',
          label: 'Banned Member',
          status: 'banned',
        },
        {
          id: 'member-active',
          label: 'Active Member',
          status: 'active',
        },
      ],
      ownerIdentityId: 'owner',
      ownerWorkspaceByIdentityId: new Map(),
      memberWorkspacesByIdentityId: new Map(),
      count: 9,
    })

    expect(selection.identityIds).toEqual(['member-active'])
    expect(selection.conflicts).toEqual([])
  })

  it('prefers identities that are unused by other workspaces', () => {
    const selection = getRandomWorkspaceMemberSelection({
      identities: [
        {
          id: 'owner',
          label: 'Owner',
        },
        {
          id: 'member-clean-1',
          label: 'Clean One',
        },
        {
          id: 'member-clean-2',
          label: 'Clean Two',
        },
        {
          id: 'member-other-workspace',
          label: 'Already Used',
        },
      ],
      ownerIdentityId: 'owner',
      ownerWorkspaceByIdentityId: new Map(),
      memberWorkspacesByIdentityId: new Map([
        [
          'member-other-workspace',
          [
            {
              id: 'workspace-2',
              label: 'Workspace Two',
            },
          ],
        ],
      ]),
      count: 2,
    })

    expect(selection.identityIds.sort()).toEqual([
      'member-clean-1',
      'member-clean-2',
    ])
    expect(selection.conflicts).toEqual([])
  })

  it('returns conflicts when it must reuse identities from other workspaces', () => {
    const selection = getRandomWorkspaceMemberSelection({
      identities: [
        {
          id: 'owner',
          label: 'Owner',
        },
        {
          id: 'member-clean',
          label: 'Clean',
        },
        {
          id: 'member-other-owner',
          label: 'Other Owner',
        },
        {
          id: 'member-other-member',
          label: 'Other Member',
        },
      ],
      ownerIdentityId: 'owner',
      ownerWorkspaceByIdentityId: new Map([
        [
          'member-other-owner',
          {
            id: 'workspace-owner',
            label: 'Owner Workspace',
          },
        ],
      ]),
      memberWorkspacesByIdentityId: new Map([
        [
          'member-other-member',
          [
            {
              id: 'workspace-member',
              label: 'Member Workspace',
            },
          ],
        ],
      ]),
      count: 3,
    })

    expect(selection.identityIds.sort()).toEqual([
      'member-clean',
      'member-other-member',
      'member-other-owner',
    ])
    expect(selection.conflicts).toHaveLength(2)
    expect(
      selection.conflicts.map((entry) => entry.identity.id).sort(),
    ).toEqual(['member-other-member', 'member-other-owner'])
    expect(
      selection.conflicts.find(
        (entry) => entry.identity.id === 'member-other-owner',
      )?.workspaces,
    ).toEqual([
      {
        id: 'workspace-owner',
        label: 'Owner Workspace',
      },
    ])
    expect(
      selection.conflicts.find(
        (entry) => entry.identity.id === 'member-other-member',
      )?.workspaces,
    ).toEqual([
      {
        id: 'workspace-member',
        label: 'Member Workspace',
      },
    ])
  })
})
