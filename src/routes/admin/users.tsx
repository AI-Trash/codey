import { useEffect, useMemo, useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  CalendarIcon,
  ShieldIcon,
  SquarePenIcon,
  UserRoundIcon,
  UsersIcon,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  AdminPageHeader,
  EmptyState,
  formatAdminDate,
} from '#/components/admin/layout'
import { ClientFilterableAdminTable } from '#/components/admin/filterable-table'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import {
  AdminTableSelectionCell,
  AdminTableSelectionHead,
} from '#/components/admin/table-selection'
import { createColumnConfigHelper } from '#/components/data-table-filter/core/filters'
import {
  adminPermissionValues,
  getDefaultAdminRoute,
  type AdminPermission,
} from '#/lib/admin-access'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

const loadAdminUsers = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ getRequest }, { requireAdminPermission }, { listAdminUsers }] =
    await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../lib/server/auth'),
      import('../../lib/server/users'),
    ])
  const request = getRequest()

  try {
    const sessionUser = await requireAdminPermission(request, 'USER_ACCESS')
    const { policy, users } = await listAdminUsers()

    return {
      authorized: true as const,
      currentUserId: sessionUser.user.id,
      defaultRoute: getDefaultAdminRoute(sessionUser.user),
      policy,
      users,
    }
  } catch {
    return { authorized: false as const }
  }
})

export const Route = createFileRoute('/admin/users')({
  loader: async () => loadAdminUsers(),
  component: AdminUsersPage,
})

type AdminUserSummary = {
  id: string
  email: string | null
  githubLogin: string | null
  name: string | null
  avatarUrl: string | null
  role: 'ADMIN' | 'USER'
  permissions: AdminPermission[]
  hasConsoleAccess: boolean
  isAllowlistedAdmin: boolean
  createdAt: string
  updatedAt: string
}

type UpdateAdminUserPermissionsResponse = {
  ok: true
  user: AdminUserSummary
  updatedSelf?: boolean
}

