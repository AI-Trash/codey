import {
  Navigate,
  Outlet,
  createFileRoute,
  useRouterState,
} from '@tanstack/react-router'

export const Route = createFileRoute('/admin/mailboxes')({
  component: AdminMailboxesLayout,
})

function AdminMailboxesLayout() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  if (pathname === '/admin/mailboxes') {
    return <Navigate to="/admin/mailboxes/domain" replace />
  }

  return <Outlet />
}
