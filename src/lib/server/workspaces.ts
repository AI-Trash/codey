import '@tanstack/react-start/server-only'

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
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
  type ManagedIdentityStatus,
  type ManagedWorkspaceMemberInviteStatus,
} from './db/schema'
import { createId } from './security'

const MAX_MANAGED_WORKSPACE_MEMBER_COUNT = 9
const TEAM_TRIAL_PAYPAL_LINK_TTL_MS = 10 * 60 * 1000

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
  inviteStatus: ManagedWorkspaceMemberInviteStatus
  invitedAt: string | null
  inviteStatusUpdatedAt: string | null
}

export interface AdminManagedWorkspaceSummary {
  id: string
  workspaceId: string | null
  label: string | null
  teamTrialPaypalUrl: string | null
  teamTrialPaypalCapturedAt: string | null
  teamTrialPaypalExpiresAt: string | null
  owner: AdminManagedWorkspaceIdentitySummary | null
  memberCount: number
  members: AdminManagedWorkspaceMemberSummary[]
  createdAt: string
  updatedAt: string
}

export type ResolvedManagedWorkspaceAssociation = AdminManagedWorkspaceSummary

export interface AdminManagedIdentityMemberWorkspaceSummary {
  workspace: AdminManagedWorkspaceSummary
  member: AdminManagedWorkspaceMemberSummary
}

export interface AdminManagedIdentityWorkspaceAssociations {
  ownedWorkspaces: AdminManagedWorkspaceSummary[]
  memberWorkspaces: AdminManagedIdentityMemberWorkspaceSummary[]
}

interface ManagedIdentityLookupRow {
  identityId: string
  email: string
  label: string | null
  status?: ManagedIdentityStatus | null
}

interface WorkspaceMemberInput {
  identityId: string | null
  email: string
  inviteStatus?: ManagedWorkspaceMemberInviteStatus
  invitedAt?: Date | null
  inviteStatusUpdatedAt?: Date | null
}

interface ManagedWorkspaceAuthorizationInput {
  identityId: string
  workspaceId: string | null
  workspaceRecordId?: string | null
}

