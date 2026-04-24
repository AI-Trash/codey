import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

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
import { StatusBadge, formatAdminDate } from '#/components/admin/layout'
import { m } from '#/paraglide/messages'

export type ManagedSub2ApiService = {
  id: string | null
  kind: 'sub2api'
  enabled: boolean
  configured: boolean
  baseUrl: string
  authMode: 'api_key' | 'bearer_token' | 'password'
  hasApiKey: boolean
  hasBearerToken: boolean
  email: string
  hasPassword: boolean
  loginPath: string
  refreshTokenPath: string
  accountsPath: string
  clientId: string
  proxyId: number | null
  concurrency: number | null
  priority: number | null
  groupIds: number[]
  autoFillRelatedModels: boolean
  confirmMixedChannelRisk: boolean
  openaiOAuthResponsesWebSocketV2Mode: 'off' | 'ctx_pool' | 'passthrough'
  updatedByUserId: string | null
  createdAt: string | Date | null
  updatedAt: string | Date | null
}

type Sub2ApiFormValues = {
  enabled: boolean
  baseUrl: string
  authMode: 'api_key' | 'bearer_token' | 'password'
  apiKey: string
  bearerToken: string
  email: string
  password: string
  loginPath: string
  refreshTokenPath: string
  accountsPath: string
  clientId: string
  proxyId: string
  concurrency: string
  priority: string
  groupIds: string
  autoFillRelatedModels: boolean
  confirmMixedChannelRisk: boolean
  openaiOAuthResponsesWebSocketV2Mode: 'off' | 'ctx_pool' | 'passthrough'
}

