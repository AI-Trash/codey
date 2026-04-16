import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { AdminPageHeader } from '../../../components/admin/layout'
import {
  AdminAuthRequired,
  NewOAuthClientPageContent,
} from '../../../components/admin/oauth-clients'
import { Button } from '../../../components/ui/button'

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
        eyebrow="Admin apps"
        title="Register a new OAuth app"
        description="Create a managed client with the scopes and grant toggles your caller needs, then capture the generated secret before you leave this page."
        actions={
          <Button asChild variant="outline">
            <a href="/admin/apps">Back to apps</a>
          </Button>
        }
      />
      <NewOAuthClientPageContent supportedScopes={data.supportedScopes} />
    </>
  )
}
