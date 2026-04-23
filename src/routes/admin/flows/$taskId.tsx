import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/flows/$taskId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/admin/flows',
      search: {
        taskId: params.taskId,
      },
      replace: true,
    })
  },
  component: () => null,
})
