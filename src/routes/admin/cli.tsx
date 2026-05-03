import { startTransition, useEffect, useMemo, useRef, useState } from 'react'

import {
  createCliFlowTaskRequest,
  DEFAULT_CHATGPT_REGISTER_TRIAL_CLAIM_METHOD,
  MAX_CLI_FLOW_TASK_BATCH_SIZE,
  type CliFlowCommandId,
  type CliFlowConfigById,
  type CliFlowConfigFieldDefinition,
  cliFlowDefinitions,
  listCliFlowConfigFieldDefinitions,
} from '../../../packages/cli/src/modules/flow-cli/flow-registry'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  type LucideIcon,
  BotIcon,
  BriefcaseIcon,
  RefreshCcwIcon,
  SettingsIcon,
} from 'lucide-react'

import {
  AdminPageHeader,
  EmptyState,
  StatusBadge,
  formatAdminDate,
} from '#/components/admin/layout'
import { AdminPaginatedTable } from '#/components/admin/filterable-table'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import {
  AdminTableSelectionCell,
  AdminTableSelectionHead,
} from '#/components/admin/table-selection'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Textarea } from '#/components/ui/textarea'
import {
  getOptionDescription,
  getOptionDisplayName,
  resolveFlowDescription,
  resolveFlowDisplayName,
} from '#/lib/admin-flow-labels'
import {
  buildFlowConfigFromDraft,
  createDraftValuesFromFlowConfig,
  type DraftOptionState,
} from '#/lib/flow-config-ui'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { getToastErrorDescription, showAppToast } from '#/lib/toast'
import { m } from '#/paraglide/messages'

const CLI_CONNECTION_POLL_INTERVAL_MS = 10_000
const BOOLEAN_DEFAULT_SENTINEL = '__default__'
const EMAIL_ADDRESS_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

type DispatchBatchMode = 'none' | 'repeat' | 'email-list'

type DispatchBatchState = {
  mode: DispatchBatchMode
  count: number
  emails: string[]
}

type DispatchSubmission<TFlowId extends CliFlowCommandId> = {
  config: CliFlowConfigById[TFlowId]
  configs?: CliFlowConfigById[TFlowId][]
  repeatCount: number
}

const loadAdminCliConnections = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [
      { getRequest },
      { requireAdminPermission },
      { listAdminCliConnectionStateForActor },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../lib/server/auth'),
      import('../../lib/server/cli-connections'),
    ])

    const request = getRequest()

    try {
      const admin = await requireAdminPermission(request, 'CLI_OPERATIONS')

      return {
        authorized: true as const,
        state: await listAdminCliConnectionStateForActor({
          userId: admin.user.id,
          githubLogin: admin.user.githubLogin,
          email: admin.user.email,
        }),
      }
    } catch {
      return { authorized: false as const }
    }
  },
)

export const Route = createFileRoute('/admin/cli')({
  loader: async () => loadAdminCliConnections(),
  component: AdminCliConnectionsPage,
})

type CliConnectionSummary = {
  id: string
  workerId: string | null
  sessionRef: string | null
  userId: string | null
  authClientId: string | null
  cliName: string | null
  target: string | null
  userAgent: string | null
  registeredFlows: string[]
  storageStateIdentityIds: string[]
  storageStateEmails: string[]
  browserLimit: number
  connectionPath: string
  status: 'active' | 'offline'
  connectedAt: string
  lastSeenAt: string
  disconnectedAt: string | null
  githubLogin: string | null
  email: string | null
  userLabel: string
  runtimeFlowId: string | null
  runtimeTaskId: string | null
  runtimeFlowStatus: string | null
  runtimeFlowMessage: string | null
  runtimeFlowStartedAt: string | null
  runtimeFlowCompletedAt: string | null
  runtimeFlowUpdatedAt: string | null
}

type CliConnectionState = {
  snapshotAt: string
  activeConnections: CliConnectionSummary[]
}

type DispatchResultSummary = {
  queuedCount: number
  assignedCliCount: number
}

type FlowDefaultConfigSummary = {
  flowType: CliFlowCommandId
  config: Record<string, unknown>
  updatedAt: string | null
}

const DEFAULT_DRAFT_VALUES_BY_FLOW: Partial<
  Record<CliFlowCommandId, DraftOptionState>
> = {
  'chatgpt-register': {
    claimTrial: DEFAULT_CHATGPT_REGISTER_TRIAL_CLAIM_METHOD,
  },
  'chatgpt-team-trial': {
    claimTrial: DEFAULT_CHATGPT_REGISTER_TRIAL_CLAIM_METHOD,
  },
}

async function loadFlowDefaultConfigs(): Promise<
  Partial<Record<CliFlowCommandId, Record<string, unknown>>>
