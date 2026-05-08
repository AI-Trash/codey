import '@tanstack/react-start/server-only'

import { asc, eq } from 'drizzle-orm'

import { getDb } from './db/client'
import { proxyNodes, type ProxyNodeRow } from './db/schema'
import { decryptSecret, encryptSecret } from './encrypted-secrets'
import { createId } from './security'

export type ProxyNodeProtocol =
  | 'hysteria2'
  | 'trojan'
  | 'vmess'
  | 'vless'
  | 'socks'
  | 'http'

export type VmessSecurity =
  | 'auto'
  | 'none'
  | 'zero'
  | 'aes-128-gcm'
  | 'chacha20-poly1305'
  | 'aes-128-ctr'

export type VmessNetwork = 'tcp' | 'udp'
export type VmessPacketEncoding = 'packetaddr' | 'xudp'
export type VmessTransportType = 'grpc' | 'http' | 'httpupgrade' | 'quic' | 'ws'

export interface VmessTransportSettings {
  type: VmessTransportType
  serviceName?: string
  idleTimeout?: string
  pingTimeout?: string
  permitWithoutStream?: boolean
  host?: string | string[]
  path?: string
  method?: string
  headers?: Record<string, string | string[]>
  maxEarlyData?: number
  earlyDataHeaderName?: string
}

export interface VmessProtocolSettings {
  security?: VmessSecurity
  alterId?: number
  globalPadding?: boolean
  authenticatedLength?: boolean
  network?: VmessNetwork
  packetEncoding?: VmessPacketEncoding
  transport?: VmessTransportSettings
}

export type ProxyNodeProtocolSettings = VmessProtocolSettings &
  Record<string, unknown>

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
  vlessFlow: string | null
  protocolSettings: ProxyNodeProtocolSettings | null
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
  uuid?: string
  vlessFlow?: string
  vmess?: VmessProtocolSettings
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
  vlessFlow?: string | null
  protocolSettings?: unknown
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
  if (
    value === 'hysteria2' ||
    value === 'trojan' ||
    value === 'vmess' ||
    value === 'vless' ||
    value === 'socks' ||
    value === 'http'
  ) {
    return value
  }

  throw new Error(
    'protocol must be hysteria2, trojan, vmess, vless, socks, or http',
  )
}

function normalizeServerPort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('serverPort must be a valid TCP port')
  }

  return value
}

function normalizeVlessFlow(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value)
  if (!normalized) {
    return null
  }

  if (normalized !== 'xtls-rprx-vision') {
    throw new Error('vlessFlow must be xtls-rprx-vision or empty')
  }

  return normalized
}

function validateUuid(value: string | null, protocol: 'vless' | 'vmess'): void {
  if (!value) {
    throw new Error(`uuid is required for ${protocol} proxy nodes`)
  }

  if (!isValidUuid(value)) {
    throw new Error('uuid must be a valid UUID')
  }
}

function validateProtocolCredentials(input: {
  protocol: ProxyNodeProtocol
  username: string | null
  passwordCiphertext: string | null | undefined
}): void {
  if (input.protocol === 'vless') {
    validateUuid(input.username, 'vless')
  }

  if (input.protocol === 'vmess') {
    validateUuid(input.username, 'vmess')
  }

  if (input.protocol === 'trojan' && !input.passwordCiphertext) {
    throw new Error('password is required for trojan proxy nodes')
  }
}

function shouldKeepUsername(protocol: ProxyNodeProtocol): boolean {
  return protocol !== 'hysteria2' && protocol !== 'trojan'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readRecordValue(
  record: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) {
      return record[key]
    }
  }

  return undefined
}

function readOptionalString(
  record: Record<string, unknown>,
  ...keys: string[]
): string | null {
  const value = readRecordValue(record, ...keys)
  return typeof value === 'string' ? normalizeOptionalText(value) : null
}

function normalizeOptionalInteger(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed)) {
    throw new Error(`${field} must be an integer`)
  }

  return parsed
}

function normalizeVmessSecurity(value: unknown): VmessSecurity | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return undefined
  }

  if (
    normalized === 'auto' ||
    normalized === 'none' ||
    normalized === 'zero' ||
    normalized === 'aes-128-gcm' ||
    normalized === 'chacha20-poly1305' ||
    normalized === 'aes-128-ctr'
  ) {
    return normalized
  }

  throw new Error('vmess security is not supported')
}

function normalizeVmessNetwork(value: unknown): VmessNetwork | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return undefined
  }

  if (normalized === 'tcp' || normalized === 'udp') {
    return normalized
  }

  throw new Error('vmess network must be tcp, udp, or empty')
}

function normalizeVmessPacketEncoding(
  value: unknown,
): VmessPacketEncoding | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return undefined
  }

  if (normalized === 'packetaddr' || normalized === 'xudp') {
    return normalized
  }

  throw new Error('vmess packetEncoding must be packetaddr, xudp, or empty')
}

