import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  AdminMetricCard,
  AdminPageHeader,
} from '../../../components/admin/layout'
import {
  AdminAuthRequired,
  OAuthClientsList,
  type ManagedOAuthClient,
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
  const [{ getRequest }, { requireAdmin }, { listOAuthClients }] =
    await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../../lib/server/auth'),
      import('../../../lib/server/oauth-clients'),
    ])
  const request = getRequest()

  try {
    await requireAdmin(request)
  } catch {
    return { authorized: false as const }
  }

  return {
    authorized: true as const,
    clients: (await listOAuthClients()) as ManagedOAuthClient[],
  }
})

export const Route = createFileRoute('/admin/apps/')({
  loader: async () => loadOAuthClients(),
  component: AdminAppsListPage,
})

function AdminAppsListPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  const enabledCount = data.clients.filter((client) => client.enabled).length
  const deviceFlowCount = data.clients.filter(
    (client) => client.deviceFlowEnabled,
  ).length
  const serviceCount = data.clients.filter(
    (client) => client.clientCredentialsEnabled,
  ).length

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
              <a href="/admin">{m.admin_back_to_operations()}</a>
            </Button>
            <Button asChild>
              <a href="/admin/apps/new">{m.admin_register_app()}</a>
            </Button>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label={m.admin_apps_metric_registered_label()}
          value={String(data.clients.length)}
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
          <OAuthClientsList clients={data.clients} />
        </CardContent>
      </Card>
    </>
  )
}
