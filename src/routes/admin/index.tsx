import { type ReactNode, useMemo } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { CalendarIcon, HashIcon, SearchIcon, ShieldIcon } from 'lucide-react'

import { ClientFilterableAdminTable } from '#/components/admin/filterable-table'
import {
  AdminMetricCard,
  AdminPageHeader,
  EmptyState,
  StatusBadge,
  formatAdminDate,
  getStatusTone,
} from '#/components/admin/layout'
import { createColumnConfigHelper } from '#/components/data-table-filter/core/filters'
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
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { translateStatusLabel } from '#/lib/i18n'
import { Textarea } from '#/components/ui/textarea'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

const loadDashboard = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ getRequest }, { requireAdmin }, { listAdminDashboardData }] =
    await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../lib/server/auth'),
      import('../../lib/server/admin'),
    ])
  const request = getRequest()
  let sessionUser
  try {
    sessionUser = await requireAdmin(request)
  } catch {
    return { authorized: false as const }
  }

  const data = await listAdminDashboardData()
  return {
    authorized: true as const,
    user: {
      name: sessionUser.user.name,
      email: sessionUser.user.email,
      githubLogin: sessionUser.user.githubLogin,
      role: sessionUser.user.role,
      avatarUrl: sessionUser.user.avatarUrl,
    },
    ...data,
  }
})

export const Route = createFileRoute('/admin/')({
  loader: async () => loadDashboard(),
  component: AdminPage,
})

type VerificationData = {
  codes?: Array<{
    id: string
    code: string
    source: string
    receivedAt: string | Date
    reservation: {
      email: string
    }
  }>
  reservations?: Array<{
    id: string
    email: string
    expiresAt: string | Date
  }>
  emails?: Array<{
    id: string
    recipient: string
    subject: string | null
    verificationCode: string | null
    receivedAt?: string | Date
  }>
  activity?: Array<{
    id: string
    title?: string | null
    detail?: string | null
    status?: string | null
    createdAt?: string | Date
  }>
}

type DeviceChallenge = {
  id: string
  deviceCode: string
  userCode: string
  status: string
  flowType: string | null
  cliName: string | null
  target?: string | null
  createdAt?: string | Date
  updatedAt?: string | Date
}

type AdminNotification = {
  id: string
  title: string
  body: string
  flowType: string | null
  target: string | null
  createdAt?: string | Date
}

type IdentitySummary = {
  id: string
  label: string
  provider?: string | null
  account?: string | null
  flowCount?: number | null
  lastSeenAt?: string | Date | null
  status?: string | null
}

type ConfigStatusItem = {
  id?: string
  key?: string
  label: string
  description?: string | null
  status: string
  detail?: string | null
}

type FlowAppRequest = {
  id: string
  appName: string
  flowType?: string | null
  requestedBy?: string | null
  requestedIdentity?: string | null
  notes?: string | null
  status?: string | null
  createdAt?: string | Date
}

