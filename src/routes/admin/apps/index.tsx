import { useEffect, useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import {
  AdminMetricCard,
  AdminPageHeader,
} from '../../../components/admin/layout'
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
    { requireAdmin },
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

  try {
    await requireAdmin(request)
  } catch {
    return {
      authorized: false as const,
      clients: [] as ManagedOAuthClient[],
      supportedScopes: [] as string[],
      verificationDomains: [] as ManagedVerificationDomainOption[],
    }
  }

  const env = getAppEnv()

  return {
    authorized: true as const,
    clients: (await listOAuthClients()) as ManagedOAuthClient[],
    supportedScopes: env.oauthSupportedScopes.length
      ? env.oauthSupportedScopes
      : DEFAULT_OAUTH_SUPPORTED_SCOPES,
    verificationDomains:
      (await listEnabledVerificationDomains()) as ManagedVerificationDomainOption[],
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
  const [clients, setClients] = useState<ManagedOAuthClient[]>(() => data.clients)

  useEffect(() => {
    setClients(data.clients)
  }, [data.clients])

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  const enabledCount = clients.filter((client) => client.enabled).length
  const deviceFlowCount = clients.filter((client) => client.deviceFlowEnabled).length
  const serviceCount = clients.filter(
    (client) => client.clientCredentialsEnabled,
  ).length

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
      <AdminPageHeader
        eyebrow={m.admin_apps_eyebrow()}
        title={m.admin_apps_title()}
        description={m.admin_apps_description()}
        variant="plain"
        actions={
          <>
            <Button asChild variant="outline">
              <a href="/admin/emails">{m.admin_nav_mail_inbox()}</a>
            </Button>
            <Button asChild variant="outline">
              <a href="/admin/domains">{m.admin_manage_domains()}</a>
            </Button>
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label={m.admin_apps_metric_registered_label()}
          value={String(clients.length)}
          description={m.admin_apps_metric_registered_description()}
        />
        <AdminMetricCard
          label={m.admin_apps_metric_enabled_label()}
          value={String(enabledCount)}
          description={m.admin_apps_metric_enabled_description()}
        />
        <AdminMetricCard
          label={m.admin_apps_metric_device_flow_label()}
          value={String(deviceFlowCount)}
          description={m.admin_apps_metric_device_flow_description()}
        />
        <AdminMetricCard
          label={m.admin_apps_metric_service_auth_label()}
          value={String(serviceCount)}
          description={m.admin_apps_metric_service_auth_description()}
        />
      </section>

      <Card>
        <CardHeader>
          <CardDescription>{m.admin_apps_inventory_kicker()}</CardDescription>
          <CardTitle>{m.admin_apps_inventory_title()}</CardTitle>
        </CardHeader>
        <CardContent>
          <OAuthClientsList clients={clients} />
        </CardContent>
      </Card>

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
