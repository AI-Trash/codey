import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { AdminPageHeader } from '#/components/admin/layout'
import {
  AdminMailInbox,
  type AdminMailInboxPageData,
} from '#/components/admin/mail-inbox'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { Button } from '#/components/ui/button'

const loadAdminMailInbox = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [
      { getRequest },
      { requireAdmin },
      { encodeAdminInboxCursor, listAdminInboxEmailsPage },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../lib/server/auth'),
      import('../../lib/server/verification'),
    ])

    const request = getRequest()

    try {
      await requireAdmin(request)
    } catch {
      return { authorized: false as const }
    }

    const loadedAt = new Date().toISOString()
    const initialPage = (await listAdminInboxEmailsPage({
      page: 1,
      pageSize: 25,
      search: '',
    })) as AdminMailInboxPageData

    return {
      authorized: true as const,
      initialPage,
      initialCursor:
        initialPage.emails[0]?.cursor ||
        encodeAdminInboxCursor({
          createdAt: loadedAt,
          id: '',
        }),
    }
  },
)

export const Route = createFileRoute('/admin/emails')({
  loader: async () => loadAdminMailInbox(),
  component: AdminMailInboxPage,
})

function AdminMailInboxPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  return (
    <>
      <AdminPageHeader
        eyebrow="Operations"
        title="Mail inbox"
        description="Dedicated operator workspace for inbound verification email. Full subjects and message bodies stay readable here, and new mail is streamed into the table automatically."
        actions={
          <Button asChild variant="outline">
            <a href="/admin">Back to operations</a>
          </Button>
        }
      />

      <AdminMailInbox
        initialPage={data.initialPage}
        initialCursor={data.initialCursor}
      />
    </>
  )
}
