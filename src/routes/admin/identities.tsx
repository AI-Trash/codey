import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  CalendarIcon,
  ClipboardCopyIcon,
  DownloadIcon,
  SearchIcon,
  ShieldIcon,
  SquarePenIcon,
  Trash2Icon,
} from 'lucide-react'

import {
  AdminPageHeader,
  EmptyState,
  formatAdminDate,
} from '#/components/admin/layout'
import { ClientFilterableAdminTable } from '#/components/admin/filterable-table'
import { AdminAuthRequired } from '#/components/admin/oauth-clients'
import {
  AdminTableSelectionCell,
  AdminTableSelectionHead,
} from '#/components/admin/table-selection'
import { createColumnConfigHelper } from '#/components/data-table-filter/core/filters'
import type { FiltersState } from '#/components/data-table-filter/core/types'
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
} from '#/components/ui/dialog'
import { InfoTooltip } from '#/components/ui/info-tooltip'
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { translateStatusLabel } from '#/lib/i18n'
import { getToastErrorDescription, showAppToast } from '#/lib/toast'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

const loadAdminIdentities = createServerFn({ method: 'GET' }).handler(
  async () => {
    const [
      { getRequest },
      { requireAdminPermission },
      { listAdminIdentitySummaries },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('../../lib/server/auth'),
      import('../../lib/server/identities'),
    ])

    const request = getRequest()

    try {
      await requireAdminPermission(request, 'MANAGED_IDENTITIES')
    } catch {
      return { authorized: false as const }
    }

    const identityState = await listAdminIdentitySummaries()
    return {
      authorized: true as const,
      identitySummaries: identityState,
    }
  },
)

export const Route = createFileRoute('/admin/identities')({
  loader: async () => loadAdminIdentities(),
  component: AdminIdentitiesPage,
})

type IdentitySummary = {
  id: string
  label: string
  account?: string | null
  lastSeenAt?: string | Date | null
  status?: string | null
}

type UpdateManagedIdentityResponse = {
  ok: boolean
  id: string
  identity?: IdentitySummary | null
}

type BulkDeleteManagedIdentityResponse = {
  ok: boolean
  identityIds: string[]
}

const managedIdentityStatusOptions = [
  {
    value: 'active',
    intent: 'activate',
    label: () => m.status_active(),
  },
  {
    value: 'review',
    intent: 'review',
    label: () => m.status_review(),
  },
  {
    value: 'archived',
    intent: 'archive',
    label: () => m.status_archived(),
  },
  {
    value: 'banned',
    intent: 'ban',
    label: () => m.status_banned(),
  },
] as const

type ManagedIdentityStatus =
  (typeof managedIdentityStatusOptions)[number]['value']

const managedIdentityBulkCopyFieldOptions = [
  {
    value: 'id',
    label: () => m.admin_identity_bulk_copy_field_identity_id(),
    getValue: (summary: IdentitySummary) => summary.id,
    getDedupeKey: (value: string) => value,
  },
  {
    value: 'email',
    label: () => m.admin_identity_bulk_copy_field_email(),
    getValue: (summary: IdentitySummary) => summary.account?.trim() || '',
    getDedupeKey: (value: string) => value.toLowerCase(),
  },
] as const

type ManagedIdentityBulkCopyField =
  (typeof managedIdentityBulkCopyFieldOptions)[number]['value']

const defaultManagedIdentityFilters: FiltersState = [
  {
    columnId: 'status',
    type: 'option',
    operator: 'is any of',
    values: ['active', 'review'],
  },
]

const IDENTITY_TABLE_PAGE_SIZE_OPTIONS = [9, 10, 25, 50] as const

function normalizeManagedIdentityStatus(
  status?: string | null,
): ManagedIdentityStatus {
  if (status === 'review' || status === 'archived' || status === 'banned') {
    return status
  }

  return 'active'
}

function isManagedIdentityStatus(
  value: string,
): value is ManagedIdentityStatus {
  return managedIdentityStatusOptions.some((option) => option.value === value)
}

function getManagedIdentityIntent(status: ManagedIdentityStatus) {
  return (
    managedIdentityStatusOptions.find((option) => option.value === status)
      ?.intent || 'activate'
  )
}

function getManagedIdentityEditableLabel(summary: IdentitySummary) {
  return summary.label !== summary.account ? summary.label : ''
}

