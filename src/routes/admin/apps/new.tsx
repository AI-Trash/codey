import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { AdminPageHeader } from '../../../components/admin/layout'
import {
  AdminAuthRequired,
  NewOAuthClientPageContent,
} from '../../../components/admin/oauth-clients'
import { Button } from '../../../components/ui/button'
import { m } from '#/paraglide/messages'

const loadOAuthClientRegistration = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [
      { getRequest },
      { requireAdmin },
      { getAppEnv },
      { DEFAULT_OAUTH_SUPPORTED_SCOPES },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../../lib/server/auth'),
      import('../../../lib/server/env'),
      import('../../../lib/server/oauth-scopes'),
    ])
    const request = getRequest()

    try {
      await requireAdmin(request)
    } catch {
      return { authorized: false as const }
    }

    const env = getAppEnv()

    return {
      authorized: true as const,
      supportedScopes: env.oauthSupportedScopes.length
        ? env.oauthSupportedScopes
        : DEFAULT_OAUTH_SUPPORTED_SCOPES,
    }
  },
)

export const Route = createFileRoute('/admin/apps/new')({
  loader: async () => loadOAuthClientRegistration(),
  component: AdminAppsNewPage,
})

function AdminAppsNewPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  return (
    <>
      <AdminPageHeader
        eyebrow={m.admin_apps_eyebrow()}
        title={m.admin_apps_new_title()}
        description={m.admin_apps_new_description()}
        actions={
          <Button asChild variant="outline">
            <a href="/admin/apps">{m.admin_back_to_apps()}</a>
          </Button>
        }
      />
      <NewOAuthClientPageContent supportedScopes={data.supportedScopes} />
    </>
  )
}
