import '@tanstack/react-start/server-only'

import { eq } from 'drizzle-orm'

import type { Sub2ApiConfig } from '../../../packages/cli/src/config'
import { getDb } from './db/client'
import {
  externalServiceConfigs,
  type ExternalServiceAuthMode,
  type ExternalServiceConfigRow,
} from './db/schema'
import { decryptSecret, encryptSecret } from './encrypted-secrets'
import { createId } from './security'

const SUB2API_SERVICE_KIND = 'sub2api' as const
const ASTRBOT_SERVICE_KIND = 'astrbot' as const
const DEFAULT_ASTRBOT_BASE_URL = 'http://astrbot:6185'
const DEFAULT_ASTRBOT_MESSAGE_PATH = '/api/v1/im/message'
const DEFAULT_ASTRBOT_TIMEOUT_MS = 5_000

type AstrBotAuthMode = Extract<
  ExternalServiceAuthMode,
  'api_key' | 'bearer_token'
>

interface AstrBotServiceSettings {
  umo?: string
  messagePath: string
  timeoutMs: number
  messageTemplate?: string
}

export interface AstrBotPayPalNotificationConfig {
  baseUrl: string
  messagePath: string
  umo: string
  timeoutMs: number
  apiKey?: string
  bearerToken?: string
  messageTemplate?: string
}