interface ManagedWorkspaceAuthorizationLookupRow {
  identityId: string
  workspaceId: string | null
  workspaceRecordId: string | null
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
const DEFAULT_WORKSPACE_MEMBER_INVITE_STATUS: ManagedWorkspaceMemberInviteStatus =
  'NOT_INVITED'

export function getTeamTrialPaypalLinkExpiresAt(
  capturedAt?: Date | null,
): Date | null {
  return capturedAt
    ? new Date(capturedAt.getTime() + TEAM_TRIAL_PAYPAL_LINK_TTL_MS)
    : null
}

export function resolveTeamTrialPaypalLinkState(input: {
  paypalUrl?: string | null
  capturedAt?: Date | null
  now?: Date
}): {
  url: string | null
  capturedAt: string | null
  expiresAt: string | null
} {
  const paypalUrl = input.paypalUrl?.trim() || null
  const capturedAt = input.capturedAt || null
  const expiresAt = getTeamTrialPaypalLinkExpiresAt(capturedAt)
  const now = input.now || new Date()
  const isActive =
    paypalUrl !== null &&
    expiresAt !== null &&
    expiresAt.getTime() > now.getTime()

  return {
    url: isActive ? paypalUrl : null,
    capturedAt: capturedAt?.toISOString() || null,
    expiresAt: expiresAt?.toISOString() || null,
  }
}

function normalizeWorkspaceId(value?: string | null): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeWorkspaceRecordId(value?: string | null): string | null {
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

function normalizeWorkspaceRecordIds(
  values: Iterable<string | null | undefined>,
): string[] {
  const deduped = new Map<string, string>()

  for (const value of values) {
    const workspaceRecordId = normalizeWorkspaceRecordId(value)
    if (!workspaceRecordId) {
      continue
    }

    deduped.set(workspaceRecordId, workspaceRecordId)
  }

  return [...deduped.values()]
}

function buildManagedWorkspaceRecordAuthorizationKey(input: {
  identityId: string
  workspaceRecordId: string
}): string {
  return `${input.identityId}::record:${input.workspaceRecordId}`
}

function buildManagedWorkspaceExternalAuthorizationKey(input: {
  identityId: string
  workspaceId: string
}): string {
  return `${input.identityId}::workspace:${input.workspaceId}`
}

function buildManagedWorkspaceAuthorizationLookupKeys(input: {
  identityId: string
  workspaceId?: string | null
  workspaceRecordId?: string | null
}): string[] {
  const keys: string[] = []
  const workspaceRecordId = normalizeWorkspaceRecordId(input.workspaceRecordId)
  const workspaceId = normalizeWorkspaceId(input.workspaceId)

  if (workspaceRecordId) {
    keys.push(
      buildManagedWorkspaceRecordAuthorizationKey({
        identityId: input.identityId,
        workspaceRecordId,
      }),
    )
  }

  if (workspaceId) {
    keys.push(
      buildManagedWorkspaceExternalAuthorizationKey({
        identityId: input.identityId,
        workspaceId,
      }),
    )
  }

  return keys
}

function resolveManagedWorkspaceAuthorizationSummaryForIdentity(input: {
  identityId?: string | null
  workspaceId?: string | null
  workspaceRecordId?: string | null
  authorizationsByWorkspaceIdentity?: Map<
    string,
    ManagedWorkspaceAuthorizationSummary
  >
}): ManagedWorkspaceAuthorizationSummary {
  if (!input.identityId) {
    return DEFAULT_WORKSPACE_AUTHORIZATION_SUMMARY
  }

  for (const authorizationKey of buildManagedWorkspaceAuthorizationLookupKeys({
    identityId: input.identityId,
    workspaceId: input.workspaceId,
    workspaceRecordId: input.workspaceRecordId,
  })) {
    const summary =
      input.authorizationsByWorkspaceIdentity?.get(authorizationKey)
    if (summary) {
      return summary
    }
  }

  return DEFAULT_WORKSPACE_AUTHORIZATION_SUMMARY
}

function buildManagedWorkspaceIdentitySummary(
  identity?: ManagedIdentityLookupRow | null,
  workspaceScope?: {
    workspaceId?: string | null
    workspaceRecordId?: string | null
  },
  authorizationsByWorkspaceIdentity: Map<
    string,
    ManagedWorkspaceAuthorizationSummary
  > = new Map(),
): AdminManagedWorkspaceIdentitySummary | null {
  if (!identity) {
    return null
  }

  return {
    identityId: identity.identityId,
    email: identity.email,
    identityLabel: identity.label || identity.email,
    authorization: resolveManagedWorkspaceAuthorizationSummaryForIdentity({
      identityId: identity.identityId,
      workspaceId: workspaceScope?.workspaceId,
      workspaceRecordId: workspaceScope?.workspaceRecordId,
      authorizationsByWorkspaceIdentity,
    }),
  }
}

function normalizeManagedWorkspaceAuthorizationInputs(
  values: Iterable<ManagedWorkspaceAuthorizationInput>,
): ManagedWorkspaceAuthorizationInput[] {
  const deduped = new Map<string, ManagedWorkspaceAuthorizationInput>()

  for (const value of values) {
    const identityId = value.identityId.trim()
    const workspaceId = normalizeWorkspaceId(value.workspaceId)
    const workspaceRecordId = normalizeWorkspaceRecordId(
      value.workspaceRecordId,
    )

    if (!identityId || (!workspaceId && !workspaceRecordId)) {
      continue
    }

    deduped.set(
      `${identityId}::record:${workspaceRecordId || ''}::workspace:${workspaceId || ''}`,
      {
        identityId,
        workspaceId,
        workspaceRecordId,
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
    normalizedAuthorizations.flatMap((authorization) =>
      buildManagedWorkspaceAuthorizationLookupKeys(authorization),
    ),
  )
  const normalizedIdentityIds = normalizeIdentityIds(
    normalizedAuthorizations.map((authorization) => authorization.identityId),
  )
  const normalizedWorkspaceIds = normalizeWorkspaceIds(
    normalizedAuthorizations.map((authorization) => authorization.workspaceId),
  )
  const normalizedWorkspaceRecordIds = normalizeWorkspaceRecordIds(
    normalizedAuthorizations.map(
      (authorization) => authorization.workspaceRecordId,
    ),
  )
  const workspaceClauses = [
    ...(normalizedWorkspaceIds.length
      ? [inArray(managedIdentitySessions.workspaceId, normalizedWorkspaceIds)]
      : []),
    ...(normalizedWorkspaceRecordIds.length
      ? [
          inArray(
            managedIdentitySessions.workspaceRecordId,
            normalizedWorkspaceRecordIds,
          ),
        ]
      : []),
  ]
  if (!workspaceClauses.length) {
    return new Map()
  }
  const workspaceWhere =
    workspaceClauses.length === 1
      ? workspaceClauses[0]
      : or(...workspaceClauses)

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
      workspaceRecordId: true,
      status: true,
      expiresAt: true,
      lastSeenAt: true,
    },
    orderBy: [desc(managedIdentitySessions.lastSeenAt)],
  })

  const summaries = new Map<string, ManagedWorkspaceAuthorizationSummary>()

  for (const row of rows) {
    const nextSummary = buildManagedWorkspaceAuthorizationSummary(row)
    for (const authorizationKey of buildManagedWorkspaceAuthorizationLookupKeys(
      {
        identityId: row.identityId,
        workspaceId: row.workspaceId,
        workspaceRecordId: row.workspaceRecordId,
      },
    )) {
      if (!requestedAuthorizationKeys.has(authorizationKey)) {
        continue
      }

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
      inviteStatus?: ManagedWorkspaceMemberInviteStatus | null
      invitedAt?: Date | null
      inviteStatusUpdatedAt?: Date | null
      identity?: ManagedIdentityLookupRow | null
    }>
  },
  authorizationsByWorkspaceIdentity: Map<
    string,
    ManagedWorkspaceAuthorizationSummary
  >,
): AdminManagedWorkspaceSummary {
  const teamTrialPaypalLink = resolveTeamTrialPaypalLinkState({
    paypalUrl: row.teamTrialPaypalUrl,
    capturedAt: row.teamTrialPaypalCapturedAt,
  })
  const members = row.members.map((member) => {
    return {
      id: member.id,
      email: member.email,
      identityId: member.identityId,
      identityLabel:
        member.identity?.label || member.identity?.email || member.email,
      authorization: resolveManagedWorkspaceAuthorizationSummaryForIdentity({
        identityId: member.identityId,
        workspaceId: row.workspaceId,
        workspaceRecordId: row.id,
        authorizationsByWorkspaceIdentity,
      }),
      inviteStatus:
        member.inviteStatus || DEFAULT_WORKSPACE_MEMBER_INVITE_STATUS,
      invitedAt: member.invitedAt?.toISOString() || null,
      inviteStatusUpdatedAt:
        member.inviteStatusUpdatedAt?.toISOString() || null,
    }
  })

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    label: row.label,
    teamTrialPaypalUrl: teamTrialPaypalLink.url,
    teamTrialPaypalCapturedAt: teamTrialPaypalLink.capturedAt,
    teamTrialPaypalExpiresAt: teamTrialPaypalLink.expiresAt,
    owner: buildManagedWorkspaceIdentitySummary(
      row.ownerIdentity,
      {
        workspaceId: row.workspaceId,
        workspaceRecordId: row.id,
      },
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
        ...readWorkspaceMemberInviteState(value),
        identityId,
        email,
      })
      continue
    }

    if (!deduped.has(`email:${email}`)) {
      deduped.set(`email:${email}`, {
        ...readWorkspaceMemberInviteState(value),
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

function readWorkspaceMemberInviteState(
  member: WorkspaceMemberInput,
): Pick<
  WorkspaceMemberInput,
  'inviteStatus' | 'invitedAt' | 'inviteStatusUpdatedAt'
> {
  return {
    inviteStatus: member.inviteStatus,
    invitedAt: member.invitedAt,
    inviteStatusUpdatedAt: member.inviteStatusUpdatedAt,
  }
}

function preserveWorkspaceMemberInviteStates(
  members: WorkspaceMemberInput[],
  existingMembers: WorkspaceMemberInput[],
): WorkspaceMemberInput[] {
  if (!members.length || !existingMembers.length) {
    return members
  }

  const existingByEmail = new Map(
    existingMembers.map((member) => [
      normalizeEmail(member.email),
      readWorkspaceMemberInviteState(member),
    ]),
  )

  return members.map((member) => ({
    ...existingByEmail.get(normalizeEmail(member.email)),
    ...member,
  }))
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
      status: true,
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
      status: true,
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
      inviteStatus: true,
      invitedAt: true,
      inviteStatusUpdatedAt: true,
    },
  })

  return normalizeWorkspaceMemberInputs(
    rows.map((row) => ({
      identityId: row.identityId,
      email: row.email,
      inviteStatus: row.inviteStatus,
      invitedAt: row.invitedAt,
      inviteStatusUpdatedAt: row.inviteStatusUpdatedAt,
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
      inviteStatus:
        member.inviteStatus || DEFAULT_WORKSPACE_MEMBER_INVITE_STATUS,
      invitedAt: member.invitedAt || null,
      inviteStatusUpdatedAt: member.inviteStatusUpdatedAt || seenAt,
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

  if (ownerIdentity.status === 'ARCHIVED') {
    throw new Error('Archived identities cannot own workspaces')
  }

  if (ownerIdentity.status === 'BANNED') {
    throw new Error('Banned identities cannot own workspaces')
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
                workspaceRecordId: row.id,
              },
            ]
          : []),
        ...row.members.flatMap((member) =>
          member.identityId
            ? [
                {
                  identityId: member.identityId,
                  workspaceId: row.workspaceId,
                  workspaceRecordId: row.id,
                },
              ]
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
              workspaceRecordId: row.id,
            },
          ]
        : []),
      ...row.members.flatMap((member) =>
        member.identityId
          ? [
              {
                identityId: member.identityId,
                workspaceId: row.workspaceId,
                workspaceRecordId: row.id,
              },
            ]
          : [],
      ),
    ])

  return buildAdminManagedWorkspaceSummary(
    row,
    authorizationsByWorkspaceIdentity,
  )
}

