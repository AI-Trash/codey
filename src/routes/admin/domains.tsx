import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  type ManagedVerificationDomain,
  VerificationDomainsPageContent,
} from '#/components/admin/verification-domains'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import {
  AdminMetricCard,
  AdminPageHeader,
} from '#/components/admin/layout'
import { Button } from '#/components/ui/button'
import { m } from '#/paraglide/messages'

const loadVerificationDomains = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [{ getRequest }, { requireAdmin }, { listVerificationDomains }] =
      await Promise.all([
        import('@tanstack/react-start/server'),
        import('../../lib/server/auth'),
        import('../../lib/server/verification-domains'),
      ])
    const request = getRequest()

    try {
      await requireAdmin(request)
    } catch {
      return { authorized: false as const }
    }

    return {
      authorized: true as const,
      domains: (await listVerificationDomains()) as ManagedVerificationDomain[],
    }
  },
)

export const Route = createFileRoute('/admin/domains')({
  loader: async () => loadVerificationDomains(),
  component: AdminDomainsPage,
})

function AdminDomainsPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  const enabledCount = data.domains.filter((domain) => domain.enabled).length
  const defaultCount = data.domains.filter((domain) => domain.isDefault).length
  const linkedAppCount = data.domains.reduce(
    (total, domain) => total + domain.appCount,
    0,
  )

  return (
    <>
      <AdminPageHeader
        eyebrow={m.domain_page_eyebrow()}
        title={m.domain_page_title()}
        description={m.domain_page_description()}
        variant="plain"
        actions={
          <>
            <Button asChild variant="outline">
              <a href="/admin/apps">{m.admin_back_to_apps()}</a>
            </Button>
            <Button asChild>
              <a href="/admin/apps?create=true">{m.admin_register_app()}</a>
            </Button>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label={m.domain_metric_registered_label()}
          value={String(data.domains.length)}
          description={m.domain_metric_registered_description()}
        />
        <AdminMetricCard
          label={m.domain_metric_enabled_label()}
          value={String(enabledCount)}
          description={m.domain_metric_enabled_description()}
        />
        <AdminMetricCard
          label={m.domain_metric_default_label()}
          value={String(defaultCount)}
          description={m.domain_metric_default_description()}
        />
        <AdminMetricCard
          label={m.domain_metric_linked_apps_label()}
          value={String(linkedAppCount)}
          description={m.domain_metric_linked_apps_description()}
        />
      </section>

      <VerificationDomainsPageContent initialDomains={data.domains} />
    </>
  )
}
