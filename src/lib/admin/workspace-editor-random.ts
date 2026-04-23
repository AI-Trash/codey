export type RandomizableIdentity = {
  id: string
  label: string
  account?: string | null
  status?: string | null
}

export type RandomizableWorkspace = {
  id: string
  label?: string | null
}

export type RandomWorkspaceMemberConflict = {
  identity: RandomizableIdentity
  workspaces: RandomizableWorkspace[]
}

function shuffleItems<T>(items: T[]): T[] {
  const next = [...items]

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
  }

  return next
}

export function getOtherWorkspaceOwnerWorkspace(
  identityId: string,
  ownerWorkspaceByIdentityId: ReadonlyMap<string, RandomizableWorkspace>,
  currentWorkspaceId?: string,
) {
  const ownerWorkspace = ownerWorkspaceByIdentityId.get(identityId)

  if (!ownerWorkspace || ownerWorkspace.id === currentWorkspaceId) {
    return null
  }

  return ownerWorkspace
}

export function getOtherWorkspaceMemberWorkspaces(
  identityId: string,
  memberWorkspacesByIdentityId: ReadonlyMap<
    string,
    readonly RandomizableWorkspace[]
  >,
  currentWorkspaceId?: string,
) {
  return (memberWorkspacesByIdentityId.get(identityId) || []).filter(
    (workspace) => workspace.id !== currentWorkspaceId,
  )
}

function getOtherWorkspaceAssociations(
  identityId: string,
  ownerWorkspaceByIdentityId: ReadonlyMap<string, RandomizableWorkspace>,
  memberWorkspacesByIdentityId: ReadonlyMap<
    string,
    readonly RandomizableWorkspace[]
  >,
  currentWorkspaceId?: string,
) {
  const entries = new Map<string, RandomizableWorkspace>()
  const ownerWorkspace = getOtherWorkspaceOwnerWorkspace(
    identityId,
    ownerWorkspaceByIdentityId,
    currentWorkspaceId,
  )

  if (ownerWorkspace) {
    entries.set(ownerWorkspace.id, ownerWorkspace)
  }

  for (const workspace of getOtherWorkspaceMemberWorkspaces(
    identityId,
    memberWorkspacesByIdentityId,
    currentWorkspaceId,
  )) {
    entries.set(workspace.id, workspace)
  }

  return [...entries.values()]
}

export function getRandomWorkspaceOwnerIdentity(input: {
  identities: RandomizableIdentity[]
  ownerWorkspaceByIdentityId: ReadonlyMap<string, RandomizableWorkspace>
  memberWorkspacesByIdentityId: ReadonlyMap<
    string,
    readonly RandomizableWorkspace[]
  >
  currentWorkspaceId?: string
}) {
  const eligibleIdentities = input.identities.filter(
    (identity) =>
      !getOtherWorkspaceOwnerWorkspace(
        identity.id,
        input.ownerWorkspaceByIdentityId,
        input.currentWorkspaceId,
      ),
  )
  const [preferredIdentities, fallbackIdentities] = eligibleIdentities.reduce<
    [RandomizableIdentity[], RandomizableIdentity[]]
  >(
    (groups, identity) => {
      if (
        getOtherWorkspaceMemberWorkspaces(
          identity.id,
          input.memberWorkspacesByIdentityId,
          input.currentWorkspaceId,
        ).length
      ) {
        groups[1].push(identity)
      } else {
        groups[0].push(identity)
      }

      return groups
    },
    [[], []],
  )

  return [
    ...shuffleItems(preferredIdentities),
    ...shuffleItems(fallbackIdentities),
  ][0]
}

export function getRandomWorkspaceMemberSelection(input: {
  identities: RandomizableIdentity[]
  ownerIdentityId: string
  ownerWorkspaceByIdentityId: ReadonlyMap<string, RandomizableWorkspace>
  memberWorkspacesByIdentityId: ReadonlyMap<
    string,
    readonly RandomizableWorkspace[]
  >
  currentWorkspaceId?: string
  count?: number
}) {
  if (!input.ownerIdentityId) {
    return {
      identityIds: [],
      conflicts: [],
    }
  }

  const eligibleIdentities = input.identities.filter(
    (identity) => identity.id !== input.ownerIdentityId,
  )
  const [preferredIdentities, fallbackIdentities] = eligibleIdentities.reduce<
    [RandomizableIdentity[], RandomWorkspaceMemberConflict[]]
  >(
    (groups, identity) => {
      const workspaces = getOtherWorkspaceAssociations(
        identity.id,
        input.ownerWorkspaceByIdentityId,
        input.memberWorkspacesByIdentityId,
        input.currentWorkspaceId,
      )

      if (workspaces.length) {
        groups[1].push({
          identity,
          workspaces,
        })
      } else {
        groups[0].push(identity)
      }

      return groups
    },
    [[], []],
  )
  const count = input.count ?? eligibleIdentities.length
  const nextPreferred = shuffleItems(preferredIdentities).slice(0, count)
  const remainingCount = Math.max(0, count - nextPreferred.length)
  const nextFallback = shuffleItems(fallbackIdentities).slice(0, remainingCount)

  return {
    identityIds: [
      ...nextPreferred.map((identity) => identity.id),
      ...nextFallback.map((entry) => entry.identity.id),
    ],
    conflicts: nextFallback,
  }
}