function mergeIdentitySummaries(
  current: IdentitySummary[],
  updates: IdentitySummary[],
) {
  const updatesById = new Map(updates.map((summary) => [summary.id, summary]))
  return current.map((summary) => updatesById.get(summary.id) || summary)
}

function removeIdentitySummaries(
  current: IdentitySummary[],
  identityIds: string[],
) {
  const removedIds = new Set(identityIds)
  return current.filter((summary) => !removedIds.has(summary.id))
}

function isManagedIdentityBulkCopyField(
  value: string,
): value is ManagedIdentityBulkCopyField {
  return managedIdentityBulkCopyFieldOptions.some(
    (option) => option.value === value,
  )
}

function getCopyableIdentityValues(
  rows: IdentitySummary[],
  field: ManagedIdentityBulkCopyField,
) {
  const fieldOption = managedIdentityBulkCopyFieldOptions.find(
    (option) => option.value === field,
  )
  if (!fieldOption) {
    return []
  }

  const dedupedValues = new Set<string>()
  const values: string[] = []

  for (const row of rows) {
    const value = fieldOption.getValue(row).trim()
    if (!value) {
      continue
    }

    const dedupeKey = fieldOption.getDedupeKey(value)
    if (dedupedValues.has(dedupeKey)) {
      continue
    }

    dedupedValues.add(dedupeKey)
    values.push(value)
  }

  return values
}

