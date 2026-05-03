import { startTransition, useEffect, useMemo, useState } from 'react'

import {
  type CliFlowCommandId,
  type CliFlowConfigFieldDefinition,
  cliFlowDefinitions,
  listCliFlowConfigFieldDefinitions,
} from '../../../packages/cli/src/modules/flow-cli/flow-registry'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { CheckIcon, SaveIcon, SlidersHorizontalIcon } from 'lucide-react'

import {
  AdminPageHeader,
  EmptyState,
  formatAdminDate,
} from '#/components/admin/layout'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
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
import { getToastErrorDescription, showAppToast } from '#/lib/toast'
import { m } from '#/paraglide/messages'

const BOOLEAN_DEFAULT_SENTINEL = '__default__'

type FlowDefaultConfigSummary = {
  flowType: CliFlowCommandId
  config: Record<string, unknown>
  updatedAt: string | null
}

type FlowDefaultsSnapshot = {
  snapshotAt: string
  defaults: FlowDefaultConfigSummary[]
}

const loadAdminFlowDefaults = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [
      { getRequest },
      { requireAdminPermission },
      { listFlowTaskDefaultConfigs },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../lib/server/auth'),
      import('../../lib/server/flow-defaults'),
    ])

    const request = getRequest()

    try {
      await requireAdminPermission(request, 'CLI_OPERATIONS')
      return {
        authorized: true as const,
        snapshot: await listFlowTaskDefaultConfigs(),
      }
    } catch {
      return { authorized: false as const }
    }
  },
)

export const Route = createFileRoute('/admin/flow-defaults')({
  loader: async () => loadAdminFlowDefaults(),
  component: AdminFlowDefaultsPage,
})

