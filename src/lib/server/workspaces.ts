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
  managedIdentitySessions,
  managedWorkspaceMembers,
  managedWorkspaces,
} from './db/schema'
import { createId } from './security'

const MAX_MANAGED_WORKSPACE_MEMBER_COUNT = 9

export type ManagedWorkspaceAuthorizationState =
  | 'authorized'
  | 'expired'
  | 'revoked'
  | 'missing'

export interface ManagedWorkspaceAuthorizationSummary {
  state: ManagedWorkspaceAuthorizationState
  expiresAt: string | null
  lastSeenAt: string | null
}

export interface AdminManagedWorkspaceIdentitySummary {
  identityId: string
  email: string
  identityLabel: string
  authorization: ManagedWorkspaceAuthorizationSummary
}

export interface AdminManagedWorkspaceMemberSummary {
  id: string
  email: string
  identityId: string | null
  identityLabel: string | null
  authorization: ManagedWorkspaceAuthorizationSummary
}

export interface AdminManagedWorkspaceSummary {
  id: string
  workspaceId: string | null
  label: string | null
  teamTrialPaypalUrl: string | null
  teamTrialPaypalCapturedAt: string | null
  owner: AdminManagedWorkspaceIdentitySummary | null
  memberCount: number
  members: AdminManagedWorkspaceMemberSummary[]
  createdAt: string
  updatedAt: string
}

export type ResolvedManagedWorkspaceAssociation = AdminManagedWorkspaceSummary

interface ManagedIdentityLookupRow {
  identityId: string
  email: string
  label: string | null
}

interface WorkspaceMemberInput {
  identityId: string | null
  email: string
}

interface ManagedWorkspaceAuthorizationInput {
  identityId: string
  workspaceId: string | null
}

interface ManagedWorkspaceAuthorizationLookupRow {
  identityId: string
  workspaceId: string | null
  status: 'ACTIVE' | 'REVOKED'
  expiresAt: Date | null
  lastSeenAt: Date
}

const DEFAULT_WORKSPACE_AUTHORIZATION_SUMMARY: ManagedWorkspaceAuthorizationSummary =
  {
    state: 'missing',
    expiresAt: null,
    lastSeenAt: null,
  }

function normalizeWorkspaceId(value?: string | null): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeOptionalLabel(value?: string | null): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeOptionalIdentityId(value?: string | null): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeOptionalMetadataString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized || null
}

export function normalizeTeamTrialPaypalUrl(
  value?: string | null,
): string | null {
  const normalized = value?.trim()
  if (!normalized) {
    return null
  }

  try {
    const url = new URL(normalized)
    const hostname = url.hostname.toLowerCase()
    if (
      url.protocol !== 'https:' ||
      (hostname !== 'paypal.com' && !hostname.endsWith('.paypal.com'))
    ) {
      return null
    }

    const baToken =
      url.searchParams.get('ba_token') || url.searchParams.get('token')
    if (!baToken || !/^BA-[A-Za-z0-9]+$/.test(baToken)) {
      return null
    }

    return url.toString()
  } catch {
    return null
  }
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

function normalizeWorkspaceIds(values: Iterable<string | null>): string[] {
  const deduped = new Map<string, string>()

  for (const value of values) {
    const workspaceId = normalizeWorkspaceId(value)
    if (!workspaceId) {
      continue
    }

    deduped.set(workspaceId, workspaceId)
  }

  return [...deduped.values()]
}

function buildManagedWorkspaceAuthorizationKey(input: {
  identityId: string
  workspaceId?: string | null
}): string {
  const workspaceId = normalizeWorkspaceId(input.workspaceId)
  return `${input.identityId}::${workspaceId ? `workspace:${workspaceId}` : 'default:'}`
}

function buildManagedWorkspaceIdentitySummary(
  identity?: ManagedIdentityLookupRow | null,
  workspaceId?: string | null,
  authorizationsByWorkspaceIdentity: Map<
    string,
    ManagedWorkspaceAuthorizationSummary
  > = new Map(),
): AdminManagedWorkspaceIdentitySummary | null {
  if (!identity) {
    return null
  }

  const authorizationKey =
    workspaceId !== undefined
      ? buildManagedWorkspaceAuthorizationKey({
          identityId: identity.identityId,
          workspaceId,
        })
      : null

  return {
    identityId: identity.identityId,
    email: identity.email,
    identityLabel: identity.label || identity.email,
    authorization:
      (authorizationKey
        ? authorizationsByWorkspaceIdentity.get(authorizationKey)
        : null) || DEFAULT_WORKSPACE_AUTHORIZATION_SUMMARY,
  }
}

function normalizeManagedWorkspaceAuthorizationInputs(
  values: Iterable<ManagedWorkspaceAuthorizationInput>,
): ManagedWorkspaceAuthorizationInput[] {
  const deduped = new Map<string, ManagedWorkspaceAuthorizationInput>()

  for (const value of values) {
    const identityId = value.identityId.trim()
    const workspaceId = normalizeWorkspaceId(value.workspaceId)

    if (!identityId) {
      continue
    }

    deduped.set(
      buildManagedWorkspaceAuthorizationKey({
        identityId,
        workspaceId,
      }),
      {
        identityId,
        workspaceId,
      },
    )
  }

  return [...deduped.values()]
}

function resolveManagedWorkspaceAuthorizationState(input: {
  status: 'ACTIVE' | 'REVOKED'
  expiresAt: Date | null
}): ManagedWorkspaceAuthorizationState {
  if (input.status === 'REVOKED') {
    return 'revoked'
  }

  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    return 'expired'
  }

  return 'authorized'
}

