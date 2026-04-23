import { startTransition, useEffect, useMemo, useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  ActivityIcon,
  BotIcon,
  Clock3Icon,
  RefreshCcwIcon,
  SearchIcon,
  UserRoundIcon,
} from 'lucide-react'

import type {
  AdminFlowRunSnapshot,
  AdminFlowTaskDetail,
  AdminFlowTaskSummary,
} from '#/lib/server/flow-runs'
import {
  AdminPageHeader,
  EmptyState,
  StatusBadge,
  formatAdminDate,
} from '#/components/admin/layout'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { ScrollArea } from '#/components/ui/scroll-area'
import { Separator } from '#/components/ui/separator'
import { m } from '#/paraglide/messages'

const FLOW_PAGE_POLL_INTERVAL_MS = 5_000

const loadAdminFlowRuns = createServerFn({ method: 'GET' })
  .inputValidator((data: { taskId?: string }) => data)
  .handler(async ({ data }) => {
    const [{ getRequest }, { requireAdminPermission }, { getAdminFlowRunSnapshotForActor }] =
      await Promise.all([
        import('@tanstack/react-start/server'),
        import('../../lib/server/auth'),
        import('../../lib/server/flow-runs'),
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
          taskId: data.taskId,
        }),
      }
    } catch {
      return { authorized: false as const }
    }
  })

