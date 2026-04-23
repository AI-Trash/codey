import { describe, expect, it } from 'vitest'

import { getRandomWorkspaceMemberSelection } from './workspace-editor-random'

describe('workspace member random selection', () => {
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
    expect(selection.conflicts.map((entry) => entry.identity.id).sort()).toEqual([
      'member-other-member',
      'member-other-owner',
    ])
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
