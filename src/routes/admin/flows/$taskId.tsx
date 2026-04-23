import { startTransition, useEffect, useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import type {
  AdminFlowRunSnapshot,
  AdminFlowTaskDetail,
} from '#/lib/server/flow-runs'
import { FlowDetailPanel } from '#/components/admin/flow-runs'
import { AdminPageHeader, formatAdminDate } from '#/components/admin/layout'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { getFlowDisplayName } from '#/lib/admin-flows'
import { m } from '#/paraglide/messages'

const FLOW_PAGE_POLL_INTERVAL_MS = 5_000

const loadAdminFlowTask = createServerFn({ method: 'GET' })
  .inputValidator((data: { taskId: string }) => data)
  .handler(async ({ data }) => {
    const [{ getRequest }, { requireAdminPermission }, { getAdminFlowTaskDetailForActor }] =
      await Promise.all([
        import('@tanstack/react-start/server'),
        import('../../../lib/server/auth'),
        import('../../../lib/server/flow-runs'),
      ])

    const request = getRequest()

    try {
      const admin = await requireAdminPermission(request, 'CLI_OPERATIONS')

      return {
        authorized: true as const,
        snapshotAt: new Date().toISOString(),
        task: await getAdminFlowTaskDetailForActor({
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

export const Route = createFileRoute('/admin/flows/$taskId')({
  loader: ({ params }) => loadAdminFlowTask({ data: { taskId: params.taskId } }),
  component: AdminFlowDetailPage,
})

function AdminFlowDetailPage() {
  const data = Route.useLoaderData()
  const params = Route.useParams()
  const authorizedSnapshotAt = data.authorized ? data.snapshotAt : null
  const authorizedTask = data.authorized
    ? (data.task as AdminFlowTaskDetail | null)
    : null
  const [detailState, setDetailState] = useState(() => ({
    snapshotAt: authorizedSnapshotAt,
    task: authorizedTask,
  }))
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    if (!data.authorized) {
      return
    }

    setDetailState({
      snapshotAt: authorizedSnapshotAt,
      task: authorizedTask,
    })
  }, [authorizedSnapshotAt, authorizedTask, data.authorized])

  async function refreshTask() {
    setIsRefreshing(true)
    try {
      const response = await fetch(
        `/api/admin/flows?taskId=${encodeURIComponent(params.taskId)}`,
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
        setDetailState({
          snapshotAt: nextSnapshot.snapshotAt,
          task: nextSnapshot.selectedTask,
        })
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
          `/api/admin/flows?taskId=${encodeURIComponent(params.taskId)}`,
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
          setDetailState({
            snapshotAt: nextSnapshot.snapshotAt,
            task: nextSnapshot.selectedTask,
          })
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
  }, [params.taskId])

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  if (!detailState.task) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardDescription>{m.admin_flow_page_title()}</CardDescription>
          <CardTitle>{m.admin_flow_not_found_title()}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {m.admin_flow_not_found_description()}
          </p>
          <Button asChild variant="outline">
            <a href="/admin/flows">{m.admin_nav_flows()}</a>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <AdminPageHeader
        title={getFlowDisplayName(detailState.task.flowType)}
        description={detailState.task.title || detailState.task.body}
        variant="plain"
        meta={
          detailState.snapshotAt ? (
            <p className="text-sm text-muted-foreground">
              {m.admin_flow_snapshot({
                time:
                  formatAdminDate(detailState.snapshotAt) ||
                  detailState.snapshotAt,
              })}
            </p>
          ) : undefined
        }
        actions={
          <>
            <Button asChild variant="outline">
              <a href="/admin/flows">{m.admin_nav_flows()}</a>
            </Button>
            <p className="text-sm text-muted-foreground">
              {m.admin_flow_auto_refresh({
                seconds: String(FLOW_PAGE_POLL_INTERVAL_MS / 1000),
              })}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void refreshTask()
              }}
              disabled={isRefreshing}
            >
              {isRefreshing ? m.status_refreshing() : m.admin_flow_refresh()}
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-6">
        <FlowDetailPanel task={detailState.task} />
      </div>
    </div>
  )
}
