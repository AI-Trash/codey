import { type ComponentProps, type ReactNode, useMemo, useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  CalendarIcon,
  DownloadIcon,
  EyeIcon,
  FingerprintIcon,
  KeyRoundIcon,
  RefreshCcwIcon,
  SearchIcon,
  ShieldIcon,
  Trash2Icon,
} from 'lucide-react'

import {
  AdminPageHeader,
  EmptyState,
  StatusBadge,
  formatAdminDate,
} from '#/components/admin/layout'
import { ClientFilterableAdminTable } from '#/components/admin/filterable-table'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import {
  AdminTableSelectionCell,
  AdminTableSelectionHead,
} from '#/components/admin/table-selection'
import { createColumnConfigHelper } from '#/components/data-table-filter/core/filters'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { ScrollArea } from '#/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { translateStatusLabel } from '#/lib/i18n'
import {
  buildManagedSessionAuthJson,
  buildManagedSessionAuthJsonFileName,
  isCodexAuthManagedSession,
  type ManagedSessionJsonObject,
} from '#/lib/managed-session-export'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

const loadAdminSessions = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [
      { getRequest },
      { requireAdminPermission },
      { listAdminManagedSessionSummaries },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../lib/server/auth'),
      import('../../lib/server/managed-sessions'),
    ])

    const request = getRequest()

    try {
      await requireAdminPermission(request, 'MANAGED_SESSIONS')
    } catch {
      return { authorized: false as const }
    }

    const sessions = await listAdminManagedSessionSummaries()
    return {
      authorized: true as const,
      sessions,
    }
  },
)

export const Route = createFileRoute('/admin/sessions')({
  loader: async () => loadAdminSessions(),
  component: AdminSessionsPage,
})

type ManagedSessionSummary = {
  id: string
  identityId: string
  identityLabel: string
  email: string
  clientId: string
  authMode: string
  flowType: string
  accountId?: string | null
  sessionId?: string | null
  status: string
  lastRefreshAt?: string | null
  expiresAt?: string | null
  lastSeenAt: string
  createdAt: string
  updatedAt: string
  sessionData: ManagedSessionJsonObject
}

