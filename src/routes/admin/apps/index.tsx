import { useEffect, useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { hasAdminPermission } from '#/lib/admin-access'

import { AdminPageHeader } from '../../../components/admin/layout'
import {
  AdminAuthRequired,
  CreateOAuthClientDialog,
  OAuthClientsList,
  type ManagedOAuthClient,
  type ManagedVerificationDomainOption,
} from '../../../components/admin/oauth-clients'
import { Button } from '../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
import { m } from '#/paraglide/messages'

const loadOAuthClients = createServerFn({ method: 'GET' }).handler(async () => {
  const [
    { getRequest },
    { requireAdminPermission },
    { listOAuthClients },
    { getAppEnv },
    { DEFAULT_OAUTH_SUPPORTED_SCOPES },
    { listEnabledVerificationDomains },
  ] = await Promise.all([
    import('@tanstack/react-start/server'),
    import('../../../lib/server/auth'),
    import('../../../lib/server/oauth-clients'),
    import('../../../lib/server/env'),
    import('../../../lib/server/oauth-scopes'),
    import('../../../lib/server/verification-domains'),
  ])
  const request = getRequest()
  const env = getAppEnv()

  try {
    const admin = await requireAdminPermission(request, 'OAUTH_CLIENTS')

    return {
      authorized: true as const,
      clients: (await listOAuthClients()) as ManagedOAuthClient[],
      supportedScopes: env.oauthSupportedScopes.length
        ? env.oauthSupportedScopes
        : DEFAULT_OAUTH_SUPPORTED_SCOPES,
      verificationDomains:
        (await listEnabledVerificationDomains()) as ManagedVerificationDomainOption[],
      canManageDomains: hasAdminPermission(admin.user, 'VERIFICATION_DOMAINS'),
    }
  } catch {
    return {
      authorized: false as const,
      clients: [] as ManagedOAuthClient[],
      supportedScopes: [] as string[],
      verificationDomains: [] as ManagedVerificationDomainOption[],
      canManageDomains: false,
    }
  }
})

export const Route = createFileRoute('/admin/apps/')({
  validateSearch: (search: Record<string, unknown>) => ({
    create:
      search.create === true ||
      search.create === 'true' ||
      search.create === '1'
        ? true
        : undefined,
  }),
  loader: async () => loadOAuthClients(),
  component: AdminAppsListPage,
})

function AdminAppsListPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [clients, setClients] = useState<ManagedOAuthClient[]>(
    () => data.clients,
  )

  useEffect(() => {
    setClients(data.clients)
  }, [data.clients])

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  function setCreateDialogOpen(open: boolean) {
    void navigate({
      to: '/admin/apps',
      search: {
        create: open ? true : undefined,
      },
      replace: true,
    })
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        <AdminPageHeader
          eyebrow={m.admin_apps_eyebrow()}
          title={m.admin_apps_title()}
          description={m.admin_apps_description()}
          variant="plain"
          actions={
            <>
              {data.canManageDomains ? (
                <Button asChild variant="outline">
                  <a href="/admin/domains">{m.admin_manage_domains()}</a>
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={() => {
                  setCreateDialogOpen(true)
                }}
              >
                {m.admin_register_app()}
              </Button>
            </>
          }
        />

        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CardHeader>
            <CardDescription>{m.admin_apps_inventory_kicker()}</CardDescription>
            <CardTitle>{m.admin_apps_inventory_title()}</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col">
            <OAuthClientsList clients={clients} fillHeight />
          </CardContent>
        </Card>
      </div>

      <CreateOAuthClientDialog
        open={Boolean(search.create)}
        onOpenChange={setCreateDialogOpen}
        supportedScopes={data.supportedScopes}
        verificationDomains={data.verificationDomains}
        onClientCreated={(client) => {
          setClients((current) => [
            client,
            ...current.filter((item) => item.id !== client.id),
          ])
        }}
      />
    </>
  )
}