function normalizeVmessTransportType(
  value: unknown,
): VmessTransportType | undefined {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!normalized) {
    return undefined
  }

  if (
    normalized === 'grpc' ||
    normalized === 'http' ||
    normalized === 'httpupgrade' ||
    normalized === 'quic' ||
    normalized === 'ws'
  ) {
    return normalized
  }

  throw new Error('vmess transport type is not supported')
}

function normalizeVmessDuration(
  value: unknown,
  field: string,
): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return undefined
  }

  if (!/^\d+(ns|us|µs|ms|s|m|h)$/.test(normalized)) {
    throw new Error(`${field} must be a duration like 60s`)
  }

  return normalized
}

function normalizeVmessHost(value: unknown): string | string[] | undefined {
  if (typeof value === 'string') {
    return normalizeOptionalText(value) || undefined
  }

  if (Array.isArray(value)) {
    const hosts = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
    return hosts.length ? hosts : undefined
  }

  return undefined
}

function normalizeVmessHeaders(
  value: unknown,
): Record<string, string | string[]> | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const headers: Record<string, string | string[]> = {}
  for (const [key, headerValue] of Object.entries(value)) {
    const headerName = key.trim()
    if (!headerName) {
      continue
    }

    if (typeof headerValue === 'string') {
      const normalized = normalizeOptionalText(headerValue)
      if (normalized) {
        headers[headerName] = normalized
      }
      continue
    }

    if (Array.isArray(headerValue)) {
      const normalizedValues = headerValue
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
      if (normalizedValues.length) {
        headers[headerName] = normalizedValues
      }
    }
  }

  return Object.keys(headers).length ? headers : undefined
}

function normalizeVmessTransport(
  value: unknown,
): VmessTransportSettings | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const type = normalizeVmessTransportType(readRecordValue(value, 'type'))
  if (!type) {
    return undefined
  }

  const maxEarlyData = normalizeOptionalInteger(
    readRecordValue(value, 'maxEarlyData', 'max_early_data'),
    'vmess transport maxEarlyData',
  )

  if (maxEarlyData !== undefined && maxEarlyData < 0) {
    throw new Error('vmess transport maxEarlyData must be at least 0')
  }

  const serviceName = readOptionalString(value, 'serviceName', 'service_name')
  const idleTimeout = normalizeVmessDuration(
    readRecordValue(value, 'idleTimeout', 'idle_timeout'),
    'vmess transport idleTimeout',
  )
  const pingTimeout = normalizeVmessDuration(
    readRecordValue(value, 'pingTimeout', 'ping_timeout'),
    'vmess transport pingTimeout',
  )
  const permitWithoutStream = readRecordValue(
    value,
    'permitWithoutStream',
    'permit_without_stream',
  )
  const host = normalizeVmessHost(readRecordValue(value, 'host'))
  const path = readOptionalString(value, 'path')
  const method = readOptionalString(value, 'method')
  const headers = normalizeVmessHeaders(readRecordValue(value, 'headers'))
  const earlyDataHeaderName = readOptionalString(
    value,
    'earlyDataHeaderName',
    'early_data_header_name',
  )

  const transport: VmessTransportSettings = {
    type,
    ...(serviceName ? { serviceName } : {}),
    ...(idleTimeout ? { idleTimeout } : {}),
    ...(pingTimeout ? { pingTimeout } : {}),
    ...(typeof permitWithoutStream === 'boolean'
      ? { permitWithoutStream }
      : {}),
    ...(host ? { host } : {}),
    ...(path ? { path } : {}),
    ...(method ? { method } : {}),
    ...(headers ? { headers } : {}),
    ...(maxEarlyData !== undefined ? { maxEarlyData } : {}),
    ...(earlyDataHeaderName ? { earlyDataHeaderName } : {}),
  }

  return transport
}

