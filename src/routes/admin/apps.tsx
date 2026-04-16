import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/apps')({
  component: AdminAppsLayout,
})

function AdminAppsLayout() {
  return <Outlet />
}