function downloadManagedSessionAuthJson(summary: ManagedSessionSummary) {
  const payload = buildManagedSessionAuthJson(summary)
  if (!payload) {
    return
  }

  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = buildManagedSessionAuthJsonFileName(summary)
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

function downloadManagedSessionBatch(summaries: ManagedSessionSummary[]) {
  for (const summary of summaries) {
    if (!isCodexAuthManagedSession(summary)) {
      continue
    }

    downloadManagedSessionAuthJson(summary)
  }
}

function AdminSessionsPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  const sessions = data.sessions as ManagedSessionSummary[]
  const locale = getLocale()

  const sessionColumns = useMemo(() => {
    const dtf = createColumnConfigHelper<ManagedSessionSummary>()
    return [
      dtf
        .text()
        .id('identity')
        .accessor((summary) => summary.identityLabel)
        .displayName(m.admin_dashboard_table_identity())
        .icon(SearchIcon)
        .build(),
      dtf
        .text()
        .id('email')
        .accessor((summary) => summary.email)
        .displayName(m.admin_dashboard_table_account())
        .icon(SearchIcon)
        .build(),
      dtf
        .text()
        .id('flowType')
        .accessor((summary) => formatFlowType(summary.flowType))
        .displayName(m.admin_session_table_flow())
        .icon(KeyRoundIcon)
        .build(),
      dtf
        .text()
        .id('clientId')
        .accessor((summary) => summary.clientId)
        .displayName(m.admin_session_table_client_id())
        .icon(KeyRoundIcon)
        .build(),
      dtf
        .text()
        .id('accountId')
        .accessor((summary) => summary.accountId || m.oauth_none())
        .displayName(m.admin_session_table_account_id())
        .icon(FingerprintIcon)
        .build(),
      dtf
        .text()
        .id('sessionId')
        .accessor((summary) => summary.sessionId || m.oauth_none())
        .displayName(m.admin_session_table_session_id())
        .icon(FingerprintIcon)
        .build(),
      dtf
        .date()
        .id('lastRefresh')
        .accessor((summary) => normalizeDate(summary.lastRefreshAt))
        .displayName(m.admin_session_table_last_refresh())
        .icon(RefreshCcwIcon)
        .build(),
      dtf
        .date()
        .id('expiresAt')
        .accessor((summary) => normalizeDate(summary.expiresAt))
        .displayName(m.admin_session_table_expires_at())
        .icon(CalendarIcon)
        .build(),
      dtf
        .option()
        .id('status')
        .accessor((summary) => summary.status)
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
        title={m.admin_session_page_title()}
        description={m.admin_session_page_description()}
        variant="plain"
        actions={
          <Button asChild variant="outline">
            <a href="/admin">{m.admin_back_to_operations()}</a>
          </Button>
        }
      />

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader>
          <CardDescription>{m.admin_session_table_kicker()}</CardDescription>
          <CardTitle>{m.admin_session_table_title()}</CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col">
          <ClientFilterableAdminTable
            data={sessions}
            columnsConfig={sessionColumns}
            getRowId={(summary) => summary.id}
            fillHeight
            emptyState={
              <EmptyState
                title={m.admin_session_empty_title()}
                description={m.admin_session_empty_description()}
              />
            }
            renderActions={({ selectedRows }) => (
              <SessionBatchExportAction rows={selectedRows} />
            )}
            renderTable={({ rows, selection }) => (
              <Table className="min-w-[1540px]">
                <TableHeader>
                  <TableRow>
                    <AdminTableSelectionHead
                      rows={rows}
                      selection={selection}
                    />
                    <TableHead>{m.admin_dashboard_table_identity()}</TableHead>
                    <TableHead>{m.admin_dashboard_table_account()}</TableHead>
                    <TableHead>{m.admin_session_table_flow()}</TableHead>
                    <TableHead>{m.admin_session_table_client_id()}</TableHead>
                    <TableHead>{m.admin_session_table_account_id()}</TableHead>
                    <TableHead>{m.admin_session_table_session_id()}</TableHead>
                    <TableHead>
                      {m.admin_session_table_last_refresh()}
                    </TableHead>
                    <TableHead>{m.admin_session_table_expires_at()}</TableHead>
                    <TableHead>{m.oauth_clients_table_status()}</TableHead>
                    <TableHead>{m.admin_dashboard_table_manage()}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((summary) => (
                    <TableRow
                      key={summary.id}
                      data-selected={selection.isSelected(summary) || undefined}
                    >
                      <AdminTableSelectionCell
                        row={summary}
                        selection={selection}
                      />
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">
                            {summary.identityLabel}
                          </div>
                          <CopyableValue
                            value={summary.identityId}
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
                        <CopyableValue
                          value={summary.email}
                          title={m.clipboard_copy_value({
                            label: m.admin_dashboard_account_email_label(),
                          })}
                          className="max-w-full"
                          contentClassName="break-all"
                        />
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {formatFlowType(summary.flowType)}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        <CopyableValue
                          value={summary.clientId}
                          title={m.clipboard_copy_value({
                            label: m.admin_session_table_client_id(),
                          })}
                          className="max-w-full"
                          contentClassName="break-all"
                        />
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {summary.accountId ? (
                          <CopyableValue
                            value={summary.accountId}
                            title={m.clipboard_copy_value({
                              label: m.admin_session_table_account_id(),
                            })}
                            className="max-w-full"
                            contentClassName="break-all"
                          />
                        ) : (
                          m.oauth_none()
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {summary.sessionId ? (
                          <CopyableValue
                            value={summary.sessionId}
                            title={m.clipboard_copy_value({
                              label: m.admin_session_table_session_id(),
                            })}
                            className="max-w-full"
                            contentClassName="break-all"
                          />
                        ) : (
                          m.oauth_none()
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {formatAdminDate(summary.lastRefreshAt) ||
                          m.admin_dashboard_not_captured_yet()}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {formatAdminDate(summary.expiresAt) ||
                          m.admin_session_never_expires()}
                      </TableCell>
                      <TableCell className="align-top">
                        <StatusBadge value={summary.status} />
                      </TableCell>
                      <TableCell className="align-top">
                        <SessionRowActions summary={summary} />
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

function SessionRowActions(props: { summary: ManagedSessionSummary }) {
  return (
    <TooltipProvider>
      <div className="flex min-w-[148px] items-start gap-2">
        <SessionPayloadDialog summary={props.summary} />
        {isCodexAuthManagedSession(props.summary) ? (
          <SessionExportAction summary={props.summary} />
        ) : null}
        <SessionDeleteAction summary={props.summary} />
      </div>
    </TooltipProvider>
  )
}

function SessionBatchExportAction(props: { rows: ManagedSessionSummary[] }) {
  const exportableRows = props.rows.filter((summary) =>
    isCodexAuthManagedSession(summary),
  )

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={exportableRows.length === 0}
      onClick={() => {
        downloadManagedSessionBatch(exportableRows)
      }}
    >
      <DownloadIcon />
      {m.admin_session_export_visible_codex_button({
        count: exportableRows.length,
      })}
    </Button>
  )
}

function SessionExportAction(props: { summary: ManagedSessionSummary }) {
  return (
    <ActionIconButton
      type="button"
      variant="outline"
      label={m.admin_session_export_button()}
      icon={<DownloadIcon />}
      onClick={() => {
        downloadManagedSessionAuthJson(props.summary)
      }}
    />
  )
}

function SessionPayloadDialog(props: { summary: ManagedSessionSummary }) {
  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={m.admin_session_view_payload_button()}
              title={m.admin_session_view_payload_button()}
            >
              <EyeIcon />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>
          {m.admin_session_view_payload_button()}
        </TooltipContent>
      </Tooltip>

      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{m.admin_session_payload_title()}</DialogTitle>
          <DialogDescription>
            {m.admin_session_payload_description()}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <SessionMetaItem
            label={m.admin_dashboard_table_identity()}
            value={props.summary.identityLabel}
          />
          <SessionMetaItem
            label={m.admin_dashboard_table_account()}
            value={props.summary.email}
          />
          <SessionMetaItem
            label={m.admin_session_table_flow()}
            value={formatFlowType(props.summary.flowType)}
          />
          <SessionMetaItem
            label={m.admin_session_table_client_id()}
            value={props.summary.clientId}
          />
          <SessionMetaItem
            label={m.oauth_clients_table_status()}
            value={translateStatusLabel(props.summary.status)}
          />
          <SessionMetaItem
            label={m.admin_session_table_account_id()}
            value={props.summary.accountId || m.oauth_none()}
          />
          <SessionMetaItem
            label={m.admin_session_table_session_id()}
            value={props.summary.sessionId || m.oauth_none()}
          />
        </div>

        <ScrollArea className="h-[420px] rounded-lg border bg-muted/30">
          <pre className="p-4 text-xs leading-6 whitespace-pre-wrap break-all text-foreground">
            {JSON.stringify(props.summary.sessionData, null, 2)}
          </pre>
        </ScrollArea>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

function SessionMetaItem(props: { label: string; value: string }) {
  return (
    <div className="space-y-1 rounded-lg border bg-muted/20 p-3">
      <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {props.label}
      </p>
      <p className="text-sm break-all text-foreground">{props.value}</p>
    </div>
  )
}

function SessionDeleteAction(props: { summary: ManagedSessionSummary }) {
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="destructive"
            aria-label={m.admin_session_delete_button()}
            title={m.admin_session_delete_button()}
            onClick={() => {
              setOpen(true)
            }}
          >
            <Trash2Icon />
          </Button>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>
          {m.admin_session_delete_button()}
        </TooltipContent>
      </Tooltip>

      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {m.admin_session_delete_confirm_title()}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {m.admin_session_delete_confirm_description()}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>{m.ui_close()}</AlertDialogCancel>
          <form method="post" action="/api/admin/sessions">
            <input type="hidden" name="id" value={props.summary.id} />
            <input type="hidden" name="redirectTo" value="/admin/sessions" />
            <Button
              type="submit"
              name="intent"
              value="delete"
              size="sm"
              variant="destructive"
            >
              {m.admin_session_delete_button()}
            </Button>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ActionIconButton(props: {
  type?: 'button' | 'submit' | 'reset'
  name?: string
  value?: string
  variant?: ComponentProps<typeof Button>['variant']
  disabled?: boolean
  onClick?: ComponentProps<typeof Button>['onClick']
  label: string
  icon: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type={props.type || 'button'}
          name={props.name}
          value={props.value}
          size="icon-sm"
          variant={props.variant || 'outline'}
          disabled={props.disabled}
          aria-label={props.label}
          title={props.label}
          onClick={props.onClick}
        >
          {props.icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{props.label}</TooltipContent>
    </Tooltip>
  )
}

function formatFlowType(value: string) {
  if (value === 'chatgpt-register') {
    return m.admin_sessions_flow_register()
  }

  if (value === 'chatgpt-login') {
    return m.admin_sessions_flow_login()
  }

  if (value === 'codex-oauth') {
    return m.admin_sessions_flow_codex_oauth()
  }

  return value
}

function normalizeDate(value?: string | null) {
  if (!value) {
    return undefined
  }

  const normalized = new Date(value)
  return Number.isNaN(normalized.getTime()) ? undefined : normalized
}
