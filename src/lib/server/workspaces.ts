import '@tanstack/react-start/server-only'

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
} from 'drizzle-orm'
import { getDb } from './db/client'
import {
  managedIdentities,
  managedWorkspaceMembers,
  managedWorkspaces,
} from './db/schema'
import { createId } from './security'

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
  memberCount: number
  members: AdminManagedWorkspaceMemberSummary[]
  createdAt: string
  updatedAt: string
}

export interface ResolvedManagedWorkspaceAssociation {
  id: string
  workspaceId: string
  label: string | null
  memberEmail: string
  identityId: string | null
  identityLabel: string | null
  createdAt: string
  updatedAt: string
}

function normalizeWorkspaceId(value: string): string {
  return value.trim()
}

function normalizeOptionalLabel(value?: string | null): string | null {
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

function buildAdminManagedWorkspaceSummary(row: {
  id: string
  workspaceId: string
  label: string | null
  createdAt: Date
  updatedAt: Date
  members: Array<{
    id: string
    email: string
    identityId: string | null
    identity?: {
      identityId: string
      email: string
      label: string | null
    } | null
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
    memberCount: members.length,
    members,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function buildResolvedManagedWorkspaceAssociation(row: {
  email: string
  identityId: string | null
  updatedAt: Date
  workspace: {
    id: string
    workspaceId: string
    label: string | null
    createdAt: Date
    updatedAt: Date
  } | null
  identity?: {
    label: string | null
    email: string
  } | null
}): ResolvedManagedWorkspaceAssociation | null {
  if (!row.workspace) {
    return null
  }

  return {
    id: row.workspace.id,
    workspaceId: row.workspace.workspaceId,
    label: row.workspace.label,
    memberEmail: row.email,
    identityId: row.identityId,
    identityLabel: row.identity?.label || row.identity?.email || row.email,
    createdAt: row.workspace.createdAt.toISOString(),
    updatedAt: row.workspace.updatedAt.toISOString(),
  }
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

async function replaceWorkspaceMembers(
  managedWorkspaceId: string,
  memberEmails: string[],
): Promise<void> {
  const db = getDb()
  const normalizedEmails = normalizeWorkspaceMemberEmails(memberEmails)
  const seenAt = new Date()
  const identityIdsByEmail = await resolveIdentityIdsByEmail(normalizedEmails)
  const existingMembers = await db.query.managedWorkspaceMembers.findMany({
    where: eq(managedWorkspaceMembers.managedWorkspaceId, managedWorkspaceId),
  })
  const existingByEmail = new Map(
    existingMembers.map((member) => [member.email, member]),
  )

  for (const email of normalizedEmails) {
    const existing = existingByEmail.get(email)
    const identityId = identityIdsByEmail.get(email) || existing?.identityId || null

    if (existing) {
      await db
        .update(managedWorkspaceMembers)
        .set({
          identityId,
          updatedAt: seenAt,
        })
        .where(eq(managedWorkspaceMembers.id, existing.id))
      continue
    }

    await db.insert(managedWorkspaceMembers).values({
      id: createId(),
      managedWorkspaceId,
      identityId,
      email,
      createdAt: seenAt,
      updatedAt: seenAt,
    })
  }

  if (!normalizedEmails.length) {
    await db
      .delete(managedWorkspaceMembers)
      .where(eq(managedWorkspaceMembers.managedWorkspaceId, managedWorkspaceId))
    return
  }

  await db
    .delete(managedWorkspaceMembers)
    .where(
      and(
        eq(managedWorkspaceMembers.managedWorkspaceId, managedWorkspaceId),
        notInArray(managedWorkspaceMembers.email, normalizedEmails),
      ),
    )
}

async function mergeWorkspaceMembers(
  managedWorkspaceId: string,
  memberEmails: string[],
): Promise<void> {
  const db = getDb()
  const normalizedEmails = normalizeWorkspaceMemberEmails(memberEmails)
  if (!normalizedEmails.length) {
    return
  }

  const seenAt = new Date()
  const identityIdsByEmail = await resolveIdentityIdsByEmail(normalizedEmails)
  const existingMembers = await db.query.managedWorkspaceMembers.findMany({
    where: and(
      eq(managedWorkspaceMembers.managedWorkspaceId, managedWorkspaceId),
      inArray(managedWorkspaceMembers.email, normalizedEmails),
    ),
  })
  const existingByEmail = new Map(
    existingMembers.map((member) => [member.email, member]),
  )

  for (const email of normalizedEmails) {
    const existing = existingByEmail.get(email)
    const identityId = identityIdsByEmail.get(email) || existing?.identityId || null

    if (existing) {
      await db
        .update(managedWorkspaceMembers)
        .set({
          identityId,
          updatedAt: seenAt,
        })
        .where(eq(managedWorkspaceMembers.id, existing.id))
      continue
    }

    await db.insert(managedWorkspaceMembers).values({
      id: createId(),
      managedWorkspaceId,
      identityId,
      email,
      createdAt: seenAt,
      updatedAt: seenAt,
    })
  }
}

export async function listAdminManagedWorkspaceSummaries(): Promise<
  AdminManagedWorkspaceSummary[]
> {
  const rows = await getDb().query.managedWorkspaces.findMany({
    with: {
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

export async function findAdminManagedWorkspaceSummary(id: string): Promise<AdminManagedWorkspaceSummary | null> {
  const row = await getDb().query.managedWorkspaces.findFirst({
    where: eq(managedWorkspaces.id, id),
    with: {
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

  const seenAt = new Date()
  const [record] = await getDb()
    .insert(managedWorkspaces)
    .values({
      id: createId(),
      workspaceId,
      label: normalizeOptionalLabel(input.label),
      createdAt: seenAt,
      updatedAt: seenAt,
    })
    .returning()

  if (!record) {
    throw new Error('Unable to create workspace')
  }

  await replaceWorkspaceMembers(record.id, input.memberEmails || [])

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
    memberEmails?: string[]
  },
): Promise<AdminManagedWorkspaceSummary | null> {
  const workspaceId = normalizeWorkspaceId(input.workspaceId)
  if (!workspaceId) {
    throw new Error('workspaceId is required')
  }

  const existing = await getDb().query.managedWorkspaces.findFirst({
    where: eq(managedWorkspaces.id, id),
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

  const [record] = await getDb()
    .update(managedWorkspaces)
    .set({
      workspaceId,
      label: normalizeOptionalLabel(input.label),
      updatedAt: new Date(),
    })
    .where(eq(managedWorkspaces.id, id))
    .returning()

  if (!record) {
    return null
  }

  if (input.memberEmails !== undefined) {
    await replaceWorkspaceMembers(record.id, input.memberEmails)
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
    },
  })

  const managedWorkspaceId = existing?.id || createId()

  if (existing) {
    await getDb()
      .update(managedWorkspaces)
      .set({
        label:
          normalizeOptionalLabel(input.label) ??
          normalizeOptionalLabel(existing.label),
        updatedAt: seenAt,
      })
      .where(eq(managedWorkspaces.id, existing.id))
  } else {
    await getDb().insert(managedWorkspaces).values({
      id: managedWorkspaceId,
      workspaceId,
      label: normalizeOptionalLabel(input.label),
      createdAt: seenAt,
      updatedAt: seenAt,
    })
  }

  await mergeWorkspaceMembers(managedWorkspaceId, input.memberEmails || [])

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
  const identityId = params.identityId?.trim() || undefined
  let email = params.email ? normalizeEmail(params.email) : undefined

  if (!email && identityId) {
    const identity = await getDb().query.managedIdentities.findFirst({
      where: eq(managedIdentities.identityId, identityId),
      columns: {
        email: true,
      },
    })
    email = identity?.email || undefined
  }

  const conditions = []
  if (identityId) {
    conditions.push(eq(managedWorkspaceMembers.identityId, identityId))
  }
  if (email) {
    conditions.push(eq(managedWorkspaceMembers.email, email))
  }

  if (!conditions.length) {
    return null
  }

  const rows = await getDb().query.managedWorkspaceMembers.findMany({
    where: conditions.length === 1 ? conditions[0] : or(...conditions),
    with: {
      workspace: true,
      identity: {
        columns: {
          email: true,
          label: true,
        },
      },
    },
    orderBy: [
      desc(managedWorkspaceMembers.updatedAt),
      desc(managedWorkspaceMembers.createdAt),
    ],
  })

  const matchedRow =
    (identityId
      ? rows.find((row) => row.identityId === identityId && row.workspace)
      : undefined) ||
    (email ? rows.find((row) => row.email === email && row.workspace) : undefined) ||
    rows.find((row) => row.workspace)

  return matchedRow ? buildResolvedManagedWorkspaceAssociation(matchedRow) : null
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
