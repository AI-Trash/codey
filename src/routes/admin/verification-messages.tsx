import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { AdminPageHeader } from '#/components/admin/layout'
import {
  AdminVerificationMessages,
  type AdminVerificationMessagesPageData,
} from '#/components/admin/verification-messages'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { m } from '#/paraglide/messages'

const loadAdminVerificationMessages = createServerFn({
  method: 'GET',
}).handler(async () => {
  const [
    { getRequest },
    { requireAdminPermission },
    { encodeAdminInboxCursor, listAdminVerificationMessagesPage },
  ] = await Promise.all([
    import('@tanstack/react-start/server'),
    import('../../lib/server/auth'),
    import('../../lib/server/verification'),
  ])

  const request = getRequest()

  try {
    await requireAdminPermission(request, 'VERIFICATION_MESSAGES')
  } catch {
    return { authorized: false as const }
  }

  const loadedAt = new Date().toISOString()
  const initialPage = (await listAdminVerificationMessagesPage({
    page: 1,
    pageSize: 25,
    search: '',
  })) as AdminVerificationMessagesPageData

  return {
    authorized: true as const,
    initialPage,
    initialCursor:
      initialPage.messages[0]?.cursor ||
      encodeAdminInboxCursor({
        createdAt: loadedAt,
        id: '',
      }),
  }
})

export const Route = createFileRoute('/admin/verification-messages')({
  loader: async () => loadAdminVerificationMessages(),
  component: AdminVerificationMessagesPage,
})

function AdminVerificationMessagesPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <AdminPageHeader
        title={m.admin_mail_page_title()}
        description={m.admin_mail_page_description()}
        variant="plain"
      />

      <AdminVerificationMessages
        initialPage={data.initialPage}
        initialCursor={data.initialCursor}
      />
    </div>
  )
}
