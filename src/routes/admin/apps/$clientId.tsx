import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { AdminPageHeader } from '../../../components/admin/layout'
import {
  AdminAuthRequired,
  EditOAuthClientPageContent,
  type ManagedOAuthClient,
} from '../../../components/admin/oauth-clients'
import { Button } from '../../../components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'

const loadOAuthClient = createServerFn({ method: 'GET' })
  .inputValidator((data: { clientId: string }) => data)
  .handler(async ({ data }) => {
    const [
      { getRequest },
      { requireAdmin },
      { getOAuthClientSummaryById },
      { getAppEnv },
      { DEFAULT_OAUTH_SUPPORTED_SCOPES },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../../lib/server/auth'),
      import('../../../lib/server/oauth-clients'),
      import('../../../lib/server/env'),
      import('../../../lib/server/oauth-scopes'),
    ])
    const request = getRequest()

    try {
      await requireAdmin(request)
    } catch {
      return { authorized: false as const }
    }

    const client = await getOAuthClientSummaryById(data.clientId)
    if (!client) {
      return {
        authorized: true as const,
        client: null,
        supportedScopes: [] as string[],
      }
    }

    const env = getAppEnv()

    return {
      authorized: true as const,
      client: client as ManagedOAuthClient,
      supportedScopes: env.oauthSupportedScopes.length
        ? env.oauthSupportedScopes
        : DEFAULT_OAUTH_SUPPORTED_SCOPES,
    }
  })

export const Route = createFileRoute('/admin/apps/$clientId')({
  loader: async ({ params }) =>
    loadOAuthClient({ data: { clientId: params.clientId } }),
  component: AdminAppsDetailPage,
})

function AdminAppsDetailPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  if (!data.client) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardDescription>Admin apps</CardDescription>
          <CardTitle>OAuth app not found</CardTitle>
          <CardDescription>
            The requested managed client is missing or has been removed. Return
            to the apps list to choose another record.
          </CardDescription>
        </CardHeader>
        <div className="px-6 pb-6">
          <Button asChild>
            <a href="/admin/apps">Back to apps</a>
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin apps"
        title={data.client.clientName}
        description="Update app metadata, change grant support, reveal the stored secret when needed, or rotate it to replace the previous credential."
        actions={
          <>
            <Button asChild variant="outline">
              <a href="/admin/apps">Back to apps</a>
            </Button>
            <Button asChild variant="outline">
              <a href="/admin/apps/new">Register another app</a>
            </Button>
          </>
        }
      />
      <EditOAuthClientPageContent
        initialClient={data.client}
        supportedScopes={data.supportedScopes}
      />
    </>
  )
}
