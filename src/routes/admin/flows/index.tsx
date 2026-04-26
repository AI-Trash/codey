import { startTransition, useEffect, useMemo, useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  ActivityIcon,
  BotIcon,
  CalendarIcon,
  SearchIcon,
  ShieldIcon,
  Trash2Icon,
  UserRoundIcon,
} from 'lucide-react'

import type {
  AdminFlowRunSnapshot,
  AdminFlowTaskSummary,
} from '#/lib/server/flow-runs'
import { FlowDetailPanel } from '#/components/admin/flow-runs'
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
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Badge } from '#/components/ui/badge'
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
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { getFlowDisplayName } from '#/lib/admin-flows'
import { translateStatusLabel } from '#/lib/i18n'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

const FLOW_PAGE_POLL_INTERVAL_MS = 5_000

type ClearFlowRunsMode = 'completed' | 'all'

type ClearFlowRunsResponse = {
  deletedCount: number
  preservedCount: number
  totalVisibleCount: number
}

type FlowPageFlash = {
  kind: 'success' | 'error'
  title: string
  description: string
}

const loadAdminFlowRuns = createServerFn({ method: 'GET' })
  .inputValidator((data: { taskId?: string }) => data)
  .handler(async ({ data }) => {
    const [
      { getRequest },
      { requireAdminPermission },
      { getAdminFlowRunSnapshotForActor },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../../lib/server/auth'),
      import('../../../lib/server/flow-runs'),
    ])

    const request = getRequest()

    try {
      const admin = await requireAdminPermission(request, 'CLI_OPERATIONS')

      return {
        authorized: true as const,
        snapshot: await getAdminFlowRunSnapshotForActor({
          actor: {
            userId: admin.user.id,
            githubLogin: admin.user.githubLogin,
            email: admin.user.email,
          },
          taskId: data?.taskId,
        }),
      }
    } catch {
      return { authorized: false as const }
    }
  })

export const Route = createFileRoute('/admin/flows/')({
  validateSearch: (search: Record<string, unknown>) => ({
    taskId: typeof search.taskId === 'string' ? search.taskId : undefined,
  }),
  loaderDeps: ({ search: { taskId } }) => ({ taskId }),
  loader: ({ deps }) => loadAdminFlowRuns({ data: { taskId: deps.taskId } }),
  component: AdminFlowsPage,
})

function AdminFlowsPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const locale = getLocale()
  const authorizedSnapshot = data.authorized
    ? (data.snapshot as AdminFlowRunSnapshot)
    : null
  const [snapshot, setSnapshot] = useState<AdminFlowRunSnapshot>(
    () =>
      authorizedSnapshot || {
        snapshotAt: new Date().toISOString(),
        tasks: [],
        selectedTask: null,
      },
  )
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [clearMode, setClearMode] = useState<ClearFlowRunsMode | null>(null)
  const [flash, setFlash] = useState<FlowPageFlash | null>(null)

  useEffect(() => {
    if (!authorizedSnapshot) {
      return
    }

    setSnapshot(authorizedSnapshot)
  }, [authorizedSnapshot])
  const activeTaskId = search.taskId
  const activeTask = !activeTaskId
    ? null
    : snapshot.selectedTask?.id === activeTaskId
      ? snapshot.selectedTask
      : snapshot.tasks.find((task) => task.id === activeTaskId) || null

  async function refreshSnapshot(taskId = activeTaskId) {
    setIsRefreshing(true)
    try {
      const response = await fetch(buildAdminFlowSnapshotApiHref(taskId), {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        return
      }

      const nextSnapshot = (await response.json()) as AdminFlowRunSnapshot
      startTransition(() => {
        setSnapshot(nextSnapshot)
      })
    } finally {
      setIsRefreshing(false)
    }
  }

  function setDetailsOpen(taskId?: string, replace = false) {
    void navigate({
      to: '/admin/flows',
      search: (current) => ({
        ...current,
        taskId,
      }),
      replace,
    })
  }

  async function clearFlowRuns(mode: ClearFlowRunsMode) {
    setIsClearing(true)
    setFlash(null)

    try {
      const response = await fetch(`/api/admin/flows?mode=${mode}`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        const message = (await response.text()).trim()
        throw new Error(
          message ||
            (mode === 'all'
              ? m.admin_flow_force_clear_error()
              : m.admin_flow_clear_error()),
        )
      }

      const result = (await response.json()) as ClearFlowRunsResponse
      const nextTasks =
        mode === 'all'
          ? []
          : snapshot.tasks.filter(
              (task) => !isClearableFlowTaskStatus(task.status),
            )
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          snapshotAt: new Date().toISOString(),
          tasks: nextTasks,
          selectedTask:
            current.selectedTask &&
            nextTasks.some((task) => task.id === current.selectedTask?.id)
              ? current.selectedTask
              : null,
        }))
      })
      setClearMode(null)

      if (activeTaskId && !nextTasks.some((task) => task.id === activeTaskId)) {
        setDetailsOpen(undefined, true)
      }

      if (mode === 'all') {
        setFlash({
          kind: 'success',
          title: m.status_success(),
          description:
            result.deletedCount > 0
              ? m.admin_flow_force_clear_success({
                  count: String(result.deletedCount),
                })
              : m.admin_flow_force_clear_empty(),
        })
        return
      }

      if (result.deletedCount > 0 && result.preservedCount > 0) {
        setFlash({
          kind: 'success',
          title: m.status_success(),
          description: m.admin_flow_clear_success_partial({
            count: String(result.deletedCount),
            preserved: String(result.preservedCount),
          }),
        })
        return
      }

      if (result.deletedCount > 0) {
        setFlash({
          kind: 'success',
          title: m.status_success(),
          description: m.admin_flow_clear_success({
            count: String(result.deletedCount),
          }),
        })
        return
      }

      setFlash({
        kind: 'success',
        title: m.status_success(),
        description:
          result.preservedCount > 0
            ? m.admin_flow_clear_pending_only({
                count: String(result.preservedCount),
              })
            : m.admin_flow_clear_empty(),
      })
    } catch (error) {
      setFlash({
        kind: 'error',
        title: m.status_failed(),
        description:
          error instanceof Error
            ? error.message
            : mode === 'all'
              ? m.admin_flow_force_clear_error()
              : m.admin_flow_clear_error(),
      })
    } finally {
      setIsClearing(false)
    }
  }

  useEffect(() => {
    if (!activeTaskId) {
      return
    }

    void refreshSnapshot(activeTaskId)
  }, [activeTaskId])

  useEffect(() => {
    let active = true

    const tick = async () => {
      if (!active) {
        return
      }

      setIsRefreshing(true)
      try {
        const response = await fetch(
          buildAdminFlowSnapshotApiHref(activeTaskId),
          {
            headers: {
              Accept: 'application/json',
            },
          },
        )

        if (!response.ok || !active) {
          return
        }

        const nextSnapshot = (await response.json()) as AdminFlowRunSnapshot
        startTransition(() => {
          setSnapshot(nextSnapshot)
        })
      } finally {
        if (active) {
          setIsRefreshing(false)
        }
      }
    }

    const interval = window.setInterval(() => {
      void tick()
    }, FLOW_PAGE_POLL_INTERVAL_MS)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [activeTaskId])

  const flowColumns = useMemo(() => {
    const dtf = createColumnConfigHelper<AdminFlowTaskSummary>()

    return [
      dtf
        .text()
        .id('flow')
        .accessor((task) =>
          [
            getFlowDisplayName(task.flowType),
            task.id,
            task.title,
            task.body,
            task.lastMessage,
            task.lastError,
          ]
            .filter(Boolean)
            .join(' '),
        )
        .displayName(m.admin_session_table_flow())
        .icon(ActivityIcon)
        .build(),
      dtf
        .text()
        .id('cli')
        .accessor(
          (task) => task.connection?.cliName || m.admin_cli_unknown_cli(),
        )
        .displayName(m.admin_cli_table_cli())
        .icon(BotIcon)
        .build(),
      dtf
        .text()
        .id('operator')
        .accessor(
          (task) =>
            task.connection?.userLabel || m.admin_dashboard_unknown_user(),
        )
        .displayName(m.admin_cli_table_operator())
        .icon(UserRoundIcon)
        .build(),
      dtf
        .text()
        .id('target')
        .accessor((task) => task.target || m.oauth_none())
        .displayName(m.admin_dashboard_table_target())
        .icon(SearchIcon)
        .build(),
      dtf
        .date()
        .id('updatedAt')
        .accessor((task) => normalizeDate(task.updatedAt))
        .displayName(m.oauth_clients_table_updated())
        .icon(CalendarIcon)
        .build(),
      dtf
        .option()
        .id('status')
        .accessor((task) => task.status)
        .displayName(m.oauth_clients_table_status())
        .icon(ShieldIcon)
        .transformOptionFn((status) => ({
          label: translateStatusLabel(status),
          value: status,
        }))
        .build(),
    ] as const
  }, [locale])
  const hasTasks = snapshot.tasks.length > 0
  const hasCompletedTasks = snapshot.tasks.some((task) =>
    isClearableFlowTaskStatus(task.status),
  )

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <AdminPageHeader
        title={m.admin_flow_page_title()}
        description={m.admin_flow_page_description()}
        variant="plain"
        meta={
          <p className="text-sm text-muted-foreground">
            {m.admin_flow_snapshot({
              time: formatAdminDate(snapshot.snapshotAt) || snapshot.snapshotAt,
            })}
          </p>
        }
        actions={
          <>
            <p className="text-sm text-muted-foreground">
              {m.admin_flow_auto_refresh({
                seconds: String(FLOW_PAGE_POLL_INTERVAL_MS / 1000),
              })}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFlash(null)
                void refreshSnapshot(activeTaskId)
              }}
              disabled={isRefreshing}
            >
              {isRefreshing ? m.status_refreshing() : m.admin_flow_refresh()}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isClearing || !hasCompletedTasks}
              onClick={() => {
                setFlash(null)
                setClearMode('completed')
              }}
            >
              <Trash2Icon />
              {isClearing
                ? m.admin_flow_clear_pending()
                : m.admin_flow_clear_button()}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isClearing || !hasTasks}
              onClick={() => {
                setFlash(null)
                setClearMode('all')
              }}
            >
              <Trash2Icon />
              {isClearing
                ? m.admin_flow_force_clear_pending()
                : m.admin_flow_force_clear_button()}
            </Button>
          </>
        }
      />

      {flash ? (
        <Alert variant={flash.kind === 'error' ? 'destructive' : undefined}>
          <AlertTitle>{flash.title}</AlertTitle>
          <AlertDescription>{flash.description}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader>
          <CardDescription>{m.admin_flow_list_description()}</CardDescription>
          <CardTitle>{m.admin_flow_list_title()}</CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col">
          <ClientFilterableAdminTable
            data={snapshot.tasks}
            columnsConfig={flowColumns}
            getRowId={(task) => task.id}
            fillHeight
            emptyState={
              <EmptyState
                title={m.admin_flow_list_empty_title()}
                description={m.admin_flow_list_empty_description()}
              />
            }
            renderTable={({ rows, selection }) => (
              <Table className="min-w-[1320px]">
                <TableHeader>
                  <TableRow>
                    <AdminTableSelectionHead
                      rows={rows}
                      selection={selection}
                    />
                    <TableHead>{m.admin_session_table_flow()}</TableHead>
                    <TableHead>{m.admin_cli_table_cli()}</TableHead>
                    <TableHead>{m.admin_cli_table_operator()}</TableHead>
                    <TableHead>{m.admin_dashboard_table_target()}</TableHead>
                    <TableHead>{m.oauth_clients_table_updated()}</TableHead>
                    <TableHead>{m.oauth_clients_table_status()}</TableHead>
                    <TableHead>{m.admin_dashboard_table_manage()}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((task) => (
                    <TableRow
                      key={task.id}
                      data-selected={selection.isSelected(task) || undefined}
                    >
                      <AdminTableSelectionCell
                        row={task}
                        selection={selection}
                      />
                      <TableCell className="align-top">
                        <div className="max-w-[360px] space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">
                              {getFlowDisplayName(task.flowType)}
                            </span>
                            {task.isLive ? (
                              <Badge variant="outline">
                                {m.admin_flow_live_badge()}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-sm leading-6 text-muted-foreground">
                            {task.title || task.body}
                          </p>
                          <p className="text-sm leading-6 text-muted-foreground">
                            {task.lastMessage || task.body}
                          </p>
                          <CopyableValue
                            value={task.id}
                            code
                            title={m.clipboard_copy_value({
                              label: m.admin_flow_meta_task_id(),
                            })}
                            className="max-w-full text-sm text-muted-foreground"
                            contentClassName="break-all"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="max-w-[240px] space-y-1">
                          <div className="font-medium text-foreground">
                            {task.connection?.cliName ||
                              m.admin_cli_unknown_cli()}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {task.connection?.id || m.oauth_none()}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="max-w-[260px] space-y-1">
                          <div className="font-medium text-foreground">
                            {task.connection?.userLabel ||
                              m.admin_dashboard_unknown_user()}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {task.connection?.authClientId || m.oauth_none()}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {task.target || m.oauth_none()}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {formatAdminDate(task.updatedAt) || m.status_unknown()}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge value={task.status} className="w-fit" />
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDetailsOpen(task.id)
                          }}
                        >
                          {m.mail_inbox_table_details()}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          />
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(clearMode)}
        onOpenChange={(open) => {
          if (!isClearing && !open) {
            setClearMode(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {clearMode === 'all'
                ? m.admin_flow_force_clear_confirm_title()
                : m.admin_flow_clear_confirm_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {clearMode === 'all'
                ? m.admin_flow_force_clear_confirm_description()
                : m.admin_flow_clear_confirm_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>
              {m.ui_close()}
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={isClearing || !clearMode}
              onClick={() => {
                if (!clearMode) {
                  return
                }

                void clearFlowRuns(clearMode)
              }}
            >
              {clearMode === 'all'
                ? isClearing
                  ? m.admin_flow_force_clear_pending()
                  : m.admin_flow_force_clear_button()
                : isClearing
                  ? m.admin_flow_clear_pending()
                  : m.admin_flow_clear_button()}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={Boolean(activeTaskId)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailsOpen(undefined, true)
          }
        }}
      >
        <DialogContent className="grid max-h-[92vh] max-w-[min(1120px,calc(100%-2rem))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[min(1120px,calc(100%-2rem))]">
          <DialogHeader className="gap-3 border-b px-6 py-5 pr-14 text-left">
            <DialogDescription>{m.admin_flow_page_title()}</DialogDescription>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <DialogTitle className="text-xl">
                  {activeTask
                    ? getFlowDisplayName(activeTask.flowType)
                    : m.admin_flow_not_found_title()}
                </DialogTitle>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  {activeTask
                    ? activeTask.title || activeTask.body
                    : m.admin_flow_not_found_description()}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void refreshSnapshot(activeTaskId)
                }}
                disabled={isRefreshing}
              >
                {isRefreshing ? m.status_refreshing() : m.admin_flow_refresh()}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <p>
                {m.admin_flow_auto_refresh({
                  seconds: String(FLOW_PAGE_POLL_INTERVAL_MS / 1000),
                })}
              </p>
              <p>
                {m.admin_flow_snapshot({
                  time:
                    formatAdminDate(snapshot.snapshotAt) || snapshot.snapshotAt,
                })}
              </p>
            </div>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto px-6 py-5">
            {activeTask ? (
              <div className="flex flex-col gap-6">
                <FlowDetailPanel task={activeTask} />
              </div>
            ) : (
              <Card>
                <CardHeader>
                  <CardDescription>{m.admin_flow_page_title()}</CardDescription>
                  <CardTitle>{m.admin_flow_not_found_title()}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {m.admin_flow_not_found_description()}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function isClearableFlowTaskStatus(status: string) {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELED'
}

function buildAdminFlowSnapshotApiHref(taskId?: string) {
  if (!taskId) {
    return '/api/admin/flows'
  }

  return `/api/admin/flows?taskId=${encodeURIComponent(taskId)}`
}

function normalizeDate(value?: string | null) {
  if (!value) {
    return undefined
  }

  const normalized = new Date(value)
  return Number.isNaN(normalized.getTime()) ? undefined : normalized
}
