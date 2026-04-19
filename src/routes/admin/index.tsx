import { Navigate, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { hasAdminPermission } from '#/lib/admin-access'

const loadAdminLanding = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ getRequest }, { getSessionUser }] = await Promise.all([
    import('@tanstack/react-start/server'),
    import('../../lib/server/auth'),
  ])
  const request = getRequest()
  const sessionUser = await getSessionUser(request)

  return {
    hasOperationsAccess: hasAdminPermission(sessionUser?.user, 'OPERATIONS'),
    hasOAuthAppsAccess: hasAdminPermission(sessionUser?.user, 'OAUTH_APPS'),
    hasUsersAccess: hasAdminPermission(sessionUser?.user, 'USERS'),
  }
})

export const Route = createFileRoute('/admin/')({
  loader: async () => loadAdminLanding(),
  component: AdminIndexRedirect,
})

function AdminIndexRedirect() {
  const data = Route.useLoaderData()

  if (data.hasOperationsAccess) {
    return <Navigate to="/admin/emails" replace />
  }

  if (data.hasOAuthAppsAccess) {
    return <Navigate to="/admin/apps" replace />
  }

  if (data.hasUsersAccess) {
    return <Navigate to="/admin/users" replace />
  }

  return <Navigate to="/admin/login" replace />
}
