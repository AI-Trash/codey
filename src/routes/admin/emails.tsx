import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import {
  AdminMetricCard,
  AdminPageHeader,
  formatAdminDate,
} from '#/components/admin/layout'
import {
  AdminMailInbox,
  type AdminMailInboxEmail,
} from '#/components/admin/mail-inbox'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { Button } from '#/components/ui/button'

const loadAdminMailInbox = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [{ getRequest }, { requireAdmin }, { encodeAdminInboxCursor, listAdminInboxEmails }] =
      await Promise.all([
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
    const emails = (await listAdminInboxEmails({
      limit: 100,
    })) as AdminMailInboxEmail[]

    return {
      authorized: true as const,
      emails,
      initialCursor:
        emails[0]?.cursor ||
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

  const codeReadyCount = data.emails.filter((email) => email.latestCode).length
  const linkedReservationCount = data.emails.filter(
    (email) => email.reservationEmail,
  ).length
  const newestReceivedAt = formatAdminDate(data.emails[0]?.receivedAt)

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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="Loaded emails"
          value={String(data.emails.length)}
          description="Newest inbound emails currently loaded into the dedicated inbox view."
        />
        <AdminMetricCard
          label="Codes visible"
          value={String(codeReadyCount)}
          description="Loaded messages already associated with a verification code."
        />
        <AdminMetricCard
          label="Reservations linked"
          value={String(linkedReservationCount)}
          description="Emails that still resolve to an app-managed reservation alias."
        />
        <AdminMetricCard
          label="Latest delivery"
          value={newestReceivedAt || 'Waiting'}
          description="The most recent inbound message currently visible in the table."
        />
      </section>

      <AdminMailInbox
        initialEmails={data.emails}
        initialCursor={data.initialCursor}
      />
    </>
  )
}
