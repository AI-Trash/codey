import { Navigate, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { getDefaultAdminRoute } from '#/lib/admin-access'

const loadAdminLanding = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ getRequest }, { getSessionUser }] = await Promise.all([
    import('@tanstack/react-start/server'),
    import('../../lib/server/auth'),
  ])
  const request = getRequest()
  const sessionUser = await getSessionUser(request)

  return {
    defaultRoute: getDefaultAdminRoute(sessionUser?.user),
  }
})

export const Route = createFileRoute('/admin/')({
  loader: async () => loadAdminLanding(),
  component: AdminIndexRedirect,
})

function AdminIndexRedirect() {
  const data = Route.useLoaderData()

  return <Navigate to={data.defaultRoute} replace />
}
