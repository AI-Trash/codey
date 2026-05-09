import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { AdminPageHeader } from '#/components/admin/layout'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import {
  PersonalMailboxesPageContent,
  type ManagedPersonalMailbox,
} from '#/components/admin/personal-mailboxes'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { m } from '#/paraglide/messages'

function getLoadErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

const loadPersonalMailboxes = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [
      { getRequest },
      { requireAdminPermission },
      { listPersonalMailboxes },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../../lib/server/auth'),
      import('../../../lib/server/personal-mailboxes'),
    ])
    const request = getRequest()

    try {
      await requireAdminPermission(request, 'VERIFICATION_DOMAINS')
    } catch {
      return { authorized: false as const }
    }

    try {
      return {
        authorized: true as const,
        mailboxes: (await listPersonalMailboxes()) as ManagedPersonalMailbox[],
        loadError: null,
      }
    } catch (error) {
      return {
        authorized: true as const,
        mailboxes: [] as ManagedPersonalMailbox[],
        loadError: getLoadErrorMessage(
          error,
          'Unable to load personal mailboxes.',
        ),
      }
    }
  },
)

export const Route = createFileRoute('/admin/mailboxes/personal')({
  loader: async () => loadPersonalMailboxes(),
  component: AdminPersonalMailboxesPage,
})

function AdminPersonalMailboxesPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  return (
    <>
      <AdminPageHeader
        eyebrow={m.personal_mailbox_page_eyebrow()}
        title={m.personal_mailbox_page_title()}
        description={m.personal_mailbox_page_description()}
        variant="plain"
      />

      {data.loadError ? (
        <Alert variant="destructive">
          <AlertTitle>{m.personal_mailbox_load_failed_title()}</AlertTitle>
          <AlertDescription>
            {data.loadError || m.personal_mailbox_load_failed_description()}
          </AlertDescription>
        </Alert>
      ) : (
        <PersonalMailboxesPageContent initialMailboxes={data.mailboxes} />
      )}
    </>
  )
}
