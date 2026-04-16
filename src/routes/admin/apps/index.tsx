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
        eyebrow="Admin apps"
        title="Managed OAuth clients"
        description="Register, inspect, and maintain OAuth apps that use client credentials or admin-approved device flow inside Codey."
        actions={
          <>
            <Button asChild variant="outline">
              <a href="/admin">Back to operations</a>
            </Button>
            <Button asChild>
              <a href="/admin/apps/new">Register app</a>
            </Button>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="Registered apps"
          value={String(data.clients.length)}
          description="Managed OAuth clients available in the registry."
        />
        <AdminMetricCard
          label="Enabled"
          value={String(enabledCount)}
          description="Clients currently able to mint tokens."
        />
        <AdminMetricCard
          label="Device flow"
          value={String(deviceFlowCount)}
          description="Apps that can request browser approvals."
        />
        <AdminMetricCard
          label="Service auth"
          value={String(serviceCount)}
          description="Clients that support client credentials."
        />
      </section>

      <Card>
        <CardHeader>
          <CardDescription>Client inventory</CardDescription>
          <CardTitle>OAuth app registry</CardTitle>
        </CardHeader>
        <CardContent>
          <OAuthClientsList clients={data.clients} />
        </CardContent>
      </Card>
    </>
  )
}
