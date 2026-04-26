import { ActivityIcon } from 'lucide-react'

import type {
  AdminFlowTaskDetail,
  AdminFlowTaskSummary,
} from '#/lib/server/flow-runs'
import {
  EmptyState,
  StatusBadge,
  formatAdminDate,
} from '#/components/admin/layout'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { ScrollArea } from '#/components/ui/scroll-area'
import { Separator } from '#/components/ui/separator'
import { formatFlowBatchLabel, getFlowDisplayName } from '#/lib/admin-flows'
import { m } from '#/paraglide/messages'

export function FlowDetailPanel(props: {
  task: AdminFlowTaskDetail | AdminFlowTaskSummary
}) {
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
              value={formatFlowBatchLabel(props.task)}
            />
            <FlowMetaItem
              label={m.admin_flow_meta_attempts()}
              value={String(props.task.attemptCount)}
            />
            <FlowMetaItem
              label={m.admin_flow_meta_log_count()}
              value={
                isDetail ? String(props.task.events.length) : m.oauth_none()
              }
            />
            <FlowMetaItem
              label={m.admin_dashboard_table_target()}
              value={props.task.target || m.oauth_none()}
            />
            <FlowMetaItem
              label={m.admin_cli_table_cli()}
              value={
                props.task.connection?.cliName || m.admin_cli_unknown_cli()
              }
            />
            <FlowMetaItem
              label={m.admin_cli_table_operator()}
              value={
                props.task.connection?.userLabel ||
                m.admin_dashboard_unknown_user()
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
              value={
                formatAdminDate(props.task.leaseClaimedAt) || m.oauth_none()
              }
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
                        {event.message ||
                          props.task.lastMessage ||
                          m.oauth_none()}
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
          <CardDescription>
            {m.admin_flow_payload_description()}
          </CardDescription>
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

function FlowMetaItem(props: { label: string; value: string; mono?: boolean }) {
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

function getPayloadPreview(
  task: Pick<AdminFlowTaskSummary, 'config' | 'batch' | 'externalServices'>,
) {
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
