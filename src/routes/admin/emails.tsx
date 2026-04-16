import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { AdminPageHeader } from '#/components/admin/layout'
import {
  AdminMailInbox,
  type AdminMailInboxPageData,
} from '#/components/admin/mail-inbox'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { Button } from '#/components/ui/button'
import { m } from '#/paraglide/messages'

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
        eyebrow={m.admin_nav_operations()}
        title={m.admin_mail_page_title()}
        description={m.admin_mail_page_description()}
        actions={
          <Button asChild variant="outline">
            <a href="/admin">{m.admin_back_to_operations()}</a>
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
