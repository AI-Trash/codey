import type { ReactNode } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  AppWindowIcon,
  ArrowLeftIcon,
  UserRoundIcon,
  UsersIcon,
} from 'lucide-react'

import {
  AdminPageHeader,
  EmptyState,
  formatAdminDate,
  StatusBadge,
} from '#/components/admin/layout'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { CopyableValue } from '#/components/ui/copyable-value'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

const loadAdminIdentityDetail = createServerFn({ method: 'GET' })
  .inputValidator((data: { identityId: string }) => data)
  .handler(async ({ data }) => {
    const [
      { getRequest },
      { requireAdminPermission },
      { findAdminIdentitySummary },
      { listAdminManagedWorkspaceAssociationsForIdentity },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../../lib/server/auth'),
      import('../../../lib/server/identities'),
      import('../../../lib/server/workspaces'),
    ])

    const request = getRequest()

    try {
      await requireAdminPermission(request, 'MANAGED_IDENTITIES')
    } catch {
      return { authorized: false as const }
    }

    const identity = await findAdminIdentitySummary(data.identityId)
    if (!identity) {
      return {
        authorized: true as const,
        identity: null,
        ownedWorkspaces: [],
        memberWorkspaces: [],
      }
    }

    const associations = await listAdminManagedWorkspaceAssociationsForIdentity(
      identity.id,
    )

    return {
      authorized: true as const,
      identity,
      ownedWorkspaces: associations.ownedWorkspaces,
      memberWorkspaces: associations.memberWorkspaces,
    }
  })

export const Route = createFileRoute('/admin/identities/$identityId')({
  loader: async ({ params }) =>
    loadAdminIdentityDetail({ data: { identityId: params.identityId } }),
  component: AdminIdentityDetailPage,
})

type IdentitySummary = {
  id: string
  label: string
  account?: string | null
  lastSeenAt?: string | Date | null
  createdAt?: string | Date | null
  status?: string | null
}

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

type WorkspaceIdentitySummary = {
  identityId: string
  email: string
  identityLabel: string
  authorization: WorkspaceAuthorizationSummary
}

type WorkspaceInviteStatus = 'NOT_INVITED' | 'PENDING' | 'INVITED' | 'FAILED'

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

type WorkspaceSummary = {
  id: string
  workspaceId: string | null
  label?: string | null
  owner?: WorkspaceIdentitySummary | null
  memberCount: number
  members: WorkspaceMemberSummary[]
  createdAt: string
  updatedAt: string
}

type MemberWorkspaceSummary = {
  workspace: WorkspaceSummary
  member: WorkspaceMemberSummary
}

function AdminIdentityDetailPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  const identity = data.identity as IdentitySummary | null
  const ownedWorkspaces = data.ownedWorkspaces as WorkspaceSummary[]
  const memberWorkspaces = data.memberWorkspaces as MemberWorkspaceSummary[]

  if (!identity) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardDescription>{m.admin_nav_identities()}</CardDescription>
          <CardTitle>{m.admin_identity_not_found_title()}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {m.admin_identity_not_found_description()}
          </p>
        </CardContent>
      </Card>
    )
  }

  const totalWorkspaceCount = ownedWorkspaces.length + memberWorkspaces.length

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={identity.label}
        description={m.admin_identity_detail_page_description()}
        variant="plain"
        meta={<StatusBadge value={identity.status} />}
        actions={
          <Button asChild variant="outline">
            <a href="/admin/identities">
              <ArrowLeftIcon />
              {m.admin_identity_back_to_identities()}
            </a>
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <IdentityProfileCard identity={identity} />

        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
          <WorkspaceMetric
            icon={<AppWindowIcon />}
            label={m.admin_identity_workspace_total_label()}
            value={totalWorkspaceCount}
          />
          <WorkspaceMetric
            icon={<UserRoundIcon />}
            label={m.admin_identity_workspace_owned_label()}
            value={ownedWorkspaces.length}
          />
          <WorkspaceMetric
            icon={<UsersIcon />}
            label={m.admin_identity_workspace_member_label()}
            value={memberWorkspaces.length}
          />
        </div>
      </div>

      <OwnedWorkspacesSection workspaces={ownedWorkspaces} />
      <MemberWorkspacesSection entries={memberWorkspaces} />
    </div>
  )
}