function escapeCsvValue(value: string) {
  const normalizedValue = value.replaceAll('"', '""')
  return /[",\r\n]/.test(normalizedValue)
    ? `"${normalizedValue}"`
    : normalizedValue
}

function downloadIdentityValuesCsv(params: {
  field: ManagedIdentityBulkCopyField
  values: string[]
}) {
  const rows = [
    params.field,
    ...params.values.map((value) => escapeCsvValue(value)),
  ]
  const blob = new Blob([`${rows.join('\n')}\n`], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `managed-identities-${params.field}.csv`
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

function AdminIdentitiesPage() {
  const data = Route.useLoaderData()

  if (!data.authorized) {
    return <AdminAuthRequired />
  }

  const [identitySummaries, setIdentitySummaries] = useState(
    () => data.identitySummaries as IdentitySummary[],
  )
  const locale = getLocale()

  useEffect(() => {
    setIdentitySummaries(data.identitySummaries as IdentitySummary[])
  }, [data.identitySummaries])

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
        .accessor(
          (summary) => summary.account || m.admin_dashboard_not_linked_yet(),
        )
        .displayName(m.admin_dashboard_table_account())
        .icon(SearchIcon)
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <AdminPageHeader
        title={m.admin_identity_page_title()}
        description={m.admin_identity_page_description()}
        variant="plain"
      />

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader>
          <CardDescription>
            {m.admin_dashboard_identities_kicker()}
          </CardDescription>
          <div className="flex items-start gap-2">
            <CardTitle>{m.admin_dashboard_identities_title()}</CardTitle>
            <InfoTooltip
              content={m.admin_dashboard_identities_description()}
              label={m.admin_dashboard_identities_title()}
              className="mt-0.5"
            />
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col">
          <ClientFilterableAdminTable
            data={identitySummaries}
            columnsConfig={identityColumns}
            defaultFilters={defaultManagedIdentityFilters}
            pageSizeOptions={IDENTITY_TABLE_PAGE_SIZE_OPTIONS}
            getRowId={(summary) => summary.id}
            fillHeight
            emptyState={
              <EmptyState
                title={m.admin_dashboard_identities_empty_title()}
                description={m.admin_dashboard_identities_empty_description()}
              />
            }
            renderActions={({ selectedRows }) => (
              <TooltipProvider>
                <BulkCopyIdentityValuesAction rows={selectedRows} />
                <BulkDeleteIdentityAction
                  rows={selectedRows}
                  onDeleted={(identityIds) => {
                    setIdentitySummaries((current) =>
                      removeIdentitySummaries(current, identityIds),
                    )
                  }}
                />
              </TooltipProvider>
            )}
            renderTable={({ rows, selection }) => (
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <AdminTableSelectionHead
                      rows={rows}
                      selection={selection}
                    />
                    <TableHead>{m.admin_dashboard_table_identity()}</TableHead>
                    <TableHead>{m.admin_dashboard_table_account()}</TableHead>
                    <TableHead>{m.admin_dashboard_table_last_seen()}</TableHead>
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
                        {formatAdminDate(summary.lastSeenAt) ||
                          m.admin_dashboard_not_captured_yet()}
                      </TableCell>
                      <TableCell className="align-top">
                        <IdentityStatusSelect summary={summary} />
                      </TableCell>
                      <TableCell className="align-top">
                        <IdentityRowActions
                          summary={summary}
                          onSaved={(updatedIdentity) => {
                            setIdentitySummaries((current) =>
                              mergeIdentitySummaries(current, [
                                updatedIdentity,
                              ]),
                            )
                          }}
                        />
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

function BulkCopyIdentityValuesAction(props: { rows: IdentitySummary[] }) {
  const [open, setOpen] = useState(false)
  const [selectedField, setSelectedField] =
    useState<ManagedIdentityBulkCopyField>('email')
  const rowIdsKey = useMemo(
    () => props.rows.map((row) => row.id).join('|'),
    [props.rows],
  )
  const fieldOptions = useMemo(
    () =>
      managedIdentityBulkCopyFieldOptions.map((option) => ({
        ...option,
        values: getCopyableIdentityValues(props.rows, option.value),
      })),
    [props.rows],
  )
  const defaultField =
    fieldOptions.find(
      (option) => option.value === 'email' && option.values.length > 0,
    )?.value ||
    fieldOptions[0]?.value ||
    'email'
  const activeField =
    fieldOptions.find((option) => option.value === selectedField) ||
    fieldOptions[0]
  const previewValue = activeField ? activeField.values.join('\n') : ''

  useEffect(() => {
    if (!open) {
      return
    }

    setSelectedField(defaultField)
  }, [defaultField, open, rowIdsKey])

  async function handleCopy() {
    const fieldLabel =
      activeField?.label() || m.admin_identity_bulk_copy_field_email()

    if (!previewValue) {
      showAppToast({
        kind: 'error',
        description: m.admin_identity_bulk_copy_empty({ field: fieldLabel }),
      })
      return
    }

    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      showAppToast({
        kind: 'error',
        description: m.admin_identity_bulk_copy_error({ field: fieldLabel }),
      })
      return
    }

    try {
      await navigator.clipboard.writeText(previewValue)
      showAppToast({
        kind: 'success',
        description: m.admin_identity_bulk_copy_success({
          count: String(activeField?.values.length || 0),
          field: fieldLabel,
        }),
      })
    } catch {
      showAppToast({
        kind: 'error',
        description: m.admin_identity_bulk_copy_error({ field: fieldLabel }),
      })
    }
  }

  function handleDownloadCsv() {
    const fieldLabel =
      activeField?.label() || m.admin_identity_bulk_copy_field_email()

    if (!activeField?.values.length) {
      showAppToast({
        kind: 'error',
        description: m.admin_identity_bulk_copy_empty({ field: fieldLabel }),
      })
      return
    }

    try {
      downloadIdentityValuesCsv({
        field: activeField.value,
        values: activeField.values,
      })
      showAppToast({
        kind: 'success',
        description: m.admin_identity_bulk_copy_download_success({
          count: String(activeField.values.length),
          field: fieldLabel,
        }),
      })
    } catch {
      showAppToast({
        kind: 'error',
        description: m.admin_identity_bulk_copy_download_error({
          field: fieldLabel,
        }),
      })
    }
  }

  return (
    <>
      <ActionIconButton
        label={m.admin_identity_bulk_copy_button()}
        icon={<ClipboardCopyIcon />}
        disabled={!props.rows.length}
        onClick={() => {
          setOpen(true)
        }}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(620px,calc(100%-2rem))] gap-5">
          <DialogHeader>
            <DialogTitle>
              {m.admin_identity_bulk_copy_title({
                count: String(props.rows.length),
              })}
            </DialogTitle>
            <DialogDescription>
              {m.admin_identity_bulk_copy_description()}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
              {m.admin_identity_bulk_copy_scope({
                count: String(props.rows.length),
              })}
            </div>

            <DialogField label={m.admin_identity_bulk_copy_field_label()}>
              <Select
                value={activeField?.value || defaultField}
                onValueChange={(nextField) => {
                  if (!isManagedIdentityBulkCopyField(nextField)) {
                    return
                  }

                  setSelectedField(nextField)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {fieldOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DialogField>

            <DialogField
              label={m.admin_identity_bulk_copy_preview_label()}
              description={m.admin_identity_bulk_copy_preview_description({
                count: String(activeField?.values.length || 0),
                field:
                  activeField?.label() ||
                  m.admin_identity_bulk_copy_field_email(),
              })}
            >
              <Textarea
                readOnly
                value={previewValue}
                rows={8}
                className="min-h-40 font-mono text-xs"
                placeholder={m.admin_identity_bulk_copy_empty({
                  field:
                    activeField?.label() ||
                    m.admin_identity_bulk_copy_field_email(),
                })}
              />
            </DialogField>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
              }}
            >
              {m.ui_close()}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                handleDownloadCsv()
              }}
              disabled={!activeField?.values.length}
            >
              <DownloadIcon />
              {m.admin_identity_bulk_copy_download_button()}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleCopy()
              }}
              disabled={!activeField?.values.length}
            >
              {m.admin_identity_bulk_copy_confirm_button()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function BulkDeleteIdentityAction(props: {
  rows: IdentitySummary[]
  onDeleted: (identityIds: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const rowIds = useMemo(() => props.rows.map((row) => row.id), [props.rows])
  const rowIdsKey = rowIds.join('|')

  useEffect(() => {
    if (!open) {
      return
    }

    setSubmitting(false)
  }, [open, rowIdsKey])

  async function handleSubmit() {
    setSubmitting(true)

    try {
      const form = new FormData()
      form.set('intent', 'bulk-delete')
      form.set('redirectTo', '/admin/identities')

      for (const identityId of rowIds) {
        form.append('identityIds', identityId)
      }

      const response = await fetch('/api/admin/identities', {
        method: 'POST',
        headers: {
          accept: 'application/json',
        },
        body: form,
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const result =
        (await response.json()) as BulkDeleteManagedIdentityResponse

      props.onDeleted(result.identityIds)
      setOpen(false)
    } catch (error) {
      showAppToast({
        kind: 'error',
        title: m.oauth_unable_to_save_title(),
        description: getToastErrorDescription(
          error,
          m.admin_identity_bulk_delete_error_fallback(),
        ),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={!rowIds.length}
        onClick={() => {
          setOpen(true)
        }}
      >
        <Trash2Icon />
        {m.admin_identity_bulk_delete_button()}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(620px,calc(100%-2rem))] gap-5">
          <DialogHeader>
            <DialogTitle>
              {m.admin_identity_bulk_delete_title({
                count: String(rowIds.length),
              })}
            </DialogTitle>
            <DialogDescription>
              {m.admin_identity_bulk_delete_description()}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-muted-foreground">
              {m.admin_identity_bulk_delete_scope({
                count: String(rowIds.length),
              })}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
              }}
              disabled={submitting}
            >
              {m.ui_close()}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void handleSubmit()
              }}
              disabled={submitting || !rowIds.length}
            >
              {submitting
                ? m.oauth_saving()
                : m.admin_identity_bulk_delete_button()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function IdentityRowActions(props: {
  summary: IdentitySummary
  onSaved: (identity: IdentitySummary) => void
}) {
  return (
    <TooltipProvider>
      <div className="flex items-start gap-2">
        <IdentityEditAction summary={props.summary} onSaved={props.onSaved} />
        <IdentityDeleteAction summary={props.summary} />
      </div>
    </TooltipProvider>
  )
}

function IdentityEditAction(props: {
  summary: IdentitySummary
  onSaved: (identity: IdentitySummary) => void
}) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState(() =>
    getManagedIdentityEditableLabel(props.summary),
  )
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    setLabel(getManagedIdentityEditableLabel(props.summary))
    setSubmitting(false)
  }, [open, props.summary.account, props.summary.id, props.summary.label])

  async function handleSubmit() {
    setSubmitting(true)

    try {
      const form = new FormData()
      form.set('intent', 'save-label')
      form.set('identityId', props.summary.id)
      form.set('email', props.summary.account || props.summary.label)
      form.set('label', label)
      form.set('redirectTo', '/admin/identities')

      const response = await fetch('/api/admin/identities', {
        method: 'POST',
        headers: {
          accept: 'application/json',
        },
        body: form,
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const result = (await response.json()) as UpdateManagedIdentityResponse

      if (result.identity) {
        props.onSaved(result.identity)
      }

      setOpen(false)
    } catch (error) {
      showAppToast({
        kind: 'error',
        title: m.oauth_unable_to_save_title(),
        description: getToastErrorDescription(
          error,
          m.admin_identity_save_error_fallback(),
        ),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <ActionIconButton
        label={m.admin_identity_update_label_button()}
        icon={<SquarePenIcon />}
        onClick={() => {
          setOpen(true)
        }}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(560px,calc(100%-2rem))] gap-5">
          <DialogHeader>
            <DialogTitle>{m.admin_identity_edit_title()}</DialogTitle>
            <DialogDescription>
              {m.admin_identity_edit_description()}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="space-y-1">
                <div className="font-medium text-foreground">
                  {props.summary.label}
                </div>
                <p className="break-all text-sm text-muted-foreground">
                  {props.summary.account || m.admin_dashboard_not_linked_yet()}
                </p>
              </div>
            </div>

            <DialogField label={m.admin_dashboard_identity_label()}>
              <Input
                value={label}
                onChange={(event) => {
                  setLabel(event.target.value)
                }}
                placeholder={
                  props.summary.account || m.admin_dashboard_identity_label()
                }
                disabled={submitting}
              />
            </DialogField>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
              }}
              disabled={submitting}
            >
              {m.ui_close()}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleSubmit()
              }}
              disabled={submitting}
            >
              {submitting ? m.oauth_saving() : m.admin_identity_save_button()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DialogField(props: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-foreground">{props.label}</span>
      {props.description ? (
        <span className="text-sm text-muted-foreground">
          {props.description}
        </span>
      ) : null}
      {props.children}
    </label>
  )
}

function IdentityActionFields(props: { summary: IdentitySummary }) {
  return (
    <>
      <input type="hidden" name="identityId" value={props.summary.id} />
      <input
        type="hidden"
        name="email"
        value={props.summary.account || props.summary.label}
      />
      <input type="hidden" name="redirectTo" value="/admin/identities" />
    </>
  )
}

function IdentityStatusSelect(props: { summary: IdentitySummary }) {
  const formRef = useRef<HTMLFormElement>(null)
  const intentInputRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const currentStatus = normalizeManagedIdentityStatus(props.summary.status)

  return (
    <form ref={formRef} method="post" action="/api/admin/identities">
      <IdentityActionFields summary={props.summary} />
      <input
        ref={intentInputRef}
        type="hidden"
        name="intent"
        value={getManagedIdentityIntent(currentStatus)}
      />

      <Select
        defaultValue={currentStatus}
        disabled={submitting}
        onValueChange={(nextStatus) => {
          const intentInput = intentInputRef.current
          if (!intentInput || !isManagedIdentityStatus(nextStatus)) {
            return
          }

          intentInput.value = getManagedIdentityIntent(nextStatus)
          setSubmitting(true)
          formRef.current?.requestSubmit()
        }}
      >
        <SelectTrigger size="sm" className="w-[132px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          {managedIdentityStatusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </form>
  )
}

function IdentityDeleteAction(props: { summary: IdentitySummary }) {
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="destructive"
            aria-label={m.admin_identity_delete_button()}
            title={m.admin_identity_delete_button()}
            onClick={() => {
              setOpen(true)
            }}
          >
            <Trash2Icon />
          </Button>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>
          {m.admin_identity_delete_button()}
        </TooltipContent>
      </Tooltip>

      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {m.admin_identity_delete_confirm_title()}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {m.admin_identity_delete_confirm_description()}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>{m.ui_close()}</AlertDialogCancel>
          <form method="post" action="/api/admin/identities">
            <IdentityActionFields summary={props.summary} />
            <Button
              type="submit"
              name="intent"
              value="delete"
              size="sm"
              variant="destructive"
            >
              {m.admin_identity_delete_button()}
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
  label: string
  icon: ReactNode
  disabled?: boolean
  onClick?: () => void
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
          aria-label={props.label}
          title={props.label}
          disabled={props.disabled}
          onClick={props.onClick}
        >
          {props.icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{props.label}</TooltipContent>
    </Tooltip>
  )
}

function normalizeDate(value?: string | Date | null) {
  if (!value) {
    return undefined
  }

  const normalized = value instanceof Date ? value : new Date(value)
  return Number.isNaN(normalized.getTime()) ? undefined : normalized
}
