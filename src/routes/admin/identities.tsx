import { useMemo } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { CalendarIcon, HashIcon, SearchIcon, ShieldIcon } from 'lucide-react'

import {
  AdminMetricCard,
  AdminPageHeader,
  EmptyState,
  StatusBadge,
  formatAdminDate,
} from '#/components/admin/layout'
import { ClientFilterableAdminTable } from '#/components/admin/filterable-table'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { createColumnConfigHelper } from '#/components/data-table-filter/core/filters'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { CopyableValue } from '#/components/ui/copyable-value'
import { InfoTooltip } from '#/components/ui/info-tooltip'
import { Input } from '#/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { translateStatusLabel } from '#/lib/i18n'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

const loadAdminIdentities = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [{ getRequest }, { requireAdmin }, { listAdminIdentitySummaries }] =
      await Promise.all([
        import('@tanstack/react-start/server'),
        import('../../lib/server/auth'),
        import('../../lib/server/identities'),
      ])

    const request = getRequest()

    try {
      await requireAdmin(request)
    } catch {
      return { authorized: false as const }
    }

    const identityState = await listAdminIdentitySummaries()
    return {
      authorized: true as const,
      identitySummaries: identityState,
    }
  },
)

export const Route = createFileRoute('/admin/identities')({
  loader: async () => loadAdminIdentities(),
  component: AdminIdentitiesPage,
})

type IdentitySummary = {
  id: string
  label: string
  provider?: string | null
  account?: string | null
  flowCount?: number | null
  lastSeenAt?: string | Date | null
  status?: string | null
}

function AdminIdentitiesPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  const identitySummaries = data.identitySummaries as IdentitySummary[]
  const locale = getLocale()

  const activeCount = identitySummaries.filter(
    (summary) => summary.status === 'active',
  ).length
  const reviewCount = identitySummaries.filter(
    (summary) => summary.status === 'review',
  ).length
  const archivedCount = identitySummaries.filter(
    (summary) => summary.status === 'archived',
  ).length

  const identityColumns = useMemo(() => {
    const dtf = createColumnConfigHelper<IdentitySummary>()
    return [
      dtf
        .text()
        .id('identity')
        .accessor((summary) => summary.label)
        .displayName(m.admin_dashboard_table_identity())
        .icon(SearchIcon)
        .build(),
      dtf
        .text()
        .id('account')
        .accessor((summary) => summary.account || m.admin_dashboard_not_linked_yet())
        .displayName(m.admin_dashboard_table_account())
        .icon(SearchIcon)
        .build(),
      dtf
        .text()
        .id('provider')
        .accessor(
          (summary) => summary.provider || m.admin_dashboard_saved_identity(),
        )
        .displayName(m.admin_dashboard_table_provider())
        .icon(SearchIcon)
        .build(),
      dtf
        .number()
        .id('flows')
        .accessor((summary) => summary.flowCount ?? undefined)
        .displayName(m.admin_dashboard_table_flows())
        .icon(HashIcon)
        .build(),
      dtf
        .date()
        .id('lastSeen')
        .accessor((summary) => normalizeDate(summary.lastSeenAt))
        .displayName(m.admin_dashboard_table_last_seen())
        .icon(CalendarIcon)
        .build(),
      dtf
        .option()
        .id('status')
        .accessor((summary) => summary.status || 'unknown')
        .displayName(m.oauth_clients_table_status())
        .icon(ShieldIcon)
        .transformOptionFn((status) => ({
          label: translateStatusLabel(status),
          value: status,
        }))
        .build(),
    ] as const
  }, [locale])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <AdminPageHeader
        eyebrow={m.admin_nav_operations()}
        title={m.admin_identity_page_title()}
        description={m.admin_identity_page_description()}
        variant="plain"
        actions={
          <Button asChild variant="outline">
            <a href="/admin">{m.admin_back_to_operations()}</a>
          </Button>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label={m.admin_identity_metric_total_label()}
          value={String(identitySummaries.length)}
          description={m.admin_identity_metric_total_description()}
        />
        <AdminMetricCard
          label={m.admin_identity_metric_active_label()}
          value={String(activeCount)}
          description={m.admin_identity_metric_active_description()}
        />
        <AdminMetricCard
          label={m.admin_identity_metric_review_label()}
          value={String(reviewCount)}
          description={m.admin_identity_metric_review_description()}
        />
        <AdminMetricCard
          label={m.admin_identity_metric_archived_label()}
          value={String(archivedCount)}
          description={m.admin_identity_metric_archived_description()}
        />
      </section>

      <Card className="min-h-0 flex-1">
        <CardHeader>
          <CardDescription>{m.admin_dashboard_identities_kicker()}</CardDescription>
          <div className="flex items-start gap-2">
            <CardTitle>{m.admin_dashboard_identities_title()}</CardTitle>
            <InfoTooltip
              content={m.admin_dashboard_identities_description()}
              label={m.admin_dashboard_identities_title()}
              className="mt-0.5"
            />
          </div>
        </CardHeader>
        <CardContent>
          <ClientFilterableAdminTable
            data={identitySummaries}
            columnsConfig={identityColumns}
            emptyState={
              <EmptyState
                title={m.admin_dashboard_identities_empty_title()}
                description={m.admin_dashboard_identities_empty_description()}
              />
            }
            renderTable={(rows) => (
              <Table className="min-w-[1200px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{m.admin_dashboard_table_identity()}</TableHead>
                    <TableHead>{m.admin_dashboard_table_account()}</TableHead>
                    <TableHead>{m.admin_dashboard_table_provider()}</TableHead>
                    <TableHead>{m.admin_dashboard_table_flows()}</TableHead>
                    <TableHead>{m.admin_dashboard_table_last_seen()}</TableHead>
                    <TableHead>{m.oauth_clients_table_status()}</TableHead>
                    <TableHead>{m.admin_dashboard_table_manage()}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((summary) => (
                    <TableRow key={summary.id}>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">
                            {summary.label}
                          </div>
                          <CopyableValue
                            value={summary.id}
                            code
                            title={m.clipboard_copy_value({
                              label: m.admin_dashboard_identity_id_label(),
                            })}
                            className="max-w-full text-sm text-muted-foreground"
                            contentClassName="break-all"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {summary.account ? (
                          <CopyableValue
                            value={summary.account}
                            title={m.clipboard_copy_value({
                              label: m.admin_dashboard_account_email_label(),
                            })}
                            className="max-w-full"
                            contentClassName="break-all"
                          />
                        ) : (
                          m.admin_dashboard_not_linked_yet()
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {summary.provider || m.admin_dashboard_saved_identity()}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {summary.flowCount && summary.flowCount > 0
                          ? m.admin_dashboard_flow_count({
                              count: String(summary.flowCount),
                            })
                          : '0'}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {formatAdminDate(summary.lastSeenAt) ||
                          m.admin_dashboard_not_captured_yet()}
                      </TableCell>
                      <TableCell className="align-top">
                        <StatusBadge value={summary.status || 'unknown'} />
                      </TableCell>
                      <TableCell className="align-top">
                        <IdentityRowActions summary={summary} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function IdentityRowActions(props: { summary: IdentitySummary }) {
  const { summary } = props
  const labelDefaultValue =
    summary.label !== summary.account ? summary.label : ''

  return (
    <div className="grid min-w-[360px] gap-3">
      <form
        method="post"
        action="/api/admin/identities"
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
      >
        <IdentityActionFields summary={summary} />
        <Input
          name="label"
          defaultValue={labelDefaultValue}
          placeholder={summary.account || m.admin_dashboard_identity_label()}
          className="h-8"
        />
        <Button
          type="submit"
          name="intent"
          value="save-label"
          size="sm"
          variant="outline"
          className="sm:shrink-0"
        >
          {m.admin_identity_update_label_button()}
        </Button>
      </form>

      <div className="flex flex-wrap gap-2">
        <IdentityStatusActionButton
          summary={summary}
          intent="activate"
          active={summary.status === 'active'}
          label={m.status_active()}
        />
        <IdentityStatusActionButton
          summary={summary}
          intent="review"
          active={summary.status === 'review'}
          label={m.status_review()}
        />
        <IdentityStatusActionButton
          summary={summary}
          intent="archive"
          active={summary.status === 'archived'}
          label={m.status_archived()}
        />
        <IdentityDeleteAction summary={summary} />
      </div>
    </div>
  )
}

function IdentityActionFields(props: { summary: IdentitySummary }) {
  return (
    <>
      <input type="hidden" name="identityId" value={props.summary.id} />
      <input
        type="hidden"
        name="email"
        value={props.summary.account || props.summary.label}
      />
      <input type="hidden" name="redirectTo" value="/admin/identities" />
    </>
  )
}

function IdentityStatusActionButton(props: {
  summary: IdentitySummary
  intent: 'activate' | 'review' | 'archive'
  active: boolean
  label: string
}) {
  return (
    <form method="post" action="/api/admin/identities">
      <IdentityActionFields summary={props.summary} />
      <Button
        type="submit"
        name="intent"
        value={props.intent}
        size="sm"
        variant={props.active ? 'default' : 'outline'}
      >
        {props.label}
      </Button>
    </form>
  )
}

function IdentityDeleteAction(props: { summary: IdentitySummary }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" variant="destructive">
          {m.admin_identity_delete_button()}
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {m.admin_identity_delete_confirm_title()}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {m.admin_identity_delete_confirm_description()}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>{m.ui_close()}</AlertDialogCancel>
          <form method="post" action="/api/admin/identities">
            <IdentityActionFields summary={props.summary} />
            <Button
              type="submit"
              name="intent"
              value="delete"
              size="sm"
              variant="destructive"
            >
              {m.admin_identity_delete_button()}
            </Button>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function normalizeDate(value?: string | Date | null) {
  if (!value) {
    return undefined
  }

  const normalized = value instanceof Date ? value : new Date(value)
  return Number.isNaN(normalized.getTime()) ? undefined : normalized
}
