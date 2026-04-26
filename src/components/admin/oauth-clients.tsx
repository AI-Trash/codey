import {
  useEffect,
  useId,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react'
import {
  AppWindowIcon,
  CalendarIcon,
  GlobeIcon,
  KeyRoundIcon,
  ListIcon,
  SearchIcon,
  ShieldIcon,
} from 'lucide-react'

import { ClientFilterableAdminTable } from '#/components/admin/filterable-table'
import {
  EmptyState,
  StatusBadge,
  formatAdminDate,
} from '#/components/admin/layout'
import {
  AdminTableSelectionCell,
  AdminTableSelectionHead,
} from '#/components/admin/table-selection'
import { createColumnConfigHelper } from '#/components/data-table-filter/core/filters'
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
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { InfoTooltip } from '#/components/ui/info-tooltip'
import { Input } from '#/components/ui/input'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { translateStatusLabel } from '#/lib/i18n'
import { Textarea } from '#/components/ui/textarea'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

export type ManagedOAuthClient = {
  id: string
  clientId: string
  clientName: string
  description: string | null
  enabled: boolean
  clientCredentialsEnabled: boolean
  deviceFlowEnabled: boolean
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post'
  allowedScopes: string[]
  verificationDomainId: string | null
  verificationDomain: string | null
  clientSecretPreview: string
  clientSecretUpdatedAt: string | Date
  createdAt: string | Date
  updatedAt: string | Date
}

export type ManagedVerificationDomainOption = {
  id: string
  domain: string
  isDefault: boolean
}

type OAuthClientFormValues = {
  clientName: string
  description: string
  enabled: boolean
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post'
  allowedScopes: string
  verificationDomainId: string
  clientCredentialsEnabled: boolean
  deviceFlowEnabled: boolean
}

type OAuthClientPayload = {
  clientName: string
  description?: string
  enabled: boolean
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post'
  allowedScopes: string[]
  verificationDomainId?: string
  clientCredentialsEnabled: boolean
  deviceFlowEnabled: boolean
}

export function AdminAuthRequired() {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardDescription>{m.admin_breadcrumb_root()}</CardDescription>
        <div className="flex items-start gap-2">
          <CardTitle className="text-2xl">
            {m.admin_auth_required_title()}
          </CardTitle>
          <InfoTooltip
            content={m.admin_auth_required_description()}
            label={m.admin_auth_required_title()}
            className="mt-0.5"
          />
        </div>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <a href="/admin/login">{m.admin_auth_required_cta()}</a>
        </Button>
      </CardContent>
    </Card>
  )
}

