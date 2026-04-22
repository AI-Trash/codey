import '@tanstack/react-start/server-only'

import { and, asc, desc, eq, inArray, isNull, notInArray, or } from 'drizzle-orm'
import { getDb } from './db/client'
import {
  managedIdentities,
  managedWorkspaceMembers,
  managedWorkspaces,
} from './db/schema'
import { createId } from './security'

const MAX_MANAGED_WORKSPACE_MEMBER_COUNT = 9

export interface AdminManagedWorkspaceIdentitySummary {
  identityId: string
  email: string
  identityLabel: string
}

export interface AdminManagedWorkspaceMemberSummary {
  id: string
  email: string
  identityId: string | null
  identityLabel: string | null
}

export interface AdminManagedWorkspaceSummary {
  id: string
  workspaceId: string
  label: string | null
  owner: AdminManagedWorkspaceIdentitySummary | null
  memberCount: number
  members: AdminManagedWorkspaceMemberSummary[]
  createdAt: string
  updatedAt: string
}

export type ResolvedManagedWorkspaceAssociation =
  AdminManagedWorkspaceSummary

interface ManagedIdentityLookupRow {
  identityId: string
  email: string
  label: string | null
}

interface WorkspaceMemberInput {
  identityId: string | null
  email: string
}

function normalizeWorkspaceId(value: string): string {
  return value.trim()
}

function normalizeOptionalLabel(value?: string | null): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeOptionalIdentityId(
  value?: string | null,
): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeWorkspaceMemberEmails(values: Iterable<string>): string[] {
  const deduped = new Map<string, string>()

  for (const value of values) {
    const email = normalizeEmail(value)
    if (!email) {
      continue
    }

    deduped.set(email, email)
  }

  return [...deduped.values()]
}

function normalizeIdentityIds(values: Iterable<string>): string[] {
  const deduped = new Map<string, string>()

  for (const value of values) {
    const identityId = value.trim()
    if (!identityId) {
      continue
    }

    deduped.set(identityId, identityId)
  }

  return [...deduped.values()]
}

function buildManagedWorkspaceIdentitySummary(
  identity?: ManagedIdentityLookupRow | null,
): AdminManagedWorkspaceIdentitySummary | null {
  if (!identity) {
    return null
  }

  return {
    identityId: identity.identityId,
    email: identity.email,
    identityLabel: identity.label || identity.email,
  }
}

