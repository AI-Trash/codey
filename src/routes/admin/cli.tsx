import { startTransition, useEffect, useMemo, useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  ActivityIcon,
  BotIcon,
  RefreshCcwIcon,
  ShieldIcon,
  UserRoundIcon,
} from 'lucide-react'

import {
  AdminMetricCard,
  AdminPageHeader,
  EmptyState,
  StatusBadge,
  formatAdminDate,
} from '#/components/admin/layout'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { m } from '#/paraglide/messages'

const CLI_CONNECTION_POLL_INTERVAL_MS = 10_000

const loadAdminCliConnections = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [
      { getRequest },
      { requireAdminPermission },
      { listAdminCliConnectionState },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../lib/server/auth'),
      import('../../lib/server/cli-connections'),
    ])

    const request = getRequest()

    try {
      await requireAdminPermission(request, 'OPERATIONS')
    } catch {
      return { authorized: false as const }
    }

    return {
      authorized: true as const,
      state: await listAdminCliConnectionState(),
    }
  },
)

export const Route = createFileRoute('/admin/cli')({
  loader: async () => loadAdminCliConnections(),
  component: AdminCliConnectionsPage,
})

type CliConnectionSummary = {
  id: string
  sessionRef: string | null
  userId: string | null
  authClientId: string | null
  cliName: string | null
  target: string | null
  userAgent: string | null
  connectionPath: string
  status: 'active' | 'offline'
  connectedAt: string
  lastSeenAt: string
  disconnectedAt: string | null
  githubLogin: string | null
  email: string | null
  userLabel: string
}

type CliConnectionState = {
  snapshotAt: string
  activeConnections: CliConnectionSummary[]
  recentConnections: CliConnectionSummary[]
}

function AdminCliConnectionsPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  const [state, setState] = useState(data.state as CliConnectionState)
  const [isRefreshing, setIsRefreshing] = useState(false)

  async function refreshConnections() {
    setIsRefreshing(true)
    try {
      const response = await fetch('/api/admin/cli-connections', {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        return
      }

      const nextState = (await response.json()) as CliConnectionState
      startTransition(() => {
        setState(nextState)
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
        const response = await fetch('/api/admin/cli-connections', {
          headers: {
            Accept: 'application/json',
          },
        })

        if (!response.ok || !active) {
          return
        }

        const nextState = (await response.json()) as CliConnectionState
        startTransition(() => {
          setState(nextState)
        })
      } finally {
        if (active) {
          setIsRefreshing(false)
        }
      }
    }

    const interval = window.setInterval(() => {
      void tick()
    }, CLI_CONNECTION_POLL_INTERVAL_MS)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  const uniqueTargets = useMemo(() => {
    return new Set(
      state.activeConnections
        .map((connection) =>
          connection.target ||
          connection.githubLogin ||
          connection.email ||
          connection.userId ||
          null,
        )
        .filter((value): value is string => Boolean(value)),
    ).size
  }, [state.activeConnections])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <AdminPageHeader
        title={m.admin_cli_page_title()}
        description={m.admin_cli_page_description()}
        variant="plain"
        meta={
          <p className="text-sm text-muted-foreground">
            {m.admin_cli_snapshot({
              time: formatAdminDate(state.snapshotAt) || state.snapshotAt,
            })}
          </p>
        }
        actions={
          <>
            <p className="text-sm text-muted-foreground">
              {m.admin_cli_auto_refresh({
                seconds: String(CLI_CONNECTION_POLL_INTERVAL_MS / 1000),
              })}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void refreshConnections()
              }}
              disabled={isRefreshing}
            >
              <RefreshCcwIcon
                className={isRefreshing ? 'animate-spin' : undefined}
              />
              {isRefreshing ? m.status_refreshing() : m.admin_cli_refresh()}
            </Button>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <AdminMetricCard
          label={m.admin_cli_metric_connected_label()}
          value={String(state.activeConnections.length)}
          description={m.admin_cli_metric_connected_description()}
        />
        <AdminMetricCard
          label={m.admin_cli_metric_targets_label()}
          value={String(uniqueTargets)}
          description={m.admin_cli_metric_targets_description()}
        />
        <AdminMetricCard
          label={m.admin_cli_metric_recent_label()}
          value={String(state.recentConnections.length)}
          description={m.admin_cli_metric_recent_description()}
        />
      </section>

      <CliConnectionsTableCard
        title={m.admin_cli_connected_section_title()}
        description={m.admin_cli_connected_section_description()}
        emptyTitle={m.admin_cli_empty_connected_title()}
        emptyDescription={m.admin_cli_empty_connected_description()}
        connections={state.activeConnections}
        showDisconnectedAt={false}
      />

      <CliConnectionsTableCard
        title={m.admin_cli_recent_section_title()}
        description={m.admin_cli_recent_section_description()}
        emptyTitle={m.admin_cli_empty_recent_title()}
        emptyDescription={m.admin_cli_empty_recent_description()}
        connections={state.recentConnections}
        showDisconnectedAt
      />
    </div>
  )
}