export function OAuthClientsList({
  clients,
  fillHeight = false,
}: {
  clients: ManagedOAuthClient[]
  fillHeight?: boolean
}) {
  const locale = getLocale()
  const enabledCount = clients.filter((client) => client.enabled).length
  const deviceFlowCount = clients.filter(
    (client) => client.deviceFlowEnabled,
  ).length
  const dtf = createColumnConfigHelper<ManagedOAuthClient>()
  const columnsConfig = useMemo(
    () =>
      [
        dtf
          .text()
          .id('app')
          .accessor((client) => client.clientName)
          .displayName(m.oauth_clients_table_app())
          .icon(AppWindowIcon)
          .build(),
        dtf
          .text()
          .id('clientId')
          .accessor((client) => client.clientId)
          .displayName(m.oauth_clients_table_client_id())
          .icon(KeyRoundIcon)
          .build(),
        dtf
          .text()
          .id('verificationDomain')
          .accessor((client) => getVerificationDomainLabel(client))
          .displayName(m.oauth_clients_table_domain())
          .icon(GlobeIcon)
          .build(),
        dtf
          .multiOption()
          .id('grants')
          .accessor((client) => formatGrantList(client))
          .displayName(m.oauth_clients_table_grants())
          .icon(ListIcon)
          .transformOptionFn((grant) => ({
            label: grant,
            value: grant,
          }))
          .build(),
        dtf
          .multiOption()
          .id('scopes')
          .accessor((client) => client.allowedScopes)
          .displayName(m.oauth_clients_table_scopes())
          .icon(SearchIcon)
          .transformOptionFn((scope) => ({
            label: scope,
            value: scope,
          }))
          .build(),
        dtf
          .option()
          .id('status')
          .accessor((client) => (client.enabled ? 'enabled' : 'disabled'))
          .displayName(m.oauth_clients_table_status())
          .icon(ShieldIcon)
          .transformOptionFn((status) => ({
            label: translateStatusLabel(status),
            value: status,
          }))
          .build(),
        dtf
          .date()
          .id('updatedAt')
          .accessor((client) => normalizeDate(client.updatedAt))
          .displayName(m.oauth_clients_table_updated())
          .icon(CalendarIcon)
          .build(),
      ] as const,
    [locale],
  )

  return (
    <div
      className={cn(
        fillHeight ? 'flex min-h-0 flex-1 flex-col gap-4' : 'space-y-4',
      )}
    >
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">
          {m.oauth_clients_badge_total({ count: String(clients.length) })}
        </Badge>
        <Badge variant="outline">
          {m.oauth_clients_badge_enabled({ count: String(enabledCount) })}
        </Badge>
        <Badge variant="outline">
          {m.oauth_clients_badge_device_flow({
            count: String(deviceFlowCount),
          })}
        </Badge>
      </div>

      <ClientFilterableAdminTable
        data={clients}
        columnsConfig={columnsConfig}
        getRowId={(client) => client.id}
        fillHeight={fillHeight}
        emptyState={
          <EmptyState
            title={m.oauth_clients_empty_title()}
            description={m.oauth_clients_empty_description()}
          />
        }
        renderTable={({ rows, selection }) => (
          <Table className="min-w-[1080px]">
            <TableHeader>
              <TableRow>
                <AdminTableSelectionHead rows={rows} selection={selection} />
                <TableHead>{m.oauth_clients_table_app()}</TableHead>
                <TableHead>{m.oauth_clients_table_client_id()}</TableHead>
                <TableHead>{m.oauth_clients_table_domain()}</TableHead>
                <TableHead>{m.oauth_clients_table_grants()}</TableHead>
                <TableHead>{m.oauth_clients_table_scopes()}</TableHead>
                <TableHead>{m.oauth_clients_table_secret()}</TableHead>
                <TableHead>{m.oauth_clients_table_status()}</TableHead>
                <TableHead>{m.oauth_clients_table_updated()}</TableHead>
                <TableHead className="text-right">
                  {m.oauth_clients_table_actions()}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((client) => (
                <TableRow
                  key={client.id}
                  data-selected={selection.isSelected(client) || undefined}
                >
                  <AdminTableSelectionCell row={client} selection={selection} />
                  <TableCell className="whitespace-normal align-top">
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">
                        {client.clientName}
                      </div>
                      <p className="max-w-[320px] text-sm leading-6 text-muted-foreground">
                        {client.description || m.oauth_clients_no_description()}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="space-y-1">
                      <code className="inline-block max-w-[240px] overflow-x-auto whitespace-nowrap">
                        {client.clientId}
                      </code>
                      <p className="text-xs text-muted-foreground">
                        {formatAuthMethod(client.tokenEndpointAuthMethod)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">
                        {getVerificationDomainLabel(client)}
                      </div>
                      {!client.verificationDomain ? (
                        <p className="text-xs text-muted-foreground">
                          {m.oauth_domain_default_fallback()}
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex max-w-[200px] flex-wrap gap-1.5">
                      {formatGrantList(client).map((grant) => (
                        <Badge key={grant} variant="secondary">
                          {grant}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal align-top">
                    <div className="flex max-w-[280px] flex-wrap gap-1.5">
                      {client.allowedScopes.length ? (
                        client.allowedScopes.map((scope) => (
                          <Badge key={scope} variant="outline">
                            {scope}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {m.oauth_clients_no_scopes()}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="space-y-1">
                      <code>{client.clientSecretPreview}...</code>
                      <p className="text-xs text-muted-foreground">
                        {m.oauth_clients_rotated_label()}{' '}
                        {formatAdminDate(client.clientSecretUpdatedAt) ||
                          m.oauth_clients_recently()}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <StatusBadge
                      value={client.enabled ? 'Enabled' : 'Disabled'}
                    />
                  </TableCell>
                  <TableCell className="align-top text-sm text-muted-foreground">
                    {formatAdminDate(client.updatedAt) ||
                      m.oauth_clients_recently()}
                  </TableCell>
                  <TableCell className="align-top text-right">
                    <Button asChild size="sm">
                      <a href={`/admin/apps/${client.id}`}>
                        {m.oauth_clients_edit_app()}
                      </a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      />
    </div>
  )
}

export function CreateOAuthClientDialog({
  open,
  onOpenChange,
  supportedScopes,
  verificationDomains,
  onClientCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  supportedScopes: string[]
  verificationDomains: ManagedVerificationDomainOption[]
  onClientCreated?: (client: ManagedOAuthClient) => void
}) {
  const [form, setForm] = useState<OAuthClientFormValues>(() =>
    createNewOAuthClientFormValues(supportedScopes, verificationDomains),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{
    client: ManagedOAuthClient
    clientSecret: string
  } | null>(null)

  useEffect(() => {
    if (open) {
      return
    }

    setForm(
      createNewOAuthClientFormValues(supportedScopes, verificationDomains),
    )
    setSubmitting(false)
    setError(null)
    setCreated(null)
  }, [open, supportedScopes, verificationDomains])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setCreated(null)

    try {
      const payload = toPayload(form)
      const response = await fetch('/api/admin/oauth-clients', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const data = (await response.json()) as {
        client: ManagedOAuthClient
        clientSecret: string
      }
      setCreated(data)
      onClientCreated?.(data.client)
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : m.oauth_new_error_create(),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[min(1120px,calc(100%-2rem))] gap-0 overflow-hidden p-0 sm:max-w-[min(1120px,calc(100%-2rem))]">
        <DialogHeader className="gap-3 border-b px-6 py-5 pr-14">
          <DialogDescription>{m.admin_apps_eyebrow()}</DialogDescription>
          <div className="flex items-start gap-2">
            <DialogTitle className="text-xl">
              {m.admin_apps_new_title()}
            </DialogTitle>
            <InfoTooltip
              content={m.admin_apps_new_description()}
              label={m.admin_apps_new_title()}
              className="mt-0.5"
            />
          </div>
        </DialogHeader>

        <div className="overflow-y-auto p-6">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_380px]">
            <Card>
              <CardHeader>
                <CardDescription>
                  {m.oauth_new_registration_kicker()}
                </CardDescription>
                <div className="flex items-start gap-2">
                  <CardTitle>{m.oauth_new_title()}</CardTitle>
                  <InfoTooltip
                    content={m.oauth_new_description()}
                    label={m.oauth_new_title()}
                    className="mt-0.5"
                  />
                </div>
              </CardHeader>
              <CardContent>
                <OAuthClientForm
                  form={form}
                  submitting={submitting}
                  submitLabel={m.oauth_new_submit()}
                  supportedScopes={supportedScopes}
                  verificationDomains={verificationDomains}
                  allowedScopesInputMode="tags"
                  error={error}
                  onChange={setForm}
                  onSubmit={handleSubmit}
                />
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardDescription>{m.oauth_defaults_kicker()}</CardDescription>
                  <CardTitle className="text-lg">
                    {m.oauth_defaults_title()}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
                  <InfoBlock
                    title={m.oauth_defaults_client_credentials_title()}
                    detail={m.oauth_defaults_client_credentials_detail()}
                  />
                  <InfoBlock
                    title={m.oauth_defaults_device_flow_title()}
                    detail={m.oauth_defaults_device_flow_detail()}
                  />
                  <InfoBlock
                    title={m.oauth_defaults_secret_title()}
                    detail={m.oauth_defaults_secret_detail()}
                  />
                </CardContent>
              </Card>

              {created ? (
                <SecretPanel
                  title={m.oauth_new_secret_panel_title()}
                  body={m.oauth_new_secret_panel_body()}
                  clientId={created.client.clientId}
                  secret={created.clientSecret}
                  preview={created.client.clientSecretPreview}
                  footer={
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <a href={`/admin/apps/${created.client.id}`}>
                          {m.oauth_new_open_app_settings()}
                        </a>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          onOpenChange(false)
                        }}
                      >
                        {m.ui_close()}
                      </Button>
                    </div>
                  }
                />
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function EditOAuthClientPageContent({
  initialClient,
  supportedScopes,
  verificationDomains,
}: {
  initialClient: ManagedOAuthClient
  supportedScopes: string[]
  verificationDomains: ManagedVerificationDomainOption[]
}) {
  const [client, setClient] = useState(initialClient)
  const [form, setForm] = useState<OAuthClientFormValues>(() =>
    createFormValues(initialClient),
  )
  const [saving, setSaving] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [visibleSecret, setVisibleSecret] = useState<string | null>(null)

  useEffect(() => {
    setClient(initialClient)
    setForm(createFormValues(initialClient))
  }, [initialClient])

  async function saveClient(rotateSecret: boolean) {
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/admin/oauth-clients/${client.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ...toPayload(form),
          rotateSecret,
        }),
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const data = (await response.json()) as {
        client: ManagedOAuthClient
        rotatedSecret?: string
      }
      setClient(data.client)
      setForm(createFormValues(data.client))
      setVisibleSecret(data.rotatedSecret || null)
      setSuccess(
        rotateSecret
          ? m.oauth_edit_success_rotated()
          : m.oauth_edit_success_saved(),
      )
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : m.oauth_edit_error_update(),
      )
    } finally {
      setSaving(false)
    }
  }

  async function revealSecret() {
    setRevealing(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/admin/oauth-clients/${client.id}?includeSecret=true`,
      )
      if (!response.ok) {
        throw new Error(await response.text())
      }

      const data = (await response.json()) as {
        client: ManagedOAuthClient
        clientSecret?: string
      }
      setVisibleSecret(data.clientSecret || null)
      setClient(data.client)
      setSuccess(m.oauth_edit_reveal_success())
    } catch (revealError) {
      setError(
        revealError instanceof Error
          ? revealError.message
          : m.oauth_edit_reveal_error(),
      )
    } finally {
      setRevealing(false)
    }
  }

  const grantSummary = formatGrantList(client).join(' • ')

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_380px]">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <CardDescription>
                {m.oauth_edit_settings_kicker()}
              </CardDescription>
              <div className="flex items-start gap-2">
                <CardTitle>{client.clientName}</CardTitle>
                <InfoTooltip
                  content={m.oauth_edit_settings_description()}
                  label={client.clientName}
                  className="mt-0.5"
                />
              </div>
            </div>
            <StatusBadge value={client.enabled ? 'Enabled' : 'Disabled'} />
          </div>
        </CardHeader>
        <CardContent>
          <OAuthClientForm
            form={form}
            submitting={saving}
            submitLabel={m.oauth_edit_save_settings()}
            supportedScopes={supportedScopes}
            verificationDomains={verificationDomains}
            error={error}
            success={success}
            onChange={setForm}
            onSubmit={(event) => {
              event.preventDefault()
              void saveClient(false)
            }}
          >
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saving || revealing}>
                {saving ? m.oauth_saving() : m.oauth_edit_save_settings()}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving || revealing}
                onClick={() => {
                  void saveClient(true)
                }}
              >
                {saving ? m.oauth_updating() : m.oauth_edit_rotate_secret()}
              </Button>
            </div>
          </OAuthClientForm>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardDescription>{m.oauth_edit_summary_kicker()}</CardDescription>
            <CardTitle className="text-lg">
              {m.oauth_edit_summary_title()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm text-muted-foreground">
              <SummaryItem
                label={m.oauth_field_client_id()}
                value={client.clientId}
                code
              />
              <SummaryItem
                label={m.oauth_summary_auth_method()}
                value={formatAuthMethod(client.tokenEndpointAuthMethod)}
              />
              <SummaryItem
                label={m.oauth_summary_enabled_grants()}
                value={grantSummary || m.oauth_none()}
              />
              <SummaryItem
                label={m.oauth_summary_allowed_scopes()}
                value={client.allowedScopes.join(', ') || m.oauth_none()}
              />
              <SummaryItem
                label={m.oauth_summary_verification_domain()}
                value={getVerificationDomainLabel(client)}
              />
              <SummaryItem
                label={m.oauth_clients_table_updated()}
                value={
                  formatAdminDate(client.updatedAt) ||
                  m.oauth_clients_recently()
                }
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>{m.oauth_secret_state_kicker()}</CardDescription>
            <div className="flex items-start gap-2">
              <CardTitle className="text-lg">
                {m.oauth_secret_state_title()}
              </CardTitle>
              <InfoTooltip
                content={m.oauth_secret_state_description()}
                label={m.oauth_secret_state_title()}
                className="mt-0.5"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {m.oauth_secret_preview_badge({
                  preview: client.clientSecretPreview,
                })}
              </Badge>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={saving || revealing}
              onClick={() => {
                void revealSecret()
              }}
            >
              {revealing
                ? m.oauth_revealing()
                : m.oauth_reveal_current_secret()}
            </Button>
          </CardContent>
        </Card>

        {visibleSecret ? (
          <SecretPanel
            title={m.oauth_secret_panel_title()}
            body={m.oauth_secret_panel_body()}
            clientId={client.clientId}
            secret={visibleSecret}
            preview={client.clientSecretPreview}
          />
        ) : null}
      </div>
    </div>
  )
}

function OAuthClientForm({
  form,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
  supportedScopes,
  verificationDomains,
  allowedScopesInputMode = 'text',
  error,
  success,
  children,
}: {
  form: OAuthClientFormValues
  onChange: Dispatch<SetStateAction<OAuthClientFormValues>>
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  submitting: boolean
  submitLabel: string
  supportedScopes: string[]
  verificationDomains: ManagedVerificationDomainOption[]
  allowedScopesInputMode?: 'text' | 'tags'
  error?: string | null
  success?: string | null
  children?: ReactNode
}) {
  const enabledId = useId()
  const clientCredentialsId = useId()
  const deviceFlowId = useId()

  const parsedScopes = parseScopes(form.allowedScopes)
  const hasGrantEnabled =
    form.clientCredentialsEnabled || form.deviceFlowEnabled
  const usesScopeTagSelector = allowedScopesInputMode === 'tags'

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <Field label={m.oauth_field_client_name()}>
        <Input
          value={form.clientName}
          onChange={(event) => {
            const nextValue = event.target.value
            onChange((current) => ({ ...current, clientName: nextValue }))
          }}
          placeholder={m.oauth_field_client_name_placeholder()}
          required
        />
      </Field>

      <Field label={m.oauth_field_description()}>
        <Textarea
          value={form.description}
          onChange={(event) => {
            const nextValue = event.target.value
            onChange((current) => ({ ...current, description: nextValue }))
          }}
          placeholder={m.oauth_field_description_placeholder()}
          className="min-h-28"
        />
      </Field>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
        <Field label={m.oauth_field_token_endpoint_auth_method()}>
          <NativeSelect
            value={form.tokenEndpointAuthMethod}
            onChange={(event) => {
              const nextValue = event.target
                .value as OAuthClientFormValues['tokenEndpointAuthMethod']
              onChange((current) => ({
                ...current,
                tokenEndpointAuthMethod: nextValue,
              }))
            }}
            className="w-full"
          >
            <NativeSelectOption value="client_secret_basic">
              client_secret_basic
            </NativeSelectOption>
            <NativeSelectOption value="client_secret_post">
              client_secret_post
            </NativeSelectOption>
          </NativeSelect>
        </Field>

        <ToggleCard
          id={enabledId}
          title={m.oauth_toggle_enabled_title()}
          description={m.oauth_toggle_enabled_description()}
          checked={form.enabled}
          onCheckedChange={(checked) => {
            onChange((current) => ({ ...current, enabled: checked }))
          }}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ToggleCard
          id={clientCredentialsId}
          title={m.oauth_toggle_client_credentials_title()}
          description={m.oauth_toggle_client_credentials_description()}
          checked={form.clientCredentialsEnabled}
          onCheckedChange={(checked) => {
            onChange((current) => ({
              ...current,
              clientCredentialsEnabled: checked,
            }))
          }}
        />

        <ToggleCard
          id={deviceFlowId}
          title={m.oauth_toggle_device_flow_title()}
          description={m.oauth_toggle_device_flow_description()}
          checked={form.deviceFlowEnabled}
          onCheckedChange={(checked) => {
            onChange((current) => ({ ...current, deviceFlowEnabled: checked }))
          }}
        />
      </div>

      <Field
        label={m.oauth_field_allowed_scopes()}
        description={
          usesScopeTagSelector
            ? undefined
            : m.oauth_field_allowed_scopes_description({
                scopes: supportedScopes.join(', '),
              })
        }
      >
        {usesScopeTagSelector ? (
          <ScopeTagSelector
            supportedScopes={supportedScopes}
            value={parsedScopes}
            onChange={(nextScopes) => {
              onChange((current) => ({
                ...current,
                allowedScopes: nextScopes.join('\n'),
              }))
            }}
          />
        ) : (
          <Textarea
            value={form.allowedScopes}
            onChange={(event) => {
              const nextValue = event.target.value
              onChange((current) => ({ ...current, allowedScopes: nextValue }))
            }}
            placeholder={supportedScopes.join('\n')}
            className="min-h-32"
          />
        )}
      </Field>

      {!hasGrantEnabled ? (
        <Alert variant="destructive">
          <AlertTitle>{m.oauth_grant_type_required_title()}</AlertTitle>
          <AlertDescription>
            {m.oauth_grant_type_required_description()}
          </AlertDescription>
        </Alert>
      ) : null}

      {!verificationDomains.length ? (
        <Alert variant="destructive">
          <AlertTitle>{m.oauth_domains_required_title()}</AlertTitle>
          <AlertDescription>
            {m.oauth_domains_required_description()}
          </AlertDescription>
        </Alert>
      ) : null}

      {parsedScopes.length && !usesScopeTagSelector ? (
        <div className="flex flex-wrap gap-1.5">
          {parsedScopes.map((scope) => (
            <Badge key={scope} variant="outline">
              {scope}
            </Badge>
          ))}
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{m.oauth_unable_to_save_title()}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {success ? (
        <Alert>
          <AlertTitle>{m.oauth_saved_title()}</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      {children || (
        <Button type="submit" disabled={submitting || !hasGrantEnabled}>
          {submitting ? m.oauth_saving() : submitLabel}
        </Button>
      )}
    </form>
  )
}

function ScopeTagSelector({
  supportedScopes,
  value,
  onChange,
}: {
  supportedScopes: string[]
  value: string[]
  onChange: (nextScopes: string[]) => void
}) {
  const selectedScopes = new Set(value)

  return (
    <div className="flex min-h-11 flex-wrap gap-2 rounded-md border border-input bg-transparent p-2.5 shadow-xs">
      {supportedScopes.map((scope) => {
        const selected = selectedScopes.has(scope)

        return (
          <Badge
            asChild
            key={scope}
            variant={selected ? 'default' : 'outline'}
            className={cn(
              'px-3 py-1 text-sm',
              selected
                ? 'shadow-xs'
                : 'hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => {
                const nextScopes = supportedScopes.filter((item) =>
                  item === scope ? !selected : selectedScopes.has(item),
                )
                onChange(nextScopes)
              }}
            >
              {scope}
            </button>
          </Badge>
        )
      })}
    </div>
  )
}

function SecretPanel({
  title,
  body,
  clientId,
  secret,
  preview,
  footer,
}: {
  title: string
  body: string
  clientId: string
  secret: string
  preview: string
  footer?: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardDescription>{m.oauth_secret_preview_kicker()}</CardDescription>
            <div className="flex items-start gap-2">
              <CardTitle className="text-lg">{title}</CardTitle>
              <InfoTooltip content={body} label={title} className="mt-0.5" />
            </div>
          </div>
          <Badge variant="outline">
            {m.oauth_secret_preview_badge({ preview })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <SummaryItem label={m.oauth_field_client_id()} value={clientId} code />
        <div className="rounded-lg border bg-muted/40 p-4">
          <code className="block overflow-x-auto border-0 bg-transparent px-0 py-0 text-sm text-foreground">
            {secret}
          </code>
        </div>
        {footer}
      </CardContent>
    </Card>
  )
}

function Field(props: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <label className="grid gap-2">
      <span className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {props.label}
        </span>
        <InfoTooltip
          content={props.description}
          label={props.label}
          className="size-4"
          iconClassName="size-3"
        />
      </span>
      {props.children}
    </label>
  )
}

function ToggleCard(props: {
  id: string
  title: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-4">
      <Checkbox
        id={props.id}
        checked={props.checked}
        onCheckedChange={(checked) => {
          props.onCheckedChange(checked === true)
        }}
        className="mt-0.5"
      />
      <div className="flex items-start gap-2">
        <label
          htmlFor={props.id}
          className="text-sm font-medium text-foreground"
        >
          {props.title}
        </label>
        <InfoTooltip
          content={props.description}
          label={props.title}
          className="mt-0.5"
        />
      </div>
    </div>
  )
}

function SummaryItem(props: { label: string; value: string; code?: boolean }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {props.label}
      </dt>
      <dd className="m-0 text-sm text-foreground">
        {props.code ? (
          <code className="inline-block max-w-full overflow-x-auto whitespace-nowrap">
            {props.value}
          </code>
        ) : (
          props.value
        )}
      </dd>
    </div>
  )
}

function InfoBlock(props: { title: string; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="font-medium text-foreground">{props.title}</div>
      <InfoTooltip
        content={props.detail}
        label={props.title}
        className="mt-0.5"
      />
    </div>
  )
}

function createNewOAuthClientFormValues(
  supportedScopes: string[],
  _verificationDomains: ManagedVerificationDomainOption[],
) {
  return createFormValues({
    clientName: '',
    description: '',
    enabled: true,
    tokenEndpointAuthMethod: 'client_secret_basic',
    allowedScopes: supportedScopes,
    verificationDomainId: '',
    clientCredentialsEnabled: true,
    deviceFlowEnabled: false,
  })
}

function createFormValues(client: {
  clientName: string
  description?: string | null
  enabled: boolean
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post'
  allowedScopes: string[] | string
  verificationDomainId?: string | null
  clientCredentialsEnabled: boolean
  deviceFlowEnabled: boolean
}): OAuthClientFormValues {
  return {
    clientName: client.clientName,
    description: client.description || '',
    enabled: client.enabled,
    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
    allowedScopes: Array.isArray(client.allowedScopes)
      ? client.allowedScopes.join('\n')
      : client.allowedScopes,
    verificationDomainId: client.verificationDomainId || '',
    clientCredentialsEnabled: client.clientCredentialsEnabled,
    deviceFlowEnabled: client.deviceFlowEnabled,
  }
}

function toPayload(form: OAuthClientFormValues): OAuthClientPayload {
  return {
    clientName: form.clientName.trim(),
    description: form.description.trim() || undefined,
    enabled: form.enabled,
    tokenEndpointAuthMethod: form.tokenEndpointAuthMethod,
    allowedScopes: parseScopes(form.allowedScopes),
    clientCredentialsEnabled: form.clientCredentialsEnabled,
    deviceFlowEnabled: form.deviceFlowEnabled,
  }
}

function parseScopes(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\n\s]+/)
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ).sort()
}

function formatAuthMethod(value: 'client_secret_basic' | 'client_secret_post') {
  return value === 'client_secret_post'
    ? 'client_secret_post'
    : 'client_secret_basic'
}

function formatGrantList(
  client: Pick<
    ManagedOAuthClient,
    'clientCredentialsEnabled' | 'deviceFlowEnabled'
  >,
) {
  return [
    client.clientCredentialsEnabled ? 'client_credentials' : null,
    client.deviceFlowEnabled ? 'device_flow' : null,
  ].filter(Boolean) as string[]
}

function getVerificationDomainLabel(
  client: Pick<ManagedOAuthClient, 'verificationDomain'>,
) {
  return client.verificationDomain || m.oauth_domain_uses_default()
}

function normalizeDate(value: string | Date | null | undefined) {
  if (!value) {
    return undefined
  }

  const normalized = value instanceof Date ? value : new Date(value)
  return Number.isNaN(normalized.getTime()) ? undefined : normalized
}