function AdminPage() {
  const data = Route.useLoaderData()
  if (!data.authorized) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardDescription>{m.admin_breadcrumb_root()}</CardDescription>
          <div className="flex items-start gap-2">
            <CardTitle>{m.admin_auth_required_title()}</CardTitle>
            <InfoTooltip
              content={m.admin_dashboard_auth_description()}
              label={m.admin_auth_required_title()}
              className="mt-0.5"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/admin/login">{m.admin_auth_required_cta()}</a>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const identitySummaries = getIdentitySummaries(data)
  const configStatuses = getConfigStatuses(data)
  const flowAppRequests = getFlowAppRequests(data)
  const verificationActivity = getVerificationActivity(data.verification)
  const deviceChallenges = data.deviceChallenges as DeviceChallenge[]
  const notifications = data.notifications as AdminNotification[]

  const pendingCount = deviceChallenges.filter(
    (challenge) => challenge.status === 'PENDING',
  ).length
  const locale = getLocale()
  const configStatusColumns = useMemo(() => {
    const dtf = createColumnConfigHelper<ConfigStatusItem>()
    return [
      dtf
        .text()
        .id('capability')
        .accessor((item) => item.label)
        .displayName(m.admin_dashboard_table_capability())
        .icon(SearchIcon)
        .build(),
      dtf
        .option()
        .id('status')
        .accessor((item) => item.status)
        .displayName(m.oauth_clients_table_status())
        .icon(ShieldIcon)
        .transformOptionFn((status) => ({
          label: translateStatusLabel(status),
          value: status,
        }))
        .build(),
      dtf
        .text()
        .id('detail')
        .accessor(
          (item) => item.detail || m.admin_dashboard_waiting_backend_detail(),
        )
        .displayName(m.admin_dashboard_table_detail())
        .icon(SearchIcon)
        .build(),
    ] as const
  }, [locale])
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
  const deviceChallengeColumns = useMemo(() => {
    const dtf = createColumnConfigHelper<DeviceChallenge>()
    return [
      dtf
        .text()
        .id('userCode')
        .accessor((challenge) => challenge.userCode)
        .displayName(m.device_info_user_code())
        .icon(SearchIcon)
        .build(),
      dtf
        .text()
        .id('flowType')
        .accessor(
          (challenge) => challenge.flowType || m.admin_dashboard_cli_device_flow(),
        )
        .displayName(m.device_info_flow())
        .icon(SearchIcon)
        .build(),
      dtf
        .text()
        .id('cliName')
        .accessor(
          (challenge) => challenge.cliName || m.admin_dashboard_unknown_client(),
        )
        .displayName(m.device_info_cli())
        .icon(SearchIcon)
        .build(),
      dtf
        .text()
        .id('target')
        .accessor(
          (challenge) =>
            challenge.target || m.admin_dashboard_no_explicit_target(),
        )
        .displayName(m.admin_dashboard_table_target())
        .icon(SearchIcon)
        .build(),
      dtf
        .date()
        .id('updatedAt')
        .accessor((challenge) =>
          normalizeDate(challenge.updatedAt || challenge.createdAt),
        )
        .displayName(m.oauth_clients_table_updated())
        .icon(CalendarIcon)
        .build(),
      dtf
        .option()
        .id('status')
        .accessor((challenge) => challenge.status)
        .displayName(m.oauth_clients_table_status())
        .icon(ShieldIcon)
        .transformOptionFn((status) => ({
          label: translateStatusLabel(status),
          value: status,
        }))
        .build(),
    ] as const
  }, [locale])
  const verificationActivityColumns = useMemo(() => {
    const dtf = createColumnConfigHelper<
      ReturnType<typeof getVerificationActivity>[number]
    >()
    return [
      dtf
        .text()
        .id('title')
        .accessor((item) => item.title)
        .displayName(m.admin_dashboard_table_title())
        .icon(SearchIcon)
        .build(),
      dtf
        .text()
        .id('detail')
        .accessor((item) => item.detail)
        .displayName(m.admin_dashboard_table_detail())
        .icon(SearchIcon)
        .build(),
      dtf
        .option()
        .id('status')
        .accessor((item) => item.status)
        .displayName(m.oauth_clients_table_status())
        .icon(ShieldIcon)
        .transformOptionFn((status) => ({
          label: translateStatusLabel(status),
          value: status,
        }))
        .build(),
      dtf
        .date()
        .id('createdAt')
        .accessor((item) => normalizeDate(item.createdAt))
        .displayName(m.admin_dashboard_table_created())
        .icon(CalendarIcon)
        .build(),
    ] as const
  }, [locale])
  const notificationColumns = useMemo(() => {
    const dtf = createColumnConfigHelper<AdminNotification>()
    return [
      dtf
        .text()
        .id('title')
        .accessor((notification) => notification.title)
        .displayName(m.admin_dashboard_table_title())
        .icon(SearchIcon)
        .build(),
      dtf
        .text()
        .id('target')
        .accessor(
          (notification) => notification.target || m.admin_dashboard_all_clients(),
        )
        .displayName(m.admin_dashboard_table_target())
        .icon(SearchIcon)
        .build(),
      dtf
        .text()
        .id('flowType')
        .accessor((notification) => notification.flowType || m.status_general())
        .displayName(m.admin_dashboard_flow_type_label())
        .icon(SearchIcon)
        .build(),
      dtf
        .date()
        .id('createdAt')
        .accessor((notification) => normalizeDate(notification.createdAt))
        .displayName(m.admin_dashboard_table_created())
        .icon(CalendarIcon)
        .build(),
      dtf
        .text()
        .id('message')
        .accessor((notification) => notification.body)
        .displayName(m.admin_dashboard_message_label())
        .icon(SearchIcon)
        .build(),
    ] as const
  }, [locale])
  const flowAppRequestColumns = useMemo(() => {
    const dtf = createColumnConfigHelper<FlowAppRequest>()
    return [
      dtf
        .text()
        .id('appName')
        .accessor((request) => request.appName)
        .displayName(m.oauth_clients_table_app())
        .icon(SearchIcon)
        .build(),
      dtf
        .text()
        .id('flowType')
        .accessor((request) => request.flowType || m.admin_dashboard_flow_app())
        .displayName(m.admin_dashboard_flow_type_label())
        .icon(SearchIcon)
        .build(),
      dtf
        .text()
        .id('requestedIdentity')
        .accessor(
          (request) =>
            request.requestedIdentity || m.admin_dashboard_no_identity_attached(),
        )
        .displayName(m.admin_dashboard_requested_identity_label())
        .icon(SearchIcon)
        .build(),
      dtf
        .text()
        .id('requestedBy')
        .accessor(
          (request) => request.requestedBy || m.admin_dashboard_unknown_requester(),
        )
        .displayName(m.admin_dashboard_requested_by_label())
        .icon(SearchIcon)
        .build(),
      dtf
        .option()
        .id('status')
        .accessor((request) => request.status || 'pending')
        .displayName(m.oauth_clients_table_status())
        .icon(ShieldIcon)
        .transformOptionFn((status) => ({
          label: translateStatusLabel(status),
          value: status,
        }))
        .build(),
      dtf
        .date()
        .id('createdAt')
        .accessor((request) => normalizeDate(request.createdAt))
        .displayName(m.admin_dashboard_submitted_label())
        .icon(CalendarIcon)
        .build(),
      dtf
        .text()
        .id('notes')
        .accessor((request) => request.notes || m.admin_dashboard_no_notes())
        .displayName(m.admin_dashboard_notes_label())
        .icon(SearchIcon)
        .build(),
    ] as const
  }, [locale])

  return (
    <>
      <AdminPageHeader
        eyebrow={m.admin_breadcrumb_root()}
        title={m.admin_dashboard_title()}
        variant="plain"
        description={
          <>
            {m.admin_dashboard_signed_in_prefix()}{' '}
            <strong className="text-foreground">
              {data.user.githubLogin ||
                data.user.email ||
                data.user.name ||
                m.admin_dashboard_unknown_user()}
            </strong>
            . {m.admin_dashboard_description_suffix()}
          </>
        }
        meta={
          <StatusBadge
            value={summarizeConfigState(configStatuses)}
            tone={getConfigTone(configStatuses)}
          />
        }
        actions={
          <>
            <Button asChild variant="outline">
              <a href="/admin/emails">{m.admin_nav_mail_inbox()}</a>
            </Button>
            <Button asChild variant="outline">
              <a href="/admin/apps">{m.admin_nav_oauth_apps()}</a>
            </Button>
            <Button asChild variant="outline">
              <a href="/device">{m.home_entry_device_title()}</a>
            </Button>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <AdminMetricCard
          label={m.admin_dashboard_metric_identities_label()}
          value={String(identitySummaries.length)}
          description={m.admin_dashboard_metric_identities_description()}
        />
        <AdminMetricCard
          label={m.admin_dashboard_metric_pending_label()}
          value={String(pendingCount)}
          description={m.admin_dashboard_metric_pending_description()}
        />
        <AdminMetricCard
          label={m.admin_dashboard_metric_verification_label()}
          value={String(verificationActivity.length)}
          description={m.admin_dashboard_metric_verification_description()}
        />
        <AdminMetricCard
          label={m.admin_dashboard_metric_notifications_label()}
          value={String(notifications.length)}
          description={m.admin_dashboard_metric_notifications_description()}
        />
        <AdminMetricCard
          label={m.admin_dashboard_metric_requests_label()}
          value={String(flowAppRequests.length)}
          description={m.admin_dashboard_metric_requests_description()}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <ActionCard
          eyebrow={m.admin_dashboard_code_kicker()}
          title={m.admin_dashboard_code_title()}
          description={m.admin_dashboard_code_description()}
        >
          <form
            method="post"
            action="/api/admin/verification-codes"
            className="grid gap-3"
          >
            <LabeledInput label={m.admin_dashboard_target_email()}>
              <Input
                name="email"
                placeholder={m.admin_dashboard_target_email_placeholder()}
              />
            </LabeledInput>
            <LabeledInput label={m.admin_dashboard_code_input_label()}>
              <Input
                name="code"
                placeholder={m.admin_dashboard_code_input_placeholder()}
                inputMode="numeric"
              />
            </LabeledInput>
            <Button type="submit">{m.admin_dashboard_inject_code()}</Button>
          </form>
        </ActionCard>

        <ActionCard
          eyebrow={m.admin_dashboard_notification_kicker()}
          title={m.admin_dashboard_notification_title()}
          description={m.admin_dashboard_notification_description()}
        >
          <form
            method="post"
            action="/api/admin/notifications"
            className="grid gap-3"
          >
            <LabeledInput label={m.admin_dashboard_notification_title_label()}>
              <Input
                name="title"
                placeholder={m.admin_dashboard_notification_title_placeholder()}
              />
            </LabeledInput>
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledInput label={m.admin_dashboard_flow_type_label()}>
                <Input
                  name="flowType"
                  placeholder={m.admin_dashboard_flow_type_placeholder()}
                />
              </LabeledInput>
              <LabeledInput label={m.admin_dashboard_target_label()}>
                <Input
                  name="target"
                  placeholder={m.admin_dashboard_target_placeholder()}
                />
              </LabeledInput>
            </div>
            <LabeledInput label={m.admin_dashboard_message_label()}>
              <Textarea
                name="body"
                placeholder={m.admin_dashboard_message_placeholder()}
                className="min-h-28"
              />
            </LabeledInput>
            <Button type="submit">
              {m.admin_dashboard_create_notification()}
            </Button>
          </form>
        </ActionCard>

        <ActionCard
          eyebrow={m.admin_dashboard_request_kicker()}
          title={m.admin_dashboard_request_title()}
          description={m.admin_dashboard_request_description()}
        >
          <form
            method="post"
            action="/api/admin/flow-app-requests"
            className="grid gap-3"
          >
            <LabeledInput label={m.admin_dashboard_app_name_label()}>
              <Input
                name="appName"
                placeholder={m.admin_dashboard_app_name_placeholder()}
              />
            </LabeledInput>
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledInput label={m.admin_dashboard_flow_type_label()}>
                <Input
                  name="flowType"
                  placeholder={m.admin_dashboard_request_flow_type_placeholder()}
                />
              </LabeledInput>
              <LabeledInput
                label={m.admin_dashboard_requested_identity_label()}
              >
                <Input
                  name="requestedIdentity"
                  placeholder={m.admin_dashboard_requested_identity_placeholder()}
                />
              </LabeledInput>
            </div>
            <LabeledInput label={m.admin_dashboard_notes_label()}>
              <Textarea
                name="notes"
                placeholder={m.admin_dashboard_notes_placeholder()}
                className="min-h-28"
              />
            </LabeledInput>
            <Button type="submit">{m.admin_dashboard_submit_request()}</Button>
          </form>
        </ActionCard>
      </section>

      <TableCard
        eyebrow={m.admin_dashboard_config_kicker()}
        title={m.admin_dashboard_config_title()}
        description={m.admin_dashboard_config_description()}
      >
        <ClientFilterableAdminTable
          data={configStatuses}
          columnsConfig={configStatusColumns}
          emptyState={
            <EmptyState
              title={m.admin_dashboard_config_empty_title()}
              description={m.admin_dashboard_config_empty_description()}
            />
          }
          renderTable={(rows) => (
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{m.admin_dashboard_table_capability()}</TableHead>
                  <TableHead>{m.oauth_clients_table_status()}</TableHead>
                  <TableHead>{m.admin_dashboard_table_detail()}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item, index) => (
                  <TableRow
                    key={item.id ?? item.key ?? `${item.label}-${index}`}
                  >
                    <TableCell className="align-top">
                      <div className="flex items-start gap-2">
                        <div className="font-medium text-foreground">
                          {item.label}
                        </div>
                        <InfoTooltip
                          content={item.description}
                          label={item.label}
                          className="mt-0.5"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge value={item.status} />
                    </TableCell>
                    <TableCell className="whitespace-normal align-top text-sm leading-6 text-muted-foreground">
                      {item.detail || m.admin_dashboard_waiting_backend_detail()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        />
      </TableCard>

      <TableCard
        eyebrow={m.admin_dashboard_identities_kicker()}
        title={m.admin_dashboard_identities_title()}
        description={m.admin_dashboard_identities_description()}
      >
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
                      {summary.flowCount != null
                        ? m.admin_dashboard_flow_count({
                            count: String(summary.flowCount),
                          })
                        : m.status_pending()}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatAdminDate(summary.lastSeenAt) ||
                        m.admin_dashboard_not_captured_yet()}
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge value={summary.status || 'unknown'} />
                    </TableCell>
                    <TableCell className="align-top">
                      <form
                        method="post"
                        action="/api/admin/identities"
                        className="grid min-w-[320px] gap-2 md:grid-cols-[minmax(0,1fr)_160px_auto]"
                      >
                        <input
                          type="hidden"
                          name="identityId"
                          value={summary.id}
                        />
                        <input
                          type="hidden"
                          name="email"
                          value={summary.account || summary.label}
                        />
                        <Input
                          name="label"
                          defaultValue={
                            summary.label !== summary.account
                              ? summary.label
                              : ''
                          }
                          placeholder={
                            summary.account || m.admin_dashboard_identity_label()
                          }
                          className="h-8"
                        />
                        <NativeSelect
                          name="status"
                          defaultValue={toManagedStatus(summary.status)}
                          size="sm"
                          className="w-full min-w-[140px]"
                        >
                          <NativeSelectOption value="ACTIVE">
                            {m.status_active()}
                          </NativeSelectOption>
                          <NativeSelectOption value="REVIEW">
                            {m.status_review()}
                          </NativeSelectOption>
                          <NativeSelectOption value="ARCHIVED">
                            {m.status_archived()}
                          </NativeSelectOption>
                        </NativeSelect>
                        <Button type="submit" size="sm" variant="outline">
                          {m.oauth_edit_save_settings()}
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        />
      </TableCard>

      <TableCard
        eyebrow={m.admin_dashboard_device_kicker()}
        title={m.admin_dashboard_device_title()}
        description={m.admin_dashboard_device_description()}
      >
        <ClientFilterableAdminTable
          data={deviceChallenges}
          columnsConfig={deviceChallengeColumns}
          emptyState={
            <EmptyState
              title={m.admin_dashboard_device_empty_title()}
              description={m.admin_dashboard_device_empty_description()}
            />
          }
          renderTable={(rows) => (
            <Table className="min-w-[1040px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{m.device_info_user_code()}</TableHead>
                  <TableHead>{m.device_info_flow()}</TableHead>
                  <TableHead>{m.device_info_cli()}</TableHead>
                  <TableHead>{m.admin_dashboard_table_target()}</TableHead>
                  <TableHead>{m.oauth_clients_table_updated()}</TableHead>
                  <TableHead>{m.oauth_clients_table_status()}</TableHead>
                  <TableHead className="text-right">
                    {m.oauth_clients_table_actions()}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((challenge) => (
                  <TableRow key={challenge.id}>
                    <TableCell className="align-top">
                      <div className="space-y-1">
                        <div className="font-medium text-foreground">
                          {challenge.userCode}
                        </div>
                        <code>{challenge.deviceCode}</code>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {challenge.flowType || m.admin_dashboard_cli_device_flow()}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {challenge.cliName || m.admin_dashboard_unknown_client()}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {challenge.target || m.admin_dashboard_no_explicit_target()}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatAdminDate(
                        challenge.updatedAt || challenge.createdAt,
                      ) || m.admin_dashboard_awaiting_timestamp()}
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge
                        value={challenge.status}
                        tone={getChallengeTone(challenge.status)}
                      />
                    </TableCell>
                    <TableCell className="align-top text-right">
                      {challenge.status === 'PENDING' ? (
                        <div className="flex justify-end gap-2">
                          <form
                            method="post"
                            action={`/api/admin/device/${challenge.deviceCode}/approve`}
                          >
                            <Button type="submit" size="sm">
                              {m.admin_dashboard_approve()}
                            </Button>
                          </form>
                          <form
                            method="post"
                            action={`/api/admin/device/${challenge.deviceCode}/deny`}
                          >
                            <Button type="submit" size="sm" variant="outline">
                              {m.admin_dashboard_deny()}
                            </Button>
                          </form>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {m.status_resolved()}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        />
      </TableCard>

      <TableCard
        eyebrow={m.admin_dashboard_verification_kicker()}
        title={m.admin_dashboard_verification_title()}
        description={m.admin_dashboard_verification_description()}
      >
        <ClientFilterableAdminTable
          data={verificationActivity}
          columnsConfig={verificationActivityColumns}
          emptyState={
            <EmptyState
              title={m.admin_dashboard_verification_empty_title()}
              description={m.admin_dashboard_verification_empty_description()}
            />
          }
          renderTable={(rows) => (
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{m.admin_dashboard_table_title()}</TableHead>
                  <TableHead>{m.admin_dashboard_table_detail()}</TableHead>
                  <TableHead>{m.oauth_clients_table_status()}</TableHead>
                  <TableHead>{m.admin_dashboard_table_created()}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="align-top">
                      <div className="font-medium text-foreground">
                        {item.title}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[560px] whitespace-normal align-top text-sm leading-6 text-muted-foreground">
                      {item.detail}
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge value={item.status} />
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatAdminDate(item.createdAt) ||
                        m.mail_inbox_timestamp_unavailable()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        />
      </TableCard>

      <section className="grid gap-4 2xl:grid-cols-2">
        <TableCard
          eyebrow={m.admin_dashboard_notifications_kicker()}
          title={m.admin_dashboard_notifications_title()}
          description={m.admin_dashboard_notifications_description()}
        >
          <ClientFilterableAdminTable
            data={notifications}
            columnsConfig={notificationColumns}
            emptyState={
              <EmptyState
                title={m.admin_dashboard_notifications_empty_title()}
                description={m.admin_dashboard_notifications_empty_description()}
              />
            }
            renderTable={(rows) => (
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{m.admin_dashboard_table_title()}</TableHead>
                    <TableHead>{m.admin_dashboard_table_target()}</TableHead>
                    <TableHead>{m.admin_dashboard_flow_type_label()}</TableHead>
                    <TableHead>{m.admin_dashboard_table_created()}</TableHead>
                    <TableHead>{m.admin_dashboard_message_label()}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((notification) => (
                    <TableRow key={notification.id}>
                      <TableCell className="align-top">
                        <div className="font-medium text-foreground">
                          {notification.title}
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {notification.target || m.admin_dashboard_all_clients()}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {notification.flowType || m.status_general()}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {formatAdminDate(notification.createdAt) ||
                          m.mail_inbox_timestamp_unavailable()}
                      </TableCell>
                      <TableCell className="max-w-[380px] whitespace-normal align-top text-sm leading-6 text-muted-foreground">
                        {notification.body}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          />
        </TableCard>

        <TableCard
          eyebrow={m.admin_dashboard_requests_kicker()}
          title={m.admin_dashboard_requests_title()}
          description={m.admin_dashboard_requests_description()}
        >
          <ClientFilterableAdminTable
            data={flowAppRequests}
            columnsConfig={flowAppRequestColumns}
            emptyState={
              <EmptyState
                title={m.admin_dashboard_requests_empty_title()}
                description={m.admin_dashboard_requests_empty_description()}
              />
            }
            renderTable={(rows) => (
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{m.oauth_clients_table_app()}</TableHead>
                    <TableHead>{m.admin_dashboard_flow_type_label()}</TableHead>
                    <TableHead>
                      {m.admin_dashboard_requested_identity_label()}
                    </TableHead>
                    <TableHead>{m.admin_dashboard_requested_by_label()}</TableHead>
                    <TableHead>{m.oauth_clients_table_status()}</TableHead>
                    <TableHead>{m.admin_dashboard_submitted_label()}</TableHead>
                    <TableHead>{m.admin_dashboard_notes_label()}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="align-top">
                        <div className="font-medium text-foreground">
                          {request.appName}
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {request.flowType || m.admin_dashboard_flow_app()}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {request.requestedIdentity ||
                          m.admin_dashboard_no_identity_attached()}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {request.requestedBy ||
                          m.admin_dashboard_unknown_requester()}
                      </TableCell>
                      <TableCell className="align-top">
                        <StatusBadge value={request.status || 'pending'} />
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {formatAdminDate(request.createdAt) ||
                          m.admin_dashboard_awaiting_timestamp()}
                      </TableCell>
                      <TableCell className="max-w-[320px] whitespace-normal align-top text-sm leading-6 text-muted-foreground">
                        {request.notes || m.admin_dashboard_no_notes()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          />
        </TableCard>
      </section>
    </>
  )
}

function TableCard(props: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{props.eyebrow}</CardDescription>
        <div className="flex items-start gap-2">
          <CardTitle>{props.title}</CardTitle>
          <InfoTooltip
            content={props.description}
            label={props.title}
            className="mt-0.5"
          />
        </div>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  )
}

function ActionCard(props: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{props.eyebrow}</CardDescription>
        <div className="flex items-start gap-2">
          <CardTitle className="text-lg">{props.title}</CardTitle>
          <InfoTooltip
            content={props.description}
            label={props.title}
            className="mt-0.5"
          />
        </div>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  )
}

function LabeledInput(props: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-foreground">{props.label}</span>
      {props.children}
    </label>
  )
}

function getIdentitySummaries(data: Record<string, unknown>) {
  const candidate = data.identitySummaries
  return Array.isArray(candidate) ? (candidate as IdentitySummary[]) : []
}

function getConfigStatuses(data: Record<string, unknown>) {
  const candidate = data.configStatus
  return Array.isArray(candidate) ? (candidate as ConfigStatusItem[]) : []
}

function getFlowAppRequests(data: Record<string, unknown>) {
  const candidate = data.flowAppRequests
  return Array.isArray(candidate) ? (candidate as FlowAppRequest[]) : []
}

function getVerificationActivity(verification: VerificationData) {
  if (Array.isArray(verification.activity)) {
    return verification.activity.map((item) => ({
      id: item.id,
      title: item.title || m.admin_dashboard_verification_event_title(),
      detail: item.detail || m.admin_dashboard_verification_event_detail(),
      status: item.status || 'active',
      createdAt: item.createdAt,
    }))
  }

  const codeEvents = (verification.codes ?? []).slice(0, 3).map((code) => ({
    id: `code-${code.id}`,
    title: code.reservation.email,
    detail: m.admin_dashboard_verification_code_detail({
      code: code.code,
      source: code.source,
    }),
    status: 'received',
    createdAt: code.receivedAt,
  }))

  const emailEvents = (verification.emails ?? []).slice(0, 3).map((email) => ({
    id: `email-${email.id}`,
    title: email.recipient,
    detail: email.subject || m.admin_dashboard_verification_email_detail(),
    status: email.verificationCode ? 'parsed' : 'received',
    createdAt: email.receivedAt,
  }))

  return [...codeEvents, ...emailEvents]
}

function getConfigTone(items: ConfigStatusItem[]) {
  if (items.some((item) => getStatusTone(item.status) === 'danger')) {
    return 'danger' as const
  }

  if (items.some((item) => getStatusTone(item.status) === 'warning')) {
    return 'warning' as const
  }

  return items.length > 0 ? ('good' as const) : ('warning' as const)
}

function summarizeConfigState(items: ConfigStatusItem[]) {
  if (items.length === 0) {
    return m.admin_dashboard_waiting_for_status()
  }

  if (items.every((item) => getStatusTone(item.status) === 'good')) {
    return m.admin_dashboard_all_systems_ready()
  }

  if (items.some((item) => getStatusTone(item.status) === 'danger')) {
    return m.admin_dashboard_action_required()
  }

  return m.admin_dashboard_needs_review()
}

function getChallengeTone(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === 'pending') {
    return 'warning' as const
  }

  if (
    normalized === 'approved' ||
    normalized === 'consumed' ||
    normalized === 'complete'
  ) {
    return 'good' as const
  }

  return 'danger' as const
}

function toManagedStatus(status?: string | null) {
  const normalized = status?.toLowerCase()
  if (normalized === 'archived') {
    return 'ARCHIVED'
  }

  if (normalized === 'review' || normalized === 'pending') {
    return 'REVIEW'
  }

  return 'ACTIVE'
}

function normalizeDate(value?: string | Date | null) {
  if (!value) {
    return undefined
  }

  const normalized = value instanceof Date ? value : new Date(value)
  return Number.isNaN(normalized.getTime()) ? undefined : normalized
}
