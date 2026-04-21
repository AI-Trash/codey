import { startTransition, useEffect, useMemo, useState } from 'react'

import {
  type CliFlowCommandId,
  type CliFlowDefinition,
  type CliFlowDescriptionKey,
  type CliFlowDisplayNameKey,
  type CliFlowOptionDefinition,
  type CliFlowOptionDescriptionKey,
  type CliFlowOptionDisplayNameKey,
  cliFlowDefinitions,
  listCliFlowOptionDefinitions,
} from '../../../packages/cli/src/modules/flow-cli/flow-registry'
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
  AdminPageHeader,
  EmptyState,
  StatusBadge,
  formatAdminDate,
} from '#/components/admin/layout'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
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
import { m } from '#/paraglide/messages'

const CLI_CONNECTION_POLL_INTERVAL_MS = 10_000
const BOOLEAN_DEFAULT_SENTINEL = '__default__'

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
  sessionRef: string | null
  userId: string | null
  authClientId: string | null
  cliName: string | null
  target: string | null
  userAgent: string | null
  registeredFlows: string[]
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

type DispatchFlash = {
  title: string
  description: string
}

type DraftOptionState = Record<string, string>

function AdminCliConnectionsPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  const [state, setState] = useState(data.state as CliConnectionState)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedConnection, setSelectedConnection] =
    useState<CliConnectionSummary | null>(null)
  const [dispatchFlash, setDispatchFlash] = useState<DispatchFlash | null>(null)

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

      {dispatchFlash ? (
        <Alert>
          <AlertTitle>{dispatchFlash.title}</AlertTitle>
          <AlertDescription>{dispatchFlash.description}</AlertDescription>
        </Alert>
      ) : null}

      <CliConnectionsTableCard
        title={m.admin_cli_connected_section_title()}
        description={m.admin_cli_connected_section_description()}
        emptyTitle={m.admin_cli_empty_connected_title()}
        emptyDescription={m.admin_cli_empty_connected_description()}
        connections={state.activeConnections}
        onDispatch={(connection) => {
          setDispatchFlash(null)
          setSelectedConnection(connection)
        }}
      />

      <CliTaskDialog
        connection={selectedConnection}
        open={Boolean(selectedConnection)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedConnection(null)
          }
        }}
        onDispatched={(flowId, connection) => {
          setDispatchFlash({
            title: m.admin_cli_dispatch_success_title(),
            description: m.admin_cli_dispatch_success_description({
              flow: getFlowDisplayName(flowId),
              cli: connection.cliName || m.admin_cli_unknown_cli(),
            }),
          })
          setSelectedConnection(null)
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
                  <TableHead>{m.admin_cli_table_flow()}</TableHead>
                  <TableHead>{m.admin_cli_table_status()}</TableHead>
                  <TableHead>{m.admin_cli_table_connected_at()}</TableHead>
                  <TableHead>{m.admin_cli_table_last_seen()}</TableHead>
                  {props.onDispatch ? (
                    <TableHead>{m.admin_cli_table_actions()}</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.connections.map((connection) => {
                  const dispatchableCount =
                    getDispatchableFlowIds(connection).length

                  return (
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
                          <span className="truncate text-xs text-muted-foreground">
                            {m.admin_cli_registered_flows_count({
                              count: String(dispatchableCount),
                            })}
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
                        <RuntimeFlowCell connection={connection} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={connection.status} />
                      </TableCell>
                      <TableCell>
                        <DateCell
                          value={connection.connectedAt}
                          icon={ActivityIcon}
                        />
                      </TableCell>
                      <TableCell>
                        <DateCell
                          value={connection.lastSeenAt}
                          icon={RefreshCcwIcon}
                        />
                      </TableCell>
                      {props.onDispatch ? (
                        <TableCell className="w-[132px]">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={dispatchableCount === 0}
                            onClick={() => {
                              props.onDispatch?.(connection)
                            }}
                          >
                            {m.admin_cli_dispatch_action()}
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  )
                })}
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

function CliTaskDialog(props: {
  connection: CliConnectionSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDispatched: (
    flowId: CliFlowCommandId,
    connection: CliConnectionSummary,
  ) => void
}) {
  const availableFlows = useMemo(() => {
    return props.connection ? getDispatchableFlowIds(props.connection) : []
  }, [props.connection])
  const [selectedFlowId, setSelectedFlowId] = useState<CliFlowCommandId | ''>(
    '',
  )
  const [draftValues, setDraftValues] = useState<DraftOptionState>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    setSelectedFlowId(availableFlows[0] || '')
    setDraftValues({})
    setSubmitting(false)
    setSubmitError(null)
  }, [props.connection?.id, availableFlows])

  const optionDefinitions = useMemo(() => {
    return selectedFlowId ? listCliFlowOptionDefinitions(selectedFlowId) : []
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
    setSubmitError(null)
    try {
      const response = await fetch(
        `/api/admin/cli-connections/${encodeURIComponent(props.connection.id)}/tasks`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            flowId: selectedFlowId,
            options: buildDispatchOptions(selectedFlowId, draftValues),
          }),
        },
      )

      if (!response.ok) {
        throw new Error(await response.text())
      }

      props.onDispatched(selectedFlowId, props.connection)
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : m.admin_cli_dispatch_error_fallback(),
      )
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
                      setSelectedFlowId(value as CliFlowCommandId)
                      setSubmitError(null)
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

            {selectedFlowId ? (
              <>
                <DispatchOptionSection
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

            {submitError ? (
              <Alert variant="destructive">
                <AlertTitle>{m.admin_cli_dispatch_error_title()}</AlertTitle>
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
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
  title: string
  options: CliFlowOptionDefinition[]
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
  option: CliFlowOptionDefinition
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const inputId = `dispatch-option-${props.option.key}`

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
          {formatOptionDescription(props.option)}
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
          {formatOptionDescription(props.option)}
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
        {formatOptionDescription(props.option)}
      </FieldDescription>
    </Field>
  )
}

function DateCell(props: { value?: string | null; icon: typeof ActivityIcon }) {
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
    </div>
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

function getDispatchableFlowIds(
  connection: CliConnectionSummary,
): CliFlowCommandId[] {
  const reported = new Set(connection.registeredFlows)

  return cliFlowDefinitions
    .filter((definition) => reported.has(definition.id))
    .map((definition) => definition.id)
}

function buildDispatchOptions(
  flowId: CliFlowCommandId,
  draftValues: DraftOptionState,
) {
  const options: Record<string, unknown> = {}

  for (const definition of listCliFlowOptionDefinitions(flowId)) {
    const rawValue = draftValues[definition.key]
    if (!rawValue?.trim()) {
      continue
    }

    if (definition.type === 'boolean') {
      if (rawValue === 'true' || rawValue === 'false') {
        options[definition.key] = rawValue === 'true'
      }
      continue
    }

    if (definition.type === 'number') {
      const parsed = Number(rawValue)
      if (!Number.isFinite(parsed)) {
        throw new Error(
          m.admin_cli_dispatch_number_error({
            field: getOptionDisplayName(definition),
          }),
        )
      }
      options[definition.key] = parsed
      continue
    }

    if (definition.type === 'stringList') {
      const parsed = rawValue
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
      if (parsed.length) {
        options[definition.key] = parsed
      }
      continue
    }

    options[definition.key] = rawValue.trim()
  }

  return options
}

const flowDisplayNameMap: Record<CliFlowDisplayNameKey, () => string> = {
  chatgptRegister: () => m.admin_cli_flow_chatgpt_register_name(),
  chatgptLogin: () => m.admin_cli_flow_chatgpt_login_name(),
  chatgptLoginInvite: () => m.admin_cli_flow_chatgpt_login_invite_name(),
  codexOauth: () => m.admin_cli_flow_codex_oauth_name(),
  noop: () => m.admin_cli_flow_noop_name(),
}

const flowDescriptionMap: Record<CliFlowDescriptionKey, () => string> = {
  chatgptRegister: () => m.admin_cli_flow_chatgpt_register_description(),
  chatgptLogin: () => m.admin_cli_flow_chatgpt_login_description(),
  chatgptLoginInvite: () => m.admin_cli_flow_chatgpt_login_invite_description(),
  codexOauth: () => m.admin_cli_flow_codex_oauth_description(),
  noop: () => m.admin_cli_flow_noop_description(),
}

const optionDisplayNameMap: Record<CliFlowOptionDisplayNameKey, () => string> =
  {
    chromeDefaultProfile: () =>
      m.admin_cli_option_chrome_default_profile_name(),
    headless: () => m.admin_cli_option_headless_name(),
    slowMo: () => m.admin_cli_option_slow_mo_name(),
    har: () => m.admin_cli_option_har_name(),
    record: () => m.admin_cli_option_record_name(),
    password: () => m.admin_cli_option_password_name(),
    verificationTimeoutMs: () => m.admin_cli_option_verification_timeout_name(),
    pollIntervalMs: () => m.admin_cli_option_poll_interval_name(),
    identityId: () => m.admin_cli_option_identity_id_name(),
    email: () => m.admin_cli_option_email_name(),
    inviteEmail: () => m.admin_cli_option_invite_email_name(),
    inviteFile: () => m.admin_cli_option_invite_file_name(),
    workspaceIndex: () => m.admin_cli_option_workspace_index_name(),
    redirectPort: () => m.admin_cli_option_redirect_port_name(),
    authorizeUrlOnly: () => m.admin_cli_option_authorize_url_only_name(),
  }

const optionDescriptionMap: Record<CliFlowOptionDescriptionKey, () => string> =
  {
    chromeDefaultProfile: () =>
      m.admin_cli_option_chrome_default_profile_description(),
    headless: () => m.admin_cli_option_headless_description(),
    slowMo: () => m.admin_cli_option_slow_mo_description(),
    har: () => m.admin_cli_option_har_description(),
    record: () => m.admin_cli_option_record_description(),
    password: () => m.admin_cli_option_password_description(),
    verificationTimeoutMs: () =>
      m.admin_cli_option_verification_timeout_description(),
    pollIntervalMs: () => m.admin_cli_option_poll_interval_description(),
    identityId: () => m.admin_cli_option_identity_id_description(),
    email: () => m.admin_cli_option_email_description(),
    inviteEmail: () => m.admin_cli_option_invite_email_description(),
    inviteFile: () => m.admin_cli_option_invite_file_description(),
    workspaceIndex: () => m.admin_cli_option_workspace_index_description(),
    redirectPort: () => m.admin_cli_option_redirect_port_description(),
    authorizeUrlOnly: () => m.admin_cli_option_authorize_url_only_description(),
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

function resolveFlowDisplayName(flowDefinition: CliFlowDefinition): string {
  return flowDisplayNameMap[flowDefinition.displayNameKey]()
}

function resolveFlowDescription(flowDefinition: CliFlowDefinition): string {
  return flowDefinition.descriptionKey
    ? flowDescriptionMap[flowDefinition.descriptionKey]()
    : m.admin_cli_dispatch_flow_description()
}

function getOptionDisplayName(option: CliFlowOptionDefinition): string {
  return optionDisplayNameMap[option.displayNameKey]()
}

function formatOptionDescription(option: CliFlowOptionDefinition): string {
  const detail = option.descriptionKey
    ? optionDescriptionMap[option.descriptionKey]()
    : ''
  const parts = [
    detail,
    option.type === 'stringList' ? m.admin_cli_dispatch_string_list_hint() : '',
    m.admin_cli_dispatch_option_flag_hint({ flag: option.flag }),
  ].filter(Boolean)

  return parts.join(' ')
}
