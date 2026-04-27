import { useEffect, useMemo, useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  CalendarIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  RefreshCcwIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
  UserRoundIcon,
  UsersIcon,
} from 'lucide-react'

import {
  AdminPageHeader,
  EmptyState,
  formatAdminDate,
} from '#/components/admin/layout'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { CopyableValue } from '#/components/ui/copyable-value'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { ScrollArea } from '#/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import type { RandomWorkspaceMemberConflict } from '#/lib/admin/workspace-editor-random'
import {
  getLatestWorkspaceOwnerIdentity,
  getOtherWorkspaceOwnerWorkspace,
  getRandomWorkspaceMemberSelection,
  hasOtherWorkspaceAssociations,
  isWorkspaceSelectableIdentity,
} from '#/lib/admin/workspace-editor-random'
import { translateStatusLabel } from '#/lib/i18n'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

const MAX_WORKSPACE_MEMBER_COUNT = 9
const WORKSPACE_REFRESH_INTERVAL_MS = 10000

const loadAdminWorkspaces = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [
      { getRequest },
      { requireAdminPermission },
      { listAdminManagedWorkspaceSummaries },
      { listAdminIdentitySummaries },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../lib/server/auth'),
      import('../../lib/server/workspaces'),
      import('../../lib/server/identities'),
    ])

    const request = getRequest()

    try {
      await requireAdminPermission(request, 'MANAGED_IDENTITIES')
    } catch {
      return { authorized: false as const }
    }

    let canDispatchFlows = false
    try {
      await requireAdminPermission(request, 'CLI_OPERATIONS')
      canDispatchFlows = true
    } catch {
      canDispatchFlows = false
    }

    return {
      authorized: true as const,
      canDispatchFlows,
      workspaces: await listAdminManagedWorkspaceSummaries(),
      identitySummaries: await listAdminIdentitySummaries(),
    }
  },
)

export const Route = createFileRoute('/admin/workspaces')({
  loader: async () => loadAdminWorkspaces(),
  component: AdminWorkspacesPage,
})

type IdentitySummary = {
  id: string
  label: string
  account?: string | null
  status?: string | null
  createdAt?: string | null
}

type WorkspaceIdentitySummary = {
  identityId: string
  email: string
  identityLabel: string
  authorization: WorkspaceAuthorizationSummary
}

type WorkspaceMemberSummary = {
  id: string
  email: string
  identityId?: string | null
  identityLabel?: string | null
  authorization: WorkspaceAuthorizationSummary
  inviteStatus?: WorkspaceInviteStatus
  invitedAt?: string | null
  inviteStatusUpdatedAt?: string | null
}

type WorkspaceInviteStatus = 'NOT_INVITED' | 'PENDING' | 'INVITED' | 'FAILED'

type WorkspaceAuthorizationState =
  | 'authorized'
  | 'expired'
  | 'revoked'
  | 'missing'

type WorkspaceAuthorizationSummary = {
  state: WorkspaceAuthorizationState
  expiresAt?: string | null
  lastSeenAt?: string | null
}

type WorkspaceSummary = {
  id: string
  workspaceId: string | null
  label?: string | null
  teamTrialPaypalUrl?: string | null
  teamTrialPaypalCapturedAt?: string | null
  owner?: WorkspaceIdentitySummary | null
  memberCount: number
  members: WorkspaceMemberSummary[]
  createdAt: string
  updatedAt: string
}

type SaveWorkspaceResponse = {
  ok: boolean
  workspace: WorkspaceSummary
}

type DeleteWorkspaceResponse = {
  ok: boolean
  id: string
}

type DispatchWorkspaceInviteResponse = {
  ok: boolean
  mode: 'dispatch' | 'request'
  memberEmails: string[]
  queuedCount?: number
  assignedCliCount?: number
  connectionLabel?: string
  requestId?: string
}

type DispatchWorkspaceCodexOAuthResponse = {
  ok: boolean
  mode: 'dispatch' | 'request'
  memberEmails: string[]
  queuedCount?: number
  assignedCliCount?: number
  connectionLabel?: string
  requestId?: string
}

type DispatchWorkspaceTeamTrialResponse = {
  ok: boolean
  mode: 'dispatch' | 'request'
  ownerEmail: string
  queuedCount?: number
  assignedCliCount?: number
  connectionLabel?: string
  requestId?: string
}

type ResetWorkspaceAuthorizationResponse = {
  ok: boolean
  workspace: WorkspaceSummary
  resetCount: number
}

type FlashMessage = {
  kind: 'success' | 'error'
  message: string
}

type PendingAuthorizationReset =
  | {
      scope: 'all'
      memberIds?: undefined
      memberLabel?: undefined
    }
  | {
      scope: 'member'
      memberIds: string[]
      memberLabel: string
    }

type RandomMemberConfirmationState = {
  identityIds: string[]
  conflicts: RandomWorkspaceMemberConflict[]
}

type WorkspaceEditorState = {
  id?: string
  workspaceId: string
  label: string
  ownerIdentityId: string
  memberIdentityIds: string[]
  legacyMemberEmails: string[]
}

function createDefaultWorkspaceLabel() {
  const now = new Date()
  return formatAdminDate(now) || now.toISOString()
}

function createWorkspaceEditorState(
  summary?: WorkspaceSummary | null,
): WorkspaceEditorState {
  const members = summary?.members ?? []

  return {
    id: summary?.id,
    workspaceId: summary?.workspaceId || '',
    label: summary ? summary.label || '' : createDefaultWorkspaceLabel(),
    ownerIdentityId: summary?.owner?.identityId || '',
    memberIdentityIds: members.flatMap((member) =>
      member.identityId ? [member.identityId] : [],
    ),
    legacyMemberEmails: members
      .flatMap((member) => (member.identityId ? [] : [member.email]))
      .filter(Boolean),
  }
}

function sortWorkspaceSummaries(workspaces: WorkspaceSummary[]) {
  return [...workspaces].sort((left, right) => {
    return (
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    )
  })
}

function upsertWorkspaceSummary(
  current: WorkspaceSummary[],
  workspace: WorkspaceSummary,
) {
  return sortWorkspaceSummaries([
    workspace,
    ...current.filter((entry) => entry.id !== workspace.id),
  ])
}

function filterWorkspaceSummaries(
  workspaces: WorkspaceSummary[],
  query: string,
): WorkspaceSummary[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return workspaces
  }

  return workspaces.filter((workspace) => {
    const searchableValues = [
      workspace.label,
      workspace.workspaceId,
      workspace.owner?.identityId,
      workspace.owner?.identityLabel,
      workspace.owner?.email,
      ...workspace.members.flatMap((member) => [
        member.email,
        member.identityId,
        member.identityLabel,
      ]),
    ]

    return searchableValues.some((value) =>
      String(value || '')
        .toLowerCase()
        .includes(normalizedQuery),
    )
  })
}

function filterIdentitySummaries(
  identities: IdentitySummary[],
  query: string,
): IdentitySummary[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return identities
  }

  return identities.filter((identity) => {
    const searchableValues = [
      identity.id,
      identity.label,
      identity.account,
      identity.status,
    ]

    return searchableValues.some((value) =>
      String(value || '')
        .toLowerCase()
        .includes(normalizedQuery),
    )
  })
}

function normalizeIdentityAccount(value?: string | null) {
  return value?.trim().toLowerCase() || ''
}

function getWorkspaceDisplayLabel(
  workspace?: { label?: string | null } | null,
) {
  return workspace?.label || m.admin_workspace_unnamed_label()
}

