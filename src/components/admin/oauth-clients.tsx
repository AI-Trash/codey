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
        <CardDescription>Admin</CardDescription>
        <CardTitle className="text-2xl">Admin sign-in required</CardTitle>
        <CardDescription className="max-w-xl text-sm leading-6">
          Sign in with GitHub to manage OAuth clients and access the operator
          console.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <a href="/admin/login">Go to admin login</a>
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
        title="No OAuth clients yet"
        description="Create the first app to issue client credentials or support device flow."
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
        <Badge variant="outline">{clients.length} total</Badge>
        <Badge variant="outline">{enabledCount} enabled</Badge>
        <Badge variant="outline">{deviceFlowCount} device flow</Badge>
      </div>

      <Table className="min-w-[1080px]">
        <TableHeader>
          <TableRow>
            <TableHead>App</TableHead>
            <TableHead>Client ID</TableHead>
            <TableHead>Grants</TableHead>
            <TableHead>Scopes</TableHead>
            <TableHead>Secret</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="text-right">Actions</TableHead>
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
                    {client.description || 'No description added yet.'}
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
                      No scopes
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="align-top">
                <div className="space-y-1">
                  <code>{client.clientSecretPreview}...</code>
                  <p className="text-xs text-muted-foreground">
                    Rotated{' '}
                    {formatAdminDate(client.clientSecretUpdatedAt) ||
                      'recently'}
                  </p>
                </div>
              </TableCell>
              <TableCell className="align-top">
                <StatusBadge value={client.enabled ? 'Enabled' : 'Disabled'} />
              </TableCell>
              <TableCell className="align-top text-sm text-muted-foreground">
                {formatAdminDate(client.updatedAt) || 'Recently'}
              </TableCell>
              <TableCell className="align-top text-right">
                <Button asChild size="sm">
                  <a href={`/admin/apps/${client.id}`}>Edit app</a>
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
          : 'Unable to create OAuth client',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_380px]">
      <Card>
        <CardHeader>
          <CardDescription>Registration</CardDescription>
          <CardTitle>Create a managed OAuth app</CardTitle>
          <CardDescription>
            Create the client, define the grant types, and make the supported
            scopes explicit before handing the secret to a caller.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OAuthClientForm
            form={form}
            submitting={submitting}
            submitLabel="Create OAuth app"
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
            <CardDescription>Practical defaults</CardDescription>
            <CardTitle className="text-lg">What to enable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
            <InfoBlock
              title="Client credentials"
              detail="Use this when the caller can safely hold a secret and does not need an operator browser step."
            />
            <InfoBlock
              title="Device flow"
              detail="Use this when a CLI or daemon needs an approval handoff into the browser."
            />
            <InfoBlock
              title="Secret handling"
              detail="The full secret is shown once after registration. Save it in the calling app immediately."
            />
          </CardContent>
        </Card>

        {created ? (
          <SecretPanel
            title="OAuth app created"
            body="This secret is only shown here after registration. Copy it into the calling app before leaving the page."
            clientId={created.client.clientId}
            secret={created.clientSecret}
            preview={created.client.clientSecretPreview}
            footer={
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href={`/admin/apps/${created.client.id}`}>
                    Open app settings
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href="/admin/apps">Back to apps</a>
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
          ? 'OAuth app updated and secret rotated.'
          : 'OAuth app settings saved.',
      )
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Unable to update OAuth client',
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
      setSuccess('Current client secret revealed.')
    } catch (revealError) {
      setError(
        revealError instanceof Error
          ? revealError.message
          : 'Unable to reveal client secret',
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
              <CardDescription>OAuth app settings</CardDescription>
              <CardTitle>{client.clientName}</CardTitle>
            </div>
            <StatusBadge value={client.enabled ? 'Enabled' : 'Disabled'} />
          </div>
          <CardDescription>
            Update app metadata, adjust grants, and change secret state without
            leaving the management view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OAuthClientForm
            form={form}
            submitting={saving}
            submitLabel="Save app settings"
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
                {saving ? 'Saving...' : 'Save app settings'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving || revealing}
                onClick={() => {
                  void saveClient(true)
                }}
              >
                {saving ? 'Updating...' : 'Rotate secret'}
              </Button>
            </div>
          </OAuthClientForm>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardDescription>Client summary</CardDescription>
            <CardTitle className="text-lg">Current state</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm text-muted-foreground">
              <SummaryItem label="Client ID" value={client.clientId} code />
              <SummaryItem
                label="Auth method"
                value={formatAuthMethod(client.tokenEndpointAuthMethod)}
              />
              <SummaryItem
                label="Enabled grants"
                value={grantSummary || 'None'}
              />
              <SummaryItem
                label="Allowed scopes"
                value={client.allowedScopes.join(', ') || 'None'}
              />
              <SummaryItem
                label="Updated"
                value={formatAdminDate(client.updatedAt) || 'Recently'}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Secret state</CardDescription>
            <CardTitle className="text-lg">Reveal or rotate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                value={`Preview ${client.clientSecretPreview}`}
                tone="good"
              />
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              Reveal the current secret when you need to reconfigure an existing
              caller, or rotate it to invalidate the previous one.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={saving || revealing}
              onClick={() => {
                void revealSecret()
              }}
            >
              {revealing ? 'Revealing...' : 'Reveal current secret'}
            </Button>
          </CardContent>
        </Card>

        {visibleSecret ? (
          <SecretPanel
            title="Client secret"
            body="Treat this like a password. Copy it into the calling app, then rotate it if you suspect it has leaked."
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
      <Field label="Client name">
        <Input
          value={form.clientName}
          onChange={(event) => {
            const nextValue = event.target.value
            onChange((current) => ({ ...current, clientName: nextValue }))
          }}
          placeholder="CLI daemon"
          required
        />
      </Field>

      <Field label="Description">
        <Textarea
          value={form.description}
          onChange={(event) => {
            const nextValue = event.target.value
            onChange((current) => ({ ...current, description: nextValue }))
          }}
          placeholder="What this app is for"
          className="min-h-28"
        />
      </Field>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
        <Field label="Token endpoint auth method">
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
          title="Enabled"
          description="Disable the app without deleting its configuration."
          checked={form.enabled}
          onCheckedChange={(checked) => {
            onChange((current) => ({ ...current, enabled: checked }))
          }}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ToggleCard
          id={clientCredentialsId}
          title="Enable client credentials"
          description="Allow token exchange with the app secret and no browser step."
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
          title="Enable device flow"
          description="Allow user-code sign-in flows that finish with an admin-approved browser step."
          checked={form.deviceFlowEnabled}
          onCheckedChange={(checked) => {
            onChange((current) => ({ ...current, deviceFlowEnabled: checked }))
          }}
        />
      </div>

      <Field
        label="Allowed scopes"
        description={`One scope per line. Supported in this app: ${supportedScopes.join(', ')}.`}
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
          <AlertTitle>Grant type required</AlertTitle>
          <AlertDescription>
            Enable at least one grant type before saving the OAuth app.
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
          <AlertTitle>Unable to save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {success ? (
        <Alert>
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      {children || (
        <Button type="submit" disabled={submitting || !hasGrantEnabled}>
          {submitting ? 'Saving...' : submitLabel}
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
            <CardDescription>Secret preview</CardDescription>
            <CardTitle className="text-lg">{title}</CardTitle>
          </div>
          <StatusBadge value={preview} tone="good" />
        </div>
        <CardDescription className="text-sm leading-6">{body}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SummaryItem label="Client ID" value={clientId} code />
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
