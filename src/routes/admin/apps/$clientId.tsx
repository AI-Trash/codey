import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { hasAdminPermission } from '#/lib/admin-access'
import { AdminPageHeader } from '../../../components/admin/layout'
import {
  AdminAuthRequired,
  EditOAuthClientPageContent,
  type ManagedOAuthClient,
  type ManagedVerificationDomainOption,
} from '../../../components/admin/oauth-clients'
import { Button } from '../../../components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
import { InfoTooltip } from '../../../components/ui/info-tooltip'
import { m } from '#/paraglide/messages'

const loadOAuthClient = createServerFn({ method: 'GET' })
  .inputValidator((data: { clientId: string }) => data)
  .handler(async ({ data }) => {
    const [
      { getRequest },
      { requireAdminPermission },
      { getOAuthClientSummaryById },
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
      const admin = await requireAdminPermission(request, 'OAUTH_CLIENTS')

      const client = await getOAuthClientSummaryById(data.clientId)
      if (!client) {
        return {
          authorized: true as const,
          client: null,
          supportedScopes: [] as string[],
          verificationDomains: [] as ManagedVerificationDomainOption[],
          canManageDomains: hasAdminPermission(
            admin.user,
            'VERIFICATION_DOMAINS',
          ),
        }
      }

      const env = getAppEnv()

      return {
        authorized: true as const,
        client: client as ManagedOAuthClient,
        supportedScopes: env.oauthSupportedScopes.length
          ? env.oauthSupportedScopes
          : DEFAULT_OAUTH_SUPPORTED_SCOPES,
        verificationDomains:
          (await listEnabledVerificationDomains()) as ManagedVerificationDomainOption[],
        canManageDomains: hasAdminPermission(
          admin.user,
          'VERIFICATION_DOMAINS',
        ),
      }
    } catch {
      return { authorized: false as const }
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
          <div className="flex items-start gap-2">
            <CardTitle>{m.admin_app_not_found_title()}</CardTitle>
            <InfoTooltip
              content={m.admin_app_not_found_description()}
              label={m.admin_app_not_found_title()}
              className="mt-0.5"
            />
          </div>
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
            {data.canManageDomains ? (
              <Button asChild variant="outline">
                <a href="/admin/domains">{m.admin_manage_domains()}</a>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <a href="/admin/apps?create=true">
                {m.admin_register_another_app()}
              </a>
            </Button>
          </>
        }
      />
      <EditOAuthClientPageContent
        initialClient={data.client}
        supportedScopes={data.supportedScopes}
        verificationDomains={data.verificationDomains}
      />
    </>
  )
}