function AdminFlowDefaultsPage() {
  const data = Route.useLoaderData()
  const authorizedSnapshot = data.authorized
    ? (data.snapshot as FlowDefaultsSnapshot)
    : null
  const [snapshot, setSnapshot] = useState<FlowDefaultsSnapshot>(
    () =>
      authorizedSnapshot || {
        snapshotAt: new Date().toISOString(),
        defaults: [],
      },
  )
  const [selectedFlowId, setSelectedFlowId] = useState<CliFlowCommandId>(
    () => snapshot.defaults[0]?.flowType || cliFlowDefinitions[0].id,
  )
  const [draftValues, setDraftValues] = useState<DraftOptionState>({})
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!authorizedSnapshot) {
      return
    }

    setSnapshot(authorizedSnapshot)
  }, [authorizedSnapshot])

  const selectedDefinition = cliFlowDefinitions.find(
    (definition) => definition.id === selectedFlowId,
  )
  const selectedDefault = snapshot.defaults.find(
    (entry) => entry.flowType === selectedFlowId,
  )
  const optionDefinitions = useMemo(
    () => listCliFlowConfigFieldDefinitions(selectedFlowId),
    [selectedFlowId],
  )
  const commonOptionDefinitions = optionDefinitions.filter(
    (definition) => definition.common,
  )
  const flowOptionDefinitions = optionDefinitions.filter(
    (definition) => !definition.common,
  )
  const selectedConfigKey = JSON.stringify(selectedDefault?.config || {})

  useEffect(() => {
    setDraftValues(
      createDraftValuesFromFlowConfig(
        selectedFlowId,
        selectedDefault?.config,
        optionDefinitions,
      ),
    )
  }, [selectedConfigKey, selectedFlowId, optionDefinitions])

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  async function saveDefaults() {
    setIsSaving(true)
    try {
      const config = buildFlowConfigFromDraft(
        selectedFlowId,
        optionDefinitions,
        draftValues,
        {
          getFieldLabel: getOptionDisplayName,
          getInvalidNumberMessage: (field) =>
            m.admin_cli_dispatch_number_error({ field }),
        },
        {
          transformRawValue: ({ definition, rawValue }) => {
            if (
              (selectedFlowId === 'chatgpt-invite' ||
                selectedFlowId === 'codex-oauth') &&
              definition.key === 'email'
            ) {
              return rawValue.trim().split(/[\n,]/)[0]?.trim()
            }

            return rawValue
          },
        },
      )
      const response = await fetch('/api/admin/flow-defaults', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          flowId: selectedFlowId,
          config,
        }),
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const result = (await response.json()) as {
        defaultConfig?: FlowDefaultConfigSummary
      }
      if (!result.defaultConfig) {
        throw new Error(m.admin_flow_defaults_save_error())
      }

      const savedDefault = result.defaultConfig
      startTransition(() => {
        setSnapshot((current) => ({
          snapshotAt: new Date().toISOString(),
          defaults: current.defaults.map((entry) =>
            entry.flowType === savedDefault.flowType ? savedDefault : entry,
          ),
        }))
      })
      showAppToast({
        kind: 'success',
        title: m.status_success(),
        description: m.admin_flow_defaults_save_success(),
      })
    } catch (error) {
      showAppToast({
        kind: 'error',
        title: m.status_failed(),
        description: getToastErrorDescription(
          error,
          m.admin_flow_defaults_save_error(),
        ),
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <AdminPageHeader
        title={m.admin_flow_defaults_page_title()}
        description={m.admin_flow_defaults_page_description()}
        variant="plain"
        meta={
          <p className="text-sm text-muted-foreground">
            {m.admin_flow_snapshot({
              time: formatAdminDate(snapshot.snapshotAt) || snapshot.snapshotAt,
            })}
          </p>
        }
        actions={
          <Button
            type="button"
            onClick={() => {
              void saveDefaults()
            }}
            disabled={isSaving}
          >
            <SaveIcon />
            {isSaving
              ? m.admin_flow_defaults_saving()
              : m.admin_flow_defaults_save_button()}
          </Button>
        }
      />

      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader>
            <CardTitle>{m.admin_flow_defaults_list_title()}</CardTitle>
            <CardDescription>
              {m.admin_flow_defaults_list_description()}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 overflow-y-auto">
            <div className="space-y-2">
              {snapshot.defaults.map((entry) => {
                const definition = cliFlowDefinitions.find(
                  (candidate) => candidate.id === entry.flowType,
                )
                if (!definition) {
                  return null
                }

                const isSelected = entry.flowType === selectedFlowId
                const hasConfig = Object.keys(entry.config || {}).length > 0

                return (
                  <button
                    key={entry.flowType}
                    type="button"
                    className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'bg-background hover:bg-muted/50'
                    }`}
                    onClick={() => {
                      setSelectedFlowId(entry.flowType)
                    }}
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      {hasConfig ? (
                        <CheckIcon className="size-4" />
                      ) : (
                        <SlidersHorizontalIcon className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">
                        {resolveFlowDisplayName(definition)}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                        {resolveFlowDescription(definition)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>
                  {selectedDefinition
                    ? resolveFlowDisplayName(selectedDefinition)
                    : selectedFlowId}
                </CardTitle>
                <CardDescription>
                  {selectedDefinition
                    ? resolveFlowDescription(selectedDefinition)
                    : m.admin_cli_dispatch_flow_description()}
                </CardDescription>
              </div>
              <Badge variant="outline">
                {selectedDefault?.updatedAt
                  ? m.admin_flow_defaults_updated_badge({
                      time:
                        formatAdminDate(selectedDefault.updatedAt) ||
                        selectedDefault.updatedAt,
                    })
                  : m.admin_flow_defaults_empty_badge()}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 overflow-y-auto">
            {optionDefinitions.length ? (
              <div className="space-y-6">
                <FlowDefaultOptionSection
                  flowId={selectedFlowId}
                  title={m.admin_cli_dispatch_common_section_title()}
                  options={commonOptionDefinitions}
                  draftValues={draftValues}
                  disabled={isSaving}
                  onChange={(key, value) => {
                    setDraftValues((current) => ({
                      ...current,
                      [key]: value,
                    }))
                  }}
                />
                <FlowDefaultOptionSection
                  flowId={selectedFlowId}
                  title={m.admin_cli_dispatch_flow_section_title()}
                  options={flowOptionDefinitions}
                  emptyMessage={m.admin_cli_dispatch_flow_section_empty()}
                  draftValues={draftValues}
                  disabled={isSaving}
                  onChange={(key, value) => {
                    setDraftValues((current) => ({
                      ...current,
                      [key]: value,
                    }))
                  }}
                />
              </div>
            ) : (
              <EmptyState
                title={m.admin_flow_defaults_no_options_title()}
                description={m.admin_flow_defaults_no_options_description()}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function FlowDefaultOptionSection(props: {
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
      <div className="rounded-lg border bg-background">
        <div className="border-b p-4">
          <h3 className="text-base font-medium text-foreground">
            {props.title}
          </h3>
        </div>
        <div className="p-4">
          <p className="text-sm text-muted-foreground">{props.emptyMessage}</p>
        </div>
      </div>
    ) : null
  }

  return (
    <div className="rounded-lg border bg-background">
      <div className="border-b p-4">
        <h3 className="text-base font-medium text-foreground">{props.title}</h3>
      </div>
      <div className="p-4 pt-0">
        <FieldSet>
          <FieldLegend className="sr-only">{props.title}</FieldLegend>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            {props.options.map((option) => (
              <FlowDefaultOptionField
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
      </div>
    </div>
  )
}

function FlowDefaultOptionField(props: {
  flowId: CliFlowCommandId
  option: CliFlowConfigFieldDefinition
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const inputId = `flow-default-${props.flowId}-${props.option.key}`

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
          {formatOptionDescription(props.option)}
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

function formatOptionDescription(option: CliFlowConfigFieldDefinition): string {
  const parts = [
    getOptionDescription(option),
    option.type === 'stringList' ? m.admin_cli_dispatch_string_list_hint() : '',
    m.admin_cli_dispatch_option_flag_hint({ flag: option.cliFlag }),
  ].filter(Boolean)

  return parts.join(' ')
}
