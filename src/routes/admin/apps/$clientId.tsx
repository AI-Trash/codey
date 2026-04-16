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
import { m } from '#/paraglide/messages'

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
          <CardDescription>{m.admin_apps_eyebrow()}</CardDescription>
          <CardTitle>{m.admin_app_not_found_title()}</CardTitle>
          <CardDescription>{m.admin_app_not_found_description()}</CardDescription>
        </CardHeader>
        <div className="px-6 pb-6">
          <Button asChild>
            <a href="/admin/apps">{m.admin_back_to_apps()}</a>
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <>
      <AdminPageHeader
        eyebrow={m.admin_apps_eyebrow()}
        title={data.client.clientName}
        description={m.admin_app_detail_description()}
        actions={
          <>
            <Button asChild variant="outline">
              <a href="/admin/apps">{m.admin_back_to_apps()}</a>
            </Button>
            <Button asChild variant="outline">
              <a href="/admin/apps/new">{m.admin_register_another_app()}</a>
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
