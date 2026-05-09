import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { hasAdminPermission } from '#/lib/admin-access'
import { AdminPageHeader } from '../../../components/admin/layout'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '../../../components/ui/alert'
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

function getLoadErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

const loadOAuthClient = createServerFn({ method: 'GET' })
  .inputValidator((data: { clientId: string }) => data)
  .handler(async ({ data }) => {
    const [
      { getRequest },
      { requireAdminPermission },
      { getOAuthClientSummaryById },
      { getAppEnv },
      { DEFAULT_OAUTH_SUPPORTED_SCOPES },
      { listRegistrationEnabledVerificationDomains },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../../lib/server/auth'),
      import('../../../lib/server/oauth-clients'),
      import('../../../lib/server/env'),
      import('../../../lib/server/oauth-scopes'),
      import('../../../lib/server/verification-domains'),
    ])
    const request = getRequest()

    let admin
    try {
      admin = await requireAdminPermission(request, 'OAUTH_CLIENTS')
    } catch {
      return { authorized: false as const }
    }

    const env = getAppEnv()
    const appBaseUrl = env.appBaseUrl || new URL(request.url).origin

    try {
      const client = await getOAuthClientSummaryById(data.clientId)
      if (!client) {
        return {
          authorized: true as const,
          client: null,
          appBaseUrl,
          supportedScopes: [] as string[],
          verificationDomains: [] as ManagedVerificationDomainOption[],
          verificationDomainsError: null,
          loadError: null,
          canManageDomains: hasAdminPermission(
            admin.user,
            'VERIFICATION_DOMAINS',
          ),
        }
      }

      const verificationDomainsResult =
        await listRegistrationEnabledVerificationDomains()
          .then((domains) => ({
            domains: domains as ManagedVerificationDomainOption[],
            error: null,
          }))
          .catch((error: unknown) => ({
            domains: [] as ManagedVerificationDomainOption[],
            error: getLoadErrorMessage(
              error,
              'Unable to load verification mailboxes.',
            ),
          }))

      return {
        authorized: true as const,
        client: client as ManagedOAuthClient,
        appBaseUrl,
        supportedScopes: env.oauthSupportedScopes.length
          ? env.oauthSupportedScopes
          : DEFAULT_OAUTH_SUPPORTED_SCOPES,
        verificationDomains: verificationDomainsResult.domains,
        verificationDomainsError: verificationDomainsResult.error,
        loadError: null,
        canManageDomains: hasAdminPermission(
          admin.user,
          'VERIFICATION_DOMAINS',
        ),
      }
    } catch (error) {
      return {
        authorized: true as const,
        client: null,
        appBaseUrl,
        supportedScopes: [] as string[],
        verificationDomains: [] as ManagedVerificationDomainOption[],
        verificationDomainsError: null,
        loadError: getLoadErrorMessage(error, 'Unable to load OAuth app.'),
        canManageDomains: hasAdminPermission(
          admin.user,
          'VERIFICATION_DOMAINS',
        ),
      }
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

  if (data.loadError) {
    return (
      <div className="grid gap-4">
        <AdminPageHeader
          eyebrow={m.admin_apps_eyebrow()}
          title={m.admin_apps_title()}
          description={m.admin_apps_description()}
          variant="plain"
        />
        <Alert variant="destructive">
          <AlertTitle>{m.oauth_clients_load_failed_title()}</AlertTitle>
          <AlertDescription>
            {data.loadError || m.oauth_clients_load_failed_description()}
          </AlertDescription>
        </Alert>
      </div>
    )
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
            {data.canManageDomains ? (
              <Button asChild variant="outline">
                <Link to="/admin/mailboxes/domain">
                  {m.admin_manage_domains()}
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link to="/admin/apps" search={{ create: true }}>
                {m.admin_register_another_app()}
              </Link>
            </Button>
          </>
        }
      />
      {data.verificationDomainsError ? (
        <Alert variant="destructive">
          <AlertTitle>{m.domain_load_failed_title()}</AlertTitle>
          <AlertDescription>
            {data.verificationDomainsError ||
              m.domain_load_failed_description()}
          </AlertDescription>
        </Alert>
      ) : null}
      <EditOAuthClientPageContent
        initialClient={data.client}
        supportedScopes={data.supportedScopes}
        verificationDomains={data.verificationDomains}
        appBaseUrl={data.appBaseUrl}
      />
    </>
  )
}