function IdentityProfileCard(props: { identity: IdentitySummary }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{m.admin_identity_profile_kicker()}</CardDescription>
        <CardTitle>{m.admin_identity_profile_title()}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <IdentityDetailField label={m.admin_dashboard_identity_label()}>
          <div className="text-sm text-foreground">{props.identity.label}</div>
        </IdentityDetailField>

        <IdentityDetailField label={m.oauth_clients_table_status()}>
          <StatusBadge value={props.identity.status} />
        </IdentityDetailField>

        <IdentityDetailField label={m.admin_dashboard_account_email_label()}>
          {props.identity.account ? (
            <CopyableValue
              value={props.identity.account}
              title={m.clipboard_copy_value({
                label: m.admin_dashboard_account_email_label(),
              })}
              className="max-w-full text-sm text-muted-foreground"
              contentClassName="break-all"
            />
          ) : (
            <div className="text-sm text-muted-foreground">
              {m.admin_dashboard_not_linked_yet()}
            </div>
          )}
        </IdentityDetailField>

        <IdentityDetailField label={m.admin_dashboard_identity_id_label()}>
          <CopyableValue
            value={props.identity.id}
            code
            title={m.clipboard_copy_value({
              label: m.admin_dashboard_identity_id_label(),
            })}
            className="max-w-full text-sm text-muted-foreground"
            contentClassName="break-all"
          />
        </IdentityDetailField>

        <IdentityDetailField label={m.admin_dashboard_table_last_seen()}>
          <div className="text-sm text-muted-foreground">
            {formatAdminDate(props.identity.lastSeenAt) ||
              m.admin_dashboard_not_captured_yet()}
          </div>
        </IdentityDetailField>

        <IdentityDetailField label={m.admin_workspace_created_at_label()}>
          <div className="text-sm text-muted-foreground">
            {formatAdminDate(props.identity.createdAt) ||
              m.admin_dashboard_not_captured_yet()}
          </div>
        </IdentityDetailField>
      </CardContent>
    </Card>
  )
}

function IdentityDetailField(props: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-sm font-medium text-foreground">{props.label}</div>
      {props.children}
    </div>
  )
}