export interface ManagedSub2ApiServiceSummary {
  id: string | null
  kind: typeof SUB2API_SERVICE_KIND
  enabled: boolean
  configured: boolean
  baseUrl: string
  authMode: ExternalServiceAuthMode
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
  openaiOAuthResponsesWebSocketV2Mode: Sub2ApiConfig['openaiOAuthResponsesWebSocketV2Mode']
  updatedByUserId: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

export interface ManagedAstrBotServiceSummary {
  id: string | null
  kind: typeof ASTRBOT_SERVICE_KIND
  enabled: boolean
  configured: boolean
  baseUrl: string
  authMode: AstrBotAuthMode
  hasApiKey: boolean
  hasBearerToken: boolean
  umo: string
  messagePath: string
  timeoutMs: number
  messageTemplate: string
  updatedByUserId: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

export interface UpsertSub2ApiServiceInput {
  enabled?: boolean
  baseUrl?: string | null
  authMode?: ExternalServiceAuthMode
  apiKey?: string | null
  bearerToken?: string | null
  email?: string | null
  password?: string | null
  loginPath?: string | null
  refreshTokenPath?: string | null
  accountsPath?: string | null
  clientId?: string | null
  proxyId?: number | null
  concurrency?: number | null
  priority?: number | null
  groupIds?: number[] | null
  autoFillRelatedModels?: boolean | null
  confirmMixedChannelRisk?: boolean | null
  openaiOAuthResponsesWebSocketV2Mode?:
    | Sub2ApiConfig['openaiOAuthResponsesWebSocketV2Mode']
    | null
  updatedByUserId?: string
}

export interface UpsertAstrBotServiceInput {
  enabled?: boolean
  baseUrl?: string | null
  authMode?: AstrBotAuthMode
  apiKey?: string | null
  bearerToken?: string | null
  umo?: string | null
  messagePath?: string | null
  timeoutMs?: number | null
  messageTemplate?: string | null
  updatedByUserId?: string
}

function normalizeOptionalText(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : undefined
}

function readRecordString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? normalizeOptionalText(value) : undefined
}

function resolveOptionalTextUpdate(
  nextValue: string | null | undefined,
  existingValue: string | null | undefined,
): string | undefined {
  if (nextValue === undefined) {
    return normalizeOptionalText(existingValue)
  }

  return normalizeOptionalText(nextValue)
}

function normalizeAstrBotBaseUrl(value?: string | null): string {
  const normalized = normalizeOptionalText(value) || DEFAULT_ASTRBOT_BASE_URL
  return normalized.replace(/\/+$/, '')
}

function normalizeAstrBotMessagePath(value?: string | null): string {
  const normalized =
    normalizeOptionalText(value) || DEFAULT_ASTRBOT_MESSAGE_PATH
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function normalizeAstrBotTimeoutMs(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ASTRBOT_TIMEOUT_MS
  }

  return Math.min(Math.floor(parsed), 60_000)
}

function resolveAstrBotTimeoutMsUpdate(
  nextValue: number | null | undefined,
  existingValue: number,
): number {
  if (nextValue === undefined) {
    return normalizeAstrBotTimeoutMs(existingValue)
  }

  if (nextValue === null) {
    return DEFAULT_ASTRBOT_TIMEOUT_MS
  }

  return normalizeAstrBotTimeoutMs(nextValue)
}

function normalizeSecret(value: string | null | undefined): string | undefined {
  return normalizeOptionalText(value)
}

function resolveOptionalInteger(
  nextValue: number | null | undefined,
  existingValue: number | null | undefined,
  field: string,
): number | undefined {
  if (nextValue === undefined) {
    return existingValue ?? undefined
  }

  if (nextValue === null) {
    return undefined
  }

  if (!Number.isInteger(nextValue)) {
    throw new Error(`${field} must be a whole number.`)
  }

  return nextValue
}

function normalizeGroupIds(
  value: number[] | null | undefined,
): number[] | undefined {
  if (value == null) {
    return undefined
  }

  const normalized = Array.from(
    new Set(value.filter((entry) => Number.isInteger(entry) && entry > 0)),
  )

  return normalized.length ? normalized : undefined
}

function resolveConfirmMixedChannelRisk(
  nextValue: boolean | null | undefined,
  existingValue: boolean | null | undefined,
): boolean | undefined {
  if (typeof nextValue === 'boolean') {
    return nextValue
  }

  if (nextValue === null) {
    return undefined
  }

  return existingValue ?? undefined
}

function resolveOptionalBooleanUpdate(
  nextValue: boolean | null | undefined,
  existingValue: boolean | null | undefined,
): boolean | undefined {
  if (typeof nextValue === 'boolean') {
    return nextValue
  }

  if (nextValue === null) {
    return undefined
  }

  return existingValue ?? undefined
}

function resolveOpenAIWSModeUpdate(
  nextValue:
    | Sub2ApiConfig['openaiOAuthResponsesWebSocketV2Mode']
    | null
    | undefined,
  existingValue: string | null | undefined,
): Sub2ApiConfig['openaiOAuthResponsesWebSocketV2Mode'] | undefined {
  if (nextValue === null) {
    return undefined
  }

  const value = nextValue ?? existingValue
  return value === 'off' || value === 'ctx_pool' || value === 'passthrough'
    ? value
    : undefined
}

function resolveGroupIdsUpdate(
  nextValue: number[] | null | undefined,
  existingValue: number[] | null | undefined,
): number[] | undefined {
  if (nextValue === undefined) {
    return normalizeGroupIds(existingValue)
  }

  return normalizeGroupIds(nextValue)
}

function resolveSub2ApiAuthMode(
  row:
    | Pick<
        ExternalServiceConfigRow,
        | 'authMode'
        | 'apiKeyCiphertext'
        | 'bearerTokenCiphertext'
        | 'email'
        | 'passwordCiphertext'
      >
    | null
    | undefined,
): ExternalServiceAuthMode {
  if (row?.authMode) {
    return row.authMode
  }

  if (row?.apiKeyCiphertext) {
    return 'api_key'
  }

  if (row?.bearerTokenCiphertext) {
    return 'bearer_token'
  }

  if (normalizeOptionalText(row?.email) || row?.passwordCiphertext) {
    return 'password'
  }

  return 'api_key'
}

function isSub2ApiConfigReady(
  row:
    | Pick<
        ExternalServiceConfigRow,
        | 'enabled'
        | 'baseUrl'
        | 'authMode'
        | 'apiKeyCiphertext'
        | 'bearerTokenCiphertext'
        | 'email'
        | 'passwordCiphertext'
      >
    | null
    | undefined,
): boolean {
  if (!row?.enabled || !normalizeOptionalText(row.baseUrl)) {
    return false
  }

  const authMode = resolveSub2ApiAuthMode(row)

  if (authMode === 'api_key') {
    return Boolean(row.apiKeyCiphertext)
  }

  if (authMode === 'bearer_token') {
    return Boolean(row.bearerTokenCiphertext)
  }

  if (authMode === 'password') {
    return Boolean(normalizeOptionalText(row.email) && row.passwordCiphertext)
  }

  return false
}

function toSummary(
  row: ExternalServiceConfigRow | null | undefined,
): ManagedSub2ApiServiceSummary {
  const authMode = resolveSub2ApiAuthMode(row)

  return {
    id: row?.id ?? null,
    kind: SUB2API_SERVICE_KIND,
    enabled: row?.enabled ?? false,
    configured: isSub2ApiConfigReady(row),
    baseUrl: row?.baseUrl ?? '',
    authMode,
    hasApiKey: Boolean(row?.apiKeyCiphertext),
    hasBearerToken: Boolean(row?.bearerTokenCiphertext),
    email: row?.email ?? '',
    hasPassword: Boolean(row?.passwordCiphertext),
    loginPath: row?.loginPath ?? '',
    refreshTokenPath: row?.refreshTokenPath ?? '',
    accountsPath: row?.accountsPath ?? '',
    clientId: row?.clientId ?? '',
    proxyId: row?.proxyId ?? null,
    concurrency: row?.concurrency ?? null,
    priority: row?.priority ?? null,
    groupIds: normalizeGroupIds(row?.groupIds) ?? [],
    autoFillRelatedModels: row?.autoFillRelatedModels ?? false,
    confirmMixedChannelRisk: row?.confirmMixedChannelRisk ?? false,
    openaiOAuthResponsesWebSocketV2Mode:
      resolveOpenAIWSModeUpdate(
        undefined,
        row?.openaiOAuthResponsesWebSocketV2Mode,
      ) ?? 'off',
    updatedByUserId: row?.updatedByUserId ?? null,
    createdAt: row?.createdAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  }
}

function readAstrBotServiceSettings(
  row: Pick<ExternalServiceConfigRow, 'settings'> | null | undefined,
): AstrBotServiceSettings {
  const settings = asRecord(row?.settings)
  return {
    umo: readRecordString(settings, 'umo'),
    messagePath: normalizeAstrBotMessagePath(
      readRecordString(settings, 'messagePath'),
    ),
    timeoutMs: normalizeAstrBotTimeoutMs(settings?.timeoutMs),
    messageTemplate: readRecordString(settings, 'messageTemplate'),
  }
}

function resolveAstrBotAuthMode(
  row:
    | Pick<
        ExternalServiceConfigRow,
        'authMode' | 'apiKeyCiphertext' | 'bearerTokenCiphertext'
      >
    | null
    | undefined,
): AstrBotAuthMode {
  if (row?.authMode === 'bearer_token') {
    return 'bearer_token'
  }

  if (row?.authMode === 'api_key') {
    return 'api_key'
  }

  if (row?.bearerTokenCiphertext && !row.apiKeyCiphertext) {
    return 'bearer_token'
  }

  return 'api_key'
}

function isAstrBotConfigReady(
  row:
    | Pick<
        ExternalServiceConfigRow,
        | 'enabled'
        | 'authMode'
        | 'apiKeyCiphertext'
        | 'bearerTokenCiphertext'
        | 'settings'
      >
    | null
    | undefined,
): boolean {
  if (!row?.enabled) {
    return false
  }

  const settings = readAstrBotServiceSettings(row)
  if (!settings.umo) {
    return false
  }

  const authMode = resolveAstrBotAuthMode(row)
  return authMode === 'api_key'
    ? Boolean(row.apiKeyCiphertext)
    : Boolean(row.bearerTokenCiphertext)
}

function toAstrBotSummary(
  row: ExternalServiceConfigRow | null | undefined,
): ManagedAstrBotServiceSummary {
  const settings = readAstrBotServiceSettings(row)
  const authMode = resolveAstrBotAuthMode(row)

  return {
    id: row?.id ?? null,
    kind: ASTRBOT_SERVICE_KIND,
    enabled: row?.enabled ?? false,
    configured: isAstrBotConfigReady(row),
    baseUrl: normalizeAstrBotBaseUrl(row?.baseUrl),
    authMode,
    hasApiKey: Boolean(row?.apiKeyCiphertext),
    hasBearerToken: Boolean(row?.bearerTokenCiphertext),
    umo: settings.umo ?? '',
    messagePath: settings.messagePath,
    timeoutMs: settings.timeoutMs,
    messageTemplate: settings.messageTemplate ?? '',
    updatedByUserId: row?.updatedByUserId ?? null,
    createdAt: row?.createdAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  }
}

async function findSub2ApiServiceRow(): Promise<ExternalServiceConfigRow | null> {
  return (
    (await getDb().query.externalServiceConfigs.findFirst({
      where: eq(externalServiceConfigs.kind, SUB2API_SERVICE_KIND),
    })) ?? null
  )
}

async function findAstrBotServiceRow(): Promise<ExternalServiceConfigRow | null> {
  return (
    (await getDb().query.externalServiceConfigs.findFirst({
      where: eq(externalServiceConfigs.kind, ASTRBOT_SERVICE_KIND),
    })) ?? null
  )
}

export async function getSub2ApiServiceSummary(): Promise<ManagedSub2ApiServiceSummary> {
  return toSummary(await findSub2ApiServiceRow())
}

export async function getAstrBotServiceSummary(): Promise<ManagedAstrBotServiceSummary> {
  return toAstrBotSummary(await findAstrBotServiceRow())
}

export async function hasEnabledSub2ApiServiceConfig(): Promise<boolean> {
  return isSub2ApiConfigReady(await findSub2ApiServiceRow())
}

export async function upsertSub2ApiServiceConfig(
  input: UpsertSub2ApiServiceInput,
): Promise<ManagedSub2ApiServiceSummary> {
  const existing = await findSub2ApiServiceRow()
  const now = new Date()
  const existingAuthMode = resolveSub2ApiAuthMode(existing)
  const authMode = input.authMode ?? existingAuthMode
  const enabled = input.enabled ?? existing?.enabled ?? false
  const baseUrl = resolveOptionalTextUpdate(input.baseUrl, existing?.baseUrl)
  const email =
    authMode === 'password'
      ? resolveOptionalTextUpdate(input.email, existing?.email)
      : undefined

  const nextApiKey =
    authMode === 'api_key' ? normalizeSecret(input.apiKey) : undefined
  const nextBearerToken =
    authMode === 'bearer_token' ? normalizeSecret(input.bearerToken) : undefined
  const nextPassword =
    authMode === 'password' ? normalizeSecret(input.password) : undefined

  const apiKeyCiphertext =
    authMode === 'api_key'
      ? nextApiKey
        ? encryptSecret(nextApiKey, 'manage Sub2API API keys')
        : existingAuthMode === 'api_key'
          ? (existing?.apiKeyCiphertext ?? undefined)
          : undefined
      : undefined

  const bearerTokenCiphertext =
    authMode === 'bearer_token'
      ? nextBearerToken
        ? encryptSecret(nextBearerToken, 'manage Sub2API bearer tokens')
        : existingAuthMode === 'bearer_token'
          ? (existing.bearerTokenCiphertext ?? undefined)
          : undefined
      : undefined

  const passwordCiphertext =
    authMode === 'password'
      ? nextPassword
        ? encryptSecret(nextPassword, 'manage Sub2API passwords')
        : existingAuthMode === 'password'
          ? (existing.passwordCiphertext ?? undefined)
          : undefined
      : undefined

  if (enabled) {
    if (!baseUrl) {
      throw new Error(
        'Sub2API base URL is required before enabling the service.',
      )
    }

    if (authMode === 'api_key' && !apiKeyCiphertext) {
      throw new Error(
        'Sub2API API key is required before enabling api-key auth.',
      )
    }

    if (authMode === 'bearer_token' && !bearerTokenCiphertext) {
      throw new Error(
        'Sub2API bearer token is required before enabling bearer-token auth.',
      )
    }

    if (authMode === 'password') {
      if (!email) {
        throw new Error(
          'Sub2API email is required before enabling password auth.',
        )
      }

      if (!passwordCiphertext) {
        throw new Error(
          'Sub2API password is required before enabling password auth.',
        )
      }
    }
  }

  const payload = {
    kind: SUB2API_SERVICE_KIND,
    enabled,
    baseUrl: baseUrl ?? null,
    authMode,
    apiKeyCiphertext: apiKeyCiphertext ?? null,
    bearerTokenCiphertext: bearerTokenCiphertext ?? null,
    email: email ?? null,
    passwordCiphertext: passwordCiphertext ?? null,
    loginPath:
      resolveOptionalTextUpdate(input.loginPath, existing?.loginPath) ?? null,
    refreshTokenPath:
      resolveOptionalTextUpdate(
        input.refreshTokenPath,
        existing?.refreshTokenPath,
      ) ?? null,
    accountsPath:
      resolveOptionalTextUpdate(input.accountsPath, existing?.accountsPath) ??
      null,
    clientId:
      resolveOptionalTextUpdate(input.clientId, existing?.clientId) ?? null,
    proxyId:
      resolveOptionalInteger(input.proxyId, existing?.proxyId, 'proxyId') ??
      null,
    concurrency:
      resolveOptionalInteger(
        input.concurrency,
        existing?.concurrency,
        'concurrency',
      ) ?? null,
    priority:
      resolveOptionalInteger(input.priority, existing?.priority, 'priority') ??
      null,
    groupIds: resolveGroupIdsUpdate(input.groupIds, existing?.groupIds) ?? null,
    autoFillRelatedModels:
      resolveOptionalBooleanUpdate(
        input.autoFillRelatedModels,
        existing?.autoFillRelatedModels,
      ) ?? null,
    confirmMixedChannelRisk:
      resolveConfirmMixedChannelRisk(
        input.confirmMixedChannelRisk,
        existing?.confirmMixedChannelRisk,
      ) ?? null,
    openaiOAuthResponsesWebSocketV2Mode:
      resolveOpenAIWSModeUpdate(
        input.openaiOAuthResponsesWebSocketV2Mode,
        existing?.openaiOAuthResponsesWebSocketV2Mode,
      ) ?? null,
    updatedByUserId: input.updatedByUserId?.trim() || null,
    updatedAt: now,
  }

  const [row] = existing
    ? await getDb()
        .update(externalServiceConfigs)
        .set(payload)
        .where(eq(externalServiceConfigs.id, existing.id))
        .returning()
    : await getDb()
        .insert(externalServiceConfigs)
        .values({
          id: createId(),
          ...payload,
          createdAt: now,
        })
        .returning()

  if (!row) {
    throw new Error('Unable to save Sub2API configuration.')
  }

  return toSummary(row)
}

export async function upsertAstrBotServiceConfig(
  input: UpsertAstrBotServiceInput,
): Promise<ManagedAstrBotServiceSummary> {
  const existing = await findAstrBotServiceRow()
  const existingSettings = readAstrBotServiceSettings(existing)
  const now = new Date()
  const existingAuthMode = resolveAstrBotAuthMode(existing)
  const authMode = input.authMode ?? existingAuthMode
  const enabled = input.enabled ?? existing?.enabled ?? false
  const baseUrl = normalizeAstrBotBaseUrl(
    resolveOptionalTextUpdate(input.baseUrl, existing?.baseUrl),
  )
  const umo = resolveOptionalTextUpdate(input.umo, existingSettings.umo)
  const messagePath = normalizeAstrBotMessagePath(
    resolveOptionalTextUpdate(input.messagePath, existingSettings.messagePath),
  )
  const timeoutMs = resolveAstrBotTimeoutMsUpdate(
    input.timeoutMs,
    existingSettings.timeoutMs,
  )
  const messageTemplate = resolveOptionalTextUpdate(
    input.messageTemplate,
    existingSettings.messageTemplate,
  )

  const nextApiKey =
    authMode === 'api_key' ? normalizeSecret(input.apiKey) : undefined
  const nextBearerToken =
    authMode === 'bearer_token' ? normalizeSecret(input.bearerToken) : undefined

  const apiKeyCiphertext =
    authMode === 'api_key'
      ? nextApiKey
        ? encryptSecret(nextApiKey, 'manage AstrBot API keys')
        : existingAuthMode === 'api_key'
          ? (existing?.apiKeyCiphertext ?? undefined)
          : undefined
      : undefined

  const bearerTokenCiphertext =
    authMode === 'bearer_token'
      ? nextBearerToken
        ? encryptSecret(nextBearerToken, 'manage AstrBot bearer tokens')
        : existingAuthMode === 'bearer_token'
          ? (existing?.bearerTokenCiphertext ?? undefined)
          : undefined
      : undefined

  if (enabled) {
    if (!umo) {
      throw new Error(
        'AstrBot target UMO is required before enabling PayPal notifications.',
      )
    }

    if (authMode === 'api_key' && !apiKeyCiphertext) {
      throw new Error(
        'AstrBot API key is required before enabling api-key auth.',
      )
    }

    if (authMode === 'bearer_token' && !bearerTokenCiphertext) {
      throw new Error(
        'AstrBot bearer token is required before enabling bearer-token auth.',
      )
    }
  }

  const settings = {
    ...(umo ? { umo } : {}),
    messagePath,
    timeoutMs,
    ...(messageTemplate ? { messageTemplate } : {}),
  }

  const payload = {
    kind: ASTRBOT_SERVICE_KIND,
    enabled,
    baseUrl,
    authMode,
    apiKeyCiphertext: apiKeyCiphertext ?? null,
    bearerTokenCiphertext: bearerTokenCiphertext ?? null,
    email: null,
    passwordCiphertext: null,
    loginPath: null,
    refreshTokenPath: null,
    accountsPath: null,
    clientId: null,
    proxyId: null,
    concurrency: null,
    priority: null,
    groupIds: null,
    autoFillRelatedModels: null,
    confirmMixedChannelRisk: null,
    openaiOAuthResponsesWebSocketV2Mode: null,
    settings,
    updatedByUserId: input.updatedByUserId?.trim() || null,
    updatedAt: now,
  }

  const [row] = existing
    ? await getDb()
        .update(externalServiceConfigs)
        .set(payload)
        .where(eq(externalServiceConfigs.id, existing.id))
        .returning()
    : await getDb()
        .insert(externalServiceConfigs)
        .values({
          id: createId(),
          ...payload,
          createdAt: now,
        })
        .returning()

  if (!row) {
    throw new Error('Unable to save AstrBot configuration.')
  }

  return toAstrBotSummary(row)
}

export async function getAstrBotPayPalNotificationConfig(): Promise<AstrBotPayPalNotificationConfig | null> {
  const row = await findAstrBotServiceRow()
  if (!row?.enabled) {
    return null
  }

  const settings = readAstrBotServiceSettings(row)
  if (!settings.umo) {
    throw new Error('AstrBot target UMO is not configured.')
  }

  const baseConfig = {
    baseUrl: normalizeAstrBotBaseUrl(row.baseUrl),
    messagePath: settings.messagePath,
    umo: settings.umo,
    timeoutMs: settings.timeoutMs,
    messageTemplate: settings.messageTemplate,
  }
  const authMode = resolveAstrBotAuthMode(row)

  if (authMode === 'api_key') {
    if (!row.apiKeyCiphertext) {
      throw new Error('AstrBot API key is not configured.')
    }

    return {
      ...baseConfig,
      apiKey: decryptSecret(row.apiKeyCiphertext, 'decrypt an AstrBot API key'),
    }
  }

  if (!row.bearerTokenCiphertext) {
    throw new Error('AstrBot bearer token is not configured.')
  }

  return {
    ...baseConfig,
    bearerToken: decryptSecret(
      row.bearerTokenCiphertext,
      'decrypt an AstrBot bearer token',
    ),
  }
}

export async function getCliSub2ApiConfig(): Promise<Sub2ApiConfig> {
  const row = await findSub2ApiServiceRow()
  if (!isSub2ApiConfigReady(row)) {
    throw new Error('Sub2API app configuration is not enabled.')
  }

  if (!row?.baseUrl) {
    throw new Error('Sub2API app configuration is incomplete.')
  }

  const authMode = resolveSub2ApiAuthMode(row)

  if (authMode === 'api_key') {
    if (!row.apiKeyCiphertext) {
      throw new Error('Sub2API API key is not configured.')
    }

    return {
      baseUrl: row.baseUrl,
      apiKey: decryptSecret(row.apiKeyCiphertext, 'decrypt a Sub2API API key'),
      loginPath: row.loginPath ?? undefined,
      refreshTokenPath: row.refreshTokenPath ?? undefined,
      accountsPath: row.accountsPath ?? undefined,
      clientId: row.clientId ?? undefined,
      proxyId: row.proxyId ?? undefined,
      concurrency: row.concurrency ?? undefined,
      priority: row.priority ?? undefined,
      groupIds: normalizeGroupIds(row.groupIds),
      autoFillRelatedModels: row.autoFillRelatedModels ?? undefined,
      confirmMixedChannelRisk: row.confirmMixedChannelRisk ?? undefined,
      openaiOAuthResponsesWebSocketV2Mode: resolveOpenAIWSModeUpdate(
        undefined,
        row.openaiOAuthResponsesWebSocketV2Mode,
      ),
    }
  }

  if (authMode === 'bearer_token') {
    if (!row.bearerTokenCiphertext) {
      throw new Error('Sub2API bearer token is not configured.')
    }

    return {
      baseUrl: row.baseUrl,
      bearerToken: decryptSecret(
        row.bearerTokenCiphertext,
        'decrypt a Sub2API bearer token',
      ),
      loginPath: row.loginPath ?? undefined,
      refreshTokenPath: row.refreshTokenPath ?? undefined,
      accountsPath: row.accountsPath ?? undefined,
      clientId: row.clientId ?? undefined,
      proxyId: row.proxyId ?? undefined,
      concurrency: row.concurrency ?? undefined,
      priority: row.priority ?? undefined,
      groupIds: normalizeGroupIds(row.groupIds),
      autoFillRelatedModels: row.autoFillRelatedModels ?? undefined,
      confirmMixedChannelRisk: row.confirmMixedChannelRisk ?? undefined,
      openaiOAuthResponsesWebSocketV2Mode: resolveOpenAIWSModeUpdate(
        undefined,
        row.openaiOAuthResponsesWebSocketV2Mode,
      ),
    }
  }

  if (!row.email || !row.passwordCiphertext) {
    throw new Error('Sub2API password auth is incomplete.')
  }

  return {
    baseUrl: row.baseUrl,
    email: row.email,
    password: decryptSecret(
      row.passwordCiphertext,
      'decrypt a Sub2API password',
    ),
    loginPath: row.loginPath ?? undefined,
    refreshTokenPath: row.refreshTokenPath ?? undefined,
    accountsPath: row.accountsPath ?? undefined,
    clientId: row.clientId ?? undefined,
    proxyId: row.proxyId ?? undefined,
    concurrency: row.concurrency ?? undefined,
    priority: row.priority ?? undefined,
    groupIds: normalizeGroupIds(row.groupIds),
    autoFillRelatedModels: row.autoFillRelatedModels ?? undefined,
    confirmMixedChannelRisk: row.confirmMixedChannelRisk ?? undefined,
    openaiOAuthResponsesWebSocketV2Mode: resolveOpenAIWSModeUpdate(
      undefined,
      row.openaiOAuthResponsesWebSocketV2Mode,
    ),
  }
}
