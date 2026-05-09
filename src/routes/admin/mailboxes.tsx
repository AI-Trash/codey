import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/mailboxes')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/admin/mailboxes/domain',
      search,
      replace: true,
    })
  },
  component: () => null,
})