> {
  const response = await fetch('/api/admin/flow-defaults', {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    return {}
  }

  const snapshot = (await response.json()) as {
    defaults?: FlowDefaultConfigSummary[]
  }

  return Object.fromEntries(
    (snapshot.defaults || []).map((entry) => [entry.flowType, entry.config]),
  ) as Partial<Record<CliFlowCommandId, Record<string, unknown>>>
}

function AdminCliConnectionsPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  const [state, setState] = useState(data.state as CliConnectionState)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedConnection, setSelectedConnection] =
    useState<CliConnectionSummary | null>(null)
  const [selectedSettingsConnection, setSelectedSettingsConnection] =
    useState<CliConnectionSummary | null>(null)
  const [flowDefaultConfigs, setFlowDefaultConfigs] = useState<
    Partial<Record<CliFlowCommandId, Record<string, unknown>>>
  >({})

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

  useEffect(() => {
    void loadFlowDefaultConfigs().then((defaults) => {
      startTransition(() => {
        setFlowDefaultConfigs(defaults)
      })
    })
  }, [])

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

      <CliConnectionsTableCard
        title={m.admin_cli_connected_section_title()}
        description={m.admin_cli_connected_section_description()}
        emptyTitle={m.admin_cli_empty_connected_title()}
        emptyDescription={m.admin_cli_empty_connected_description()}
        connections={state.activeConnections}
        onDispatch={(connection) => {
          setSelectedConnection(connection)
        }}
        onSettings={(connection) => {
          setSelectedSettingsConnection(connection)
        }}
      />

      <CliTaskDialog
        connection={selectedConnection}
        defaultConfigs={flowDefaultConfigs}
        open={Boolean(selectedConnection)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedConnection(null)
          }
        }}
        onDispatched={(flowId, connection, result) => {
          showAppToast({
            kind: 'success',
            title: m.admin_cli_dispatch_success_title(),
            description:
              result.assignedCliCount > 1
                ? result.queuedCount > 1
                  ? m.admin_cli_dispatch_success_description_batch_multi({
                      flow: getFlowDisplayName(flowId),
                      count: String(result.queuedCount),
                      cliCount: String(result.assignedCliCount),
                    })
                  : m.admin_cli_dispatch_success_description_multi({
                      flow: getFlowDisplayName(flowId),
                      cliCount: String(result.assignedCliCount),
                    })
                : result.queuedCount > 1
                  ? m.admin_cli_dispatch_success_description_batch({
                      flow: getFlowDisplayName(flowId),
                      cli: connection.cliName || m.admin_cli_unknown_cli(),
                      count: String(result.queuedCount),
                    })
                  : m.admin_cli_dispatch_success_description({
                      flow: getFlowDisplayName(flowId),
                      cli: connection.cliName || m.admin_cli_unknown_cli(),
                    }),
          })
          setSelectedConnection(null)
        }}
      />

      <CliSettingsDialog
        connection={selectedSettingsConnection}
        open={Boolean(selectedSettingsConnection)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSettingsConnection(null)
          }
        }}
        onSaved={(connection) => {
          setState((current) => ({
            ...current,
            activeConnections: current.activeConnections.map((candidate) =>
              candidate.id === connection.id ? connection : candidate,
            ),
          }))
          setSelectedSettingsConnection(null)
        }}
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
  onDispatch?: (connection: CliConnectionSummary) => void
  onSettings?: (connection: CliConnectionSummary) => void
}) {
  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {props.connections.length ? (
          <TooltipProvider>
            <AdminPaginatedTable
              rows={props.connections}
              getRowId={(connection) => connection.id}
              fillHeight
              emptyState={
                <EmptyState
                  title={props.emptyTitle}
                  description={props.emptyDescription}
                />
              }
              renderTable={({ rows, selection }) => (
                <Table className="min-w-[920px]">
                  <TableHeader>
                    <TableRow>
                      <AdminTableSelectionHead
                        rows={rows}
                        selection={selection}
                      />
                      <TableHead>{m.admin_cli_table_cli()}</TableHead>
                      <TableHead>{m.admin_cli_table_flow()}</TableHead>
                      <TableHead>{m.admin_cli_table_status()}</TableHead>
                      <TableHead>{m.admin_cli_table_last_seen()}</TableHead>
                      {props.onDispatch ? (
                        <TableHead>{m.admin_cli_table_actions()}</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((connection) => {
                      const dispatchableCount =
                        getDispatchableFlowIds(connection).length

                      return (
                        <TableRow
                          key={connection.id}
                          data-selected={
                            selection.isSelected(connection) || undefined
                          }
                        >
                          <AdminTableSelectionCell
                            row={connection}
                            selection={selection}
                          />
                          <TableCell>
                            <div className="flex min-w-0 flex-col gap-1">
                              <span className="inline-flex items-center gap-2 font-medium">
                                <BotIcon className="size-4 text-muted-foreground" />
                                {connection.cliName ||
                                  m.admin_cli_unknown_cli()}
                              </span>
                              <span className="truncate text-xs text-muted-foreground">
                                {connection.connectionPath}
                              </span>
                              <span className="truncate text-xs text-muted-foreground">
                                {m.admin_cli_registered_flows_count({
                                  count: String(dispatchableCount),
                                })}
                              </span>
                              <span className="truncate text-xs text-muted-foreground">
                                {m.admin_cli_browser_limit_summary({
                                  count: String(connection.browserLimit),
                                })}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <RuntimeFlowCell connection={connection} />
                          </TableCell>
                          <TableCell>
                            <StatusBadge value={connection.status} />
                          </TableCell>
                          <TableCell>
                            <DateCell
                              value={connection.lastSeenAt}
                              icon={RefreshCcwIcon}
                            />
                          </TableCell>
                          {props.onDispatch ? (
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {props.onSettings ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        size="icon-sm"
                                        variant="outline"
                                        aria-label={m.admin_cli_settings_action()}
                                        title={m.admin_cli_settings_action()}
                                        onClick={() => {
                                          props.onSettings?.(connection)
                                        }}
                                      >
                                        <SettingsIcon />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent sideOffset={6}>
                                      {m.admin_cli_settings_action()}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : null}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      size="icon-sm"
                                      variant="outline"
                                      aria-label={m.admin_cli_dispatch_action()}
                                      title={m.admin_cli_dispatch_action()}
                                      disabled={dispatchableCount === 0}
                                      onClick={() => {
                                        props.onDispatch?.(connection)
                                      }}
                                    >
                                      <BriefcaseIcon />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent sideOffset={6}>
                                    {m.admin_cli_dispatch_action()}
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            />
          </TooltipProvider>
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

function CliSettingsDialog(props: {
  connection: CliConnectionSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (connection: CliConnectionSummary) => void
}) {
  const [browserLimit, setBrowserLimit] = useState('10')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setBrowserLimit(
      props.connection?.browserLimit
        ? String(props.connection.browserLimit)
        : '10',
    )
    setSubmitting(false)
  }, [props.connection?.id, props.connection?.browserLimit])

  async function submitSettings() {
    if (!props.connection) {
      return
    }

    const parsed = readBrowserLimitInput(browserLimit)
    if (!parsed) {
      showAppToast({
        kind: 'error',
        title: m.admin_cli_settings_error_title(),
        description: m.admin_cli_browser_limit_error(),
      })
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch(
        `/api/admin/cli-connections/${encodeURIComponent(props.connection.id)}/settings`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            browserLimit: parsed,
          }),
        },
      )

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const result = (await response.json()) as {
        connection?: CliConnectionSummary | null
      }
      if (!result.connection) {
        throw new Error(m.admin_cli_settings_error_fallback())
      }

      showAppToast({
        kind: 'success',
        description: m.admin_cli_settings_success(),
      })
      props.onSaved(result.connection)
    } catch (error) {
      showAppToast({
        kind: 'error',
        title: m.admin_cli_settings_error_title(),
        description: getToastErrorDescription(
          error,
          m.admin_cli_settings_error_fallback(),
        ),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[min(560px,calc(100%-2rem))] gap-5">
        <DialogHeader>
          <DialogTitle>{m.admin_cli_settings_title()}</DialogTitle>
          <DialogDescription>
            {props.connection
              ? m.admin_cli_settings_description({
                  cli: props.connection.cliName || m.admin_cli_unknown_cli(),
                })
              : m.admin_cli_settings_idle_description()}
          </DialogDescription>
        </DialogHeader>

        {props.connection ? (
          <FieldSet>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="cli-browser-limit">
                  {m.admin_cli_browser_limit_label()}
                </FieldLabel>
                <Input
                  id="cli-browser-limit"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={browserLimit}
                  disabled={submitting}
                  onChange={(event) => {
                    setBrowserLimit(event.currentTarget.value)
                  }}
                />
                <FieldDescription>
                  {m.admin_cli_browser_limit_description()}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FieldSet>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              props.onOpenChange(false)
            }}
            disabled={submitting}
          >
            {m.ui_close()}
          </Button>
          <Button
            type="button"
            onClick={() => {
              void submitSettings()
            }}
            disabled={!props.connection || submitting}
          >
            {submitting
              ? m.admin_cli_settings_submitting()
              : m.admin_cli_settings_submit()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CliTaskDialog(props: {
  connection: CliConnectionSummary | null
  defaultConfigs: Partial<Record<CliFlowCommandId, Record<string, unknown>>>
  open: boolean
  onOpenChange: (open: boolean) => void
  onDispatched: (
    flowId: CliFlowCommandId,
    connection: CliConnectionSummary,
    result: DispatchResultSummary,
  ) => void
}) {
  const registeredFlowKey = props.connection?.registeredFlows.join('\n') || ''
  const availableFlows = useMemo(() => {
    return props.connection ? getDispatchableFlowIds(props.connection) : []
  }, [props.connection?.id, registeredFlowKey])
  const availableFlowKey = availableFlows.join('\n')
  const [selectedFlowId, setSelectedFlowId] = useState<CliFlowCommandId | ''>(
    '',
  )
  const [dispatchCount, setDispatchCount] = useState('1')
  const [draftValues, setDraftValues] = useState<DraftOptionState>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const nextAvailableFlows = props.connection
      ? getDispatchableFlowIds(props.connection)
      : []
    const nextFlowId = nextAvailableFlows[0] || ''
    setSelectedFlowId(nextFlowId)
    setDispatchCount('1')
    setDraftValues(
      getDefaultDraftValuesForFlow(nextFlowId, props.defaultConfigs),
    )
    setSubmitting(false)
  }, [props.connection?.id, props.open, props.defaultConfigs])

  useEffect(() => {
    setSelectedFlowId((current) => {
      const nextFlowId =
        current && availableFlows.includes(current)
          ? current
          : availableFlows[0] || ''
      if (nextFlowId !== current) {
        setDraftValues(
          getDefaultDraftValuesForFlow(nextFlowId, props.defaultConfigs),
        )
      }
      return nextFlowId
    })
  }, [availableFlowKey, availableFlows, props.defaultConfigs])

  const batchState = useMemo(
    () => resolveDispatchBatchState(selectedFlowId, draftValues, dispatchCount),
    [dispatchCount, draftValues, selectedFlowId],
  )
  const batchingEnabled = batchState.mode !== 'none'

  const optionDefinitions = useMemo(() => {
    return selectedFlowId
      ? listCliFlowConfigFieldDefinitions(selectedFlowId)
      : []
  }, [selectedFlowId])
  const commonOptionDefinitions = optionDefinitions.filter(
    (definition) => definition.common,
  )
  const flowOptionDefinitions = optionDefinitions.filter(
    (definition) => !definition.common,
  )

  async function submitTask() {
    if (!props.connection || !selectedFlowId) {
      return
    }

    setSubmitting(true)
    try {
      const submission = buildDispatchSubmission(
        selectedFlowId,
        draftValues,
        dispatchCount,
      )
      const response = await fetch(
        `/api/admin/cli-connections/${encodeURIComponent(props.connection.id)}/tasks`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            ...createCliFlowTaskRequest(selectedFlowId, submission.config),
            ...(submission.configs ? { configs: submission.configs } : {}),
            repeatCount: submission.repeatCount,
            ...(batchState.count > 1 ? { parallelism: batchState.count } : {}),
          }),
        },
      )

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const result = (await response.json()) as {
        queuedCount?: number
        assignedCliCount?: number
      }

      props.onDispatched(selectedFlowId, props.connection, {
        queuedCount:
          typeof result.queuedCount === 'number' && result.queuedCount > 0
            ? result.queuedCount
            : submission.repeatCount,
        assignedCliCount:
          typeof result.assignedCliCount === 'number' &&
          result.assignedCliCount > 0
            ? result.assignedCliCount
            : 1,
      })
    } catch (error) {
      showAppToast({
        kind: 'error',
        title: m.admin_cli_dispatch_error_title(),
        description: getToastErrorDescription(
          error,
          m.admin_cli_dispatch_error_fallback(),
        ),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[min(960px,calc(100%-2rem))] overflow-y-auto sm:max-w-[min(960px,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>{m.admin_cli_dispatch_dialog_title()}</DialogTitle>
          <DialogDescription>
            {props.connection
              ? m.admin_cli_dispatch_dialog_description({
                  cli: props.connection.cliName || m.admin_cli_unknown_cli(),
                  target:
                    props.connection.target || m.admin_cli_unknown_target(),
                })
              : m.admin_cli_dispatch_dialog_idle_description()}
          </DialogDescription>
        </DialogHeader>

        {props.connection ? (
          <div className="space-y-6">
            <FieldSet>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="dispatch-flow-id">
                    {m.admin_cli_dispatch_flow_label()}
                  </FieldLabel>
                  <Select
                    value={selectedFlowId}
                    onValueChange={(value) => {
                      const nextFlowId = value as CliFlowCommandId
                      setSelectedFlowId(nextFlowId)
                      setDispatchCount('1')
                      setDraftValues(
                        getDefaultDraftValuesForFlow(
                          nextFlowId,
                          props.defaultConfigs,
                        ),
                      )
                    }}
                    disabled={!availableFlows.length || submitting}
                  >
                    <SelectTrigger
                      id="dispatch-flow-id"
                      className="w-full justify-between"
                    >
                      <SelectValue
                        placeholder={m.admin_cli_dispatch_flow_placeholder()}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {availableFlows.map((flowId) => (
                        <SelectItem key={flowId} value={flowId}>
                          {getFlowDisplayName(flowId)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    {selectedFlowId
                      ? getFlowDescription(selectedFlowId)
                      : m.admin_cli_dispatch_flow_description()}
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </FieldSet>

            {batchingEnabled ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {m.admin_cli_dispatch_batch_section_title()}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <FieldSet>
                    <FieldGroup className="grid gap-4 md:grid-cols-2">
                      {batchState.mode === 'repeat' ? (
                        <Field>
                          <FieldLabel htmlFor="dispatch-repeat-count">
                            {m.admin_cli_dispatch_repeat_count_label()}
                          </FieldLabel>
                          <Input
                            id="dispatch-repeat-count"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={MAX_CLI_FLOW_TASK_BATCH_SIZE}
                            value={dispatchCount}
                            disabled={submitting}
                            onChange={(event) => {
                              setDispatchCount(event.currentTarget.value)
                            }}
                          />
                          <FieldDescription>
                            {m.admin_cli_dispatch_repeat_count_description({
                              max: String(MAX_CLI_FLOW_TASK_BATCH_SIZE),
                            })}
                          </FieldDescription>
                        </Field>
                      ) : null}
                      {batchState.mode === 'email-list' ? (
                        <Field>
                          <FieldLabel htmlFor="dispatch-resolved-count">
                            {m.admin_cli_dispatch_resolved_count_label()}
                          </FieldLabel>
                          <Input
                            id="dispatch-resolved-count"
                            value={String(batchState.count)}
                            disabled
                            readOnly
                          />
                          <FieldDescription>
                            {m.admin_cli_dispatch_email_batch_count_description(
                              {
                                count: String(batchState.count),
                              },
                            )}
                          </FieldDescription>
                        </Field>
                      ) : null}
                    </FieldGroup>
                  </FieldSet>
                </CardContent>
              </Card>
            ) : null}

            {selectedFlowId ? (
              <>
                <DispatchOptionSection
                  flowId={selectedFlowId}
                  title={m.admin_cli_dispatch_common_section_title()}
                  options={commonOptionDefinitions}
                  draftValues={draftValues}
                  disabled={submitting}
                  onChange={(key, value) => {
                    setDraftValues((current) => ({
                      ...current,
                      [key]: value,
                    }))
                  }}
                />

                <DispatchOptionSection
                  flowId={selectedFlowId}
                  title={m.admin_cli_dispatch_flow_section_title()}
                  options={flowOptionDefinitions}
                  emptyMessage={m.admin_cli_dispatch_flow_section_empty()}
                  draftValues={draftValues}
                  disabled={submitting}
                  onChange={(key, value) => {
                    setDraftValues((current) => ({
                      ...current,
                      [key]: value,
                    }))
                  }}
                />
              </>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              props.onOpenChange(false)
            }}
            disabled={submitting}
          >
            {m.ui_close()}
          </Button>
          <Button
            type="button"
            onClick={() => {
              void submitTask()
            }}
            disabled={!props.connection || !selectedFlowId || submitting}
          >
            {submitting
              ? m.admin_cli_dispatch_submitting()
              : m.admin_cli_dispatch_submit()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DispatchOptionSection(props: {
  flowId: CliFlowCommandId
  title: string
  options: CliFlowConfigFieldDefinition[]
  emptyMessage?: string
  draftValues: DraftOptionState
  disabled: boolean
  onChange: (key: string, value: string) => void
}) {
  if (!props.options.length) {
    return props.emptyMessage ? (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{props.title}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">{props.emptyMessage}</p>
        </CardContent>
      </Card>
    ) : null
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <FieldSet>
          <FieldLegend className="sr-only">{props.title}</FieldLegend>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            {props.options.map((option) => (
              <DispatchOptionField
                key={option.key}
                flowId={props.flowId}
                option={option}
                value={props.draftValues[option.key] || ''}
                disabled={props.disabled}
                onChange={(value) => {
                  props.onChange(option.key, value)
                }}
              />
            ))}
          </FieldGroup>
        </FieldSet>
      </CardContent>
    </Card>
  )
}

function DispatchOptionField(props: {
  flowId: CliFlowCommandId
  option: CliFlowConfigFieldDefinition
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const inputId = `dispatch-option-${props.option.key}`

  if (isEmailBatchDispatchOption(props.flowId, props.option)) {
    return (
      <EmailBatchDispatchField
        flowId={props.flowId}
        inputId={inputId}
        option={props.option}
        value={props.value}
        disabled={props.disabled}
        onChange={props.onChange}
      />
    )
  }

  if (props.option.type === 'select') {
    return (
      <Field>
        <FieldLabel htmlFor={inputId}>
          {getOptionDisplayName(props.option)}
        </FieldLabel>
        <Select
          value={props.value || BOOLEAN_DEFAULT_SENTINEL}
          onValueChange={(value) => {
            props.onChange(value === BOOLEAN_DEFAULT_SENTINEL ? '' : value)
          }}
          disabled={props.disabled}
        >
          <SelectTrigger id={inputId} className="w-full justify-between">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={BOOLEAN_DEFAULT_SENTINEL}>
              {m.admin_cli_dispatch_select_default()}
            </SelectItem>
            {props.option.options?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          {formatOptionDescription(props.option, props.flowId)}
        </FieldDescription>
      </Field>
    )
  }

  if (props.option.type === 'boolean') {
    return (
      <Field>
        <FieldLabel htmlFor={inputId}>
          {getOptionDisplayName(props.option)}
        </FieldLabel>
        <Select
          value={props.value || BOOLEAN_DEFAULT_SENTINEL}
          onValueChange={(value) => {
            props.onChange(value === BOOLEAN_DEFAULT_SENTINEL ? '' : value)
          }}
          disabled={props.disabled}
        >
          <SelectTrigger id={inputId} className="w-full justify-between">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={BOOLEAN_DEFAULT_SENTINEL}>
              {m.admin_cli_dispatch_boolean_default()}
            </SelectItem>
            <SelectItem value="true">
              {m.admin_cli_dispatch_boolean_true()}
            </SelectItem>
            <SelectItem value="false">
              {m.admin_cli_dispatch_boolean_false()}
            </SelectItem>
          </SelectContent>
        </Select>
        <FieldDescription>
          {formatOptionDescription(props.option, props.flowId)}
        </FieldDescription>
      </Field>
    )
  }

  if (props.option.type === 'stringList') {
    return (
      <Field className="md:col-span-2">
        <FieldLabel htmlFor={inputId}>
          {getOptionDisplayName(props.option)}
        </FieldLabel>
        <Textarea
          id={inputId}
          value={props.value}
          disabled={props.disabled}
          rows={4}
          placeholder={'a@example.com\nb@example.com'}
          onChange={(event) => {
            props.onChange(event.currentTarget.value)
          }}
        />
        <FieldDescription>
          {formatOptionDescription(props.option, props.flowId)}
        </FieldDescription>
      </Field>
    )
  }

  return (
    <Field>
      <FieldLabel htmlFor={inputId}>
        {getOptionDisplayName(props.option)}
      </FieldLabel>
      <Input
        id={inputId}
        type={props.option.type === 'number' ? 'number' : 'text'}
        inputMode={props.option.type === 'number' ? 'numeric' : undefined}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange(event.currentTarget.value)
        }}
      />
      <FieldDescription>
        {formatOptionDescription(props.option, props.flowId)}
      </FieldDescription>
    </Field>
  )
}

function EmailBatchDispatchField(props: {
  flowId: CliFlowCommandId
  inputId: string
  option: CliFlowConfigFieldDefinition
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const detectedEmails = useMemo(
    () => extractDispatchEmailAddresses(props.value),
    [props.value],
  )

  return (
    <Field className="md:col-span-2">
      <FieldLabel htmlFor={props.inputId}>
        {getOptionDisplayName(props.option)}
      </FieldLabel>
      <Textarea
        id={props.inputId}
        value={props.value}
        disabled={props.disabled}
        rows={6}
        placeholder={'a@example.com\nb@example.com'}
        onChange={(event) => {
          props.onChange(event.currentTarget.value)
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.disabled}
          onClick={() => {
            fileInputRef.current?.click()
          }}
        >
          {m.admin_cli_dispatch_upload_csv()}
        </Button>
        <span className="text-xs text-muted-foreground">
          {detectedEmails.length
            ? m.admin_cli_dispatch_email_detected_count({
                count: String(detectedEmails.length),
              })
            : m.admin_cli_dispatch_email_batch_hint()}
        </span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        disabled={props.disabled}
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0]
          if (!file) {
            return
          }

          try {
            const content = await file.text()
            const importedEmails = extractDispatchEmailAddresses(content)

            if (!importedEmails.length) {
              showAppToast({
                kind: 'error',
                description: m.admin_cli_dispatch_upload_csv_empty(),
              })
              return
            }

            const mergedEmails = mergeDispatchEmailAddresses(
              extractDispatchEmailAddresses(props.value),
              importedEmails,
            )

            props.onChange(mergedEmails.join('\n'))
            showAppToast({
              kind: 'success',
              description: m.admin_cli_dispatch_upload_csv_success({
                count: String(importedEmails.length),
                file: file.name,
              }),
            })
          } catch {
            showAppToast({
              kind: 'error',
              description: m.admin_cli_dispatch_upload_csv_error(),
            })
          } finally {
            event.currentTarget.value = ''
          }
        }}
      />
      <FieldDescription>
        {formatOptionDescription(props.option, props.flowId)}
      </FieldDescription>
    </Field>
  )
}

function DateCell(props: { value?: string | null; icon: LucideIcon }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <props.icon className="size-4 text-muted-foreground" />
      {formatAdminDate(props.value) || m.oauth_none()}
    </span>
  )
}

function RuntimeFlowCell(props: { connection: CliConnectionSummary }) {
  const { connection } = props
  const flowId = connection.runtimeFlowId

  if (!flowId) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{m.admin_cli_flow_idle_title()}</span>
        <span className="text-xs text-muted-foreground">
          {m.admin_cli_flow_idle_description()}
        </span>
      </div>
    )
  }

  const status = connection.runtimeFlowStatus || 'running'
  const detail =
    connection.runtimeFlowMessage ||
    formatAdminDate(connection.runtimeFlowUpdatedAt) ||
    m.oauth_none()
  const timestamp =
    connection.runtimeFlowCompletedAt || connection.runtimeFlowStartedAt

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-medium">{getRuntimeFlowDisplayName(flowId)}</span>
      <div className="inline-flex items-center gap-2">
        <StatusBadge value={status} className="w-fit" />
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </div>
      <span className="truncate text-xs text-muted-foreground">
        {timestamp ? formatAdminDate(timestamp) || timestamp : m.oauth_none()}
      </span>
      {connection.runtimeTaskId ? (
        <a
          href={`/admin/flows/${encodeURIComponent(connection.runtimeTaskId)}`}
          className="text-xs font-medium text-foreground underline underline-offset-4"
        >
          {m.admin_cli_view_flow()}
        </a>
      ) : null}
    </div>
  )
}

function getDispatchableFlowIds(
  connection: CliConnectionSummary,
): CliFlowCommandId[] {
  const reported = new Set(connection.registeredFlows)

  return cliFlowDefinitions
    .filter((definition) => reported.has(definition.id))
    .map((definition) => definition.id)
}

function supportsRepeatedDispatch(
  flowId: CliFlowCommandId | '',
): flowId is 'chatgpt-register' {
  return flowId === 'chatgpt-register'
}

function supportsEmailListDispatch(
  flowId: CliFlowCommandId | '',
): flowId is 'chatgpt-invite' | 'codex-oauth' {
  return flowId === 'chatgpt-invite' || flowId === 'codex-oauth'
}

function isEmailBatchDispatchOption(
  flowId: CliFlowCommandId,
  option: CliFlowConfigFieldDefinition,
) {
  return supportsEmailListDispatch(flowId) && option.key === 'email'
}

function extractDispatchEmailAddresses(input: string): string[] {
  const normalized = new Map<string, string>()
  const matches = input.match(EMAIL_ADDRESS_PATTERN) || []

  for (const match of matches) {
    const email = match.trim().toLowerCase()
    if (!email || normalized.has(email)) {
      continue
    }
    normalized.set(email, email)
  }

  return [...normalized.values()]
}

function mergeDispatchEmailAddresses(...lists: string[][]): string[] {
  const normalized = new Map<string, string>()

  for (const list of lists) {
    for (const email of list) {
      const nextEmail = email.trim().toLowerCase()
      if (!nextEmail || normalized.has(nextEmail)) {
        continue
      }
      normalized.set(nextEmail, nextEmail)
    }
  }

  return [...normalized.values()]
}

function previewDispatchCount(rawValue: string): number {
  const normalized = rawValue.trim()
  if (!normalized) {
    return 1
  }

  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 1
  }

  return Math.min(parsed, MAX_CLI_FLOW_TASK_BATCH_SIZE)
}

function resolveDispatchBatchState(
  flowId: CliFlowCommandId | '',
  draftValues: DraftOptionState,
  rawDispatchCount: string,
): DispatchBatchState {
  if (supportsRepeatedDispatch(flowId)) {
    return {
      mode: 'repeat',
      count: previewDispatchCount(rawDispatchCount),
      emails: [],
    }
  }

  if (supportsEmailListDispatch(flowId)) {
    const emails = extractDispatchEmailAddresses(draftValues.email || '')
    if (emails.length > 1) {
      return {
        mode: 'email-list',
        count: emails.length,
        emails,
      }
    }
  }

  return {
    mode: 'none',
    count: 1,
    emails: [],
  }
}

function readDispatchCount(flowId: CliFlowCommandId, rawValue: string): number {
  if (!supportsRepeatedDispatch(flowId)) {
    return 1
  }

  const normalized = rawValue.trim()
  if (!normalized) {
    return 1
  }

  const parsed = Number.parseInt(normalized, 10)
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_CLI_FLOW_TASK_BATCH_SIZE
  ) {
    throw new Error(
      m.admin_cli_dispatch_repeat_count_error({
        max: String(MAX_CLI_FLOW_TASK_BATCH_SIZE),
      }),
    )
  }

  return parsed
}

function getDefaultDraftValuesForFlow(
  flowId: CliFlowCommandId | '',
  defaultConfigs: Partial<
    Record<CliFlowCommandId, Record<string, unknown>>
  > = {},
): DraftOptionState {
  if (!flowId) {
    return {}
  }

  return {
    ...DEFAULT_DRAFT_VALUES_BY_FLOW[flowId],
    ...createDraftValuesFromFlowConfig(
      flowId,
      defaultConfigs[flowId],
      listCliFlowConfigFieldDefinitions(flowId),
    ),
  }
}

function buildDispatchSubmission<TFlowId extends CliFlowCommandId>(
  flowId: TFlowId,
  draftValues: DraftOptionState,
  rawDispatchCount: string,
): DispatchSubmission<TFlowId> {
  const config = buildDispatchConfig(flowId, draftValues)
  const batchState = resolveDispatchBatchState(
    flowId,
    draftValues,
    rawDispatchCount,
  )

  if (batchState.mode === 'email-list') {
    const identityId = draftValues.identityId?.trim()
    if (identityId) {
      throw new Error(m.admin_cli_dispatch_email_batch_identity_id_error())
    }

    if (batchState.count > MAX_CLI_FLOW_TASK_BATCH_SIZE) {
      throw new Error(
        m.admin_cli_dispatch_email_batch_count_error({
          max: String(MAX_CLI_FLOW_TASK_BATCH_SIZE),
        }),
      )
    }

    const sharedConfig = {
      ...(config as Record<string, unknown>),
    }
    delete sharedConfig.email
    const configs = batchState.emails.map((email) => ({
      ...sharedConfig,
      email,
    })) as CliFlowConfigById[TFlowId][]

    return {
      config: sharedConfig as CliFlowConfigById[TFlowId],
      configs,
      repeatCount: configs.length,
    }
  }

  const repeatCount = readDispatchCount(flowId, rawDispatchCount)
  return {
    config,
    repeatCount,
  }
}

function readBrowserLimitInput(rawValue: string): number | null {
  const normalized = rawValue.trim()
  if (!normalized) {
    return null
  }

  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null
  }

  return parsed
}

function buildDispatchConfig<TFlowId extends CliFlowCommandId>(
  flowId: TFlowId,
  draftValues: DraftOptionState,
): CliFlowConfigById[TFlowId] {
  const config = buildFlowConfigFromDraft(
    flowId,
    listCliFlowConfigFieldDefinitions(flowId),
    draftValues,
    {
      getFieldLabel: getOptionDisplayName,
      getInvalidNumberMessage: (field) =>
        m.admin_cli_dispatch_number_error({ field }),
    },
    {
      transformRawValue: ({ definition, rawValue }) => {
        if (!isEmailBatchDispatchOption(flowId, definition)) {
          return rawValue
        }

        const emails = extractDispatchEmailAddresses(rawValue)
        if (!emails.length) {
          throw new Error(m.admin_cli_dispatch_email_batch_invalid())
        }

        return emails[0]
      },
    },
  ) as Record<string, unknown>

  return config as CliFlowConfigById[TFlowId]
}

function getFlowDisplayName(flowId: CliFlowCommandId): string {
  const flowDefinition = cliFlowDefinitions.find(
    (definition) => definition.id === flowId,
  )
  return flowDefinition ? resolveFlowDisplayName(flowDefinition) : flowId
}

function getRuntimeFlowDisplayName(flowId: string): string {
  const flowDefinition = cliFlowDefinitions.find(
    (definition) => definition.id === flowId,
  )
  return flowDefinition ? resolveFlowDisplayName(flowDefinition) : flowId
}

function getFlowDescription(flowId: CliFlowCommandId): string {
  const flowDefinition = cliFlowDefinitions.find(
    (definition) => definition.id === flowId,
  )
  return flowDefinition
    ? resolveFlowDescription(flowDefinition)
    : m.admin_cli_dispatch_flow_description()
}

function formatOptionDescription(
  option: CliFlowConfigFieldDefinition,
  flowId?: CliFlowCommandId,
): string {
  const detail = getOptionDescription(option)
  const parts = [
    detail,
    flowId && isEmailBatchDispatchOption(flowId, option)
      ? m.admin_cli_dispatch_email_batch_help()
      : '',
    option.type === 'stringList' ? m.admin_cli_dispatch_string_list_hint() : '',
    m.admin_cli_dispatch_option_flag_hint({ flag: option.cliFlag }),
  ].filter(Boolean)

  return parts.join(' ')
}