export function ExternalServicesPageContent(props: {
  initialSub2Api: ManagedSub2ApiService
}) {
  const [service, setService] = useState(props.initialSub2Api)
  const [form, setForm] = useState(() => toSub2ApiFormValues(props.initialSub2Api))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    setService(props.initialSub2Api)
    setForm(toSub2ApiFormValues(props.initialSub2Api))
  }, [props.initialSub2Api])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/admin/external-services/sub2api', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          enabled: form.enabled,
          baseUrl: form.baseUrl,
          authMode: form.authMode,
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
          ...(form.bearerToken.trim()
            ? { bearerToken: form.bearerToken.trim() }
            : {}),
          email: form.email,
          ...(form.password.trim() ? { password: form.password.trim() } : {}),
          loginPath: form.loginPath,
          refreshTokenPath: form.refreshTokenPath,
          accountsPath: form.accountsPath,
          clientId: form.clientId,
          proxyId: parseOptionalIntegerInput(form.proxyId),
          concurrency: parseOptionalIntegerInput(form.concurrency),
          priority: parseOptionalIntegerInput(form.priority),
          groupIds: parseGroupIds(form.groupIds),
          autoFillRelatedModels: form.autoFillRelatedModels,
          confirmMixedChannelRisk: form.confirmMixedChannelRisk,
          openaiOAuthResponsesWebSocketV2Mode:
            form.openaiOAuthResponsesWebSocketV2Mode,
        }),
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const data = (await response.json()) as {
        service: ManagedSub2ApiService
      }

      setService(data.service)
      setForm(toSub2ApiFormValues(data.service))
      setSuccess(m.external_services_save_success())
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : m.external_services_save_error(),
      )
    } finally {
      setSaving(false)
    }
  }

  const isApiKeyAuth = form.authMode === 'api_key'
  const isBearerAuth = form.authMode === 'bearer_token'

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{m.external_services_sub2api_title()}</CardTitle>
              <StatusBadge
                value={service.enabled ? m.status_enabled() : m.status_disabled()}
              />
              <StatusBadge
                value={
                  service.configured ? m.status_configured() : m.status_missing()
                }
              />
            </div>
            <CardDescription>
              {m.external_services_sub2api_description()}
            </CardDescription>
          </div>
          <Badge variant="outline">
            {m.external_services_field_updated_at()}:{' '}
            {formatAdminDate(service.updatedAt) || m.status_unknown()}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="grid gap-4">
        <Alert>
          <AlertTitle>{m.external_services_sub2api_dispatch_hint_title()}</AlertTitle>
          <AlertDescription>
            {m.external_services_sub2api_dispatch_hint()}
          </AlertDescription>
        </Alert>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
            <Field label={m.external_services_field_base_url()}>
              <Input
                value={form.baseUrl}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setForm((current) => ({ ...current, baseUrl: nextValue }))
                }}
                placeholder="https://sub2api.example.com"
              />
            </Field>

            <Field label={m.external_services_field_auth_mode()}>
              <NativeSelect
                value={form.authMode}
                onChange={(event) => {
                  const nextValue = event.target.value as
                    | 'api_key'
                    | 'bearer_token'
                    | 'password'
                  setForm((current) => ({
                    ...current,
                    authMode: nextValue,
                    apiKey: '',
                    bearerToken: '',
                    password: '',
                  }))
                }}
              >
                <NativeSelectOption value="api_key">
                  {m.external_services_auth_mode_api_key()}
                </NativeSelectOption>
                <NativeSelectOption value="bearer_token">
                  {m.external_services_auth_mode_bearer()}
                </NativeSelectOption>
                <NativeSelectOption value="password">
                  {m.external_services_auth_mode_password()}
                </NativeSelectOption>
              </NativeSelect>
            </Field>
          </div>

          {isApiKeyAuth ? (
            <Field
              label={m.external_services_field_api_key()}
              description={
                service.hasApiKey
                  ? m.external_services_secret_keep_hint()
                  : m.external_services_secret_required_hint()
              }
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={form.apiKey}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setForm((current) => ({
                    ...current,
                    apiKey: nextValue,
                  }))
                }}
                placeholder={m.external_services_field_api_key_placeholder()}
              />
            </Field>
          ) : isBearerAuth ? (
            <Field
              label={m.external_services_field_bearer_token()}
              description={
                service.hasBearerToken
                  ? m.external_services_secret_keep_hint()
                  : m.external_services_secret_required_hint()
              }
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={form.bearerToken}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setForm((current) => ({
                    ...current,
                    bearerToken: nextValue,
                  }))
                }}
                placeholder={m.external_services_field_bearer_token_placeholder()}
              />
            </Field>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label={m.external_services_field_email()}>
                <Input
                  value={form.email}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setForm((current) => ({ ...current, email: nextValue }))
                  }}
                  placeholder="admin@example.com"
                />
              </Field>

              <Field
                label={m.external_services_field_password()}
                description={
                  service.hasPassword
                    ? m.external_services_secret_keep_hint()
                    : m.external_services_secret_required_hint()
                }
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setForm((current) => ({ ...current, password: nextValue }))
                  }}
                  placeholder={m.external_services_field_password_placeholder()}
                />
              </Field>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Field label={m.external_services_field_login_path()}>
              <Input
                value={form.loginPath}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setForm((current) => ({ ...current, loginPath: nextValue }))
                }}
                placeholder="/api/v1/auth/login"
              />
            </Field>

            <Field label={m.external_services_field_refresh_token_path()}>
              <Input
                value={form.refreshTokenPath}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setForm((current) => ({
                    ...current,
                    refreshTokenPath: nextValue,
                  }))
                }}
                placeholder="/api/v1/admin/openai/refresh-token"
              />
            </Field>

            <Field label={m.external_services_field_accounts_path()}>
              <Input
                value={form.accountsPath}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setForm((current) => ({ ...current, accountsPath: nextValue }))
                }}
                placeholder="/api/v1/admin/accounts"
              />
            </Field>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <Field label={m.external_services_field_client_id()}>
              <Input
                value={form.clientId}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setForm((current) => ({ ...current, clientId: nextValue }))
                }}
              />
            </Field>

            <Field label={m.external_services_field_proxy_id()}>
              <Input
                value={form.proxyId}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setForm((current) => ({ ...current, proxyId: nextValue }))
                }}
                inputMode="numeric"
              />
            </Field>

            <Field
              label={m.external_services_field_default_concurrency()}
              description={m.external_services_field_default_concurrency_description()}
            >
              <Input
                value={form.concurrency}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setForm((current) => ({ ...current, concurrency: nextValue }))
                }}
                inputMode="numeric"
              />
            </Field>

            <Field
              label={m.external_services_field_default_priority()}
              description={m.external_services_field_default_priority_description()}
            >
              <Input
                value={form.priority}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setForm((current) => ({ ...current, priority: nextValue }))
                }}
                inputMode="numeric"
              />
            </Field>

            <Field
              label={m.external_services_field_group_ids()}
              description={m.external_services_field_group_ids_description()}
            >
              <Input
                value={form.groupIds}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setForm((current) => ({ ...current, groupIds: nextValue }))
                }}
                placeholder={m.external_services_field_group_ids_placeholder()}
              />
            </Field>

            <Field
              label={m.external_services_field_openai_ws_mode()}
              description={m.external_services_field_openai_ws_mode_description()}
            >
              <NativeSelect
                value={form.openaiOAuthResponsesWebSocketV2Mode}
                onChange={(event) => {
                  const nextValue = event.target.value as Sub2ApiFormValues['openaiOAuthResponsesWebSocketV2Mode']
                  setForm((current) => ({
                    ...current,
                    openaiOAuthResponsesWebSocketV2Mode: nextValue,
                  }))
                }}
              >
                <NativeSelectOption value="off">
                  {m.external_services_openai_ws_mode_off()}
                </NativeSelectOption>
                <NativeSelectOption value="ctx_pool">
                  {m.external_services_openai_ws_mode_ctx_pool()}
                </NativeSelectOption>
                <NativeSelectOption value="passthrough">
                  {m.external_services_openai_ws_mode_passthrough()}
                </NativeSelectOption>
              </NativeSelect>
            </Field>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <CheckboxRow
              checked={form.autoFillRelatedModels}
              label={m.external_services_toggle_auto_fill_related_models_title()}
              description={m.external_services_toggle_auto_fill_related_models_description()}
              onCheckedChange={(checked) => {
                setForm((current) => ({
                  ...current,
                  autoFillRelatedModels: checked,
                }))
              }}
              disabled={saving}
            />

            <CheckboxRow
              checked={form.enabled}
              label={m.external_services_toggle_enabled_title()}
              description={m.external_services_toggle_enabled_description()}
              onCheckedChange={(checked) => {
                setForm((current) => ({ ...current, enabled: checked }))
              }}
              disabled={saving}
            />

            <CheckboxRow
              checked={form.confirmMixedChannelRisk}
              label={m.external_services_toggle_confirm_risk_title()}
              description={m.external_services_toggle_confirm_risk_description()}
              onCheckedChange={(checked) => {
                setForm((current) => ({
                  ...current,
                  confirmMixedChannelRisk: checked,
                }))
              }}
              disabled={saving}
            />
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{m.external_services_save_failed_title()}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {success ? (
            <Alert>
              <AlertTitle>{m.oauth_saved_title()}</AlertTitle>
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? m.oauth_saving() : m.external_services_save_button()}
            </Button>
          </div>
        </form>
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
        <span className="text-sm text-muted-foreground">{props.description}</span>
      ) : null}
    </label>
  )
}