function AdminUsersPage() {
  const data = Route.useLoaderData()
  const navigate = Route.useNavigate()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  const locale = getLocale()
  const [users, setUsers] = useState(() => data.users as AdminUserSummary[])
  const [editingUserId, setEditingUserId] = useState<string | null>(null)

  useEffect(() => {
    setUsers(data.users as AdminUserSummary[])
  }, [data.users])

  const editingUser = users.find((user) => user.id === editingUserId) || null

  const userColumns = useMemo(() => {
    const dtf = createColumnConfigHelper<AdminUserSummary>()

    return [
      dtf
        .text()
        .id('user')
        .accessor((user) => getUserSearchText(user))
        .displayName(m.admin_users_table_user())
        .icon(UserRoundIcon)
        .build(),
      dtf
        .option()
        .id('role')
        .accessor((user) => user.role)
        .displayName(m.admin_users_table_role())
        .icon(ShieldIcon)
        .transformOptionFn((role) => ({
          label:
            role === 'ADMIN'
              ? m.admin_sidebar_role_admin()
              : m.admin_sidebar_role_user(),
          value: role,
        }))
        .build(),
      dtf
        .multiOption()
        .id('permissions')
        .accessor((user) =>
          user.permissions.length ? user.permissions : ['NO_ACCESS'],
        )
        .displayName(m.admin_users_table_access())
        .icon(UsersIcon)
        .transformOptionFn((permission) => ({
          label:
            permission === 'NO_ACCESS'
              ? m.admin_users_no_access()
              : getPermissionLabel(permission as AdminPermission),
          value: permission,
        }))
        .build(),
      dtf
        .date()
        .id('createdAt')
        .accessor((user) => new Date(user.createdAt))
        .displayName(m.admin_users_table_joined())
        .icon(CalendarIcon)
        .build(),
      dtf
        .date()
        .id('updatedAt')
        .accessor((user) => new Date(user.updatedAt))
        .displayName(m.oauth_clients_table_updated())
        .icon(CalendarIcon)
        .build(),
    ] as const
  }, [locale])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <AdminPageHeader
        eyebrow={m.admin_nav_users()}
        title={m.admin_users_page_title()}
        description={m.admin_users_page_description()}
        variant="plain"
        actions={
          data.defaultRoute !== '/admin/users' ? (
            <Button asChild variant="outline">
              <a href={data.defaultRoute}>{m.admin_users_back_to_console()}</a>
            </Button>
          ) : undefined
        }
      />

      {data.policy === 'ALLOWLIST' ? (
        <Alert>
          <AlertTitle>{m.admin_users_allowlist_title()}</AlertTitle>
          <AlertDescription>
            {m.admin_users_allowlist_description()}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader>
          <CardDescription>{m.admin_users_table_kicker()}</CardDescription>
          <CardTitle>{m.admin_users_table_title()}</CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col">
          <ClientFilterableAdminTable
            data={users}
            columnsConfig={userColumns}
            getRowId={(user) => user.id}
            fillHeight
            emptyState={
              <EmptyState
                title={m.admin_users_empty_title()}
                description={m.admin_users_empty_description()}
              />
            }
            renderTable={({ rows, selection }) => (
              <Table className="min-w-[1380px]">
                <TableHeader>
                  <TableRow>
                    <AdminTableSelectionHead rows={rows} selection={selection} />
                    <TableHead>{m.admin_users_table_user()}</TableHead>
                    <TableHead>{m.admin_users_table_role()}</TableHead>
                    <TableHead>{m.admin_users_table_access()}</TableHead>
                    <TableHead>{m.admin_users_table_joined()}</TableHead>
                    <TableHead>{m.oauth_clients_table_updated()}</TableHead>
                    <TableHead>{m.admin_dashboard_table_manage()}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((user) => (
                    <TableRow
                      key={user.id}
                      data-selected={selection.isSelected(user) || undefined}
                    >
                      <AdminTableSelectionCell row={user} selection={selection} />
                      <TableCell className="align-top">
                        <div className="flex items-start gap-3">
                          <Avatar className="mt-0.5" size="sm">
                            <AvatarImage src={user.avatarUrl || undefined} />
                            <AvatarFallback>
                              {getUserInitials(user)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-foreground">
                                {getUserPrimaryLabel(user)}
                              </span>
                              {user.id === data.currentUserId ? (
                                <Badge variant="outline">
                                  {m.admin_users_you_badge()}
                                </Badge>
                              ) : null}
                              {user.isAllowlistedAdmin ? (
                                <Badge variant="outline">
                                  {m.admin_users_allowlist_badge()}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {getUserSecondaryLabel(user)}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge
                          variant={
                            user.role === 'ADMIN' ? 'default' : 'outline'
                          }
                        >
                          {user.role === 'ADMIN'
                            ? m.admin_sidebar_role_admin()
                            : m.admin_sidebar_role_user()}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex max-w-[380px] flex-wrap gap-2">
                          {user.permissions.length ? (
                            user.permissions.map((permission) => (
                              <Badge key={permission} variant="outline">
                                {getPermissionLabel(permission)}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {m.admin_users_no_access()}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-muted-foreground">
                        {formatAdminDate(user.createdAt) || m.status_unknown()}
                      </TableCell>
                      <TableCell className="align-top text-muted-foreground">
                        {formatAdminDate(user.updatedAt) || m.status_unknown()}
                      </TableCell>
                      <TableCell className="align-top">
                        {data.policy === 'ALLOWLIST' ? (
                          <p className="max-w-[280px] text-sm text-muted-foreground">
                            {m.admin_users_allowlist_row_locked()}
                          </p>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingUserId(user.id)
                            }}
                          >
                            <SquarePenIcon />
                            {m.admin_users_edit_button()}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          />
        </CardContent>
      </Card>

      <UserPermissionsDialog
        user={editingUser}
        currentUserId={data.currentUserId}
        open={editingUser !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingUserId(null)
          }
        }}
        onSaved={(result) => {
          setUsers((current) =>
            current.map((user) =>
              user.id === result.user.id ? result.user : user,
            ),
          )
          setEditingUserId(null)

          if (!result.updatedSelf) {
            return
          }

          const nextRoute = getDefaultAdminRoute({
            role: result.user.role,
            permissions: result.user.permissions,
          })
          if (nextRoute !== '/admin/users') {
            void navigate({ to: nextRoute })
          }
        }}
      />
    </div>
  )
}

function UserPermissionsDialog(props: {
  user: AdminUserSummary | null
  currentUserId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (result: { user: AdminUserSummary; updatedSelf: boolean }) => void
}) {
  const [selectedPermissions, setSelectedPermissions] = useState<
    AdminPermission[]
  >([])
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setSelectedPermissions(props.user?.permissions || [])
    setSubmitting(false)
    setSaveError(null)
  }, [props.user?.id, props.user?.updatedAt])

  if (!props.user) {
    return null
  }

  const user = props.user
  const nextRole =
    selectedPermissions.length > 0
      ? m.admin_sidebar_role_admin()
      : m.admin_sidebar_role_user()

  async function handleSubmit() {
    setSubmitting(true)
    setSaveError(null)

    try {
      const form = new FormData()
      form.set('userId', user.id)

      for (const permission of selectedPermissions) {
        form.append('permissions', permission)
      }

      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          accept: 'application/json',
        },
        body: form,
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const result =
        (await response.json()) as UpdateAdminUserPermissionsResponse

      props.onSaved({
        user: result.user,
        updatedSelf: Boolean(result.updatedSelf),
      })
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : m.admin_users_save_error_fallback(),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[min(720px,calc(100%-2rem))] gap-5">
        <DialogHeader>
          <DialogTitle>
            {m.admin_users_dialog_title({
              user: getUserPrimaryLabel(props.user),
            })}
          </DialogTitle>
          <DialogDescription>
            {m.admin_users_dialog_description()}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex items-start gap-3">
              <Avatar className="mt-0.5" size="sm">
                <AvatarImage src={props.user.avatarUrl || undefined} />
                <AvatarFallback>{getUserInitials(props.user)}</AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">
                    {getUserPrimaryLabel(props.user)}
                  </span>
                  <Badge
                    variant={
                      selectedPermissions.length > 0 ? 'default' : 'outline'
                    }
                  >
                    {nextRole}
                  </Badge>
                  {props.user.id === props.currentUserId ? (
                    <Badge variant="outline">{m.admin_users_you_badge()}</Badge>
                  ) : null}
                  {props.user.isAllowlistedAdmin ? (
                    <Badge variant="outline">
                      {m.admin_users_allowlist_badge()}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {getUserSecondaryLabel(props.user)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            {adminPermissionValues.map((permission) => (
              <PermissionCheckboxRow
                key={permission}
                checked={selectedPermissions.includes(permission)}
                label={getPermissionLabel(permission)}
                description={getPermissionDescription(permission)}
                onCheckedChange={(checked) => {
                  setSelectedPermissions((current) => {
                    const nextPermissions = checked
                      ? [...current, permission]
                      : current.filter((item) => item !== permission)

                    return adminPermissionValues.filter((item) =>
                      nextPermissions.includes(item),
                    )
                  })
                }}
                disabled={submitting}
              />
            ))}
          </div>

          {saveError ? (
            <Alert variant="destructive">
              <AlertTitle>{m.admin_users_save_failed_title()}</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              props.onOpenChange(false)
            }}
            disabled={submitting}
          >
            {m.ui_close()}
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handleSubmit()
            }}
            disabled={submitting}
          >
            {submitting ? m.oauth_saving() : m.admin_users_save_button()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PermissionCheckboxRow(props: {
  checked: boolean
  label: string
  description: string
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-4">
      <Checkbox
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={(checked) => {
          props.onCheckedChange(checked === true)
        }}
        className="mt-0.5"
      />
      <div className="grid gap-1">
        <div className="text-sm font-medium text-foreground">{props.label}</div>
        <p className="text-sm text-muted-foreground">{props.description}</p>
      </div>
    </div>
  )
}

function getPermissionLabel(permission: AdminPermission) {
  if (permission === 'MAIL_INBOX') {
    return m.admin_users_permission_mail_inbox()
  }

  if (permission === 'MANAGED_IDENTITIES') {
    return m.admin_users_permission_managed_identities()
  }

  if (permission === 'CLI_OPERATIONS') {
    return m.admin_users_permission_cli_operations()
  }

  if (permission === 'MANAGED_SESSIONS') {
    return m.admin_users_permission_managed_sessions()
  }

  if (permission === 'OAUTH_CLIENTS') {
    return m.admin_users_permission_oauth_clients()
  }

  if (permission === 'VERIFICATION_DOMAINS') {
    return m.admin_users_permission_verification_domains()
  }

  return m.admin_users_permission_user_access()
}

function getPermissionDescription(permission: AdminPermission) {
  if (permission === 'MAIL_INBOX') {
    return m.admin_users_permission_mail_inbox_description()
  }

  if (permission === 'MANAGED_IDENTITIES') {
    return m.admin_users_permission_managed_identities_description()
  }

  if (permission === 'CLI_OPERATIONS') {
    return m.admin_users_permission_cli_operations_description()
  }

  if (permission === 'MANAGED_SESSIONS') {
    return m.admin_users_permission_managed_sessions_description()
  }

  if (permission === 'OAUTH_CLIENTS') {
    return m.admin_users_permission_oauth_clients_description()
  }

  if (permission === 'VERIFICATION_DOMAINS') {
    return m.admin_users_permission_verification_domains_description()
  }

  return m.admin_users_permission_user_access_description()
}

function getUserPrimaryLabel(user: AdminUserSummary) {
  return (
    user.name ||
    user.githubLogin ||
    user.email ||
    m.admin_dashboard_unknown_user()
  )
}

function getUserSecondaryLabel(user: AdminUserSummary) {
  if (user.email && user.githubLogin) {
    return `${user.email} · @${user.githubLogin}`
  }

  if (user.email) {
    return user.email
  }

  if (user.githubLogin) {
    return `@${user.githubLogin}`
  }

  return user.id
}

function getUserInitials(user: AdminUserSummary) {
  const label = getUserPrimaryLabel(user).trim()

  if (!label) {
    return 'US'
  }

  const words = label.split(/[\s@._-]+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0]?.slice(0, 1) || ''}${words[1]?.slice(0, 1) || ''}`.toUpperCase()
  }

  return label.slice(0, 2).toUpperCase()
}

function getUserSearchText(user: AdminUserSummary) {
  return [
    user.name,
    user.email,
    user.githubLogin,
    user.id,
    ...user.permissions.flatMap((permission) => [
      permission,
      getPermissionLabel(permission),
      getPermissionDescription(permission),
    ]),
  ]
    .filter(Boolean)
    .join(' ')
}