function WorkspaceMetric(props: {
  icon: ReactNode
  label: string
  value: number
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {props.icon}
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-semibold leading-none text-foreground">
            {props.value}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {props.label}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function OwnedWorkspacesSection(props: { workspaces: WorkspaceSummary[] }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>
          {m.admin_identity_owned_workspaces_kicker()}
        </CardDescription>
        <CardTitle>
          {m.admin_identity_owned_workspaces_title({
            count: String(props.workspaces.length),
          })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {props.workspaces.length ? (
          <div className="overflow-auto rounded-lg border">
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{m.admin_workspace_table_label()}</TableHead>
                  <TableHead>
                    {m.admin_workspace_table_workspace_id()}
                  </TableHead>
                  <TableHead>
                    {m.admin_identity_workspace_authorization_label()}
                  </TableHead>
                  <TableHead>{m.admin_workspace_table_members()}</TableHead>
                  <TableHead>{m.admin_workspace_table_updated_at()}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.workspaces.map((workspace) => (
                  <TableRow key={workspace.id}>
                    <WorkspaceCell workspace={workspace} />
                    <WorkspaceIdCell workspace={workspace} />
                    <TableCell className="align-top">
                      <WorkspaceAuthorizationBadge
                        authorization={workspace.owner?.authorization}
                      />
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {workspace.memberCount}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatAdminDate(workspace.updatedAt) ||
                        workspace.updatedAt}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            title={m.admin_identity_owned_workspaces_empty_title()}
            description={m.admin_identity_owned_workspaces_empty_description()}
          />
        )}
      </CardContent>
    </Card>
  )
}

function MemberWorkspacesSection(props: { entries: MemberWorkspaceSummary[] }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>
          {m.admin_identity_member_workspaces_kicker()}
        </CardDescription>
        <CardTitle>
          {m.admin_identity_member_workspaces_title({
            count: String(props.entries.length),
          })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {props.entries.length ? (
          <div className="overflow-auto rounded-lg border">
            <Table className="min-w-[1120px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{m.admin_workspace_table_label()}</TableHead>
                  <TableHead>
                    {m.admin_workspace_table_workspace_id()}
                  </TableHead>
                  <TableHead>{m.admin_workspace_table_owner()}</TableHead>
                  <TableHead>
                    {m.admin_identity_member_account_label()}
                  </TableHead>
                  <TableHead>
                    {m.admin_identity_workspace_authorization_label()}
                  </TableHead>
                  <TableHead>
                    {m.admin_identity_workspace_invitation_label()}
                  </TableHead>
                  <TableHead>{m.admin_workspace_table_updated_at()}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.entries.map(({ workspace, member }) => (
                  <TableRow key={`${workspace.id}:${member.id}`}>
                    <WorkspaceCell workspace={workspace} />
                    <WorkspaceIdCell workspace={workspace} />
                    <TableCell className="align-top">
                      {workspace.owner ? (
                        <div className="min-w-0 space-y-1">
                          <div className="text-sm font-medium text-foreground">
                            {workspace.owner.identityLabel}
                          </div>
                          <div className="break-all text-sm text-muted-foreground">
                            {workspace.owner.email}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          {m.admin_workspace_owner_missing()}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="min-w-0 space-y-1">
                        <div className="text-sm font-medium text-foreground">
                          {member.identityLabel || member.email}
                        </div>
                        <div className="break-all text-sm text-muted-foreground">
                          {member.email}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <WorkspaceAuthorizationBadge
                        authorization={member.authorization}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <WorkspaceInviteStatusBadge
                        status={member.inviteStatus}
                      />
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatAdminDate(workspace.updatedAt) ||
                        workspace.updatedAt}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            title={m.admin_identity_member_workspaces_empty_title()}
            description={m.admin_identity_member_workspaces_empty_description()}
          />
        )}
      </CardContent>
    </Card>
  )
}

function WorkspaceCell(props: { workspace: WorkspaceSummary }) {
  return (
    <TableCell className="align-top">
      <div className="min-w-0 space-y-1">
        <div className="font-medium text-foreground">
          {getWorkspaceDisplayName(props.workspace)}
        </div>
        <CopyableValue
          value={props.workspace.id}
          code
          title={m.clipboard_copy_value({
            label: m.admin_identity_workspace_record_id_label(),
          })}
          className="max-w-full text-sm text-muted-foreground"
          contentClassName="break-all"
        />
      </div>
    </TableCell>
  )
}

function WorkspaceIdCell(props: { workspace: WorkspaceSummary }) {
  return (
    <TableCell className="align-top">
      {props.workspace.workspaceId ? (
        <CopyableValue
          value={props.workspace.workspaceId}
          code
          title={m.clipboard_copy_value({
            label: m.admin_workspace_table_workspace_id(),
          })}
          className="max-w-full text-sm text-muted-foreground"
          contentClassName="break-all"
        />
      ) : (
        <div className="text-sm text-muted-foreground">
          {m.admin_workspace_id_missing_value()}
        </div>
      )}
    </TableCell>
  )
}

function getWorkspaceDisplayName(workspace: WorkspaceSummary) {
  return (
    workspace.label ||
    workspace.workspaceId ||
    m.admin_workspace_unnamed_label()
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
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }

  if (state === 'expired') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }

  if (state === 'revoked') {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
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

function WorkspaceInviteStatusBadge(props: {
  status?: WorkspaceInviteStatus | null
}) {
  const status = props.status || 'NOT_INVITED'

  return (
    <Badge
      variant="outline"
      className={cn(
        'border px-2.5 py-1 text-xs font-medium',
        status === 'INVITED'
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : status === 'FAILED'
            ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
            : status === 'PENDING'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              : 'border-muted-foreground/20 bg-muted/40 text-muted-foreground',
      )}
    >
      {getWorkspaceInviteStatusLabel(status)}
    </Badge>
  )
}