function CliConnectionsTableCard(props: {
  title: string
  description: string
  emptyTitle: string
  emptyDescription: string
  connections: CliConnectionSummary[]
  showDisconnectedAt: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {props.connections.length ? (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{m.admin_cli_table_cli()}</TableHead>
                  <TableHead>{m.admin_cli_table_operator()}</TableHead>
                  <TableHead>{m.admin_cli_table_target()}</TableHead>
                  <TableHead>{m.admin_cli_table_auth_client()}</TableHead>
                  <TableHead>{m.admin_cli_table_status()}</TableHead>
                  <TableHead>{m.admin_cli_table_connected_at()}</TableHead>
                  <TableHead>{m.admin_cli_table_last_seen()}</TableHead>
                  {props.showDisconnectedAt ? (
                    <TableHead>{m.admin_cli_table_disconnected_at()}</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.connections.map((connection) => (
                  <TableRow key={connection.id}>
                    <TableCell>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="inline-flex items-center gap-2 font-medium">
                          <BotIcon className="size-4 text-muted-foreground" />
                          {connection.cliName || m.admin_cli_unknown_cli()}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {connection.connectionPath}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="inline-flex items-center gap-2 font-medium">
                          <UserRoundIcon className="size-4 text-muted-foreground" />
                          {connection.userLabel}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {formatSecondaryIdentity(connection)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="font-medium">
                          {connection.target || m.admin_cli_unknown_target()}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {connection.sessionRef || m.oauth_none()}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="inline-flex items-center gap-2 font-medium">
                          <ShieldIcon className="size-4 text-muted-foreground" />
                          {connection.authClientId ||
                            m.admin_cli_unknown_auth_client()}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {connection.userAgent || m.oauth_none()}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={connection.status} />
                    </TableCell>
                    <TableCell>
                      <DateCell value={connection.connectedAt} icon={ActivityIcon} />
                    </TableCell>
                    <TableCell>
                      <DateCell value={connection.lastSeenAt} icon={RefreshCcwIcon} />
                    </TableCell>
                    {props.showDisconnectedAt ? (
                      <TableCell>
                        <DateCell
                          value={connection.disconnectedAt}
                          icon={ActivityIcon}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            title={props.emptyTitle}
            description={props.emptyDescription}
          />
        )}
      </CardContent>
    </Card>
  )
}

function DateCell(props: {
  value?: string | null
  icon: typeof ActivityIcon
}) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <props.icon className="size-4 text-muted-foreground" />
      {formatAdminDate(props.value) || m.oauth_none()}
    </span>
  )
}

function formatSecondaryIdentity(connection: CliConnectionSummary) {
  if (connection.githubLogin && connection.email) {
    return `@${connection.githubLogin} · ${connection.email}`
  }

  if (connection.githubLogin) {
    return `@${connection.githubLogin}`
  }

  return connection.email || m.oauth_none()
}