export async function findAdminManagedWorkspaceSummaryByOwnerIdentity(
  ownerIdentityId: string,
): Promise<AdminManagedWorkspaceSummary | null> {
  const identityId = normalizeOptionalIdentityId(ownerIdentityId)
  if (!identityId) {
    return null
  }

  const workspace = await getDb().query.managedWorkspaces.findFirst({
    where: eq(managedWorkspaces.ownerIdentityId, identityId),
    columns: {
      id: true,
    },
  })

  return workspace ? findAdminManagedWorkspaceSummary(workspace.id) : null
}

export async function listAdminManagedWorkspaceAssociationsForIdentity(
  identityId: string,
): Promise<AdminManagedIdentityWorkspaceAssociations> {
  const normalizedIdentityId = normalizeOptionalIdentityId(identityId)
  if (!normalizedIdentityId) {
    return {
      ownedWorkspaces: [],
      memberWorkspaces: [],
    }
  }

  const identity = await getDb().query.managedIdentities.findFirst({
    where: eq(managedIdentities.identityId, normalizedIdentityId),
    columns: {
      email: true,
    },
  })
  if (!identity) {
    return {
      ownedWorkspaces: [],
      memberWorkspaces: [],
    }
  }

  const identityEmail = normalizeEmail(identity.email)
  const workspaces = await listAdminManagedWorkspaceSummaries()
  const ownedWorkspaces: AdminManagedWorkspaceSummary[] = []
  const memberWorkspaces: AdminManagedIdentityMemberWorkspaceSummary[] = []

  for (const workspace of workspaces) {
    if (workspace.owner?.identityId === normalizedIdentityId) {
      ownedWorkspaces.push(workspace)
    }

    const member =
      workspace.members.find(
        (entry) => entry.identityId === normalizedIdentityId,
      ) ||
      workspace.members.find(
        (entry) => normalizeEmail(entry.email) === identityEmail,
      )

    if (member) {
      memberWorkspaces.push({
        workspace,
        member,
      })
    }
  }

  return {
    ownedWorkspaces,
    memberWorkspaces,
  }
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

export async function ensureManagedWorkspaceMemberIdentityCount(input: {
  id: string
  count?: number
}): Promise<AdminManagedWorkspaceSummary> {
  const managedWorkspaceId = input.id.trim()
  const count = input.count ?? MAX_MANAGED_WORKSPACE_MEMBER_COUNT
  if (!managedWorkspaceId) {
    throw new Error('Workspace id is required')
  }
  if (count < 1 || count > MAX_MANAGED_WORKSPACE_MEMBER_COUNT) {
    throw new Error(
      `A workspace can include at most ${MAX_MANAGED_WORKSPACE_MEMBER_COUNT} member identities.`,
    )
  }

  const db = getDb()
  const workspace = await db.query.managedWorkspaces.findFirst({
    where: eq(managedWorkspaces.id, managedWorkspaceId),
    with: {
      ownerIdentity: {
        columns: {
          identityId: true,
          email: true,
          label: true,
          passwordCiphertext: true,
          status: true,
        },
      },
      members: {
        with: {
          identity: {
            columns: {
              identityId: true,
              email: true,
              passwordCiphertext: true,
              status: true,
            },
          },
        },
        orderBy: [asc(managedWorkspaceMembers.email)],
      },
    },
  })

  if (!workspace) {
    throw new Error('Workspace not found')
  }

  const ownerIdentity = workspace.ownerIdentity
  if (!ownerIdentity) {
    throw new Error('Workspace owner identity is required')
  }
  if (ownerIdentity.status !== 'ACTIVE' || !ownerIdentity.passwordCiphertext) {
    throw new Error(
      'Workspace owner must be an active managed identity with a shared password',
    )
  }

  const currentMembers = workspace.members
    .filter(
      (member) =>
        member.identity &&
        member.identity.status === 'ACTIVE' &&
        Boolean(member.identity.passwordCiphertext),
    )
    .map((member) => ({
      identityId: member.identity?.identityId || null,
      email: member.identity?.email || member.email,
      inviteStatus: member.inviteStatus,
      invitedAt: member.invitedAt,
      inviteStatusUpdatedAt: member.inviteStatusUpdatedAt,
    }))
    .slice(0, count)

  if (currentMembers.length === count) {
    return findAdminManagedWorkspaceSummary(managedWorkspaceId).then(
      (summary) => {
        if (!summary) {
          throw new Error('Unable to load workspace')
        }
        return summary
      },
    )
  }

  const selectedIdentityIds = new Set(
    currentMembers
      .map((member) => member.identityId)
      .filter((identityId): identityId is string => Boolean(identityId)),
  )
  const selectedEmails = new Set(
    currentMembers.map((member) => normalizeEmail(member.email)),
  )
  selectedIdentityIds.add(ownerIdentity.identityId)
  selectedEmails.add(normalizeEmail(ownerIdentity.email))

  const ownerRows = await db.query.managedWorkspaces.findMany({
    columns: {
      id: true,
      ownerIdentityId: true,
    },
  })
  const memberRows = await db.query.managedWorkspaceMembers.findMany({
    columns: {
      managedWorkspaceId: true,
      identityId: true,
      email: true,
    },
  })
  const unavailableIdentityIds = new Set<string>(selectedIdentityIds)
  const unavailableEmails = new Set<string>(selectedEmails)

  for (const row of ownerRows) {
    if (row.ownerIdentityId && row.id !== managedWorkspaceId) {
      unavailableIdentityIds.add(row.ownerIdentityId)
    }
  }

  for (const row of memberRows) {
    if (row.managedWorkspaceId === managedWorkspaceId) {
      continue
    }
    if (row.identityId) {
      unavailableIdentityIds.add(row.identityId)
    }
    unavailableEmails.add(normalizeEmail(row.email))
  }

  const candidates = await db.query.managedIdentities.findMany({
    where: and(
      eq(managedIdentities.status, 'ACTIVE'),
      isNotNull(managedIdentities.passwordCiphertext),
    ),
    columns: {
      identityId: true,
      email: true,
    },
    orderBy: [desc(managedIdentities.createdAt), desc(managedIdentities.id)],
  })
  const replacements: WorkspaceMemberInput[] = []

  for (const candidate of candidates) {
    const email = normalizeEmail(candidate.email)
    if (
      unavailableIdentityIds.has(candidate.identityId) ||
      unavailableEmails.has(email)
    ) {
      continue
    }

    replacements.push({
      identityId: candidate.identityId,
      email,
    })
    unavailableIdentityIds.add(candidate.identityId)
    unavailableEmails.add(email)

    if (currentMembers.length + replacements.length >= count) {
      break
    }
  }

  if (currentMembers.length + replacements.length < count) {
    throw new Error(
      `Not enough active managed identities with shared passwords are available to keep ${count} workspace members.`,
    )
  }

  const nextMembers = [...currentMembers, ...replacements]
  validateManagedWorkspaceMembership({
    ownerIdentity,
    members: nextMembers,
  })
  await replaceWorkspaceMembers(managedWorkspaceId, nextMembers)
  await db
    .update(managedWorkspaces)
    .set({
      updatedAt: new Date(),
    })
    .where(eq(managedWorkspaces.id, managedWorkspaceId))

  const summary = await findAdminManagedWorkspaceSummary(managedWorkspaceId)
  if (!summary) {
    throw new Error('Unable to load updated workspace')
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

function readResultStringArray(
  source: Record<string, unknown>,
  key: string,
): string[] {
  const value = source[key]
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === 'string')
  ) {
    return []
  }

  return value
}

export async function recordWorkspaceInvitesFromFlowTask(input: {
  payload?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
  capturedAt?: Date
}): Promise<AdminManagedWorkspaceSummary | null> {
  if (!isRecord(input.payload) || input.payload.flowId !== 'chatgpt-invite') {
    return null
  }

  if (!isRecord(input.result)) {
    return null
  }

  const invites = isRecord(input.result.invites)
    ? input.result.invites
    : input.result
  const confirmedInviteEmails = normalizeWorkspaceMemberEmails(
    readResultStringArray(invites, 'invitedEmails'),
  )
  const failedInviteEmails = normalizeWorkspaceMemberEmails(
    readResultStringArray(invites, 'erroredEmails'),
  ).filter((email) => !confirmedInviteEmails.includes(email))
  if (!confirmedInviteEmails.length && !failedInviteEmails.length) {
    return null
  }

  const metadata = isRecord(input.payload.metadata)
    ? input.payload.metadata
    : null
  const metadataWorkspace =
    metadata && isRecord(metadata.workspace) ? metadata.workspace : null
  const workspaceRecordId = normalizeOptionalMetadataString(
    metadataWorkspace?.recordId,
  )
  const workspaceId =
    normalizeOptionalMetadataString(input.result.workspaceId) ||
    normalizeOptionalMetadataString(invites.accountId) ||
    normalizeOptionalMetadataString(metadataWorkspace?.workspaceId)
  const where =
    workspaceRecordId !== null
      ? eq(managedWorkspaces.id, workspaceRecordId)
      : workspaceId !== null
        ? eq(managedWorkspaces.workspaceId, workspaceId)
        : null
  if (!where) {
    return null
  }

  const workspace = await getDb().query.managedWorkspaces.findFirst({
    where,
    columns: {
      id: true,
    },
  })
  if (!workspace) {
    return null
  }

  const capturedAt = input.capturedAt || new Date()
  await markManagedWorkspaceMemberInviteStatus({
    workspaceRecordId: workspace.id,
    emails: failedInviteEmails,
    status: 'FAILED',
    seenAt: capturedAt,
  })
  await markManagedWorkspaceMemberInviteStatus({
    workspaceRecordId: workspace.id,
    emails: confirmedInviteEmails,
    status: 'INVITED',
    seenAt: capturedAt,
  })

  return findAdminManagedWorkspaceSummary(workspace.id)
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
  const currentMemberInputs = await listWorkspaceMemberInputs(existing.id)
  const nextMemberInputs =
    input.memberIdentityIds !== undefined || input.memberEmails !== undefined
      ? preserveWorkspaceMemberInviteStates(
          await resolveWorkspaceMemberInputs({
            memberIdentityIds: input.memberIdentityIds,
            memberEmails: input.memberEmails,
          }),
          currentMemberInputs,
        )
      : currentMemberInputs

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

export async function deleteManagedWorkspaceForOwnerIdentity(
  ownerIdentityId: string,
) {
  const identityId = normalizeOptionalIdentityId(ownerIdentityId)
  if (!identityId) {
    return null
  }

  const workspace = await getDb().query.managedWorkspaces.findFirst({
    where: eq(managedWorkspaces.ownerIdentityId, identityId),
    columns: {
      id: true,
    },
  })

  if (!workspace) {
    return null
  }

  return deleteManagedWorkspace(workspace.id)
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
          ? or(
              eq(managedIdentitySessions.workspaceId, workspace.workspaceId),
              eq(managedIdentitySessions.workspaceRecordId, workspace.id),
            )
          : eq(managedIdentitySessions.workspaceRecordId, workspace.id),
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

export async function markManagedWorkspaceMemberInviteStatus(input: {
  workspaceRecordId: string
  emails: string[]
  status: ManagedWorkspaceMemberInviteStatus
  seenAt?: Date
}): Promise<void> {
  const workspaceRecordId = input.workspaceRecordId.trim()
  const emails = normalizeWorkspaceMemberEmails(input.emails)
  if (!workspaceRecordId || !emails.length) {
    return
  }

  const seenAt = input.seenAt || new Date()
  const patch = {
    inviteStatus: input.status,
    inviteStatusUpdatedAt: seenAt,
    updatedAt: seenAt,
    ...(input.status === 'INVITED' ? { invitedAt: seenAt } : {}),
  }
  const baseWhere = and(
    eq(managedWorkspaceMembers.managedWorkspaceId, workspaceRecordId),
    inArray(managedWorkspaceMembers.email, emails),
  )
  const where =
    input.status === 'PENDING' || input.status === 'FAILED'
      ? and(
          baseWhere,
          notInArray(managedWorkspaceMembers.inviteStatus, ['INVITED']),
        )
      : baseWhere

  await getDb().update(managedWorkspaceMembers).set(patch).where(where)
}

export async function syncManagedWorkspaceInvite(input: {
  workspaceId: string
  label?: string | null
  ownerIdentityId?: string | null
  memberIdentityIds?: string[]
  memberEmails?: string[]
  confirmedInviteEmails?: string[]
  failedInviteEmails?: string[]
}): Promise<AdminManagedWorkspaceSummary> {
  const workspaceId = normalizeWorkspaceId(input.workspaceId)
  if (!workspaceId) {
    throw new Error('workspaceId is required')
  }

  const seenAt = new Date()
  const confirmedInviteEmails = normalizeWorkspaceMemberEmails(
    input.confirmedInviteEmails || [],
  )
  const failedInviteEmails = normalizeWorkspaceMemberEmails(
    input.failedInviteEmails || [],
  ).filter((email) => !confirmedInviteEmails.includes(email))
  const requestedOwnerIdentityId =
    input.ownerIdentityId === undefined
      ? undefined
      : normalizeOptionalIdentityId(input.ownerIdentityId)
  let existing = await getDb().query.managedWorkspaces.findFirst({
    where: eq(managedWorkspaces.workspaceId, workspaceId),
    columns: {
      id: true,
      workspaceId: true,
      label: true,
      ownerIdentityId: true,
    },
  })

  if (!existing && requestedOwnerIdentityId) {
    existing = await getDb().query.managedWorkspaces.findFirst({
      where: eq(managedWorkspaces.ownerIdentityId, requestedOwnerIdentityId),
      columns: {
        id: true,
        workspaceId: true,
        label: true,
        ownerIdentityId: true,
      },
    })
  }

  const ownerIdentityId: string | null =
    input.ownerIdentityId === undefined
      ? existing?.ownerIdentityId || null
      : requestedOwnerIdentityId || null
  const ownerIdentity = await resolveManagedWorkspaceOwner(ownerIdentityId)
  const currentMemberInputs = existing
    ? await listWorkspaceMemberInputs(existing.id)
    : []
  const incomingMemberInputs = preserveWorkspaceMemberInviteStates(
    await resolveWorkspaceMemberInputs({
      memberIdentityIds: input.memberIdentityIds,
      memberEmails: [
        ...(input.memberEmails || []),
        ...confirmedInviteEmails,
        ...failedInviteEmails,
      ],
    }),
    currentMemberInputs,
  )
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
        workspaceId,
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
  await markManagedWorkspaceMemberInviteStatus({
    workspaceRecordId: managedWorkspaceId,
    emails: failedInviteEmails,
    status: 'FAILED',
    seenAt,
  })
  await markManagedWorkspaceMemberInviteStatus({
    workspaceRecordId: managedWorkspaceId,
    emails: confirmedInviteEmails,
    status: 'INVITED',
    seenAt,
  })

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
