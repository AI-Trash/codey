import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Trash2Icon } from 'lucide-react'

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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import { Textarea } from '#/components/ui/textarea'
import { EmptyState, formatAdminDate } from '#/components/admin/layout'
import { getToastErrorDescription, showAppToast } from '#/lib/toast'
import { m } from '#/paraglide/messages'

export type ProxyNodeProtocol =
  | 'hysteria2'
  | 'trojan'
  | 'vless'
  | 'socks'
  | 'http'

export type ManagedProxyNode = {
  id: string
  name: string
  tag: string
  protocol: ProxyNodeProtocol
  server: string
  serverPort: number
  username: string | null
  hasPassword: boolean
  passwordPreview: string | null
  vlessFlow: string | null
  tlsServerName: string | null
  tlsInsecure: boolean
  description: string | null
  enabled: boolean
  updatedByUserId: string | null
  createdAt: string | Date
  updatedAt: string | Date
}

type ProxyNodeFormValues = {
  name: string
  tag: string
  protocol: ProxyNodeProtocol
  server: string
  serverPort: string
  username: string
  password: string
  vlessFlow: string
  tlsServerName: string
  tlsInsecure: boolean
  description: string
  enabled: boolean
}

export function ProxyNodesPageContent({
  initialNodes,
  createdNode,
}: {
  initialNodes: ManagedProxyNode[]
  createdNode?: ManagedProxyNode | null
}) {
  const [nodes, setNodes] = useState(() => sortProxyNodes(initialNodes))

  useEffect(() => {
    setNodes(sortProxyNodes(initialNodes))
  }, [initialNodes])

  useEffect(() => {
    if (!createdNode) {
      return
    }

    setNodes((current) =>
      sortProxyNodes(
        mergeUpdatedProxyNode([createdNode, ...current], createdNode),
      ),
    )
  }, [createdNode])

  function handleNodeUpdated(updatedNode: ManagedProxyNode) {
    setNodes((current) =>
      sortProxyNodes(mergeUpdatedProxyNode(current, updatedNode)),
    )
  }

  function handleNodeDeleted(nodeId: string) {
    setNodes((current) => current.filter((node) => node.id !== nodeId))
  }

  return (
    <div className="grid gap-4">
      {nodes.length ? (
        nodes.map((node) => (
          <ProxyNodeCard
            key={node.id}
            node={node}
            onUpdated={handleNodeUpdated}
            onDeleted={handleNodeDeleted}
          />
        ))
      ) : (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              title={m.proxy_nodes_empty_title()}
              description={m.proxy_nodes_empty_description()}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export function CreateProxyNodeDialog({
  open,
  onOpenChange,
  onNodeCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNodeCreated?: (node: ManagedProxyNode) => void
}) {
  const [form, setForm] = useState(createNewProxyNodeFormValues)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open) {
      return
    }

    setForm(createNewProxyNodeFormValues())
    setCreating(false)
  }, [open])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreating(true)

    try {
      const response = await fetch('/api/admin/proxy-nodes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(toProxyNodePayload(form, true)),
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const data = (await response.json()) as { node: ManagedProxyNode }
      onNodeCreated?.(data.node)
      onOpenChange(false)
    } catch (createError) {
      showAppToast({
        kind: 'error',
        title: m.proxy_nodes_save_failed_title(),
        description: getToastErrorDescription(
          createError,
          m.proxy_nodes_create_error(),
        ),
      })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[min(760px,calc(100%-2rem))] overflow-y-auto sm:max-w-[min(760px,calc(100%-2rem))]">
        <DialogHeader>
          <DialogDescription>{m.proxy_nodes_create_kicker()}</DialogDescription>
          <DialogTitle>{m.proxy_nodes_create_title()}</DialogTitle>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleCreate}>
          <ProxyNodeForm
            form={form}
            onChange={setForm}
            disabled={creating}
            requirePassword
          />

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={creating}>
              {creating
                ? m.proxy_nodes_creating()
                : m.proxy_nodes_create_submit()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProxyNodeCard({
  node,
  onUpdated,
  onDeleted,
}: {
  node: ManagedProxyNode
  onUpdated: (node: ManagedProxyNode) => void
  onDeleted: (nodeId: string) => void
}) {
  const [form, setForm] = useState(() => toFormValues(node))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setForm(toFormValues(node))
  }, [node])

  async function saveNode(overrides?: Partial<ProxyNodeFormValues>) {
    setSaving(true)

    try {
      const response = await fetch(`/api/admin/proxy-nodes/${node.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(
          toProxyNodePayload(
            {
              ...form,
              ...overrides,
            },
            false,
          ),
        ),
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const data = (await response.json()) as { node: ManagedProxyNode }
      onUpdated(data.node)
      showAppToast({
        kind: 'success',
        title: m.oauth_saved_title(),
        description: m.proxy_nodes_update_success(),
      })
    } catch (saveError) {
      showAppToast({
        kind: 'error',
        title: m.proxy_nodes_save_failed_title(),
        description: getToastErrorDescription(
          saveError,
          m.proxy_nodes_update_error(),
        ),
      })
    } finally {
      setSaving(false)
    }
  }

  async function deleteNode() {
    const confirmed = window.confirm(m.proxy_nodes_delete_confirm())
    if (!confirmed) {
      return
    }

    setDeleting(true)

    try {
      const response = await fetch(`/api/admin/proxy-nodes/${node.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      onDeleted(node.id)
      showAppToast({
        kind: 'success',
        title: m.proxy_nodes_delete_success(),
      })
    } catch (deleteError) {
      showAppToast({
        kind: 'error',
        title: m.proxy_nodes_save_failed_title(),
        description: getToastErrorDescription(
          deleteError,
          m.proxy_nodes_delete_error(),
        ),
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-lg">{node.name}</CardTitle>
              <Badge>{node.tag}</Badge>
              <Badge variant="outline">{node.protocol}</Badge>
              <Badge variant="outline">
                {node.enabled ? m.status_enabled() : m.status_disabled()}
              </Badge>
            </div>
            <CardDescription>
              {node.description || m.proxy_nodes_no_description()}
            </CardDescription>
          </div>
          <Badge variant="outline">
            {m.proxy_nodes_field_updated_at()}:{' '}
            {formatAdminDate(node.updatedAt) || m.status_unknown()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ProxyNodeForm
          form={form}
          onChange={setForm}
          disabled={saving}
          requirePassword={!node.hasPassword}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={saving || deleting}
            onClick={() => {
              void saveNode()
            }}
          >
            {saving ? m.oauth_saving() : m.proxy_nodes_update_submit()}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving || deleting}
            onClick={() => {
              void saveNode({ enabled: !form.enabled })
            }}
          >
            {form.enabled
              ? m.proxy_nodes_disable_submit()
              : m.proxy_nodes_enable_submit()}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={saving || deleting}
            onClick={() => {
              void deleteNode()
            }}
          >
            <Trash2Icon />
            {deleting
              ? m.proxy_nodes_deleting()
              : m.proxy_nodes_delete_submit()}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ProxyNodeForm(props: {
  form: ProxyNodeFormValues
  onChange: (next: ProxyNodeFormValues) => void
  disabled?: boolean
  requirePassword?: boolean
}) {
  const { form, onChange } = props
  const supportsUsername =
    form.protocol !== 'hysteria2' && form.protocol !== 'trojan'
  const supportsPassword = form.protocol !== 'vless'
  const supportsTls =
    form.protocol === 'hysteria2' ||
    form.protocol === 'trojan' ||
    form.protocol === 'vless'
  const isVless = form.protocol === 'vless'

  function patch(values: Partial<ProxyNodeFormValues>) {
    onChange({
      ...form,
      ...values,
    })
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
        <Field label={m.proxy_nodes_field_name()}>
          <Input
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder={m.proxy_nodes_field_name_placeholder()}
            required
            disabled={props.disabled}
          />
        </Field>

        <Field label={m.proxy_nodes_field_tag()}>
          <Input
            value={form.tag}
            onChange={(event) => patch({ tag: event.target.value })}
            placeholder={m.proxy_nodes_field_tag_placeholder()}
            required
            disabled={props.disabled}
          />
        </Field>

        <Field label={m.proxy_nodes_field_protocol()}>
          <NativeSelect
            value={form.protocol}
            onChange={(event) =>
              patch({ protocol: event.target.value as ProxyNodeProtocol })
            }
            disabled={props.disabled}
            className="w-full"
          >
            <NativeSelectOption value="hysteria2">hysteria2</NativeSelectOption>
            <NativeSelectOption value="trojan">trojan</NativeSelectOption>
            <NativeSelectOption value="vless">vless</NativeSelectOption>
            <NativeSelectOption value="socks">socks</NativeSelectOption>
            <NativeSelectOption value="http">http</NativeSelectOption>
          </NativeSelect>
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_160px]">
        <Field label={m.proxy_nodes_field_server()}>
          <Input
            value={form.server}
            onChange={(event) => patch({ server: event.target.value })}
            placeholder={m.proxy_nodes_field_server_placeholder()}
            required
            disabled={props.disabled}
          />
        </Field>

        <Field label={m.proxy_nodes_field_port()}>
          <Input
            value={form.serverPort}
            onChange={(event) => patch({ serverPort: event.target.value })}
            placeholder="443"
            inputMode="numeric"
            required
            disabled={props.disabled}
          />
        </Field>
      </div>

      <div
        className={
          supportsUsername && supportsPassword
            ? 'grid gap-4 lg:grid-cols-2'
            : 'grid gap-4'
        }
      >
        {supportsUsername ? (
          <Field
            label={
              isVless
                ? m.proxy_nodes_field_uuid()
                : m.proxy_nodes_field_username()
            }
          >
            <Input
              value={form.username}
              onChange={(event) => patch({ username: event.target.value })}
              placeholder={
                isVless
                  ? m.proxy_nodes_field_uuid_placeholder()
                  : m.proxy_nodes_field_username_placeholder()
              }
              required={isVless}
              disabled={props.disabled}
            />
          </Field>
        ) : null}

        {supportsPassword ? (
          <Field label={m.proxy_nodes_field_password()}>
            <Input
              value={form.password}
              onChange={(event) => patch({ password: event.target.value })}
              placeholder={m.proxy_nodes_field_password_placeholder()}
              type="password"
              required={Boolean(
                props.requirePassword && form.protocol === 'trojan',
              )}
              disabled={props.disabled}
            />
          </Field>
        ) : null}
      </div>

      {isVless ? (
        <Field label={m.proxy_nodes_field_vless_flow()}>
          <NativeSelect
            value={form.vlessFlow}
            onChange={(event) => patch({ vlessFlow: event.target.value })}
            disabled={props.disabled}
            className="w-full"
          >
            <NativeSelectOption value="">
              {m.proxy_nodes_field_vless_flow_none()}
            </NativeSelectOption>
            <NativeSelectOption value="xtls-rprx-vision">
              xtls-rprx-vision
            </NativeSelectOption>
          </NativeSelect>
        </Field>
      ) : null}

      {supportsTls ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <Field label={m.proxy_nodes_field_tls_server_name()}>
            <Input
              value={form.tlsServerName}
              onChange={(event) => patch({ tlsServerName: event.target.value })}
              placeholder={m.proxy_nodes_field_tls_server_name_placeholder()}
              disabled={props.disabled}
            />
          </Field>

          <CheckboxRow
            checked={form.tlsInsecure}
            label={m.proxy_nodes_toggle_tls_insecure_title()}
            description={m.proxy_nodes_toggle_tls_insecure_description()}
            onCheckedChange={(checked) => patch({ tlsInsecure: checked })}
            disabled={props.disabled}
          />
        </div>
      ) : null}

      <Field label={m.proxy_nodes_field_description()}>
        <Textarea
          value={form.description}
          onChange={(event) => patch({ description: event.target.value })}
          placeholder={m.proxy_nodes_field_description_placeholder()}
          className="min-h-24"
          disabled={props.disabled}
        />
      </Field>

      <CheckboxRow
        checked={form.enabled}
        label={m.proxy_nodes_toggle_enabled_title()}
        description={m.proxy_nodes_toggle_enabled_description()}
        onCheckedChange={(checked) => patch({ enabled: checked })}
        disabled={props.disabled}
      />
    </div>
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

function toFormValues(node: ManagedProxyNode): ProxyNodeFormValues {
  return {
    name: node.name,
    tag: node.tag,
    protocol: node.protocol,
    server: node.server,
    serverPort: String(node.serverPort),
    username: node.username || '',
    password: '',
    vlessFlow: node.vlessFlow || '',
    tlsServerName: node.tlsServerName || '',
    tlsInsecure: node.tlsInsecure,
    description: node.description || '',
    enabled: node.enabled,
  }
}

function createNewProxyNodeFormValues(): ProxyNodeFormValues {
  return {
    name: '',
    tag: '',
    protocol: 'hysteria2',
    server: '',
    serverPort: '443',
    username: '',
    password: '',
    vlessFlow: '',
    tlsServerName: '',
    tlsInsecure: false,
    description: '',
    enabled: true,
  }
}

function toProxyNodePayload(
  form: ProxyNodeFormValues,
  includeEmptyPassword: boolean,
) {
  return {
    name: form.name,
    tag: form.tag,
    protocol: form.protocol,
    server: form.server,
    serverPort: Number(form.serverPort),
    username:
      form.protocol === 'hysteria2' || form.protocol === 'trojan'
        ? null
        : form.username.trim() || null,
    ...(includeEmptyPassword || form.password.trim()
      ? { password: form.password.trim() || null }
      : {}),
    vlessFlow: form.protocol === 'vless' ? form.vlessFlow.trim() || null : null,
    tlsServerName: form.tlsServerName.trim() || null,
    tlsInsecure: form.tlsInsecure,
    description: form.description.trim() || null,
    enabled: form.enabled,
  }
}

function sortProxyNodes(nodes: ManagedProxyNode[]) {
  return [...nodes].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1
    }

    const tagDelta = left.tag.localeCompare(right.tag)
    if (tagDelta) {
      return tagDelta
    }

    return left.name.localeCompare(right.name)
  })
}

function mergeUpdatedProxyNode(
  nodes: ManagedProxyNode[],
  updatedNode: ManagedProxyNode,
) {
  const deduped = nodes.filter((node) => node.id !== updatedNode.id)
  return [...deduped, updatedNode]
}