function getManagedWorkspaceAuthorizationPriority(
  state: ManagedWorkspaceAuthorizationState,
): number {
  if (state === 'authorized') {
    return 3
  }

  if (state === 'revoked') {
    return 2
  }

  if (state === 'expired') {
    return 1
  }

  return 0
}

function buildManagedWorkspaceAuthorizationSummary(
  row: ManagedWorkspaceAuthorizationLookupRow,
): ManagedWorkspaceAuthorizationSummary {
  return {
    state: resolveManagedWorkspaceAuthorizationState({
      status: row.status,
      expiresAt: row.expiresAt,
    }),
    expiresAt: row.expiresAt?.toISOString() || null,
    lastSeenAt: row.lastSeenAt.toISOString(),
  }
}

async function resolveManagedWorkspaceAuthorizations(
  authorizations: Iterable<ManagedWorkspaceAuthorizationInput>,
): Promise<Map<string, ManagedWorkspaceAuthorizationSummary>> {
  const normalizedAuthorizations =
    normalizeManagedWorkspaceAuthorizationInputs(authorizations)
  if (!normalizedAuthorizations.length) {
    return new Map()
  }

  const requestedAuthorizationKeys = new Set(
    normalizedAuthorizations.map((authorization) =>
      buildManagedWorkspaceAuthorizationKey(authorization),
    ),
  )
  const normalizedIdentityIds = normalizeIdentityIds(
    normalizedAuthorizations.map((authorization) => authorization.identityId),
  )
  const normalizedWorkspaceIds = normalizeWorkspaceIds(
    normalizedAuthorizations.map((authorization) => authorization.workspaceId),
  )
  const requestsDefaultWorkspace = normalizedAuthorizations.some(
    (authorization) => !authorization.workspaceId,
  )
  const workspaceWhere =
    normalizedWorkspaceIds.length && requestsDefaultWorkspace
      ? or(
          inArray(managedIdentitySessions.workspaceId, normalizedWorkspaceIds),
          isNull(managedIdentitySessions.workspaceId),
        )
      : normalizedWorkspaceIds.length
        ? inArray(managedIdentitySessions.workspaceId, normalizedWorkspaceIds)
        : isNull(managedIdentitySessions.workspaceId)

  const rows = await getDb().query.managedIdentitySessions.findMany({
    where: and(
      inArray(managedIdentitySessions.identityId, normalizedIdentityIds),
      workspaceWhere,
      or(
        eq(managedIdentitySessions.authMode, 'codex-oauth'),
        eq(managedIdentitySessions.flowType, 'codex-oauth'),
      ),
    ),
    columns: {
      identityId: true,
      workspaceId: true,
      status: true,
      expiresAt: true,
      lastSeenAt: true,
    },
    orderBy: [desc(managedIdentitySessions.lastSeenAt)],
  })

  const summaries = new Map<string, ManagedWorkspaceAuthorizationSummary>()

  for (const row of rows) {
    const authorizationKey = buildManagedWorkspaceAuthorizationKey({
      identityId: row.identityId,
      workspaceId: row.workspaceId,
    })
    if (!requestedAuthorizationKeys.has(authorizationKey)) {
      continue
    }

    const nextSummary = buildManagedWorkspaceAuthorizationSummary(row)
    const currentSummary = summaries.get(authorizationKey)

    if (!currentSummary) {
      summaries.set(authorizationKey, nextSummary)
      continue
    }

    const currentPriority = getManagedWorkspaceAuthorizationPriority(
      currentSummary.state,
    )
    const nextPriority = getManagedWorkspaceAuthorizationPriority(
      nextSummary.state,
    )

    if (nextPriority > currentPriority) {
      summaries.set(authorizationKey, nextSummary)
      continue
    }

    if (nextPriority < currentPriority) {
      continue
    }

    const currentLastSeenAt = currentSummary.lastSeenAt
      ? new Date(currentSummary.lastSeenAt).getTime()
      : 0
    const nextLastSeenAt = nextSummary.lastSeenAt
      ? new Date(nextSummary.lastSeenAt).getTime()
      : 0

    if (nextLastSeenAt > currentLastSeenAt) {
      summaries.set(authorizationKey, nextSummary)
    }
  }

  return summaries
}

