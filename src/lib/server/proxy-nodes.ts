import '@tanstack/react-start/server-only'

import { asc, eq } from 'drizzle-orm'

import { getDb } from './db/client'
import { proxyNodes, type ProxyNodeRow } from './db/schema'
import { decryptSecret, encryptSecret } from './encrypted-secrets'
import { createId } from './security'

export type ProxyNodeProtocol = 'hysteria2' | 'socks' | 'http'

export interface ManagedProxyNodeSummary {
  id: string
  name: string
  tag: string
  protocol: ProxyNodeProtocol
  server: string
  serverPort: number
  username: string | null
  hasPassword: boolean
  passwordPreview: string | null
  tlsServerName: string | null
  tlsInsecure: boolean
  description: string | null
  enabled: boolean
  updatedByUserId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CliProxyNodeConfig {
  id: string
  name: string
  tag: string
  protocol: ProxyNodeProtocol
  server: string
  serverPort: number
  username?: string
  password?: string
  tls?: {
    enabled: true
    serverName?: string
    insecure?: boolean
  }
}

export interface CreateProxyNodeInput {
  name: string
  tag: string
  protocol?: ProxyNodeProtocol
  server: string
  serverPort: number
  username?: string | null
  password?: string | null
  tlsServerName?: string | null
  tlsInsecure?: boolean
  description?: string | null
  enabled?: boolean
  updatedByUserId?: string | null
}

export type UpdateProxyNodeInput = Partial<CreateProxyNodeInput>

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized || null
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${field} is required`)
  }
  return normalized
}

function normalizeTag(value: string): string {
  return normalizeRequiredText(value, 'tag').toLowerCase()
}

function normalizeProtocol(value: unknown): ProxyNodeProtocol {
  if (value === 'hysteria2' || value === 'socks' || value === 'http') {
    return value
  }

  throw new Error('protocol must be hysteria2, socks, or http')
}

function normalizeServerPort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('serverPort must be a valid TCP port')
  }

  return value
}

function createPasswordPreview(password: string): string {
  if (password.length <= 4) {
    return '****'
  }

  return `****${password.slice(-4)}`
}

function buildPasswordUpdate(password: string | null | undefined):
  | {
      passwordCiphertext?: string | null
      passwordPreview?: string | null
    }
  | undefined {
  if (password === undefined) {
    return undefined
  }

  const normalized = normalizeOptionalText(password)
  if (!normalized) {
    return {
      passwordCiphertext: null,
      passwordPreview: null,
    }
  }

  return {
    passwordCiphertext: encryptSecret(
      normalized,
      'encrypt proxy node password',
    ),
    passwordPreview: createPasswordPreview(normalized),
  }
}

function toSummary(row: ProxyNodeRow): ManagedProxyNodeSummary {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    protocol: row.protocol,
    server: row.server,
    serverPort: row.serverPort,
    username: row.username,
    hasPassword: Boolean(row.passwordCiphertext),
    passwordPreview: row.passwordPreview,
    tlsServerName: row.tlsServerName,
    tlsInsecure: row.tlsInsecure,
    description: row.description,
    enabled: row.enabled,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toCliConfig(row: ProxyNodeRow): CliProxyNodeConfig {
  const password = row.passwordCiphertext
    ? decryptSecret(row.passwordCiphertext, 'decrypt proxy node password')
    : undefined

  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    protocol: row.protocol,
    server: row.server,
    serverPort: row.serverPort,
    ...(row.username ? { username: row.username } : {}),
    ...(password ? { password } : {}),
    ...(row.protocol === 'hysteria2'
      ? {
          tls: {
            enabled: true as const,
            ...(row.tlsServerName ? { serverName: row.tlsServerName } : {}),
            ...(row.tlsInsecure ? { insecure: true } : {}),
          },
        }
      : {}),
  }
}

async function getProxyNodeRowById(id: string): Promise<ProxyNodeRow> {
  const row = await getDb().query.proxyNodes.findFirst({
    where: eq(proxyNodes.id, id),
  })

  if (!row) {
    throw new Error('Proxy node not found')
  }

  return row
}

export async function listProxyNodes(): Promise<ManagedProxyNodeSummary[]> {
  const rows = await getDb().query.proxyNodes.findMany({
    orderBy: [
      asc(proxyNodes.tag),
      asc(proxyNodes.name),
      asc(proxyNodes.createdAt),
    ],
  })

  return rows.map(toSummary)
}

export async function listEnabledProxyNodesForCli(): Promise<
  CliProxyNodeConfig[]
> {
  const rows = await getDb().query.proxyNodes.findMany({
    where: eq(proxyNodes.enabled, true),
    orderBy: [
      asc(proxyNodes.tag),
      asc(proxyNodes.name),
      asc(proxyNodes.createdAt),
    ],
  })

  return rows.map(toCliConfig)
}

export async function createProxyNode(
  input: CreateProxyNodeInput,
): Promise<ManagedProxyNodeSummary> {
  const name = normalizeRequiredText(input.name, 'name')
  const tag = normalizeTag(input.tag)
  const protocol = normalizeProtocol(input.protocol || 'hysteria2')
  const server = normalizeRequiredText(input.server, 'server')
  const serverPort = normalizeServerPort(input.serverPort)
  const passwordUpdate = buildPasswordUpdate(input.password)
  const now = new Date()

  const duplicate = await getDb().query.proxyNodes.findFirst({
    where: eq(proxyNodes.name, name),
  })
  if (duplicate) {
    throw new Error('Proxy node name already exists')
  }

  const [row] = await getDb()
    .insert(proxyNodes)
    .values({
      id: createId(),
      name,
      tag,
      protocol,
      server,
      serverPort,
      username: normalizeOptionalText(input.username),
      passwordCiphertext: passwordUpdate?.passwordCiphertext ?? null,
      passwordPreview: passwordUpdate?.passwordPreview ?? null,
      tlsServerName: normalizeOptionalText(input.tlsServerName),
      tlsInsecure: input.tlsInsecure ?? false,
      description: normalizeOptionalText(input.description),
      enabled: input.enabled ?? true,
      updatedByUserId: input.updatedByUserId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  if (!row) {
    throw new Error('Unable to create proxy node')
  }

  return toSummary(row)
}

export async function updateProxyNode(
  id: string,
  input: UpdateProxyNodeInput,
): Promise<ManagedProxyNodeSummary> {
  const existing = await getProxyNodeRowById(id)
  const passwordUpdate = buildPasswordUpdate(input.password)
  const nextName =
    input.name !== undefined
      ? normalizeRequiredText(input.name, 'name')
      : existing.name

  if (nextName !== existing.name) {
    const duplicate = await getDb().query.proxyNodes.findFirst({
      where: eq(proxyNodes.name, nextName),
    })
    if (duplicate && duplicate.id !== existing.id) {
      throw new Error('Proxy node name already exists')
    }
  }

  const [row] = await getDb()
    .update(proxyNodes)
    .set({
      name: nextName,
      tag: input.tag !== undefined ? normalizeTag(input.tag) : existing.tag,
      protocol:
        input.protocol !== undefined
          ? normalizeProtocol(input.protocol)
          : existing.protocol,
      server:
        input.server !== undefined
          ? normalizeRequiredText(input.server, 'server')
          : existing.server,
      serverPort:
        input.serverPort !== undefined
          ? normalizeServerPort(input.serverPort)
          : existing.serverPort,
      username:
        input.username !== undefined
          ? normalizeOptionalText(input.username)
          : existing.username,
      ...passwordUpdate,
      tlsServerName:
        input.tlsServerName !== undefined
          ? normalizeOptionalText(input.tlsServerName)
          : existing.tlsServerName,
      tlsInsecure:
        input.tlsInsecure !== undefined
          ? input.tlsInsecure
          : existing.tlsInsecure,
      description:
        input.description !== undefined
          ? normalizeOptionalText(input.description)
          : existing.description,
      enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
      updatedByUserId:
        input.updatedByUserId !== undefined
          ? input.updatedByUserId
          : existing.updatedByUserId,
      updatedAt: new Date(),
    })
    .where(eq(proxyNodes.id, id))
    .returning()

  if (!row) {
    throw new Error('Unable to update proxy node')
  }

  return toSummary(row)
}

export async function deleteProxyNode(id: string): Promise<void> {
  await getProxyNodeRowById(id)
  await getDb().delete(proxyNodes).where(eq(proxyNodes.id, id))
}