export const Route = createFileRoute('/admin/flows')({
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

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  const [snapshot, setSnapshot] = useState(
    data.snapshot as AdminFlowRunSnapshot,
  )
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    setSnapshot(data.snapshot as AdminFlowRunSnapshot)
  }, [data.snapshot])

  useEffect(() => {
    if (!search.taskId && snapshot.selectedTask?.id) {
      void navigate({
        to: '/admin/flows',
        search: {
          taskId: snapshot.selectedTask.id,
        },
        replace: true,
      })
    }
  }, [navigate, search.taskId, snapshot.selectedTask?.id])

  async function refreshSnapshot() {
    setIsRefreshing(true)
    try {
      const response = await fetch(
        `/api/admin/flows${search.taskId ? `?taskId=${encodeURIComponent(search.taskId)}` : ''}`,
        {
          headers: {
            Accept: 'application/json',
          },
        },
      )

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

  useEffect(() => {
    let active = true

    const tick = async () => {
      if (!active) {
        return
      }

      setIsRefreshing(true)
      try {
        const response = await fetch(
          `/api/admin/flows${search.taskId ? `?taskId=${encodeURIComponent(search.taskId)}` : ''}`,
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
  }, [search.taskId])

  const filteredTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return snapshot.tasks
    }

    return snapshot.tasks.filter((task) =>
      [
        task.id,
        task.flowType,
        task.title,
        task.body,
        task.target,
        task.workerId,
        task.lastMessage,
        task.lastError,
        task.connection?.cliName,
        task.connection?.userLabel,
        task.connection?.target,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized)),
    )
  }, [query, snapshot.tasks])

  const selectedTask =
    snapshot.selectedTask?.id === search.taskId
      ? snapshot.selectedTask
      : snapshot.selectedTask ||
        filteredTasks.find((task) => task.id === search.taskId) ||
        filteredTasks[0] ||
        snapshot.tasks[0] ||
        null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <AdminPageHeader
        title={m.admin_flow_page_title()}
        description={m.admin_flow_page_description()}
        variant="plain"
        meta={
          <p className="text-sm text-muted-foreground">
            {m.admin_flow_snapshot({
              time:
                formatAdminDate(snapshot.snapshotAt) || snapshot.snapshotAt,
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
                void refreshSnapshot()
              }}
              disabled={isRefreshing}
            >
              <RefreshCcwIcon
                className={isRefreshing ? 'animate-spin' : undefined}
              />
              {isRefreshing ? m.status_refreshing() : m.admin_flow_refresh()}
            </Button>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="gap-4">
            <div>
              <CardTitle>{m.admin_flow_list_title()}</CardTitle>
              <CardDescription>
                {m.admin_flow_list_description()}
              </CardDescription>
            </div>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value)
                }}
                className="pl-9"
                placeholder={m.admin_flow_search_placeholder()}
              />
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            {filteredTasks.length ? (
              <ScrollArea className="min-h-0 flex-1">
                <div className="grid gap-3 p-4">
                  {filteredTasks.map((task) => (
                    <FlowListItem
                      key={task.id}
                      task={task}
                      active={task.id === selectedTask?.id}
                      onSelect={() => {
                        void navigate({
                          to: '/admin/flows',
                          search: {
                            taskId: task.id,
                          },
                        })
                      }}
                    />
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="p-4">
                <EmptyState
                  title={m.admin_flow_list_empty_title()}
                  description={m.admin_flow_list_empty_description()}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex min-h-0 flex-col gap-6">
          {selectedTask ? (
            <FlowDetailPanel task={selectedTask} />
          ) : (
            <EmptyState
              title={m.admin_flow_detail_empty_title()}
              description={m.admin_flow_detail_empty_description()}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function FlowListItem(props: {
  task: AdminFlowTaskSummary
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={`rounded-xl border p-4 text-left transition-colors ${
        props.active
          ? 'border-primary bg-primary/5'
          : 'hover:border-primary/40 hover:bg-muted/30'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">
            {getFlowDisplayName(props.task.flowType)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {props.task.id}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {props.task.isLive ? (
            <Badge variant="outline">{m.admin_flow_live_badge()}</Badge>
          ) : null}
          <StatusBadge value={props.task.status} className="w-fit" />
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BotIcon className="size-4" />
          <span className="truncate">
            {props.task.connection?.cliName || m.admin_cli_unknown_cli()}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <UserRoundIcon className="size-4" />
          <span className="truncate">
            {props.task.connection?.userLabel || m.admin_dashboard_unknown_user()}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock3Icon className="size-4" />
          <span className="truncate">
            {formatAdminDate(props.task.updatedAt) || props.task.updatedAt}
          </span>
        </div>
        <p className="text-sm leading-6 text-foreground">
          {props.task.lastMessage || props.task.body}
        </p>
      </div>
    </button>
  )
}

function FlowDetailPanel(props: { task: AdminFlowTaskDetail | AdminFlowTaskSummary }) {
  const isDetail = 'events' in props.task
  const payload = getPayloadPreview(props.task)
  const runtimeVisible =
    props.task.isLive &&
    props.task.connection?.runtimeTaskId === props.task.id &&
    (props.task.connection.runtimeFlowMessage ||
      props.task.connection.runtimeFlowStatus)

  return (
    <>
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <CardTitle>{getFlowDisplayName(props.task.flowType)}</CardTitle>
              <CardDescription>{props.task.title}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {props.task.isLive ? (
                <Badge variant="outline">{m.admin_flow_live_badge()}</Badge>
              ) : null}
              <StatusBadge value={props.task.status} className="w-fit" />
            </div>
          </div>

          <p className="text-sm leading-6 text-muted-foreground">
            {props.task.lastMessage || props.task.body}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {props.task.lastError ? (
            <Alert variant="destructive">
              <AlertTitle>{m.status_failed()}</AlertTitle>
              <AlertDescription>{props.task.lastError}</AlertDescription>
            </Alert>
          ) : null}

          {runtimeVisible ? (
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="mb-2 flex items-center gap-2">
                <ActivityIcon className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  {m.admin_flow_runtime_title()}
                </p>
              </div>
              <p className="text-sm leading-6 text-foreground">
                {props.task.connection?.runtimeFlowMessage ||
                  props.task.connection?.runtimeFlowStatus ||
                  m.admin_cli_flow_idle_description()}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {m.admin_flow_runtime_description()}{' '}
                {props.task.connection?.runtimeFlowUpdatedAt
                  ? formatAdminDate(props.task.connection.runtimeFlowUpdatedAt)
                  : m.oauth_none()}
              </p>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <FlowMetaItem
              label={m.admin_flow_meta_task_id()}
              value={props.task.id}
              mono
            />
            <FlowMetaItem
              label={m.admin_flow_meta_connection()}
              value={props.task.connection?.id || m.oauth_none()}
              mono
            />
            <FlowMetaItem
              label={m.admin_flow_meta_worker()}
              value={props.task.workerId}
              mono
            />
            <FlowMetaItem
              label={m.admin_flow_meta_batch()}
              value={formatBatchLabel(props.task)}
            />
            <FlowMetaItem
              label={m.admin_flow_meta_attempts()}
              value={String(props.task.attemptCount)}
            />
            <FlowMetaItem
              label={m.admin_flow_meta_log_count()}
              value={isDetail ? String(props.task.events.length) : m.oauth_none()}
            />
            <FlowMetaItem
              label={m.admin_dashboard_table_target()}
              value={props.task.target || m.oauth_none()}
            />
            <FlowMetaItem
              label={m.admin_cli_table_cli()}
              value={props.task.connection?.cliName || m.admin_cli_unknown_cli()}
            />
            <FlowMetaItem
              label={m.admin_cli_table_operator()}
              value={
                props.task.connection?.userLabel || m.admin_dashboard_unknown_user()
              }
            />
            <FlowMetaItem
              label={m.admin_cli_table_auth_client()}
              value={props.task.connection?.authClientId || m.oauth_none()}
            />
            <FlowMetaItem
              label={m.admin_flow_meta_connection_path()}
              value={props.task.connection?.connectionPath || m.oauth_none()}
              mono
            />
            <FlowMetaItem
              label={m.admin_dashboard_table_created()}
              value={formatAdminDate(props.task.createdAt) || m.oauth_none()}
            />
            <FlowMetaItem
              label={m.admin_flow_meta_claimed()}
              value={formatAdminDate(props.task.leaseClaimedAt) || m.oauth_none()}
            />
            <FlowMetaItem
              label={m.admin_flow_meta_started()}
              value={formatAdminDate(props.task.startedAt) || m.oauth_none()}
            />
            <FlowMetaItem
              label={m.oauth_clients_table_updated()}
              value={formatAdminDate(props.task.updatedAt) || m.oauth_none()}
            />
            <FlowMetaItem
              label={m.admin_flow_meta_completed()}
              value={formatAdminDate(props.task.completedAt) || m.oauth_none()}
            />
          </div>
        </CardContent>
      </Card>

      {isDetail ? (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CardHeader>
            <CardTitle>{m.admin_flow_logs_title()}</CardTitle>
            <CardDescription>{m.admin_flow_logs_description()}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col">
            {props.task.events.length ? (
              <ScrollArea className="min-h-0 flex-1 rounded-xl border">
                <div className="divide-y">
                  {props.task.events.map((event) => (
                    <div key={event.id} className="space-y-3 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {event.type === 'LOG' ? (
                            <Badge variant="outline">
                              {m.admin_flow_log_label()}
                            </Badge>
                          ) : (
                            <StatusBadge
                              value={event.status || event.type}
                              className="w-fit"
                            />
                          )}
                          {event.connection?.cliName ? (
                            <span className="text-xs text-muted-foreground">
                              {event.connection.cliName}
                            </span>
                          ) : null}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatAdminDate(event.createdAt) || event.createdAt}
                        </span>
                      </div>
                      <p className="text-sm leading-6 text-foreground">
                        {event.message || props.task.lastMessage || m.oauth_none()}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <EmptyState
                title={m.admin_flow_logs_empty_title()}
                description={m.admin_flow_logs_empty_description()}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{m.admin_flow_payload_title()}</CardTitle>
          <CardDescription>{m.admin_flow_payload_description()}</CardDescription>
        </CardHeader>
        <CardContent>
          {payload ? (
            <ScrollArea className="h-[320px] rounded-xl border bg-muted/20">
              <pre className="p-4 text-xs leading-6 whitespace-pre-wrap break-all text-foreground">
                {JSON.stringify(payload, null, 2)}
              </pre>
            </ScrollArea>
          ) : (
            <p className="text-sm text-muted-foreground">
              {m.admin_flow_payload_empty()}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function FlowMetaItem(props: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {props.label}
      </p>
      <Separator className="my-2" />
      <p
        className={`text-sm text-foreground ${props.mono ? 'break-all font-mono' : 'break-words'}`}
      >
        {props.value}
      </p>
    </div>
  )
}

function getFlowDisplayName(flowType: string) {
  if (flowType === 'chatgpt-register') {
    return m.admin_cli_flow_chatgpt_register_name()
  }

  if (flowType === 'chatgpt-login') {
    return m.admin_cli_flow_chatgpt_login_name()
  }

  if (flowType === 'chatgpt-login-invite') {
    return m.admin_cli_flow_chatgpt_login_invite_name()
  }

  if (flowType === 'codex-oauth') {
    return m.admin_cli_flow_codex_oauth_name()
  }

  if (flowType === 'noop') {
    return m.admin_cli_flow_noop_name()
  }

  return flowType
}

function formatBatchLabel(task: Pick<AdminFlowTaskSummary, 'batch'>) {
  if (!task.batch) {
    return m.oauth_none()
  }

  const parts = []

  if (task.batch.batchId) {
    parts.push(task.batch.batchId)
  }

  if (task.batch.sequence && task.batch.total) {
    parts.push(`${task.batch.sequence}/${task.batch.total}`)
  }

  if (task.batch.parallelism) {
    parts.push(`parallelism ${task.batch.parallelism}`)
  }

  return parts.join(' · ') || m.oauth_none()
}

function getPayloadPreview(task: Pick<
  AdminFlowTaskSummary,
  'config' | 'batch' | 'externalServices'
>) {
  const hasConfig = Object.keys(task.config).length > 0

  if (!hasConfig && !task.batch && !task.externalServices) {
    return null
  }

  return {
    ...(hasConfig ? { config: task.config } : {}),
    ...(task.batch ? { batch: task.batch } : {}),
    ...(task.externalServices
      ? { externalServices: task.externalServices }
      : {}),
  }
}
