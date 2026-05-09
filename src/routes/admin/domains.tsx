import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/domains')({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/admin/mailboxes/domain',
      search,
      replace: true,
    })
  },
  component: () => null,
})
