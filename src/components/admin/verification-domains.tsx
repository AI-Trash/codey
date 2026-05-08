import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

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
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { EmptyState, formatAdminDate } from '#/components/admin/layout'
import { getToastErrorDescription, showAppToast } from '#/lib/toast'
import { m } from '#/paraglide/messages'

export type ManagedVerificationDomain = {
  id: string
  domain: string
  mailboxType: VerificationMailboxType
  mailboxPrefix: string | null
  description: string | null
  registrationEnabled: boolean
  isDefault: boolean
  appCount: number
  createdAt: string | Date
  updatedAt: string | Date
}

type VerificationMailboxType = 'cloudflare' | 'outlook'

type VerificationDomainFormValues = {
  domain: string
  mailboxType: VerificationMailboxType
  mailboxPrefix: string
  description: string
  registrationEnabled: boolean
  isDefault: boolean
}

export function VerificationDomainsPageContent({
  initialDomains,
  createdDomain,
}: {
  initialDomains: ManagedVerificationDomain[]
  createdDomain?: ManagedVerificationDomain | null
}) {
  const [domains, setDomains] = useState(() => sortDomains(initialDomains))

  useEffect(() => {
    setDomains(sortDomains(initialDomains))
  }, [initialDomains])

  useEffect(() => {
    if (!createdDomain) {
      return
    }

    setDomains((current) =>
      sortDomains(
        mergeUpdatedDomain([createdDomain, ...current], createdDomain),
      ),
    )
  }, [createdDomain])

  function handleDomainUpdated(updatedDomain: ManagedVerificationDomain) {
    setDomains((current) =>
      sortDomains(mergeUpdatedDomain(current, updatedDomain)),
    )
  }

  return (
    <div className="grid gap-4">
      {domains.length ? (
        domains.map((domain) => (
          <VerificationDomainCard
            key={domain.id}
            domain={domain}
            onUpdated={handleDomainUpdated}
          />
        ))
      ) : (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              title={m.domain_empty_title()}
              description={m.domain_empty_description()}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export function CreateVerificationDomainDialog({
  open,
  onOpenChange,
  hasExistingDomains,
  onDomainCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hasExistingDomains: boolean
  onDomainCreated?: (domain: ManagedVerificationDomain) => void
}) {
  const [form, setForm] = useState<VerificationDomainFormValues>(() =>
    createNewVerificationDomainFormValues(hasExistingDomains),
  )
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open) {
      return
    }

    setForm(createNewVerificationDomainFormValues(hasExistingDomains))
    setCreating(false)
  }, [open, hasExistingDomains])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreating(true)

    try {
      const response = await fetch('/api/admin/verification-domains', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          domain: form.domain,
          mailboxType: form.mailboxType,
          mailboxPrefix: form.mailboxPrefix.trim() || null,
          description: form.description.trim() || undefined,
          registrationEnabled: form.registrationEnabled,
          isDefault: form.isDefault,
        }),
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const data = (await response.json()) as {
        domain: ManagedVerificationDomain
      }

      onDomainCreated?.(data.domain)
      onOpenChange(false)
    } catch (createError) {
      showAppToast({
        kind: 'error',
        title: m.domain_save_failed_title(),
        description: getToastErrorDescription(
          createError,
          m.domain_create_error(),
        ),
      })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[min(720px,calc(100%-2rem))] overflow-y-auto sm:max-w-[min(720px,calc(100%-2rem))]">
        <DialogHeader>
          <DialogDescription>{m.domain_create_kicker()}</DialogDescription>
          <DialogTitle>{m.domain_create_title()}</DialogTitle>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleCreate}>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Field label={m.domain_field_type()}>
              <NativeSelect
                value={form.mailboxType}
                onChange={(event) => {
                  const nextValue = normalizeMailboxType(event.target.value)
                  setForm((current) => ({
                    ...current,
                    mailboxType: nextValue,
                  }))
                }}
                className="w-full"
              >
                <NativeSelectOption value="cloudflare">
                  {m.domain_type_cloudflare()}
                </NativeSelectOption>
                <NativeSelectOption value="outlook">
                  {m.domain_type_outlook()}
                </NativeSelectOption>
              </NativeSelect>
            </Field>

            <Field label={m.domain_field_domain()}>
              <Input
                value={form.domain}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setForm((current) => ({ ...current, domain: nextValue }))
                }}
                placeholder={getMailboxAddressPlaceholder(form.mailboxType)}
                required
              />
            </Field>
          </div>

          <FieldDescription>
            {getMailboxTypeDescription(form.mailboxType)}
          </FieldDescription>

          <Field label={m.domain_field_mailbox_prefix()}>
            <Input
              value={form.mailboxPrefix}
              onChange={(event) => {
                const nextValue = event.target.value
                setForm((current) => ({
                  ...current,
                  mailboxPrefix: nextValue,
                }))
              }}
              placeholder={m.domain_field_mailbox_prefix_placeholder()}
            />
          </Field>

          <Field label={m.domain_field_description()}>
            <Textarea
              value={form.description}
              onChange={(event) => {
                const nextValue = event.target.value
                setForm((current) => ({
                  ...current,
                  description: nextValue,
                }))
              }}
              placeholder={m.domain_field_description_placeholder()}
              className="min-h-24"
            />
          </Field>

          <CheckboxRow
            checked={form.registrationEnabled}
            label={m.domain_toggle_registration_enabled_title()}
            description={m.domain_toggle_registration_enabled_description()}
            onCheckedChange={(checked) => {
              setForm((current) => ({
                ...current,
                registrationEnabled: checked,
              }))
            }}
            disabled={creating}
          />

          <CheckboxRow
            checked={form.isDefault}
            label={m.domain_toggle_default_title()}
            description={m.domain_toggle_default_description()}
            onCheckedChange={(checked) => {
              setForm((current) => ({ ...current, isDefault: checked }))
            }}
            disabled={creating}
          />

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={creating}>
              {creating ? m.domain_creating() : m.domain_create_submit()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function VerificationDomainCard({
  domain,
  onUpdated,
}: {
  domain: ManagedVerificationDomain
  onUpdated: (domain: ManagedVerificationDomain) => void
}) {
  const [form, setForm] = useState(() => toFormValues(domain))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm(toFormValues(domain))
  }, [domain])

  async function saveDomain(overrides?: Partial<VerificationDomainFormValues>) {
    setSaving(true)

    try {
      const payload = {
        domain: overrides?.domain ?? form.domain,
        mailboxType: overrides?.mailboxType ?? form.mailboxType,
        mailboxPrefix:
          (overrides?.mailboxPrefix ?? form.mailboxPrefix).trim() || null,
        description:
          (overrides?.description ?? form.description).trim() || undefined,
        registrationEnabled:
          overrides?.registrationEnabled ?? form.registrationEnabled,
        isDefault: overrides?.isDefault,
      }

      const response = await fetch(
        `/api/admin/verification-domains/${domain.id}`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      )

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const data = (await response.json()) as {
        domain: ManagedVerificationDomain
      }

      onUpdated(data.domain)
      showAppToast({
        kind: 'success',
        title: m.oauth_saved_title(),
        description: overrides?.isDefault
          ? m.domain_set_default_success()
          : m.domain_update_success(),
      })
    } catch (saveError) {
      showAppToast({
        kind: 'error',
        title: m.domain_save_failed_title(),
        description: getToastErrorDescription(
          saveError,
          m.domain_update_error(),
        ),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-lg">{domain.domain}</CardTitle>
              <Badge variant="secondary">
                {getMailboxTypeLabel(domain.mailboxType)}
              </Badge>
              {domain.isDefault ? (
                <Badge>{m.domain_badge_default()}</Badge>
              ) : null}
              <Badge variant="outline">
                {domain.registrationEnabled
                  ? m.domain_badge_registration_enabled()
                  : m.domain_badge_registration_excluded()}
              </Badge>
            </div>
            <CardDescription>
              {domain.description || m.domain_no_description()}
            </CardDescription>
          </div>
          {domain.appCount > 0 ? (
            <Badge variant="outline">
              {m.domain_badge_app_count({ count: String(domain.appCount) })}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,200px)_minmax(0,1fr)_minmax(0,240px)_220px]">
          <Field label={m.domain_field_type()}>
            <NativeSelect
              value={form.mailboxType}
              onChange={(event) => {
                const nextValue = normalizeMailboxType(event.target.value)
                setForm((current) => ({
                  ...current,
                  mailboxType: nextValue,
                }))
              }}
              className="w-full"
            >
              <NativeSelectOption value="cloudflare">
                {m.domain_type_cloudflare()}
              </NativeSelectOption>
              <NativeSelectOption value="outlook">
                {m.domain_type_outlook()}
              </NativeSelectOption>
            </NativeSelect>
          </Field>

          <Field label={m.domain_field_domain()}>
            <Input
              value={form.domain}
              onChange={(event) => {
                const nextValue = event.target.value
                setForm((current) => ({ ...current, domain: nextValue }))
              }}
              placeholder={getMailboxAddressPlaceholder(form.mailboxType)}
            />
          </Field>

          <Field label={m.domain_field_mailbox_prefix()}>
            <Input
              value={form.mailboxPrefix}
              onChange={(event) => {
                const nextValue = event.target.value
                setForm((current) => ({
                  ...current,
                  mailboxPrefix: nextValue,
                }))
              }}
              placeholder={m.domain_field_mailbox_prefix_placeholder()}
            />
          </Field>

          <Field label={m.domain_field_updated_at()}>
            <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
              {formatAdminDate(domain.updatedAt) || m.oauth_clients_recently()}
            </div>
          </Field>
        </div>

        <FieldDescription>
          {getMailboxTypeDescription(form.mailboxType)}
        </FieldDescription>

        <Field label={m.domain_field_description()}>
          <Textarea
            value={form.description}
            onChange={(event) => {
              const nextValue = event.target.value
              setForm((current) => ({ ...current, description: nextValue }))
            }}
            className="min-h-24"
          />
        </Field>

        <div className="grid gap-3 lg:grid-cols-2">
          <CheckboxRow
            checked={form.registrationEnabled}
            label={m.domain_toggle_registration_enabled_title()}
            description={m.domain_toggle_registration_enabled_description()}
            onCheckedChange={(checked) => {
              setForm((current) => ({
                ...current,
                registrationEnabled: checked,
              }))
            }}
          />

          <CheckboxRow
            checked={domain.isDefault}
            label={m.domain_toggle_default_title()}
            description={m.domain_toggle_default_description()}
            onCheckedChange={(checked) => {
              if (checked && !domain.isDefault) {
                void saveDomain({ isDefault: true })
              }
            }}
            disabled={domain.isDefault || saving}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={saving}
            onClick={() => {
              void saveDomain()
            }}
          >
            {saving ? m.oauth_saving() : m.domain_update_submit()}
          </Button>
          {!domain.isDefault ? (
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                void saveDomain({ isDefault: true })
              }}
            >
              {m.domain_set_default_submit()}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-foreground">{props.label}</span>
      {props.children}
    </label>
  )
}

function FieldDescription(props: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{props.children}</p>
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

function toFormValues(
  domain: ManagedVerificationDomain,
): VerificationDomainFormValues {
  return {
    domain: domain.domain,
    mailboxType: domain.mailboxType,
    mailboxPrefix: domain.mailboxPrefix || '',
    description: domain.description || '',
    registrationEnabled: domain.registrationEnabled,
    isDefault: domain.isDefault,
  }
}

function createNewVerificationDomainFormValues(
  hasExistingDomains: boolean,
): VerificationDomainFormValues {
  return {
    domain: '',
    mailboxType: 'cloudflare',
    mailboxPrefix: '',
    description: '',
    registrationEnabled: true,
    isDefault: !hasExistingDomains,
  }
}

function normalizeMailboxType(value: string): VerificationMailboxType {
  return value === 'outlook' ? 'outlook' : 'cloudflare'
}

function getMailboxTypeLabel(type: VerificationMailboxType) {
  return type === 'outlook'
    ? m.domain_type_outlook()
    : m.domain_type_cloudflare()
}

function getMailboxTypeDescription(type: VerificationMailboxType) {
  return type === 'outlook'
    ? m.domain_type_outlook_description()
    : m.domain_type_cloudflare_description()
}

function getMailboxAddressPlaceholder(type: VerificationMailboxType) {
  return type === 'outlook'
    ? m.domain_field_outlook_mailbox_placeholder()
    : m.domain_field_domain_placeholder()
}

function sortDomains(domains: ManagedVerificationDomain[]) {
  return [...domains].sort((left, right) => {
    if (left.isDefault !== right.isDefault) {
      return left.isDefault ? -1 : 1
    }

    if (left.registrationEnabled !== right.registrationEnabled) {
      return left.registrationEnabled ? -1 : 1
    }

    return left.domain.localeCompare(right.domain)
  })
}

function mergeUpdatedDomain(
  domains: ManagedVerificationDomain[],
  updatedDomain: ManagedVerificationDomain,
) {
  const deduped = domains.filter((domain) => domain.id !== updatedDomain.id)
  const nextDomains = [...deduped, updatedDomain]

  if (!updatedDomain.isDefault) {
    return nextDomains
  }

  return nextDomains.map((domain) =>
    domain.id === updatedDomain.id ? domain : { ...domain, isDefault: false },
  )
}