function CheckboxRow(props: {
  checked: boolean
  label: string
  description: string
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-4">
      <Checkbox
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={(checked) => {
          props.onCheckedChange(checked === true)
        }}
        className="mt-0.5"
      />
      <div className="grid gap-1">
        <div className="text-sm font-medium text-foreground">{props.label}</div>
        <p className="text-sm text-muted-foreground">{props.description}</p>
      </div>
    </div>
  )
}

function toSub2ApiFormValues(
  service: ManagedSub2ApiService,
): Sub2ApiFormValues {
  return {
    enabled: service.enabled,
    baseUrl: service.baseUrl,
    authMode: service.authMode,
    apiKey: '',
    bearerToken: '',
    email: service.email,
    password: '',
    loginPath: service.loginPath,
    refreshTokenPath: service.refreshTokenPath,
    accountsPath: service.accountsPath,
    clientId: service.clientId,
    proxyId: service.proxyId == null ? '' : String(service.proxyId),
    concurrency: service.concurrency == null ? '' : String(service.concurrency),
    priority: service.priority == null ? '' : String(service.priority),
    groupIds: service.groupIds.join(', '),
    autoFillRelatedModels: service.autoFillRelatedModels,
    confirmMixedChannelRisk: service.confirmMixedChannelRisk,
    openaiOAuthResponsesWebSocketV2Mode:
      service.openaiOAuthResponsesWebSocketV2Mode || 'off',
  }
}

function parseOptionalIntegerInput(value: string): number | null {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  return Number.parseInt(normalized, 10)
}

function parseGroupIds(value: string): number[] | null {
  const normalized = value
    .split(',')
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isInteger(entry) && entry > 0)

  return normalized.length ? normalized : null
}
