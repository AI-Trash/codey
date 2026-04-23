import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/flows')({
  component: AdminFlowsLayout,
})

function AdminFlowsLayout() {
  return <Outlet />
}
