import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { AdminPageHeader } from '../../../components/admin/layout'
import {
  AdminAuthRequired,
  type ManagedVerificationDomainOption,
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
      { listEnabledVerificationDomains },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../../lib/server/auth'),
      import('../../../lib/server/env'),
      import('../../../lib/server/oauth-scopes'),
      import('../../../lib/server/verification-domains'),
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
      verificationDomains:
        (await listEnabledVerificationDomains()) as ManagedVerificationDomainOption[],
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
        variant="plain"
        actions={
          <>
            <Button asChild variant="outline">
              <a href="/admin/apps">{m.admin_back_to_apps()}</a>
            </Button>
            <Button asChild variant="outline">
              <a href="/admin/domains">{m.admin_manage_domains()}</a>
            </Button>
          </>
        }
      />
      <NewOAuthClientPageContent
        supportedScopes={data.supportedScopes}
        verificationDomains={data.verificationDomains}
      />
    </>
  )
}
