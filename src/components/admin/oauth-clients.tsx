import {
  useEffect,
  useId,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react'

import {
  EmptyState,
  StatusBadge,
  formatAdminDate,
} from '#/components/admin/layout'
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
import { Textarea } from '#/components/ui/textarea'
import { m } from '#/paraglide/messages'

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
  clientSecretPreview: string
  clientSecretUpdatedAt: string | Date
  createdAt: string | Date
  updatedAt: string | Date
}

type OAuthClientFormValues = {
  clientName: string
  description: string
  enabled: boolean
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post'
  allowedScopes: string
  clientCredentialsEnabled: boolean
  deviceFlowEnabled: boolean
}

type OAuthClientPayload = {
  clientName: string
  description?: string
  enabled: boolean
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post'
  allowedScopes: string[]
  clientCredentialsEnabled: boolean
  deviceFlowEnabled: boolean
}

export function AdminAuthRequired() {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardDescription>{m.admin_breadcrumb_root()}</CardDescription>
        <CardTitle className="text-2xl">
          {m.admin_auth_required_title()}
        </CardTitle>
        <CardDescription className="max-w-xl text-sm leading-6">
          {m.admin_auth_required_description()}
        </CardDescription>
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
}: {
  clients: ManagedOAuthClient[]
}) {
  if (!clients.length) {
    return (
      <EmptyState
        title={m.oauth_clients_empty_title()}
        description={m.oauth_clients_empty_description()}
      />
    )
  }

  const enabledCount = clients.filter((client) => client.enabled).length
  const deviceFlowCount = clients.filter(
    (client) => client.deviceFlowEnabled,
  ).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">
          {m.oauth_clients_badge_total({ count: String(clients.length) })}
        </Badge>
        <Badge variant="outline">
          {m.oauth_clients_badge_enabled({ count: String(enabledCount) })}
        </Badge>
        <Badge variant="outline">
          {m.oauth_clients_badge_device_flow({ count: String(deviceFlowCount) })}
        </Badge>
      </div>

      <Table className="min-w-[1080px]">
        <TableHeader>
          <TableRow>
            <TableHead>{m.oauth_clients_table_app()}</TableHead>
            <TableHead>{m.oauth_clients_table_client_id()}</TableHead>
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
          {clients.map((client) => (
            <TableRow key={client.id}>
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
                <StatusBadge value={client.enabled ? 'Enabled' : 'Disabled'} />
              </TableCell>
              <TableCell className="align-top text-sm text-muted-foreground">
                {formatAdminDate(client.updatedAt) || m.oauth_clients_recently()}
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
    </div>
  )
}

export function NewOAuthClientPageContent({
  supportedScopes,
}: {
  supportedScopes: string[]
}) {
  const [form, setForm] = useState<OAuthClientFormValues>(() =>
    createFormValues({
      clientName: '',
      description: '',
      enabled: true,
      tokenEndpointAuthMethod: 'client_secret_basic',
      allowedScopes: supportedScopes.join('\n'),
      clientCredentialsEnabled: true,
      deviceFlowEnabled: false,
    }),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{
    client: ManagedOAuthClient
    clientSecret: string
  } | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_380px]">
      <Card>
        <CardHeader>
          <CardDescription>{m.oauth_new_registration_kicker()}</CardDescription>
          <CardTitle>{m.oauth_new_title()}</CardTitle>
          <CardDescription>{m.oauth_new_description()}</CardDescription>
        </CardHeader>
        <CardContent>
          <OAuthClientForm
            form={form}
            submitting={submitting}
            submitLabel={m.oauth_new_submit()}
            supportedScopes={supportedScopes}
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
                <Button asChild size="sm" variant="outline">
                  <a href="/admin/apps">{m.admin_back_to_apps()}</a>
                </Button>
              </div>
            }
          />
        ) : null}
      </div>
    </div>
  )
}

export function EditOAuthClientPageContent({
  initialClient,
  supportedScopes,
}: {
  initialClient: ManagedOAuthClient
  supportedScopes: string[]
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
            <div>
              <CardDescription>{m.oauth_edit_settings_kicker()}</CardDescription>
              <CardTitle>{client.clientName}</CardTitle>
            </div>
            <StatusBadge value={client.enabled ? 'Enabled' : 'Disabled'} />
          </div>
          <CardDescription>{m.oauth_edit_settings_description()}</CardDescription>
        </CardHeader>
        <CardContent>
          <OAuthClientForm
            form={form}
            submitting={saving}
            submitLabel={m.oauth_edit_save_settings()}
            supportedScopes={supportedScopes}
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
                label={m.oauth_clients_table_updated()}
                value={formatAdminDate(client.updatedAt) || m.oauth_clients_recently()}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>{m.oauth_secret_state_kicker()}</CardDescription>
            <CardTitle className="text-lg">
              {m.oauth_secret_state_title()}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {m.oauth_secret_preview_badge({
                  preview: client.clientSecretPreview,
                })}
              </Badge>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {m.oauth_secret_state_description()}
            </p>
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
        description={m.oauth_field_allowed_scopes_description({
          scopes: supportedScopes.join(', '),
        })}
      >
        <Textarea
          value={form.allowedScopes}
          onChange={(event) => {
            const nextValue = event.target.value
            onChange((current) => ({ ...current, allowedScopes: nextValue }))
          }}
          placeholder={supportedScopes.join('\n')}
          className="min-h-32"
        />
      </Field>

      {!hasGrantEnabled ? (
        <Alert variant="destructive">
          <AlertTitle>{m.oauth_grant_type_required_title()}</AlertTitle>
          <AlertDescription>
            {m.oauth_grant_type_required_description()}
          </AlertDescription>
        </Alert>
      ) : null}

      {parsedScopes.length ? (
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
          <div>
            <CardDescription>{m.oauth_secret_preview_kicker()}</CardDescription>
            <CardTitle className="text-lg">{title}</CardTitle>
          </div>
          <Badge variant="outline">
            {m.oauth_secret_preview_badge({ preview })}
          </Badge>
        </div>
        <CardDescription className="text-sm leading-6">{body}</CardDescription>
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
      <span className="text-sm font-medium text-foreground">{props.label}</span>
      {props.children}
      {props.description ? (
        <span className="text-xs leading-5 text-muted-foreground">
          {props.description}
        </span>
      ) : null}
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
      <label htmlFor={props.id} className="grid gap-1">
        <span className="text-sm font-medium text-foreground">
          {props.title}
        </span>
        <span className="text-sm leading-6 text-muted-foreground">
          {props.description}
        </span>
      </label>
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
    <div className="space-y-1">
      <div className="font-medium text-foreground">{props.title}</div>
      <p className="m-0">{props.detail}</p>
    </div>
  )
}

function createFormValues(client: {
  clientName: string
  description?: string | null
  enabled: boolean
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post'
  allowedScopes: string[] | string
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