function normalizeProtocolSettings(
  protocol: ProxyNodeProtocol,
  value: unknown,
): ProxyNodeProtocolSettings | null {
  if (protocol !== 'vmess') {
    return null
  }

  if (value === undefined || value === null || value === '') {
    return {
      security: 'auto',
      alterId: 0,
    }
  }

  if (!isRecord(value)) {
    throw new Error('protocolSettings must be a JSON object')
  }

  const alterId = normalizeOptionalInteger(
    readRecordValue(value, 'alterId', 'alter_id'),
    'vmess alterId',
  )
  if (alterId !== undefined && (alterId < 0 || alterId > 65535)) {
    throw new Error('vmess alterId must be between 0 and 65535')
  }

  const globalPadding = readRecordValue(
    value,
    'globalPadding',
    'global_padding',
  )
  const authenticatedLength = readRecordValue(
    value,
    'authenticatedLength',
    'authenticated_length',
  )
  const network = normalizeVmessNetwork(readRecordValue(value, 'network'))
  const packetEncoding = normalizeVmessPacketEncoding(
    readRecordValue(value, 'packetEncoding', 'packet_encoding'),
  )
  const transport = normalizeVmessTransport(readRecordValue(value, 'transport'))

  return {
    security:
      normalizeVmessSecurity(readRecordValue(value, 'security')) || 'auto',
    alterId: alterId ?? 0,
    ...(typeof globalPadding === 'boolean' ? { globalPadding } : {}),
    ...(typeof authenticatedLength === 'boolean'
      ? { authenticatedLength }
      : {}),
    ...(network ? { network } : {}),
    ...(packetEncoding ? { packetEncoding } : {}),
    ...(transport ? { transport } : {}),
  }
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
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
    vlessFlow: row.vlessFlow,
    protocolSettings:
      row.protocol === 'vmess'
        ? normalizeProtocolSettings(row.protocol, row.protocolSettings)
        : null,
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
  const tlsEnabled =
    row.protocol === 'hysteria2' ||
    row.protocol === 'trojan' ||
    row.protocol === 'vmess' ||
    row.protocol === 'vless'
  const vmessSettings =
    row.protocol === 'vmess'
      ? normalizeProtocolSettings(row.protocol, row.protocolSettings)
      : null

  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    protocol: row.protocol,
    server: row.server,
    serverPort: row.serverPort,
    ...((row.protocol === 'vless' || row.protocol === 'vmess') && row.username
      ? { uuid: row.username }
      : row.username
        ? { username: row.username }
        : {}),
    ...(row.protocol !== 'vless' && row.protocol !== 'vmess' && password
      ? { password }
      : {}),
    ...(row.protocol === 'vless' && row.vlessFlow
      ? { vlessFlow: row.vlessFlow }
      : {}),
    ...(vmessSettings ? { vmess: vmessSettings } : {}),
    ...(tlsEnabled
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
  const username = normalizeOptionalText(input.username)
  const passwordUpdate = buildPasswordUpdate(input.password)
  const vlessFlow = normalizeVlessFlow(input.vlessFlow)
  const protocolSettings = normalizeProtocolSettings(
    protocol,
    input.protocolSettings,
  )
  const now = new Date()

  validateProtocolCredentials({
    protocol,
    username,
    passwordCiphertext: passwordUpdate?.passwordCiphertext,
  })

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
      username: shouldKeepUsername(protocol) ? username : null,
      passwordCiphertext:
        protocol === 'vless' || protocol === 'vmess'
          ? null
          : (passwordUpdate?.passwordCiphertext ?? null),
      passwordPreview:
        protocol === 'vless' || protocol === 'vmess'
          ? null
          : (passwordUpdate?.passwordPreview ?? null),
      vlessFlow: protocol === 'vless' ? vlessFlow : null,
      protocolSettings,
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
  const nextProtocol =
    input.protocol !== undefined
      ? normalizeProtocol(input.protocol)
      : existing.protocol
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

  const nextUsername =
    input.username !== undefined
      ? normalizeOptionalText(input.username)
      : existing.username
  const nextVlessFlow =
    input.vlessFlow !== undefined
      ? normalizeVlessFlow(input.vlessFlow)
      : existing.vlessFlow
  const nextProtocolSettings =
    input.protocolSettings !== undefined || nextProtocol !== existing.protocol
      ? normalizeProtocolSettings(nextProtocol, input.protocolSettings)
      : normalizeProtocolSettings(nextProtocol, existing.protocolSettings)
  const nextPasswordCiphertext =
    nextProtocol === 'vless' || nextProtocol === 'vmess'
      ? null
      : (passwordUpdate?.passwordCiphertext ??
        (passwordUpdate ? null : existing.passwordCiphertext))

  validateProtocolCredentials({
    protocol: nextProtocol,
    username: nextUsername,
    passwordCiphertext: nextPasswordCiphertext,
  })

  const [row] = await getDb()
    .update(proxyNodes)
    .set({
      name: nextName,
      tag: input.tag !== undefined ? normalizeTag(input.tag) : existing.tag,
      protocol: nextProtocol,
      server:
        input.server !== undefined
          ? normalizeRequiredText(input.server, 'server')
          : existing.server,
      serverPort:
        input.serverPort !== undefined
          ? normalizeServerPort(input.serverPort)
          : existing.serverPort,
      username: shouldKeepUsername(nextProtocol) ? nextUsername : null,
      ...(nextProtocol === 'vless' || nextProtocol === 'vmess'
        ? {
            passwordCiphertext: null,
            passwordPreview: null,
          }
        : (passwordUpdate ?? {})),
      vlessFlow: nextProtocol === 'vless' ? nextVlessFlow : null,
      protocolSettings: nextProtocolSettings,
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
