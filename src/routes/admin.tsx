import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { AdminShell } from '#/components/admin/layout'
import { hasAnyAdminPermission } from '#/lib/admin-access'

const loadAdminShellUser = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [{ getRequest }, { getSessionUser }] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../lib/server/auth'),
    ])

    const request = getRequest()
    const sessionUser = await getSessionUser(request)

    if (!sessionUser || !hasAnyAdminPermission(sessionUser.user)) {
      return null
    }

    return {
      name: sessionUser.user.name,
      email: sessionUser.user.email,
      githubLogin: sessionUser.user.githubLogin,
      avatarUrl: sessionUser.user.avatarUrl,
      role: sessionUser.user.role,
      permissions: sessionUser.user.permissions,
    }
  },
)

export const Route = createFileRoute('/admin')({
  loader: async () => ({
    currentUser: await loadAdminShellUser(),
  }),
  component: AdminLayout,
})

function AdminLayout() {
  const data = Route.useLoaderData()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  if (pathname === '/admin/login') {
    return <Outlet />
  }

  return (
    <AdminShell currentUser={data.currentUser}>
      <Outlet />
    </AdminShell>
  )
}
