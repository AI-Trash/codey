import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/apps/new')({
  beforeLoad: () => {
    throw redirect({
      to: '/admin/apps',
      search: {
        create: true,
      },
    })
  },
  component: () => null,
})