function buildAdminManagedWorkspaceSummary(
  row: {
    id: string
    workspaceId: string | null
    label: string | null
    teamTrialPaypalUrl?: string | null
    teamTrialPaypalCapturedAt?: Date | null
    ownerIdentity?: ManagedIdentityLookupRow | null
    createdAt: Date
    updatedAt: Date
    members: Array<{
      id: string
      email: string
      identityId: string | null
      identity?: ManagedIdentityLookupRow | null
    }>
  },
  authorizationsByWorkspaceIdentity: Map<
    string,
    ManagedWorkspaceAuthorizationSummary
  >,
): AdminManagedWorkspaceSummary {
  const members = row.members.map((member) => {
    const authorizationKey = member.identityId
      ? buildManagedWorkspaceAuthorizationKey({
          identityId: member.identityId,
          workspaceId: row.workspaceId,
        })
      : null

    return {
      id: member.id,
      email: member.email,
      identityId: member.identityId,
      identityLabel:
        member.identity?.label || member.identity?.email || member.email,
      authorization:
        (authorizationKey
          ? authorizationsByWorkspaceIdentity.get(authorizationKey)
          : null) || DEFAULT_WORKSPACE_AUTHORIZATION_SUMMARY,
    }
  })

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    label: row.label,
    teamTrialPaypalUrl: row.teamTrialPaypalUrl || null,
    teamTrialPaypalCapturedAt:
      row.teamTrialPaypalCapturedAt?.toISOString() || null,
    owner: buildManagedWorkspaceIdentitySummary(
      row.ownerIdentity,
      row.workspaceId,
      authorizationsByWorkspaceIdentity,
    ),
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
  const normalizedIdentityIds = normalizeIdentityIds(
    input.memberIdentityIds || [],
  )
  const normalizedEmails = normalizeWorkspaceMemberEmails(
    input.memberEmails || [],
  )
  const identitiesById = await resolveManagedIdentityRowsByIds(
    normalizedIdentityIds,
  )
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
  ownerIdentity: ManagedIdentityLookupRow | null,
  currentWorkspaceId?: string,
) {
  if (!ownerIdentity) {
    return
  }

  const duplicate = await getDb().query.managedWorkspaces.findFirst({
    where: currentWorkspaceId
      ? and(
          eq(managedWorkspaces.ownerIdentityId, ownerIdentity.identityId),
          notInArray(managedWorkspaces.id, [currentWorkspaceId]),
        )
      : eq(managedWorkspaces.ownerIdentityId, ownerIdentity.identityId),
    columns: {
      id: true,
      workspaceId: true,
      label: true,
    },
  })

  if (duplicate) {
    throw new Error(
      `This identity already owns workspace ${duplicate.label || duplicate.workspaceId || 'unnamed workspace'}.`,
    )
  }

  const ownerEmail = normalizeEmail(ownerIdentity.email)
  const memberMatch = await getDb().query.managedWorkspaceMembers.findFirst({
    where: currentWorkspaceId
      ? and(
          or(
            eq(managedWorkspaceMembers.identityId, ownerIdentity.identityId),
            eq(managedWorkspaceMembers.email, ownerEmail),
          ),
          notInArray(managedWorkspaceMembers.managedWorkspaceId, [
            currentWorkspaceId,
          ]),
        )
      : or(
          eq(managedWorkspaceMembers.identityId, ownerIdentity.identityId),
          eq(managedWorkspaceMembers.email, ownerEmail),
        ),
    columns: {
      id: true,
    },
    with: {
      workspace: {
        columns: {
          id: true,
          workspaceId: true,
          label: true,
        },
      },
    },
  })

  if (memberMatch) {
    const workspace = memberMatch.workspace
    throw new Error(
      `This identity already belongs to workspace ${workspace?.label || workspace?.workspaceId || 'unnamed workspace'}.`,
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

  const authorizationsByWorkspaceIdentity =
    await resolveManagedWorkspaceAuthorizations(
      rows.flatMap((row) => [
        ...(row.ownerIdentity?.identityId
          ? [
              {
                identityId: row.ownerIdentity.identityId,
                workspaceId: row.workspaceId,
              },
            ]
          : []),
        ...row.members.flatMap((member) =>
          member.identityId
            ? [{ identityId: member.identityId, workspaceId: row.workspaceId }]
            : [],
        ),
      ]),
    )

  return rows.map((row) =>
    buildAdminManagedWorkspaceSummary(row, authorizationsByWorkspaceIdentity),
  )
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

  if (!row) {
    return null
  }

  const authorizationsByWorkspaceIdentity =
    await resolveManagedWorkspaceAuthorizations([
      ...(row.ownerIdentity?.identityId
        ? [
            {
              identityId: row.ownerIdentity.identityId,
              workspaceId: row.workspaceId,
            },
          ]
        : []),
      ...row.members.flatMap((member) =>
        member.identityId
          ? [{ identityId: member.identityId, workspaceId: row.workspaceId }]
          : [],
      ),
    ])

  return buildAdminManagedWorkspaceSummary(
    row,
    authorizationsByWorkspaceIdentity,
  )
}

export async function createManagedWorkspace(input: {
  workspaceId?: string | null
  label?: string | null
  ownerIdentityId?: string | null
  memberIdentityIds?: string[]
  memberEmails?: string[]
}): Promise<AdminManagedWorkspaceSummary> {
  const workspaceId = normalizeWorkspaceId(input.workspaceId)

  if (workspaceId) {
    const existing = await getDb().query.managedWorkspaces.findFirst({
      where: eq(managedWorkspaces.workspaceId, workspaceId),
      columns: {
        id: true,
      },
    })
    if (existing) {
      throw new Error('Workspace ID already exists')
    }
  }

  const ownerIdentityId = normalizeOptionalIdentityId(input.ownerIdentityId)
  const ownerIdentity = await resolveManagedWorkspaceOwner(ownerIdentityId)
  const memberInputs = await resolveWorkspaceMemberInputs({
    memberIdentityIds: input.memberIdentityIds,
    memberEmails: input.memberEmails,
  })

  await assertWorkspaceOwnerAvailability(ownerIdentity)
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

export async function recordManagedWorkspaceTeamTrialPaypalUrl(input: {
  workspaceRecordId?: string | null
  workspaceId?: string | null
  ownerIdentityId?: string | null
  paypalUrl: string
  capturedAt?: Date
}): Promise<AdminManagedWorkspaceSummary | null> {
  const paypalUrl = normalizeTeamTrialPaypalUrl(input.paypalUrl)
  if (!paypalUrl) {
    return null
  }

  const workspaceRecordId = normalizeOptionalMetadataString(
    input.workspaceRecordId,
  )
  const workspaceId = normalizeWorkspaceId(input.workspaceId)
  const ownerIdentityId = normalizeOptionalIdentityId(input.ownerIdentityId)
  const where =
    workspaceRecordId !== null
      ? eq(managedWorkspaces.id, workspaceRecordId)
      : workspaceId !== null
        ? eq(managedWorkspaces.workspaceId, workspaceId)
        : ownerIdentityId !== null
          ? eq(managedWorkspaces.ownerIdentityId, ownerIdentityId)
          : null

  if (!where) {
    return null
  }

  const now = input.capturedAt || new Date()
  const [record] = await getDb()
    .update(managedWorkspaces)
    .set({
      teamTrialPaypalUrl: paypalUrl,
      teamTrialPaypalCapturedAt: now,
      updatedAt: now,
    })
    .where(where)
    .returning({
      id: managedWorkspaces.id,
    })

  if (!record) {
    return null
  }

  return findAdminManagedWorkspaceSummary(record.id)
}

export async function recordWorkspaceTeamTrialPaypalUrlFromFlowTask(input: {
  payload?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
  capturedAt?: Date
}): Promise<AdminManagedWorkspaceSummary | null> {
  if (
    !isRecord(input.payload) ||
    input.payload.flowId !== 'chatgpt-team-trial'
  ) {
    return null
  }

  if (!isRecord(input.result)) {
    return null
  }

  const paypalUrl = normalizeTeamTrialPaypalUrl(
    normalizeOptionalMetadataString(input.result.paypalApprovalUrl),
  )
  if (!paypalUrl) {
    return null
  }

  const metadata = isRecord(input.payload.metadata)
    ? input.payload.metadata
    : null
  const workspace =
    metadata && isRecord(metadata.workspace) ? metadata.workspace : null

  return recordManagedWorkspaceTeamTrialPaypalUrl({
    workspaceRecordId: normalizeOptionalMetadataString(workspace?.recordId),
    workspaceId: normalizeOptionalMetadataString(workspace?.workspaceId),
    ownerIdentityId: normalizeOptionalMetadataString(
      workspace?.ownerIdentityId,
    ),
    paypalUrl,
    capturedAt: input.capturedAt,
  })
}

export async function updateManagedWorkspace(
  id: string,
  input: {
    workspaceId?: string | null
    label?: string | null
    ownerIdentityId?: string | null
    memberIdentityIds?: string[]
    memberEmails?: string[]
  },
): Promise<AdminManagedWorkspaceSummary | null> {
  const existing = await getDb().query.managedWorkspaces.findFirst({
    where: eq(managedWorkspaces.id, id),
    columns: {
      id: true,
      workspaceId: true,
      ownerIdentityId: true,
    },
  })
  if (!existing) {
    return null
  }

  const workspaceId =
    input.workspaceId === undefined
      ? existing.workspaceId
      : normalizeWorkspaceId(input.workspaceId)

  if (workspaceId) {
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

  await assertWorkspaceOwnerAvailability(ownerIdentity, id)
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

  if (
    input.memberIdentityIds !== undefined ||
    input.memberEmails !== undefined
  ) {
    await replaceWorkspaceMembers(record.id, nextMemberInputs)
  }

  return findAdminManagedWorkspaceSummary(record.id)
}

export async function deleteManagedWorkspace(id: string) {
  const [record] = await getDb()
    .delete(managedWorkspaces)
    .where(eq(managedWorkspaces.id, id))
    .returning()

  if (record?.ownerIdentityId) {
    await archiveDeletedWorkspaceOwnerIdentity(record.ownerIdentityId)
  }

  return record ?? null
}

async function archiveDeletedWorkspaceOwnerIdentity(ownerIdentityId: string) {
  const identityId = normalizeOptionalIdentityId(ownerIdentityId)
  if (!identityId) {
    return null
  }

  const owner = await getDb().query.managedIdentities.findFirst({
    where: eq(managedIdentities.identityId, identityId),
    columns: {
      identityId: true,
      email: true,
      status: true,
    },
  })

  if (!owner) {
    return null
  }

  if (owner.status !== 'BANNED') {
    await getDb()
      .update(managedIdentities)
      .set({
        status: 'ARCHIVED',
        updatedAt: new Date(),
      })
      .where(eq(managedIdentities.identityId, identityId))
  }

  await removeManagedIdentityFromAllWorkspaces({
    identityId: owner.identityId,
    email: owner.email,
  })

  return owner
}

export async function resetManagedWorkspaceAuthorizationStatuses(input: {
  id: string
  memberIds?: string[]
}): Promise<{
  workspace: AdminManagedWorkspaceSummary
  resetCount: number
}> {
  const managedWorkspaceId = input.id.trim()
  if (!managedWorkspaceId) {
    throw new Error('id is required')
  }

  const workspace = await findAdminManagedWorkspaceSummary(managedWorkspaceId)
  if (!workspace) {
    throw new Error('Workspace not found')
  }

  const requestedMemberIds = new Set(
    (input.memberIds || []).map((memberId) => memberId.trim()).filter(Boolean),
  )
  const selectedMembers = requestedMemberIds.size
    ? workspace.members.filter((member) => requestedMemberIds.has(member.id))
    : workspace.members

  if (
    requestedMemberIds.size &&
    selectedMembers.length !== requestedMemberIds.size
  ) {
    throw new Error('Some requested workspace members were not found')
  }

  const identityIds = normalizeIdentityIds([
    ...(!requestedMemberIds.size &&
    workspace.owner?.identityId &&
    workspace.owner.authorization.state !== 'missing'
      ? [workspace.owner.identityId]
      : []),
    ...selectedMembers.flatMap((member) =>
      member.identityId && member.authorization.state !== 'missing'
        ? [member.identityId]
        : [],
    ),
  ])

  if (!identityIds.length) {
    throw new Error(
      requestedMemberIds.size
        ? 'Selected members do not have a stored authorization status to reset'
        : 'This workspace does not have any stored authorization statuses to reset',
    )
  }

  const deletedSessions = await getDb()
    .delete(managedIdentitySessions)
    .where(
      and(
        inArray(managedIdentitySessions.identityId, identityIds),
        workspace.workspaceId
          ? eq(managedIdentitySessions.workspaceId, workspace.workspaceId)
          : isNull(managedIdentitySessions.workspaceId),
        or(
          eq(managedIdentitySessions.authMode, 'codex-oauth'),
          eq(managedIdentitySessions.flowType, 'codex-oauth'),
        ),
      ),
    )
    .returning({
      id: managedIdentitySessions.id,
    })

  await getDb()
    .update(managedWorkspaces)
    .set({
      updatedAt: new Date(),
    })
    .where(eq(managedWorkspaces.id, workspace.id))

  const refreshedWorkspace = await findAdminManagedWorkspaceSummary(
    workspace.id,
  )
  if (!refreshedWorkspace) {
    throw new Error('Unable to load updated workspace')
  }

  return {
    workspace: refreshedWorkspace,
    resetCount: deletedSessions.length,
  }
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

  await assertWorkspaceOwnerAvailability(ownerIdentity, existing?.id)
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
    await getDb()
      .insert(managedWorkspaces)
      .values({
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

export async function removeManagedIdentityFromAllWorkspaces(params: {
  identityId: string
  email?: string | null
}): Promise<{
  removedOwnerCount: number
  removedMemberCount: number
}> {
  const identityId = params.identityId.trim()
  const email = params.email ? normalizeEmail(params.email) : null

  if (!identityId && !email) {
    return {
      removedOwnerCount: 0,
      removedMemberCount: 0,
    }
  }

  const db = getDb()
  const seenAt = new Date()
  const touchedWorkspaceIds = new Set<string>()

  const ownerRows = identityId
    ? await db.query.managedWorkspaces.findMany({
        where: eq(managedWorkspaces.ownerIdentityId, identityId),
        columns: {
          id: true,
        },
      })
    : []

  if (ownerRows.length) {
    for (const row of ownerRows) {
      touchedWorkspaceIds.add(row.id)
    }

    await db
      .update(managedWorkspaces)
      .set({
        ownerIdentityId: null,
        updatedAt: seenAt,
      })
      .where(eq(managedWorkspaces.ownerIdentityId, identityId))
  }

  const memberConditions = []
  if (identityId) {
    memberConditions.push(eq(managedWorkspaceMembers.identityId, identityId))
  }
  if (email) {
    memberConditions.push(eq(managedWorkspaceMembers.email, email))
  }

  const memberRows = memberConditions.length
    ? await db.query.managedWorkspaceMembers.findMany({
        where:
          memberConditions.length === 1
            ? memberConditions[0]
            : or(...memberConditions),
        columns: {
          id: true,
          managedWorkspaceId: true,
        },
      })
    : []

  if (memberRows.length) {
    for (const row of memberRows) {
      touchedWorkspaceIds.add(row.managedWorkspaceId)
    }

    await db.delete(managedWorkspaceMembers).where(
      inArray(
        managedWorkspaceMembers.id,
        memberRows.map((row) => row.id),
      ),
    )
  }

  const workspaceIdsToTouch = [...touchedWorkspaceIds]
  if (workspaceIdsToTouch.length) {
    await db
      .update(managedWorkspaces)
      .set({
        updatedAt: seenAt,
      })
      .where(inArray(managedWorkspaces.id, workspaceIdsToTouch))
  }

  return {
    removedOwnerCount: ownerRows.length,
    removedMemberCount: memberRows.length,
  }
}
