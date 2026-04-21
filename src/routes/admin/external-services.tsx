import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { ExternalServicesPageContent } from '#/components/admin/external-services'
import { AdminPageHeader } from '#/components/admin/layout'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { m } from '#/paraglide/messages'

const loadExternalServices = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [{ getRequest }, { requireAdminPermission }, { getSub2ApiServiceSummary }] =
      await Promise.all([
        import('@tanstack/react-start/server'),
        import('../../lib/server/auth'),
        import('../../lib/server/external-service-configs'),
      ])

    const request = getRequest()

    try {
      await requireAdminPermission(request, 'OAUTH_CLIENTS')

      return {
        authorized: true as const,
        sub2api: await getSub2ApiServiceSummary(),
      }
    } catch {
      return { authorized: false as const }
    }
  },
)

export const Route = createFileRoute('/admin/external-services')({
  loader: async () => loadExternalServices(),
  component: AdminExternalServicesPage,
})

function AdminExternalServicesPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <AdminPageHeader
        eyebrow={m.external_services_page_eyebrow()}
        title={m.external_services_page_title()}
        description={m.external_services_page_description()}
        variant="plain"
      />

      <ExternalServicesPageContent initialSub2Api={data.sub2api} />
    </div>
  )
}