function getWorkspaceIdDisplayValue(workspaceId?: string | null) {
  return workspaceId || m.admin_workspace_id_missing_value()
}

function isWorkspaceAuthorized(
  authorization?: WorkspaceAuthorizationSummary | null,
) {
  return authorization?.state === 'authorized'
}

function canResetWorkspaceAuthorization(
  authorization?: WorkspaceAuthorizationSummary | null,
  identityId?: string | null,
) {
  return Boolean(
    identityId && authorization?.state && authorization.state !== 'missing',
  )
}

function getWorkspaceAuthorizationLabel(
  authorization?: WorkspaceAuthorizationSummary | null,
) {
  const state = authorization?.state || 'missing'

  if (state === 'authorized') {
    return m.admin_workspace_authorization_authorized()
  }

  if (state === 'expired') {
    return m.admin_workspace_authorization_expired()
  }

  if (state === 'revoked') {
    return m.admin_workspace_authorization_revoked()
  }

  return m.admin_workspace_authorization_missing()
}

function getWorkspaceAuthorizationBadgeClassName(
  authorization?: WorkspaceAuthorizationSummary | null,
) {
  const state = authorization?.state || 'missing'

  if (state === 'authorized') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
  }

  if (state === 'expired') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700'
  }

  if (state === 'revoked') {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-700'
  }

  return 'border-muted-foreground/20 bg-muted/40 text-muted-foreground'
}

function WorkspaceAuthorizationBadge(props: {
  authorization?: WorkspaceAuthorizationSummary | null
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'border px-2.5 py-1 text-xs font-medium',
        getWorkspaceAuthorizationBadgeClassName(props.authorization),
      )}
    >
      {getWorkspaceAuthorizationLabel(props.authorization)}
    </Badge>
  )
}

function getWorkspaceInviteStatusLabel(status?: WorkspaceInviteStatus | null) {
  if (status === 'INVITED') {
    return m.admin_workspace_invitation_invited()
  }

  if (status === 'PENDING') {
    return m.admin_workspace_invitation_pending()
  }

  if (status === 'FAILED') {
    return m.admin_workspace_invitation_failed()
  }

  return m.admin_workspace_invitation_not_invited()
}

function getWorkspaceInviteStatusBadgeClassName(
  status?: WorkspaceInviteStatus | null,
) {
  if (status === 'INVITED') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-700'
  }

  if (status === 'PENDING') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700'
  }

  if (status === 'FAILED') {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-700'
  }

  return 'border-muted-foreground/20 bg-muted/40 text-muted-foreground'
}

function WorkspaceInviteStatusBadge(props: {
  status?: WorkspaceInviteStatus | null
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'border px-2.5 py-1 text-xs font-medium',
        getWorkspaceInviteStatusBadgeClassName(props.status),
      )}
    >
      {getWorkspaceInviteStatusLabel(props.status)}
    </Badge>
  )
}

function escapeCsvValue(value: string) {
  const normalizedValue = value.replaceAll('"', '""')
  return /[",\r\n]/.test(normalizedValue)
    ? `"${normalizedValue}"`
    : normalizedValue
}

function normalizeDownloadEmails(values: Iterable<string>): string[] {
  const dedupedEmails = new Set<string>()
  const emails: string[] = []

  for (const value of values) {
    const email = value.trim()
    if (!email) {
      continue
    }

    const dedupeKey = email.toLowerCase()
    if (dedupedEmails.has(dedupeKey)) {
      continue
    }

    dedupedEmails.add(dedupeKey)
    emails.push(email)
  }

  return emails
}

function toDownloadSlug(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'workspace'
}

function downloadWorkspaceEmailsCsv(params: {
  workspace: WorkspaceSummary
  values: string[]
  fileSuffix: 'owner-and-members' | 'members'
}): number {
  const emails = normalizeDownloadEmails(params.values)
  const rows = ['email', ...emails.map((value) => escapeCsvValue(value))]
  const blob = new Blob([`${rows.join('\n')}\n`], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const slug = toDownloadSlug(
    params.workspace.label || params.workspace.workspaceId || 'workspace',
  )

  link.href = url
  link.download = `${slug}-${params.fileSuffix}-emails.csv`
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)

  return emails.length
}

async function readResponseError(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  return body.trim() || m.admin_workspace_save_error_fallback()
}

async function saveWorkspace(
  editor: WorkspaceEditorState,
): Promise<WorkspaceSummary> {
  const response = await fetch('/api/admin/workspaces', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'save',
      id: editor.id,
      workspaceId: editor.workspaceId,
      label: editor.label,
      ownerIdentityId: editor.ownerIdentityId,
      memberIdentityIds: editor.memberIdentityIds,
      memberEmails: editor.legacyMemberEmails,
    }),
  })

  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }

  const payload = (await response.json()) as SaveWorkspaceResponse
  return payload.workspace
}

async function deleteWorkspace(id: string): Promise<string> {
  const response = await fetch('/api/admin/workspaces', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'delete',
      id,
    }),
  })

  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }

  const payload = (await response.json()) as DeleteWorkspaceResponse
  return payload.id
}

async function dispatchWorkspaceInvite(
  workspaceId: string,
  memberIds?: string[],
): Promise<DispatchWorkspaceInviteResponse> {
  const response = await fetch(
    `/api/admin/workspaces/${encodeURIComponent(workspaceId)}/invite`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memberIds,
      }),
    },
  )

  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }

  return (await response.json()) as DispatchWorkspaceInviteResponse
}

async function dispatchWorkspaceCodexOAuth(
  workspaceId: string,
  memberIds?: string[],
): Promise<DispatchWorkspaceCodexOAuthResponse> {
  const response = await fetch(
    `/api/admin/workspaces/${encodeURIComponent(workspaceId)}/codex-oauth`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memberIds,
      }),
    },
  )

  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }

  return (await response.json()) as DispatchWorkspaceCodexOAuthResponse
}

async function dispatchWorkspaceTeamTrial(
  workspaceId: string,
): Promise<DispatchWorkspaceTeamTrialResponse> {
  const response = await fetch(
    `/api/admin/workspaces/${encodeURIComponent(workspaceId)}/team-trial`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  )

  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }

  return (await response.json()) as DispatchWorkspaceTeamTrialResponse
}

async function resetWorkspaceAuthorizationStatuses(
  workspaceId: string,
  memberIds?: string[],
): Promise<ResetWorkspaceAuthorizationResponse> {
  const response = await fetch(
    `/api/admin/workspaces/${encodeURIComponent(workspaceId)}/reset-authorization`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memberIds,
      }),
    },
  )

  if (!response.ok) {
    throw new Error(await readResponseError(response))
  }

  return (await response.json()) as ResetWorkspaceAuthorizationResponse
}