function buildAdminManagedWorkspaceSummary(row: {
  id: string
  workspaceId: string
  label: string | null
  ownerIdentity?: ManagedIdentityLookupRow | null
  createdAt: Date
  updatedAt: Date
  members: Array<{
    id: string
    email: string
    identityId: string | null
    identity?: ManagedIdentityLookupRow | null
  }>
}): AdminManagedWorkspaceSummary {
  const members = row.members.map((member) => ({
    id: member.id,
    email: member.email,
    identityId: member.identityId,
    identityLabel:
      member.identity?.label || member.identity?.email || member.email,
  }))

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    label: row.label,
    owner: buildManagedWorkspaceIdentitySummary(row.ownerIdentity),
    memberCount: members.length,
    members,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function normalizeWorkspaceMemberInputs(
  values: Iterable<WorkspaceMemberInput>,
): WorkspaceMemberInput[] {
  const deduped = new Map<string, WorkspaceMemberInput>()

  for (const value of values) {
    const email = normalizeEmail(value.email)
    const identityId = normalizeOptionalIdentityId(value.identityId)

    if (!email) {
      continue
    }

    if (identityId) {
      deduped.delete(`email:${email}`)
      deduped.set(`identity:${identityId}`, {
        identityId,
        email,
      })
      continue
    }

    if (!deduped.has(`email:${email}`)) {
      deduped.set(`email:${email}`, {
        identityId: null,
        email,
      })
    }
  }

  const normalized = [...deduped.values()].sort((left, right) =>
    left.email.localeCompare(right.email),
  )
  const seenEmails = new Set<string>()

  for (const member of normalized) {
    if (seenEmails.has(member.email)) {
      throw new Error(`Duplicate workspace member email: ${member.email}`)
    }

    seenEmails.add(member.email)
  }

  return normalized
}

async function resolveIdentityIdsByEmail(
  emails: string[],
): Promise<Map<string, string>> {
  if (!emails.length) {
    return new Map()
  }

  const rows = await getDb().query.managedIdentities.findMany({
    where: inArray(managedIdentities.email, emails),
    columns: {
      email: true,
      identityId: true,
    },
  })

  return new Map(rows.map((row) => [row.email, row.identityId]))
}

async function resolveManagedIdentityRowsByIds(
  identityIds: string[],
): Promise<Map<string, ManagedIdentityLookupRow>> {
  if (!identityIds.length) {
    return new Map()
  }

  const rows = await getDb().query.managedIdentities.findMany({
    where: inArray(managedIdentities.identityId, identityIds),
    columns: {
      identityId: true,
      email: true,
      label: true,
    },
  })

  return new Map(rows.map((row) => [row.identityId, row]))
}

async function resolveManagedWorkspaceOwner(
  ownerIdentityId: string | null,
): Promise<ManagedIdentityLookupRow | null> {
  if (!ownerIdentityId) {
    return null
  }

  const owner = await getDb().query.managedIdentities.findFirst({
    where: eq(managedIdentities.identityId, ownerIdentityId),
    columns: {
      identityId: true,
      email: true,
      label: true,
    },
  })

  if (!owner) {
    throw new Error('Owner identity was not found')
  }

  return owner
}

async function resolveWorkspaceMemberInputs(input: {
  memberIdentityIds?: string[]
  memberEmails?: string[]
}): Promise<WorkspaceMemberInput[]> {
  const normalizedIdentityIds = normalizeIdentityIds(input.memberIdentityIds || [])
  const normalizedEmails = normalizeWorkspaceMemberEmails(input.memberEmails || [])
  const identitiesById = await resolveManagedIdentityRowsByIds(normalizedIdentityIds)
  const memberInputs: WorkspaceMemberInput[] = []
  const identityEmails = new Set<string>()

  if (identitiesById.size !== normalizedIdentityIds.length) {
    const missingIdentityIds = normalizedIdentityIds.filter(
      (identityId) => !identitiesById.has(identityId),
    )

    throw new Error(
      `Some selected member identities were not found: ${missingIdentityIds.join(', ')}`,
    )
  }

  for (const identityId of normalizedIdentityIds) {
    const identity = identitiesById.get(identityId)
    if (!identity) {
      continue
    }

    memberInputs.push({
      identityId: identity.identityId,
      email: identity.email,
    })
    identityEmails.add(normalizeEmail(identity.email))
  }

  if (normalizedEmails.length) {
    const identityIdsByEmail = await resolveIdentityIdsByEmail(normalizedEmails)

    for (const email of normalizedEmails) {
      if (identityEmails.has(email)) {
        continue
      }

      memberInputs.push({
        identityId: identityIdsByEmail.get(email) || null,
        email,
      })
    }
  }

  return normalizeWorkspaceMemberInputs(memberInputs)
}

function validateManagedWorkspaceMembership(input: {
  ownerIdentity?: ManagedIdentityLookupRow | null
  members: WorkspaceMemberInput[]
}) {
  if (input.members.length > MAX_MANAGED_WORKSPACE_MEMBER_COUNT) {
    throw new Error(
      `A workspace can include at most ${MAX_MANAGED_WORKSPACE_MEMBER_COUNT} member identities.`,
    )
  }

  if (!input.ownerIdentity) {
    return
  }

  const ownerEmail = normalizeEmail(input.ownerIdentity.email)
  if (
    input.members.some(
      (member) =>
        member.identityId === input.ownerIdentity?.identityId ||
        member.email === ownerEmail,
    )
  ) {
    throw new Error('Workspace owner cannot also be listed as a member')
  }
}

async function listWorkspaceMemberInputs(
  managedWorkspaceId: string,
): Promise<WorkspaceMemberInput[]> {
  const rows = await getDb().query.managedWorkspaceMembers.findMany({
    where: eq(managedWorkspaceMembers.managedWorkspaceId, managedWorkspaceId),
    columns: {
      identityId: true,
      email: true,
    },
  })

  return normalizeWorkspaceMemberInputs(
    rows.map((row) => ({
      identityId: row.identityId,
      email: row.email,
    })),
  )
}

async function replaceWorkspaceMembers(
  managedWorkspaceId: string,
  memberInputs: WorkspaceMemberInput[],
): Promise<void> {
  const normalizedMembers = normalizeWorkspaceMemberInputs(memberInputs)
  const db = getDb()

  await db
    .delete(managedWorkspaceMembers)
    .where(eq(managedWorkspaceMembers.managedWorkspaceId, managedWorkspaceId))

  if (!normalizedMembers.length) {
    return
  }

  const seenAt = new Date()
  await db.insert(managedWorkspaceMembers).values(
    normalizedMembers.map((member) => ({
      id: createId(),
      managedWorkspaceId,
      identityId: member.identityId,
      email: member.email,
      createdAt: seenAt,
      updatedAt: seenAt,
    })),
  )
}

async function assertWorkspaceOwnerAvailability(
  ownerIdentityId: string | null,
  currentWorkspaceId?: string,
) {
  if (!ownerIdentityId) {
    return
  }

  const duplicate = await getDb().query.managedWorkspaces.findFirst({
    where: currentWorkspaceId
      ? and(
          eq(managedWorkspaces.ownerIdentityId, ownerIdentityId),
          notInArray(managedWorkspaces.id, [currentWorkspaceId]),
        )
      : eq(managedWorkspaces.ownerIdentityId, ownerIdentityId),
    columns: {
      id: true,
      workspaceId: true,
      label: true,
    },
  })

  if (duplicate) {
    throw new Error(
      `This identity already owns workspace ${duplicate.label || duplicate.workspaceId}.`,
    )
  }
}

export async function listAdminManagedWorkspaceSummaries(): Promise<
  AdminManagedWorkspaceSummary[]
> {
  const rows = await getDb().query.managedWorkspaces.findMany({
    with: {
      ownerIdentity: {
        columns: {
          identityId: true,
          email: true,
          label: true,
        },
      },
      members: {
        with: {
          identity: {
            columns: {
              identityId: true,
              email: true,
              label: true,
            },
          },
        },
        orderBy: [asc(managedWorkspaceMembers.email)],
      },
    },
    orderBy: [desc(managedWorkspaces.updatedAt)],
  })

  return rows.map((row) => buildAdminManagedWorkspaceSummary(row))
}

export async function findAdminManagedWorkspaceSummary(
  id: string,
): Promise<AdminManagedWorkspaceSummary | null> {
  const row = await getDb().query.managedWorkspaces.findFirst({
    where: eq(managedWorkspaces.id, id),
    with: {
      ownerIdentity: {
        columns: {
          identityId: true,
          email: true,
          label: true,
        },
      },
      members: {
        with: {
          identity: {
            columns: {
              identityId: true,
              email: true,
              label: true,
            },
          },
        },
        orderBy: [asc(managedWorkspaceMembers.email)],
      },
    },
  })

  return row ? buildAdminManagedWorkspaceSummary(row) : null
}

export async function createManagedWorkspace(input: {
  workspaceId: string
  label?: string | null
  ownerIdentityId?: string | null
  memberIdentityIds?: string[]
  memberEmails?: string[]
}): Promise<AdminManagedWorkspaceSummary> {
  const workspaceId = normalizeWorkspaceId(input.workspaceId)
  if (!workspaceId) {
    throw new Error('workspaceId is required')
  }

  const existing = await getDb().query.managedWorkspaces.findFirst({
    where: eq(managedWorkspaces.workspaceId, workspaceId),
    columns: {
      id: true,
    },
  })
  if (existing) {
    throw new Error('Workspace ID already exists')
  }

  const ownerIdentityId = normalizeOptionalIdentityId(input.ownerIdentityId)
  const ownerIdentity = await resolveManagedWorkspaceOwner(ownerIdentityId)
  const memberInputs = await resolveWorkspaceMemberInputs({
    memberIdentityIds: input.memberIdentityIds,
    memberEmails: input.memberEmails,
  })

  await assertWorkspaceOwnerAvailability(ownerIdentityId)
  validateManagedWorkspaceMembership({
    ownerIdentity,
    members: memberInputs,
  })

  const seenAt = new Date()
  const [record] = await getDb()
    .insert(managedWorkspaces)
    .values({
      id: createId(),
      workspaceId,
      label: normalizeOptionalLabel(input.label),
      ownerIdentityId,
      createdAt: seenAt,
      updatedAt: seenAt,
    })
    .returning()

  if (!record) {
    throw new Error('Unable to create workspace')
  }

  await replaceWorkspaceMembers(record.id, memberInputs)

  const summary = await findAdminManagedWorkspaceSummary(record.id)
  if (!summary) {
    throw new Error('Unable to load created workspace')
  }

  return summary
}

export async function updateManagedWorkspace(
  id: string,
  input: {
    workspaceId: string
    label?: string | null
    ownerIdentityId?: string | null
    memberIdentityIds?: string[]
    memberEmails?: string[]
  },
): Promise<AdminManagedWorkspaceSummary | null> {
  const workspaceId = normalizeWorkspaceId(input.workspaceId)
  if (!workspaceId) {
    throw new Error('workspaceId is required')
  }

  const existing = await getDb().query.managedWorkspaces.findFirst({
    where: eq(managedWorkspaces.id, id),
    columns: {
      id: true,
      ownerIdentityId: true,
    },
  })
  if (!existing) {
    return null
  }

  const duplicate = await getDb().query.managedWorkspaces.findFirst({
    where: and(
      eq(managedWorkspaces.workspaceId, workspaceId),
      notInArray(managedWorkspaces.id, [id]),
    ),
    columns: {
      id: true,
    },
  })
  if (duplicate) {
    throw new Error('Workspace ID already exists')
  }

  const ownerIdentityId =
    input.ownerIdentityId === undefined
      ? existing.ownerIdentityId
      : normalizeOptionalIdentityId(input.ownerIdentityId)
  const ownerIdentity = await resolveManagedWorkspaceOwner(ownerIdentityId)
  const nextMemberInputs =
    input.memberIdentityIds !== undefined || input.memberEmails !== undefined
      ? await resolveWorkspaceMemberInputs({
          memberIdentityIds: input.memberIdentityIds,
          memberEmails: input.memberEmails,
        })
      : await listWorkspaceMemberInputs(existing.id)

  await assertWorkspaceOwnerAvailability(ownerIdentityId, id)
  validateManagedWorkspaceMembership({
    ownerIdentity,
    members: nextMemberInputs,
  })

  const [record] = await getDb()
    .update(managedWorkspaces)
    .set({
      workspaceId,
      label: normalizeOptionalLabel(input.label),
      ownerIdentityId,
      updatedAt: new Date(),
    })
    .where(eq(managedWorkspaces.id, id))
    .returning()

  if (!record) {
    return null
  }

  if (input.memberIdentityIds !== undefined || input.memberEmails !== undefined) {
    await replaceWorkspaceMembers(record.id, nextMemberInputs)
  }

  return findAdminManagedWorkspaceSummary(record.id)
}

export async function deleteManagedWorkspace(id: string) {
  const [record] = await getDb()
    .delete(managedWorkspaces)
    .where(eq(managedWorkspaces.id, id))
    .returning()

  return record ?? null
}

export async function syncManagedWorkspaceInvite(input: {
  workspaceId: string
  label?: string | null
  ownerIdentityId?: string | null
  memberIdentityIds?: string[]
  memberEmails?: string[]
}): Promise<AdminManagedWorkspaceSummary> {
  const workspaceId = normalizeWorkspaceId(input.workspaceId)
  if (!workspaceId) {
    throw new Error('workspaceId is required')
  }

  const seenAt = new Date()
  const existing = await getDb().query.managedWorkspaces.findFirst({
    where: eq(managedWorkspaces.workspaceId, workspaceId),
    columns: {
      id: true,
      label: true,
      ownerIdentityId: true,
    },
  })

  const ownerIdentityId =
    input.ownerIdentityId === undefined
      ? existing?.ownerIdentityId || null
      : normalizeOptionalIdentityId(input.ownerIdentityId)
  const ownerIdentity = await resolveManagedWorkspaceOwner(ownerIdentityId)
  const incomingMemberInputs = await resolveWorkspaceMemberInputs({
    memberIdentityIds: input.memberIdentityIds,
    memberEmails: input.memberEmails,
  })
  const currentMemberInputs = existing
    ? await listWorkspaceMemberInputs(existing.id)
    : []
  const mergedMemberInputs = normalizeWorkspaceMemberInputs([
    ...currentMemberInputs,
    ...incomingMemberInputs,
  ])

  await assertWorkspaceOwnerAvailability(ownerIdentityId, existing?.id)
  validateManagedWorkspaceMembership({
    ownerIdentity,
    members: mergedMemberInputs,
  })

  const managedWorkspaceId = existing?.id || createId()

  if (existing) {
    await getDb()
      .update(managedWorkspaces)
      .set({
        label:
          normalizeOptionalLabel(input.label) ??
          normalizeOptionalLabel(existing.label),
        ownerIdentityId,
        updatedAt: seenAt,
      })
      .where(eq(managedWorkspaces.id, existing.id))
  } else {
    await getDb().insert(managedWorkspaces).values({
      id: managedWorkspaceId,
      workspaceId,
      label: normalizeOptionalLabel(input.label),
      ownerIdentityId,
      createdAt: seenAt,
      updatedAt: seenAt,
    })
  }

  await replaceWorkspaceMembers(managedWorkspaceId, mergedMemberInputs)

  const summary = await findAdminManagedWorkspaceSummary(managedWorkspaceId)
  if (!summary) {
    throw new Error('Unable to load synced workspace')
  }

  return summary
}

export async function resolveAssociatedManagedWorkspace(params: {
  identityId?: string
  email?: string
}): Promise<ResolvedManagedWorkspaceAssociation | null> {
  let identityId = normalizeOptionalIdentityId(params.identityId)
  let email = params.email ? normalizeEmail(params.email) : undefined

  if (!identityId && email) {
    const identity = await getDb().query.managedIdentities.findFirst({
      where: eq(managedIdentities.email, email),
      columns: {
        identityId: true,
      },
    })
    identityId = identity?.identityId || null
  }

  if (!email && identityId) {
    const identity = await getDb().query.managedIdentities.findFirst({
      where: eq(managedIdentities.identityId, identityId),
      columns: {
        email: true,
      },
    })
    email = identity?.email || undefined
  }

  const candidates = new Map<string, Date>()

  if (identityId) {
    const ownerRows = await getDb().query.managedWorkspaces.findMany({
      where: eq(managedWorkspaces.ownerIdentityId, identityId),
      columns: {
        id: true,
        updatedAt: true,
      },
      orderBy: [desc(managedWorkspaces.updatedAt)],
      limit: 10,
    })

    for (const row of ownerRows) {
      candidates.set(row.id, row.updatedAt)
    }
  }

  const memberConditions = []
  if (identityId) {
    memberConditions.push(eq(managedWorkspaceMembers.identityId, identityId))
  }
  if (email) {
    memberConditions.push(eq(managedWorkspaceMembers.email, email))
  }

  if (memberConditions.length) {
    const memberRows = await getDb().query.managedWorkspaceMembers.findMany({
      where:
        memberConditions.length === 1
          ? memberConditions[0]
          : or(...memberConditions),
      with: {
        workspace: {
          columns: {
            id: true,
            updatedAt: true,
          },
        },
      },
      orderBy: [
        desc(managedWorkspaceMembers.updatedAt),
        desc(managedWorkspaceMembers.createdAt),
      ],
      limit: 20,
    })

    for (const row of memberRows) {
      if (!row.workspace) {
        continue
      }

      const previousUpdatedAt = candidates.get(row.workspace.id)
      if (
        !previousUpdatedAt ||
        row.workspace.updatedAt.getTime() > previousUpdatedAt.getTime()
      ) {
        candidates.set(row.workspace.id, row.workspace.updatedAt)
      }
    }
  }

  const matchedWorkspaceId = [...candidates.entries()]
    .sort((left, right) => right[1].getTime() - left[1].getTime())
    .at(0)?.[0]

  return matchedWorkspaceId
    ? findAdminManagedWorkspaceSummary(matchedWorkspaceId)
    : null
}

export async function linkWorkspaceMembersToManagedIdentity(params: {
  identityId: string
  email: string
}): Promise<number> {
  const identityId = params.identityId.trim()
  const email = normalizeEmail(params.email)
  if (!identityId || !email) {
    return 0
  }

  const rows = await getDb().query.managedWorkspaceMembers.findMany({
    where: and(
      eq(managedWorkspaceMembers.email, email),
      or(
        eq(managedWorkspaceMembers.identityId, identityId),
        isNull(managedWorkspaceMembers.identityId),
      ),
    ),
    columns: {
      id: true,
      identityId: true,
    },
  })

  let updatedCount = 0

  for (const row of rows) {
    if (row.identityId === identityId) {
      continue
    }

    await getDb()
      .update(managedWorkspaceMembers)
      .set({
        identityId,
        updatedAt: new Date(),
      })
      .where(eq(managedWorkspaceMembers.id, row.id))
    updatedCount += 1
  }

  return updatedCount
}

