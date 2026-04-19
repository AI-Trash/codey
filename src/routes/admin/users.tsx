import { useMemo } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  CalendarIcon,
  ShieldIcon,
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
import {
  AdminMetricCard,
  AdminPageHeader,
  EmptyState,
  formatAdminDate,
} from '#/components/admin/layout'
import { ClientFilterableAdminTable } from '#/components/admin/filterable-table'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { createColumnConfigHelper } from '#/components/data-table-filter/core/filters'
import { getDefaultAdminRoute, type AdminPermission } from '#/lib/admin-access'
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
    const sessionUser = await requireAdminPermission(request, 'USERS')
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

function AdminUsersPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  const users = data.users as AdminUserSummary[]
  const locale = getLocale()
  const consoleAccessCount = users.filter((user) => user.hasConsoleAccess).length
  const pendingAccessCount = users.filter((user) => !user.hasConsoleAccess).length
  const userManagerCount = users.filter((user) =>
    user.permissions.includes('USERS'),
  ).length

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
          <AlertDescription>{m.admin_users_allowlist_description()}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label={m.admin_users_metric_total_label()}
          value={String(users.length)}
          description={m.admin_users_metric_total_description()}
        />
        <AdminMetricCard
          label={m.admin_users_metric_console_access_label()}
          value={String(consoleAccessCount)}
          description={m.admin_users_metric_console_access_description()}
        />
        <AdminMetricCard
          label={m.admin_users_metric_pending_label()}
          value={String(pendingAccessCount)}
          description={m.admin_users_metric_pending_description()}
        />
        <AdminMetricCard
          label={m.admin_users_metric_user_managers_label()}
          value={String(userManagerCount)}
          description={m.admin_users_metric_user_managers_description()}
        />
      </section>

      <Card className="min-h-0 flex-1">
        <CardHeader>
          <CardDescription>{m.admin_users_table_kicker()}</CardDescription>
          <CardTitle>{m.admin_users_table_title()}</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientFilterableAdminTable
            data={users}
            columnsConfig={userColumns}
            emptyState={
              <EmptyState
                title={m.admin_users_empty_title()}
                description={m.admin_users_empty_description()}
              />
            }
            renderTable={(rows) => (
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full min-w-[1380px] caption-bottom text-sm">
                  <thead className="[&_tr]:border-b">
                    <tr className="border-b transition-colors hover:bg-muted/50">
                      <th className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground">
                        {m.admin_users_table_user()}
                      </th>
                      <th className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground">
                        {m.admin_users_table_role()}
                      </th>
                      <th className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground">
                        {m.admin_users_table_access()}
                      </th>
                      <th className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground">
                        {m.admin_users_table_joined()}
                      </th>
                      <th className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground">
                        {m.oauth_clients_table_updated()}
                      </th>
                      <th className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground">
                        {m.admin_dashboard_table_manage()}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0">
                    {rows.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b transition-colors hover:bg-muted/50"
                      >
                        <td className="p-2 align-middle whitespace-nowrap">
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
                        </td>
                        <td className="p-2 align-middle whitespace-nowrap">
                          <Badge variant={user.role === 'ADMIN' ? 'default' : 'outline'}>
                            {user.role === 'ADMIN'
                              ? m.admin_sidebar_role_admin()
                              : m.admin_sidebar_role_user()}
                          </Badge>
                        </td>
                        <td className="p-2 align-middle">
                          <div className="flex max-w-[340px] flex-wrap gap-2">
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
                        </td>
                        <td className="p-2 align-middle whitespace-nowrap text-muted-foreground">
                          {formatAdminDate(user.createdAt) || m.status_unknown()}
                        </td>
                        <td className="p-2 align-middle whitespace-nowrap text-muted-foreground">
                          {formatAdminDate(user.updatedAt) || m.status_unknown()}
                        </td>
                        <td className="p-2 align-middle">
                          {data.policy === 'ALLOWLIST' ? (
                            <p className="max-w-[280px] text-sm text-muted-foreground">
                              {m.admin_users_allowlist_row_locked()}
                            </p>
                          ) : (
                            <UserPermissionsForm user={user} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function UserPermissionsForm(props: { user: AdminUserSummary }) {
  return (
    <form method="post" action="/api/admin/users" className="grid gap-3">
      <input type="hidden" name="userId" value={props.user.id} />
      <input type="hidden" name="redirectTo" value="/admin/users" />
      <div className="flex min-w-[320px] flex-wrap gap-2">
        {(['OPERATIONS', 'OAUTH_APPS', 'USERS'] as const).map((permission) => {
          const id = `${props.user.id}-${permission.toLowerCase()}`

          return (
            <label
              key={permission}
              htmlFor={id}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-foreground"
            >
              <input
                id={id}
                type="checkbox"
                name="permissions"
                value={permission}
                defaultChecked={props.user.permissions.includes(permission)}
                className="size-4 rounded border-input"
              />
              <span>{getPermissionLabel(permission)}</span>
            </label>
          )
        })}
      </div>
      <div>
        <Button type="submit" size="sm">
          {m.admin_users_save_button()}
        </Button>
      </div>
    </form>
  )
}

function getPermissionLabel(permission: AdminPermission) {
  if (permission === 'OPERATIONS') {
    return m.admin_users_permission_operations()
  }

  if (permission === 'OAUTH_APPS') {
    return m.admin_users_permission_oauth_apps()
  }

  return m.admin_users_permission_users()
}

function getUserPrimaryLabel(user: AdminUserSummary) {
  return user.name || user.githubLogin || user.email || m.admin_dashboard_unknown_user()
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
    ...user.permissions,
  ]
    .filter(Boolean)
    .join(' ')
}