function WorkspaceMembersPreview(props: { workspace: WorkspaceSummary }) {
  if (!props.workspace.members.length) {
    return (
      <span className="text-sm text-muted-foreground">{m.oauth_none()}</span>
    )
  }

  const visibleMembers = props.workspace.members.slice(0, 2)
  const hiddenCount = props.workspace.members.length - visibleMembers.length

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {visibleMembers.map((member) => (
          <Badge key={member.id} variant="secondary" className="max-w-full">
            <span className="truncate">
              {member.identityLabel || member.email}
            </span>
          </Badge>
        ))}
        {hiddenCount > 0 ? (
          <Badge variant="outline">
            {m.admin_workspace_member_more({
              count: String(hiddenCount),
            })}
          </Badge>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground">
        {props.workspace.memberCount} {m.admin_workspace_members_label()}
      </div>
    </div>
  )
}

function SelectedMemberBadges(props: {
  identityById: Map<string, IdentitySummary>
  memberIdentityIds: string[]
  legacyMemberEmails: string[]
}) {
  if (!props.memberIdentityIds.length && !props.legacyMemberEmails.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {m.admin_workspace_members_none_selected()}
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {props.memberIdentityIds.map((identityId) => {
        const identity = props.identityById.get(identityId)
        return (
          <Badge key={identityId} variant="secondary" className="max-w-full">
            <span className="truncate">
              {identity?.label || identity?.account || identityId}
            </span>
          </Badge>
        )
      })}
      {props.legacyMemberEmails.map((email) => (
        <Badge key={email} variant="outline" className="max-w-full">
          <span className="truncate">{email}</span>
        </Badge>
      ))}
    </div>
  )
}

function mergeWorkspaceMemberIdentityIds(values: Iterable<string>): string[] {
  const deduped = new Set<string>()
  const identityIds: string[] = []

  for (const value of values) {
    const identityId = value.trim()
    if (!identityId || deduped.has(identityId)) {
      continue
    }

    deduped.add(identityId)
    identityIds.push(identityId)
  }

  return identityIds.slice(0, MAX_WORKSPACE_MEMBER_COUNT)
}

function WorkspaceEditorDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editor: WorkspaceEditorState
  onEditorChange: (
    updater:
      | WorkspaceEditorState
      | ((current: WorkspaceEditorState) => WorkspaceEditorState),
  ) => void
  identities: IdentitySummary[]
  workspaces: WorkspaceSummary[]
  isSaving: boolean
  onSave: () => Promise<void>
}) {
  const [ownerQuery, setOwnerQuery] = useState('')
  const [memberQuery, setMemberQuery] = useState('')
  const [pendingRandomMembers, setPendingRandomMembers] =
    useState<RandomMemberConfirmationState | null>(null)

  useEffect(() => {
    if (!props.open) {
      return
    }

    setOwnerQuery('')
    setMemberQuery('')
    setPendingRandomMembers(null)
  }, [props.editor.id, props.open])

  const identityById = useMemo(
    () => new Map(props.identities.map((identity) => [identity.id, identity])),
    [props.identities],
  )
  const selectableIdentities = useMemo(
    () => props.identities.filter(isWorkspaceSelectableIdentity),
    [props.identities],
  )
  const ownerWorkspaceByIdentityId = useMemo(() => {
    return new Map(
      props.workspaces.flatMap((workspace) =>
        workspace.owner?.identityId
          ? [[workspace.owner.identityId, workspace] as const]
          : [],
      ),
    )
  }, [props.workspaces])
  const memberWorkspacesByIdentityId = useMemo(() => {
    const entries = new Map<string, WorkspaceSummary[]>()

    for (const workspace of props.workspaces) {
      for (const member of workspace.members) {
        if (!member.identityId) {
          continue
        }

        const memberWorkspaces = entries.get(member.identityId) || []

        if (!memberWorkspaces.some((entry) => entry.id === workspace.id)) {
          memberWorkspaces.push(workspace)
        }

        entries.set(member.identityId, memberWorkspaces)
      }
    }

    return entries
  }, [props.workspaces])
  const memberWorkspacesByAccount = useMemo(() => {
    const entries = new Map<string, WorkspaceSummary[]>()

    for (const workspace of props.workspaces) {
      for (const member of workspace.members) {
        const account = normalizeIdentityAccount(member.email)
        if (!account) {
          continue
        }

        const memberWorkspaces = entries.get(account) || []

        if (!memberWorkspaces.some((entry) => entry.id === workspace.id)) {
          memberWorkspaces.push(workspace)
        }

        entries.set(account, memberWorkspaces)
      }
    }

    return entries
  }, [props.workspaces])
  const ownerPickerIdentities = useMemo(() => {
    return selectableIdentities.filter((identity) => {
      const hasOtherIdentityAssociation = hasOtherWorkspaceAssociations(
        identity.id,
        ownerWorkspaceByIdentityId,
        memberWorkspacesByIdentityId,
        props.editor.id,
      )
      if (hasOtherIdentityAssociation) {
        return false
      }

      const account = normalizeIdentityAccount(identity.account)
      const otherAccountMemberWorkspaces = account
        ? memberWorkspacesByAccount
            .get(account)
            ?.some((workspace) => workspace.id !== props.editor.id)
        : false

      return !otherAccountMemberWorkspaces
    })
  }, [
    memberWorkspacesByAccount,
    memberWorkspacesByIdentityId,
    ownerWorkspaceByIdentityId,
    props.editor.id,
    selectableIdentities,
  ])
  useEffect(() => {
    const ownerIdentityId = props.editor.ownerIdentityId
    if (!props.open || props.editor.id || !ownerIdentityId) {
      return
    }

    if (
      ownerPickerIdentities.some((identity) => identity.id === ownerIdentityId)
    ) {
      return
    }

    props.onEditorChange((current) =>
      current.ownerIdentityId === ownerIdentityId
        ? {
            ...current,
            ownerIdentityId: '',
          }
        : current,
    )
  }, [
    ownerPickerIdentities,
    props.editor.id,
    props.editor.ownerIdentityId,
    props.onEditorChange,
    props.open,
  ])
  const memberPickerIdentities = selectableIdentities
  const selectedMemberIds = useMemo(
    () => new Set(props.editor.memberIdentityIds),
    [props.editor.memberIdentityIds],
  )
  const filteredOwnerIdentities = useMemo(
    () => filterIdentitySummaries(ownerPickerIdentities, ownerQuery),
    [ownerPickerIdentities, ownerQuery],
  )
  const filteredMemberIdentities = useMemo(
    () => filterIdentitySummaries(memberPickerIdentities, memberQuery),
    [memberPickerIdentities, memberQuery],
  )
  const selectedOwner = props.editor.ownerIdentityId
    ? identityById.get(props.editor.ownerIdentityId) || null
    : null
  const selectedMemberCount =
    props.editor.memberIdentityIds.length +
    props.editor.legacyMemberEmails.length
  const memberCapReached = selectedMemberCount >= MAX_WORKSPACE_MEMBER_COUNT
  const remainingMemberSlots = Math.max(
    0,
    MAX_WORKSPACE_MEMBER_COUNT - selectedMemberCount,
  )
  const canChooseLatestOwner =
    !props.editor.id && ownerPickerIdentities.length > 0
  const canRandomizeMembers =
    !props.editor.id &&
    Boolean(props.editor.ownerIdentityId) &&
    memberPickerIdentities.some(
      (identity) => identity.id !== props.editor.ownerIdentityId,
    )
  const canRandomlySupplementMembers =
    Boolean(props.editor.ownerIdentityId) &&
    remainingMemberSlots > 0 &&
    memberPickerIdentities.some(
      (identity) =>
        identity.id !== props.editor.ownerIdentityId &&
        !selectedMemberIds.has(identity.id),
    )

  function setEditor(
    updater:
      | WorkspaceEditorState
      | ((current: WorkspaceEditorState) => WorkspaceEditorState),
  ) {
    props.onEditorChange(updater)
  }

  function selectOwner(identityId: string) {
    setEditor((current) => ({
      ...current,
      ownerIdentityId: identityId,
      memberIdentityIds: current.memberIdentityIds.filter(
        (entry) => entry !== identityId,
      ),
    }))
  }

  function toggleMember(identityId: string) {
    setEditor((current) => {
      const isSelected = current.memberIdentityIds.includes(identityId)
      if (isSelected) {
        return {
          ...current,
          memberIdentityIds: current.memberIdentityIds.filter(
            (entry) => entry !== identityId,
          ),
        }
      }

      if (
        current.memberIdentityIds.length + current.legacyMemberEmails.length >=
        MAX_WORKSPACE_MEMBER_COUNT
      ) {
        return current
      }

      return {
        ...current,
        memberIdentityIds: [...current.memberIdentityIds, identityId],
      }
    })
  }

  function chooseLatestOwner() {
    const nextOwner = getLatestWorkspaceOwnerIdentity({
      identities: ownerPickerIdentities,
      ownerWorkspaceByIdentityId,
      memberWorkspacesByIdentityId,
      currentWorkspaceId: props.editor.id,
    })

    if (!nextOwner) {
      return
    }

    selectOwner(nextOwner.id)
  }

  function randomizeMembers(mode: 'replace' | 'supplement') {
    if (!props.editor.ownerIdentityId) {
      return
    }

    const identities =
      mode === 'supplement'
        ? memberPickerIdentities.filter(
            (identity) => !selectedMemberIds.has(identity.id),
          )
        : memberPickerIdentities
    const selection = getRandomWorkspaceMemberSelection({
      identities,
      ownerIdentityId: props.editor.ownerIdentityId,
      ownerWorkspaceByIdentityId,
      memberWorkspacesByIdentityId,
      currentWorkspaceId: props.editor.id,
      count:
        mode === 'supplement'
          ? remainingMemberSlots
          : MAX_WORKSPACE_MEMBER_COUNT,
    })
    const nextSelection = {
      ...selection,
      identityIds:
        mode === 'supplement'
          ? mergeWorkspaceMemberIdentityIds([
              ...props.editor.memberIdentityIds,
              ...selection.identityIds,
            ])
          : selection.identityIds,
    }

    if (selection.conflicts.length) {
      setPendingRandomMembers(nextSelection)
      return
    }

    setEditor((current) => ({
      ...current,
      memberIdentityIds: nextSelection.identityIds,
    }))
  }

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={(open) => {
          if (!props.isSaving) {
            props.onOpenChange(open)
          }
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-[min(1080px,calc(100%-2rem))] overflow-y-auto sm:max-w-[min(1080px,calc(100%-2rem))]">
          <DialogHeader>
            <DialogTitle>
              {props.editor.id
                ? m.admin_workspace_dialog_edit_title()
                : m.admin_workspace_dialog_create_title()}
            </DialogTitle>
            <DialogDescription>
              {m.admin_workspace_dialog_description()}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">
                  {m.admin_workspace_id_label()}
                </span>
                <Input
                  value={props.editor.workspaceId}
                  placeholder={m.admin_workspace_id_placeholder()}
                  onChange={(event) => {
                    setEditor((current) => ({
                      ...current,
                      workspaceId: event.target.value,
                    }))
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {m.admin_workspace_id_description()}
                </p>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium">
                  {m.admin_workspace_label_label()}
                </span>
                <Input
                  value={props.editor.label}
                  placeholder={m.admin_workspace_label_placeholder()}
                  onChange={(event) => {
                    setEditor((current) => ({
                      ...current,
                      label: event.target.value,
                    }))
                  }}
                />
              </label>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <UserRoundIcon className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">
                  {m.admin_workspace_owner_label()}
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">
                {m.admin_workspace_owner_description()}
              </p>
              {!props.editor.id ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                  disabled={!canChooseLatestOwner}
                  onClick={chooseLatestOwner}
                >
                  <CalendarIcon className="size-4" />
                  {m.admin_workspace_owner_random_button()}
                </Button>
              ) : null}
              {selectedOwner ? (
                <Badge variant="secondary" className="max-w-full">
                  <span className="truncate">
                    {selectedOwner.label}
                    {selectedOwner.account ? ` · ${selectedOwner.account}` : ''}
                  </span>
                </Badge>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {m.admin_workspace_owner_none_selected()}
                </p>
              )}
              <Input
                value={ownerQuery}
                onChange={(event) => {
                  setOwnerQuery(event.target.value)
                }}
                placeholder={m.admin_workspace_identity_search_placeholder()}
              />
              <ScrollArea className="h-60 rounded-lg border">
                <div className="divide-y">
                  {filteredOwnerIdentities.length ? (
                    filteredOwnerIdentities.map((identity) => {
                      const ownerWorkspace = ownerWorkspaceByIdentityId.get(
                        identity.id,
                      )
                      const disabled =
                        Boolean(ownerWorkspace) &&
                        ownerWorkspace?.id !== props.editor.id
                      const selected =
                        props.editor.ownerIdentityId === identity.id

                      return (
                        <button
                          key={identity.id}
                          type="button"
                          disabled={disabled}
                          className={cn(
                            'flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors',
                            selected && 'bg-primary/5',
                            disabled
                              ? 'cursor-not-allowed opacity-60'
                              : 'hover:bg-muted/40',
                          )}
                          onClick={() => {
                            if (disabled) {
                              return
                            }

                            selectOwner(identity.id)
                          }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {identity.label}
                              </div>
                              <div className="truncate text-sm text-muted-foreground">
                                {identity.account || identity.id}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {selected ? (
                                <Badge>
                                  {m.admin_workspace_owner_selected_badge()}
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{identity.id}</span>
                            <span>·</span>
                            <span>
                              {translateStatusLabel(
                                identity.status || 'active',
                              )}
                            </span>
                            {disabled ? (
                              <>
                                <span>·</span>
                                <span>
                                  {m.admin_workspace_owner_taken_hint({
                                    workspace:
                                      getWorkspaceDisplayLabel(ownerWorkspace),
                                  })}
                                </span>
                              </>
                            ) : null}
                          </div>
                        </button>
                      )
                    })
                  ) : (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      {m.admin_workspace_identity_search_empty()}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <UsersIcon className="size-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">
                    {m.admin_workspace_members_label()}
                  </h3>
                </div>
                <Badge variant="outline">
                  {m.admin_workspace_members_count({
                    count: String(selectedMemberCount),
                    max: String(MAX_WORKSPACE_MEMBER_COUNT),
                  })}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {m.admin_workspace_members_picker_description({
                  max: String(MAX_WORKSPACE_MEMBER_COUNT),
                })}
              </p>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {!props.editor.id ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full sm:w-auto"
                      disabled={!canRandomizeMembers}
                      onClick={() => {
                        randomizeMembers('replace')
                      }}
                    >
                      <RefreshCcwIcon className="size-4" />
                      {m.admin_workspace_member_random_button({
                        count: String(MAX_WORKSPACE_MEMBER_COUNT),
                      })}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={!canRandomlySupplementMembers}
                    onClick={() => {
                      randomizeMembers('supplement')
                    }}
                  >
                    <PlusIcon className="size-4" />
                    {m.admin_workspace_member_random_supplement_button({
                      count: String(remainingMemberSlots),
                    })}
                  </Button>
                </div>
                {!props.editor.ownerIdentityId ? (
                  <p className="text-xs text-muted-foreground">
                    {m.admin_workspace_member_random_requires_owner()}
                  </p>
                ) : null}
              </div>
              <SelectedMemberBadges
                identityById={identityById}
                memberIdentityIds={props.editor.memberIdentityIds}
                legacyMemberEmails={props.editor.legacyMemberEmails}
              />
              <Input
                value={memberQuery}
                onChange={(event) => {
                  setMemberQuery(event.target.value)
                }}
                placeholder={m.admin_workspace_identity_search_placeholder()}
              />
              <ScrollArea className="h-72 rounded-lg border">
                <div className="divide-y">
                  {filteredMemberIdentities.length ? (
                    filteredMemberIdentities.map((identity) => {
                      const selected = selectedMemberIds.has(identity.id)
                      const otherOwnerWorkspace =
                        getOtherWorkspaceOwnerWorkspace(
                          identity.id,
                          ownerWorkspaceByIdentityId,
                          props.editor.id,
                        )
                      const disabled =
                        identity.id === props.editor.ownerIdentityId ||
                        (!selected && memberCapReached)

                      return (
                        <label
                          key={identity.id}
                          className={cn(
                            'flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors',
                            disabled && 'cursor-not-allowed opacity-60',
                            selected && 'bg-primary/5',
                            !disabled && 'hover:bg-muted/40',
                          )}
                        >
                          <Checkbox
                            checked={selected}
                            disabled={disabled}
                            onCheckedChange={() => {
                              toggleMember(identity.id)
                            }}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate font-medium">
                                  {identity.label}
                                </div>
                                <div className="truncate text-sm text-muted-foreground">
                                  {identity.account || identity.id}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                {otherOwnerWorkspace ? (
                                  <Badge variant="outline">
                                    {m.admin_workspace_member_other_owner_badge()}
                                  </Badge>
                                ) : null}
                                {selected ? (
                                  <Badge>
                                    {m.admin_workspace_member_selected_badge()}
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {identity.id}
                              {' · '}
                              {translateStatusLabel(
                                identity.status || 'active',
                              )}
                              {otherOwnerWorkspace
                                ? ` · ${m.admin_workspace_member_other_owner_hint(
                                    {
                                      workspace:
                                        getWorkspaceDisplayLabel(
                                          otherOwnerWorkspace,
                                        ),
                                    },
                                  )}`
                                : null}
                              {identity.id === props.editor.ownerIdentityId
                                ? ` · ${m.admin_workspace_member_disabled_owner()}`
                                : null}
                              {!selected &&
                              memberCapReached &&
                              identity.id !== props.editor.ownerIdentityId
                                ? ` · ${m.admin_workspace_member_disabled_limit(
                                    {
                                      max: String(MAX_WORKSPACE_MEMBER_COUNT),
                                    },
                                  )}`
                                : null}
                            </div>
                          </div>
                        </label>
                      )
                    })
                  ) : (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      {m.admin_workspace_identity_search_empty()}
                    </div>
                  )}
                </div>
              </ScrollArea>
              {props.editor.legacyMemberEmails.length ? (
                <p className="text-sm text-muted-foreground">
                  {m.admin_workspace_legacy_members_notice({
                    count: String(props.editor.legacyMemberEmails.length),
                  })}
                </p>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                props.onOpenChange(false)
              }}
              disabled={props.isSaving}
            >
              {m.ui_close()}
            </Button>
            <Button
              type="button"
              disabled={props.isSaving || !props.editor.ownerIdentityId}
              onClick={() => {
                void props.onSave()
              }}
            >
              {m.admin_workspace_save_button()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingRandomMembers)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRandomMembers(null)
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {m.admin_workspace_member_random_confirm_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRandomMembers
                ? m.admin_workspace_member_random_confirm_description({
                    count: String(pendingRandomMembers.conflicts.length),
                  })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingRandomMembers ? (
            <ScrollArea className="max-h-80">
              <div className="space-y-3 pr-4">
                {pendingRandomMembers.conflicts.map((entry) => (
                  <div
                    key={entry.identity.id}
                    className="space-y-2 rounded-lg border p-3"
                  >
                    <Badge variant="secondary" className="max-w-full">
                      <span className="truncate">
                        {entry.identity.label}
                        {entry.identity.account
                          ? ` · ${entry.identity.account}`
                          : ''}
                      </span>
                    </Badge>
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        {m.admin_workspace_member_random_confirm_memberships_label()}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {entry.workspaces.map((workspace) => (
                          <Badge
                            key={`${entry.identity.id}:${workspace.id}`}
                            variant="outline"
                          >
                            {getWorkspaceDisplayLabel(workspace)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{m.ui_close()}</AlertDialogCancel>
            <Button
              type="button"
              onClick={() => {
                if (!pendingRandomMembers) {
                  return
                }

                setEditor((current) => ({
                  ...current,
                  memberIdentityIds: pendingRandomMembers.identityIds,
                }))
                setPendingRandomMembers(null)
              }}
            >
              {m.admin_workspace_member_random_confirm_button()}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function WorkspaceDetailDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: WorkspaceSummary | null
  canDispatchFlows: boolean
  onEdit: (workspace: WorkspaceSummary) => void
  onWorkspaceChange: (workspace: WorkspaceSummary) => void
  onFlash: (flash: FlashMessage) => void
}) {
  const [inviteActionKey, setInviteActionKey] = useState<string | null>(null)
  const [teamTrialPending, setTeamTrialPending] = useState(false)
  const [authorizationPending, setAuthorizationPending] = useState(false)
  const [authorizationResetPending, setAuthorizationResetPending] =
    useState(false)
  const [authorizationResetTarget, setAuthorizationResetTarget] =
    useState<PendingAuthorizationReset | null>(null)
  const [localFlash, setLocalFlash] = useState<FlashMessage | null>(null)

  useEffect(() => {
    if (!props.open) {
      return
    }

    setInviteActionKey(null)
    setTeamTrialPending(false)
    setAuthorizationPending(false)
    setAuthorizationResetPending(false)
    setAuthorizationResetTarget(null)
    setLocalFlash(null)
  }, [props.open, props.workspace?.id])

  function publishFlash(flash: FlashMessage) {
    setLocalFlash(flash)
    props.onFlash(flash)
  }

  async function handleTeamTrial() {
    if (!props.workspace) {
      return
    }

    setTeamTrialPending(true)
    setLocalFlash(null)

    try {
      const result = await dispatchWorkspaceTeamTrial(props.workspace.id)
      const flash: FlashMessage =
        result.mode === 'dispatch'
          ? {
              kind: 'success',
              message: m.admin_workspace_team_trial_success_dispatched({
                email: result.ownerEmail,
                cli: result.connectionLabel || 'CLI',
              }),
            }
          : {
              kind: 'success',
              message: m.admin_workspace_team_trial_success_requested({
                email: result.ownerEmail,
              }),
            }

      publishFlash(flash)
    } catch (error) {
      publishFlash({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : m.admin_workspace_team_trial_error_fallback(),
      })
    } finally {
      setTeamTrialPending(false)
    }
  }

  async function handleInvite() {
    if (!props.workspace) {
      return
    }

    if (!props.workspace.members.length) {
      return
    }

    setInviteActionKey('all')
    setLocalFlash(null)

    try {
      const result = await dispatchWorkspaceInvite(props.workspace.id)
      const flash: FlashMessage =
        result.mode === 'dispatch'
          ? {
              kind: 'success',
              message:
                (result.assignedCliCount || 1) > 1
                  ? m.admin_workspace_invite_success_dispatched_multi({
                      count: String(result.memberEmails.length),
                      cliCount: String(result.assignedCliCount || 1),
                    })
                  : m.admin_workspace_invite_success_dispatched({
                      count: String(result.memberEmails.length),
                      cli: result.connectionLabel || 'CLI',
                    }),
            }
          : {
              kind: 'success',
              message: m.admin_workspace_invite_success_requested({
                count: String(result.memberEmails.length),
              }),
            }

      publishFlash(flash)
    } catch (error) {
      const flash = {
        kind: 'error' as const,
        message:
          error instanceof Error
            ? error.message
            : m.admin_workspace_invite_error_fallback(),
      }

      publishFlash(flash)
    } finally {
      setInviteActionKey(null)
    }
  }

  async function handleAuthorizeWorkspace(memberIds?: string[]) {
    if (!props.workspace) {
      return
    }

    const requestedMemberIds = memberIds?.length ? memberIds : undefined
    if (memberIds?.length === 0) {
      return
    }

    setAuthorizationPending(true)
    setLocalFlash(null)

    try {
      const result = await dispatchWorkspaceCodexOAuth(
        props.workspace.id,
        requestedMemberIds,
      )
      const flash: FlashMessage =
        result.mode === 'dispatch'
          ? {
              kind: 'success',
              message:
                (result.assignedCliCount || 1) > 1
                  ? m.admin_workspace_authorize_success_dispatched_multi({
                      count: String(result.memberEmails.length),
                      cliCount: String(result.assignedCliCount || 1),
                    })
                  : m.admin_workspace_authorize_success_dispatched({
                      count: String(result.memberEmails.length),
                      cli: result.connectionLabel || 'CLI',
                    }),
            }
          : {
              kind: 'success',
              message: m.admin_workspace_authorize_success_requested({
                count: String(result.memberEmails.length),
              }),
            }

      publishFlash(flash)
    } catch (error) {
      publishFlash({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : m.admin_workspace_authorize_error_fallback(),
      })
    } finally {
      setAuthorizationPending(false)
    }
  }

  async function handleResetAuthorization(target: PendingAuthorizationReset) {
    if (!props.workspace) {
      return
    }

    setAuthorizationResetPending(true)
    setLocalFlash(null)

    try {
      const result = await resetWorkspaceAuthorizationStatuses(
        props.workspace.id,
        target.memberIds,
      )

      props.onWorkspaceChange(result.workspace)
      setAuthorizationResetTarget(null)
      publishFlash({
        kind: 'success',
        message:
          target.scope === 'all'
            ? m.admin_workspace_authorization_reset_all_success()
            : m.admin_workspace_authorization_reset_member_success({
                member: target.memberLabel,
              }),
      })
    } catch (error) {
      publishFlash({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : m.admin_workspace_authorization_reset_error_fallback(),
      })
    } finally {
      setAuthorizationResetPending(false)
    }
  }

  function handleDownloadEmails(
    mode: 'owner-and-members' | 'members',
    values: string[],
  ) {
    if (!props.workspace) {
      return
    }

    setLocalFlash(null)

    try {
      const count = downloadWorkspaceEmailsCsv({
        workspace: props.workspace,
        values,
        fileSuffix: mode,
      })

      publishFlash({
        kind: 'success',
        message:
          mode === 'owner-and-members'
            ? m.admin_workspace_download_owner_and_members_success({
                count: String(count),
              })
            : m.admin_workspace_download_members_success({
                count: String(count),
              }),
      })
    } catch {
      publishFlash({
        kind: 'error',
        message:
          mode === 'owner-and-members'
            ? m.admin_workspace_download_owner_and_members_error()
            : m.admin_workspace_download_members_error(),
      })
    }
  }

  const memberEmails = normalizeDownloadEmails(
    props.workspace?.members.map((member) => member.email) || [],
  )
  const unauthorizedMembers =
    props.workspace?.members.filter(
      (member) => !isWorkspaceAuthorized(member.authorization),
    ) || []
  const unauthorizedOwner =
    props.workspace?.owner &&
    !isWorkspaceAuthorized(props.workspace.owner.authorization)
      ? props.workspace.owner
      : null
  const pendingWorkspaceAuthorizationCount =
    unauthorizedMembers.length + (unauthorizedOwner ? 1 : 0)
  const workspaceAuthorizationIdentityCount =
    (props.workspace?.owner ? 1 : 0) + (props.workspace?.members.length || 0)
  const hasResettableOwnerAuthorization = canResetWorkspaceAuthorization(
    props.workspace?.owner?.authorization,
    props.workspace?.owner?.identityId,
  )
  const resettableMembers =
    props.workspace?.members.filter((member) =>
      canResetWorkspaceAuthorization(member.authorization, member.identityId),
    ) || []
  const canResetAllAuthorizations =
    hasResettableOwnerAuthorization || Boolean(resettableMembers.length)
  const isMutating =
    inviteActionKey !== null ||
    teamTrialPending ||
    authorizationPending ||
    authorizationResetPending
  const canStartTeamTrial =
    props.canDispatchFlows && Boolean(props.workspace?.owner?.email)
  const teamTrialPaypalUrl = props.workspace?.teamTrialPaypalUrl?.trim() || null
  const canAuthorizeWorkspace =
    props.canDispatchFlows && Boolean(pendingWorkspaceAuthorizationCount)
  const canInviteAll =
    props.canDispatchFlows &&
    Boolean(props.workspace?.owner?.identityId) &&
    Boolean(props.workspace?.members.length)

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[min(1080px,calc(100%-2rem))] overflow-y-auto sm:max-w-[min(1080px,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>{getWorkspaceDisplayLabel(props.workspace)}</DialogTitle>
          <DialogDescription>
            {m.admin_workspace_detail_description()}
          </DialogDescription>
        </DialogHeader>

        {props.workspace ? (
          <div className="space-y-6">
            {localFlash ? (
              <Alert
                variant={
                  localFlash.kind === 'error' ? 'destructive' : undefined
                }
              >
                <AlertTitle>
                  {localFlash.kind === 'error'
                    ? m.status_failed()
                    : m.status_success()}
                </AlertTitle>
                <AlertDescription>{localFlash.message}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="gap-3 pb-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardDescription>
                        {m.admin_workspace_detail_meta_kicker()}
                      </CardDescription>
                      <CardTitle>
                        {m.admin_workspace_detail_meta_title()}
                      </CardTitle>
                    </div>
                    <Button
                      type="button"
                      disabled={!canAuthorizeWorkspace || isMutating}
                      onClick={() => {
                        void handleAuthorizeWorkspace()
                      }}
                    >
                      <KeyRoundIcon />
                      {authorizationPending
                        ? m.admin_workspace_authorize_running()
                        : pendingWorkspaceAuthorizationCount === 0
                          ? m.admin_workspace_authorize_all_authorized_button()
                          : pendingWorkspaceAuthorizationCount ===
                              workspaceAuthorizationIdentityCount
                            ? m.admin_workspace_authorize_all_button()
                            : m.admin_workspace_authorize_remaining_button()}
                    </Button>
                  </div>
                  {!props.canDispatchFlows ? (
                    <p className="text-sm text-muted-foreground">
                      {m.admin_workspace_authorize_requires_cli_permission()}
                    </p>
                  ) : !workspaceAuthorizationIdentityCount ? (
                    <p className="text-sm text-muted-foreground">
                      {m.admin_workspace_authorize_requires_members()}
                    </p>
                  ) : !pendingWorkspaceAuthorizationCount ? (
                    <p className="text-sm text-muted-foreground">
                      {m.admin_workspace_authorize_all_authorized_hint()}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {props.workspace.workspaceId
                        ? m.admin_workspace_authorize_dispatch_hint()
                        : m.admin_workspace_authorize_dispatch_default_workspace_hint()}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-foreground">
                      {m.admin_workspace_table_workspace_id()}
                    </div>
                    {props.workspace.workspaceId ? (
                      <CopyableValue
                        value={props.workspace.workspaceId}
                        code
                        className="max-w-full text-sm text-muted-foreground"
                        contentClassName="break-all"
                      />
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        {getWorkspaceIdDisplayValue(
                          props.workspace.workspaceId,
                        )}
                      </div>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-foreground">
                        {m.admin_workspace_created_at_label()}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatAdminDate(props.workspace.createdAt) ||
                          props.workspace.createdAt}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-foreground">
                        {m.admin_workspace_table_updated_at()}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatAdminDate(props.workspace.updatedAt) ||
                          props.workspace.updatedAt}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="gap-3 pb-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardDescription>
                        {m.admin_workspace_owner_kicker()}
                      </CardDescription>
                      <CardTitle>{m.admin_workspace_owner_label()}</CardTitle>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {teamTrialPaypalUrl ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            window.open(
                              teamTrialPaypalUrl,
                              '_blank',
                              'noopener,noreferrer',
                            )
                          }}
                        >
                          <ExternalLinkIcon />
                          {m.admin_workspace_team_trial_paypal_button()}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!canStartTeamTrial || isMutating}
                        onClick={() => {
                          void handleTeamTrial()
                        }}
                      >
                        <SparklesIcon />
                        {teamTrialPending
                          ? m.admin_workspace_team_trial_running()
                          : m.admin_workspace_team_trial_button()}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {props.workspace.owner ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-foreground">
                          {props.workspace.owner.identityLabel}
                        </div>
                        <WorkspaceAuthorizationBadge
                          authorization={props.workspace.owner.authorization}
                        />
                      </div>
                      <CopyableValue
                        value={props.workspace.owner.email}
                        className="max-w-full text-sm text-muted-foreground"
                        contentClassName="break-all"
                      />
                      <CopyableValue
                        value={props.workspace.owner.identityId}
                        code
                        className="max-w-full text-sm text-muted-foreground"
                        contentClassName="break-all"
                      />
                      {props.workspace.owner.authorization.lastSeenAt ? (
                        <div className="text-xs text-muted-foreground">
                          {m.admin_workspace_authorization_last_seen({
                            time:
                              formatAdminDate(
                                props.workspace.owner.authorization.lastSeenAt,
                              ) ||
                              props.workspace.owner.authorization.lastSeenAt,
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {m.admin_workspace_owner_missing()}
                    </p>
                  )}
                  {props.workspace.owner && !props.canDispatchFlows ? (
                    <p className="text-xs text-muted-foreground">
                      {m.admin_workspace_team_trial_requires_cli_permission()}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="gap-4">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardDescription>
                      {m.admin_workspace_members_kicker()}
                    </CardDescription>
                    <CardTitle>
                      {m.admin_workspace_members_title({
                        count: String(props.workspace.memberCount),
                      })}
                    </CardTitle>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!memberEmails.length}
                      onClick={() => {
                        handleDownloadEmails('members', memberEmails)
                      }}
                    >
                      <DownloadIcon />
                      {m.admin_workspace_download_members_button()}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canResetAllAuthorizations || isMutating}
                      onClick={() => {
                        setAuthorizationResetTarget({
                          scope: 'all',
                        })
                      }}
                    >
                      <RefreshCcwIcon />
                      {m.admin_workspace_authorization_reset_all_button()}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canInviteAll || isMutating}
                      onClick={() => {
                        void handleInvite()
                      }}
                    >
                      {inviteActionKey === 'all'
                        ? m.admin_workspace_invite_running()
                        : m.admin_workspace_invite_all_button()}
                    </Button>
                  </div>
                </div>
                {!props.canDispatchFlows ? (
                  <p className="text-sm text-muted-foreground">
                    {m.admin_workspace_invite_requires_cli_permission()}
                  </p>
                ) : !props.workspace.members.length ? (
                  <p className="text-sm text-muted-foreground">
                    {m.admin_workspace_invite_requires_members()}
                  </p>
                ) : !props.workspace.owner ? (
                  <p className="text-sm text-muted-foreground">
                    {m.admin_workspace_invite_requires_owner()}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {m.admin_workspace_invite_dispatch_hint()}
                  </p>
                )}
              </CardHeader>
              <CardContent>
                {props.workspace.members.length ? (
                  <div className="space-y-3">
                    {props.workspace.members.map((member) => (
                      <div
                        key={member.id}
                        className="flex flex-col gap-3 rounded-lg border p-4 lg:flex-row lg:items-center lg:justify-between"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-foreground">
                              {member.identityLabel || member.email}
                            </div>
                            <WorkspaceAuthorizationBadge
                              authorization={member.authorization}
                            />
                            <WorkspaceInviteStatusBadge
                              status={member.inviteStatus}
                            />
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {member.email}
                          </div>
                          {member.identityId ? (
                            <CopyableValue
                              value={member.identityId}
                              code
                              className="max-w-full text-sm text-muted-foreground"
                              contentClassName="break-all"
                            />
                          ) : null}
                          {member.authorization.lastSeenAt ? (
                            <div className="text-xs text-muted-foreground">
                              {m.admin_workspace_authorization_last_seen({
                                time:
                                  formatAdminDate(
                                    member.authorization.lastSeenAt,
                                  ) || member.authorization.lastSeenAt,
                              })}
                            </div>
                          ) : null}
                          {member.invitedAt ? (
                            <div className="text-xs text-muted-foreground">
                              {m.admin_workspace_invitation_last_confirmed({
                                time:
                                  formatAdminDate(member.invitedAt) ||
                                  member.invitedAt,
                              })}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            disabled={
                              !canResetWorkspaceAuthorization(
                                member.authorization,
                                member.identityId,
                              ) || isMutating
                            }
                            onClick={() => {
                              setAuthorizationResetTarget({
                                scope: 'member',
                                memberIds: [member.id],
                                memberLabel:
                                  member.identityLabel || member.email,
                              })
                            }}
                          >
                            <RefreshCcwIcon />
                            {m.admin_workspace_authorization_reset_member_button()}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {m.admin_workspace_invite_requires_members()}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}

        <AlertDialog
          open={Boolean(authorizationResetTarget)}
          onOpenChange={(open) => {
            if (!authorizationResetPending && !open) {
              setAuthorizationResetTarget(null)
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {m.admin_workspace_authorization_reset_confirm_title()}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {authorizationResetTarget?.scope === 'all'
                  ? m.admin_workspace_authorization_reset_confirm_all_description()
                  : m.admin_workspace_authorization_reset_confirm_member_description(
                      {
                        member: authorizationResetTarget?.memberLabel || '',
                      },
                    )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={authorizationResetPending}>
                {m.ui_close()}
              </AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={
                  !authorizationResetTarget || authorizationResetPending
                }
                onClick={() => {
                  if (!authorizationResetTarget) {
                    return
                  }

                  void handleResetAuthorization(authorizationResetTarget)
                }}
              >
                {authorizationResetPending
                  ? m.admin_workspace_authorization_reset_running()
                  : authorizationResetTarget?.scope === 'all'
                    ? m.admin_workspace_authorization_reset_all_button()
                    : m.admin_workspace_authorization_reset_member_button()}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <DialogFooter>
          {props.workspace ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                props.onEdit(props.workspace as WorkspaceSummary)
              }}
            >
              <PencilIcon />
              {m.admin_workspace_edit_button()}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              props.onOpenChange(false)
            }}
          >
            {m.ui_close()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AdminWorkspacesPage() {
  const data = Route.useLoaderData()
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>(() =>
    'workspaces' in data ? (data.workspaces as WorkspaceSummary[]) : [],
  )
  const [identitySummaries, setIdentitySummaries] = useState<IdentitySummary[]>(
    () =>
      'identitySummaries' in data
        ? (data.identitySummaries as IdentitySummary[])
        : [],
  )
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<WorkspaceEditorState>(
    createWorkspaceEditorState(),
  )
  const [editorOpen, setEditorOpen] = useState(false)
  const [detailsTarget, setDetailsTarget] = useState<WorkspaceSummary | null>(
    null,
  )
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSummary | null>(
    null,
  )
  const [flash, setFlash] = useState<FlashMessage | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if ('workspaces' in data) {
      setWorkspaces(
        sortWorkspaceSummaries(data.workspaces as WorkspaceSummary[]),
      )
    }

    if ('identitySummaries' in data) {
      setIdentitySummaries(data.identitySummaries as IdentitySummary[])
    }
  }, [data])

  useEffect(() => {
    if (!data.authorized) {
      return
    }

    let active = true

    async function refreshWorkspaces() {
      const next = await loadAdminWorkspaces()
      if (!active || !next.authorized) {
        return
      }

      setWorkspaces(
        sortWorkspaceSummaries(next.workspaces as WorkspaceSummary[]),
      )
      setIdentitySummaries(next.identitySummaries as IdentitySummary[])
    }

    const interval = window.setInterval(() => {
      void refreshWorkspaces()
    }, WORKSPACE_REFRESH_INTERVAL_MS)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [data.authorized])

  useEffect(() => {
    if (!detailsTarget) {
      return
    }

    const nextDetailsTarget =
      workspaces.find((workspace) => workspace.id === detailsTarget.id) || null

    if (!nextDetailsTarget) {
      setDetailsTarget(null)
      return
    }

    if (nextDetailsTarget !== detailsTarget) {
      setDetailsTarget(nextDetailsTarget)
    }
  }, [detailsTarget, workspaces])

  const filteredWorkspaces = useMemo(
    () => filterWorkspaceSummaries(workspaces, query),
    [query, workspaces],
  )

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        <AdminPageHeader
          title={m.admin_workspace_page_title()}
          description={m.admin_workspace_page_description()}
          variant="plain"
          actions={
            <>
              <Button asChild variant="outline">
                <a href="/admin">{m.admin_back_to_operations()}</a>
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setFlash(null)
                  setEditor(createWorkspaceEditorState())
                  setEditorOpen(true)
                }}
              >
                <PlusIcon />
                {m.admin_workspace_create_button()}
              </Button>
            </>
          }
        />

        {flash ? (
          <Alert variant={flash.kind === 'error' ? 'destructive' : undefined}>
            <AlertTitle>
              {flash.kind === 'error' ? m.status_failed() : m.status_success()}
            </AlertTitle>
            <AlertDescription>{flash.message}</AlertDescription>
          </Alert>
        ) : null}

        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CardHeader className="gap-4">
            <div>
              <CardDescription>
                {m.admin_workspace_table_kicker()}
              </CardDescription>
              <CardTitle>{m.admin_workspace_table_title()}</CardTitle>
            </div>
            <div className="relative max-w-md">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                }}
                placeholder={m.admin_workspace_search_placeholder()}
                className="pl-9"
              />
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col">
            {filteredWorkspaces.length ? (
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
                <Table className="min-w-[1280px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{m.admin_workspace_table_label()}</TableHead>
                      <TableHead>
                        {m.admin_workspace_table_workspace_id()}
                      </TableHead>
                      <TableHead>{m.admin_workspace_table_owner()}</TableHead>
                      <TableHead>{m.admin_workspace_table_members()}</TableHead>
                      <TableHead>
                        {m.admin_workspace_table_updated_at()}
                      </TableHead>
                      <TableHead>{m.admin_dashboard_table_manage()}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredWorkspaces.map((workspace) => (
                      <TableRow key={workspace.id}>
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            <div className="font-medium text-foreground">
                              {getWorkspaceDisplayLabel(workspace)}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {workspace.memberCount}{' '}
                              {m.admin_workspace_members_label()}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          {workspace.workspaceId ? (
                            <CopyableValue
                              value={workspace.workspaceId}
                              code
                              className="max-w-full text-sm text-muted-foreground"
                              contentClassName="break-all"
                            />
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {getWorkspaceIdDisplayValue(
                                workspace.workspaceId,
                              )}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {workspace.owner ? (
                            <div className="space-y-1">
                              <div className="font-medium text-foreground">
                                {workspace.owner.identityLabel}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {workspace.owner.email}
                              </div>
                              <WorkspaceAuthorizationBadge
                                authorization={workspace.owner.authorization}
                              />
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {m.admin_workspace_owner_missing()}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <WorkspaceMembersPreview workspace={workspace} />
                        </TableCell>
                        <TableCell className="align-top text-sm text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <CalendarIcon className="size-4" />
                            {formatAdminDate(workspace.updatedAt)}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setDetailsTarget(workspace)
                              }}
                            >
                              <EyeIcon />
                              {m.admin_workspace_detail_button()}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setFlash(null)
                                setEditor(createWorkspaceEditorState(workspace))
                                setEditorOpen(true)
                              }}
                            >
                              <PencilIcon />
                              {m.admin_workspace_edit_button()}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setDeleteTarget(workspace)
                              }}
                            >
                              <Trash2Icon />
                              {m.admin_workspace_delete_button()}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState
                title={
                  query
                    ? m.admin_table_filtered_empty_title()
                    : m.admin_workspace_empty_title()
                }
                description={
                  query
                    ? m.admin_table_filtered_empty_description()
                    : m.admin_workspace_empty_description()
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

      <WorkspaceEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editor={editor}
        onEditorChange={setEditor}
        identities={identitySummaries}
        workspaces={workspaces}
        isSaving={isSaving}
        onSave={async () => {
          setIsSaving(true)
          setFlash(null)

          try {
            const workspace = await saveWorkspace(editor)
            setWorkspaces((current) =>
              upsertWorkspaceSummary(current, workspace),
            )
            setEditorOpen(false)
          } catch (error) {
            setFlash({
              kind: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : m.admin_workspace_save_error_fallback(),
            })
          } finally {
            setIsSaving(false)
          }
        }}
      />

      <WorkspaceDetailDialog
        open={Boolean(detailsTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailsTarget(null)
          }
        }}
        workspace={detailsTarget}
        canDispatchFlows={Boolean(
          'canDispatchFlows' in data && data.canDispatchFlows,
        )}
        onEdit={(workspace) => {
          setDetailsTarget(null)
          setEditor(createWorkspaceEditorState(workspace))
          setEditorOpen(true)
        }}
        onWorkspaceChange={(workspace) => {
          setWorkspaces((current) => upsertWorkspaceSummary(current, workspace))
          setDetailsTarget(workspace)
        }}
        onFlash={setFlash}
      />

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!isDeleting && !open) {
            setDeleteTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {m.admin_workspace_delete_confirm_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {m.admin_workspace_delete_confirm_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {m.ui_close()}
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeleting || !deleteTarget}
              onClick={async () => {
                if (!deleteTarget) {
                  return
                }

                setIsDeleting(true)
                setFlash(null)

                try {
                  const deletedId = await deleteWorkspace(deleteTarget.id)
                  setWorkspaces((current) =>
                    current.filter((workspace) => workspace.id !== deletedId),
                  )

                  const next = await loadAdminWorkspaces().catch(() => null)
                  if (next?.authorized) {
                    setWorkspaces(
                      sortWorkspaceSummaries(
                        next.workspaces as WorkspaceSummary[],
                      ),
                    )
                    setIdentitySummaries(
                      next.identitySummaries as IdentitySummary[],
                    )
                  }

                  setDeleteTarget(null)
                } catch (error) {
                  setFlash({
                    kind: 'error',
                    message:
                      error instanceof Error
                        ? error.message
                        : m.admin_workspace_save_error_fallback(),
                  })
                } finally {
                  setIsDeleting(false)
                }
              }}
            >
              {m.admin_workspace_delete_button()}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
