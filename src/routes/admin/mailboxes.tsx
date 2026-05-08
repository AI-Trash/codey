import { useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  CreateVerificationDomainDialog,
  type ManagedVerificationDomain,
  VerificationDomainsPageContent,
} from '#/components/admin/verification-domains'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { AdminPageHeader } from '#/components/admin/layout'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { m } from '#/paraglide/messages'

function getLoadErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

const loadVerificationDomains = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [
      { getRequest },
      { requireAdminPermission },
      { listVerificationDomains },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../lib/server/auth'),
      import('../../lib/server/verification-domains'),
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
        domains:
          (await listVerificationDomains()) as ManagedVerificationDomain[],
        loadError: null,
      }
    } catch (error) {
      return {
        authorized: true as const,
        domains: [] as ManagedVerificationDomain[],
        loadError: getLoadErrorMessage(
          error,
          'Unable to load verification mailboxes.',
        ),
      }
    }
  },
)

export const Route = createFileRoute('/admin/mailboxes')({
  validateSearch: (search: Record<string, unknown>) => ({
    create:
      search.create === true ||
      search.create === 'true' ||
      search.create === '1'
        ? true
        : undefined,
  }),
  loader: async () => loadVerificationDomains(),
  component: AdminMailboxesPage,
})

function AdminMailboxesPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [createdDomain, setCreatedDomain] =
    useState<ManagedVerificationDomain | null>(null)

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  function setCreateDialogOpen(open: boolean) {
    void navigate({
      to: '/admin/mailboxes',
      search: {
        create: open ? true : undefined,
      },
      replace: true,
    })
  }

  return (
    <>
      <AdminPageHeader
        eyebrow={m.domain_page_eyebrow()}
        title={m.domain_page_title()}
        description={m.domain_page_description()}
        variant="plain"
        actions={
          <Button
            type="button"
            onClick={() => {
              setCreateDialogOpen(true)
            }}
          >
            {m.domain_create_submit()}
          </Button>
        }
      />

      {data.loadError ? (
        <Alert variant="destructive">
          <AlertTitle>{m.domain_load_failed_title()}</AlertTitle>
          <AlertDescription>
            {data.loadError || m.domain_load_failed_description()}
          </AlertDescription>
        </Alert>
      ) : (
        <VerificationDomainsPageContent
          initialDomains={data.domains}
          createdDomain={createdDomain}
        />
      )}

      {!data.loadError ? (
        <CreateVerificationDomainDialog
          open={Boolean(search.create)}
          onOpenChange={setCreateDialogOpen}
          hasExistingDomains={data.domains.length > 0 || createdDomain !== null}
          onDomainCreated={(domain) => {
            setCreatedDomain(domain)
          }}
        />
      ) : null}
    </>
  )
}
