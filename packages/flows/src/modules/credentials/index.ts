import crypto from 'crypto'

import type { CodeyAppConfig } from '../../config'
import { getRuntimeConfig } from '../../config'
import {
  AppVerificationProviderClient,
  type AppManagedIdentityMetadata,
  type AppManagedIdentityRecord,
  type AppManagedIdentitySummaryRecord,
} from '../verification/app-client'

export interface StoredChatGPTIdentity {
  id: string
  provider: 'chatgpt'
  createdAt: string
  updatedAt: string
  email: string
  password: string
  metadata: {
    prefix?: string
    mailbox?: string
    source: 'chatgpt-register'
    chatgptUrl?: string
  }
}

export interface StoredChatGPTIdentitySummary {
  id: string
  email: string
  createdAt: string
  updatedAt: string
  credentialCount: number
  storePath: string
  encrypted: boolean
}

export interface PersistChatGPTIdentityInput {
  email: string
  password: string
  prefix?: string
  mailbox?: string
}

export interface ResolveChatGPTIdentityOptions {
  id?: string
  email?: string
}

export interface ResolvedChatGPTIdentity {
  identity: StoredChatGPTIdentity
  summary: StoredChatGPTIdentitySummary
}

export interface StoredChatGPTIdentityStoreSummary {
  rootPath: string
  accountDirectoryPath: string
  legacyStorePath: string
  identityCount: number
  encrypted: boolean
}

const APP_IDENTITY_STORE_ROOT = 'codey-app://managed-identities'

function resolveCodeyAppConfig(): CodeyAppConfig {
  const config = getRuntimeConfig()
  const sharedAppConfig = config.app
  const verificationAppConfig = config.verification?.app

  return {
    baseUrl: verificationAppConfig?.baseUrl ?? sharedAppConfig?.baseUrl,
    oidcIssuer:
      verificationAppConfig?.oidcIssuer ?? sharedAppConfig?.oidcIssuer,
    oidcBasePath:
      verificationAppConfig?.oidcBasePath ?? sharedAppConfig?.oidcBasePath,
    clientId: verificationAppConfig?.clientId ?? sharedAppConfig?.clientId,
    clientSecret:
      verificationAppConfig?.clientSecret ?? sharedAppConfig?.clientSecret,
    scope: verificationAppConfig?.scope ?? sharedAppConfig?.scope,
    resource: verificationAppConfig?.resource ?? sharedAppConfig?.resource,
    tokenEndpointAuthMethod:
      verificationAppConfig?.tokenEndpointAuthMethod ??
      sharedAppConfig?.tokenEndpointAuthMethod,
  }
}

function createCodeyAppClient(): AppVerificationProviderClient {
  const config = resolveCodeyAppConfig()
  if (!config.baseUrl?.trim()) {
    throw new Error(
      'Codey app identity storage is required. Set CODEY_APP_BASE_URL and app auth settings before running this flow.',
    )
  }

  return new AppVerificationProviderClient(config)
}

function buildStorePath(identityId: string): string {
  return `${APP_IDENTITY_STORE_ROOT}/${identityId}`
}

function buildMetadata(
  input: PersistChatGPTIdentityInput,
): AppManagedIdentityMetadata {
  return {
    prefix: input.prefix,
    mailbox: input.mailbox,
    source: 'chatgpt-register',
    chatgptUrl: getRuntimeConfig().openai.chatgptUrl,
  }
}

function toStoredIdentity(
  record: AppManagedIdentityRecord,
): StoredChatGPTIdentity {
  return {
    id: record.id,
    provider: 'chatgpt',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    email: record.email,
    password: record.password,
    metadata: {
      prefix: record.metadata?.prefix,
      mailbox: record.metadata?.mailbox,
      source: 'chatgpt-register',
      chatgptUrl: record.metadata?.chatgptUrl,
    },
  }
}

function toSummary(
  record: Pick<
    AppManagedIdentitySummaryRecord,
    'id' | 'email' | 'createdAt' | 'updatedAt' | 'credentialCount' | 'encrypted'
  >,
): StoredChatGPTIdentitySummary {
  return {
    id: record.id,
    email: record.email,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    credentialCount: record.credentialCount,
    storePath: buildStorePath(record.id),
    encrypted: record.encrypted,
  }
}

export async function listStoredChatGPTIdentitySummaries(): Promise<
  StoredChatGPTIdentitySummary[]
> {
  const client = createCodeyAppClient()
  const identities = await client.listManagedIdentities()
  return identities.map((record) => toSummary(record))
}

export async function getStoredChatGPTIdentityStoreSummary(): Promise<StoredChatGPTIdentityStoreSummary> {
  const summaries = await listStoredChatGPTIdentitySummaries()
  return {
    rootPath: APP_IDENTITY_STORE_ROOT,
    accountDirectoryPath: APP_IDENTITY_STORE_ROOT,
    legacyStorePath: APP_IDENTITY_STORE_ROOT,
    identityCount: summaries.length,
    encrypted: summaries.some((summary) => summary.encrypted),
  }
}

export async function persistChatGPTIdentity(
  input: PersistChatGPTIdentityInput,
): Promise<ResolvedChatGPTIdentity> {
  const client = createCodeyAppClient()
  const normalizedEmail = input.email.trim().toLowerCase()
  const identityId = crypto.randomUUID()

  await client.upsertManagedIdentity({
    identityId,
    email: normalizedEmail,
    password: input.password,
    metadata: buildMetadata(input),
  })

  const stored = await client.getManagedIdentity({
    identityId,
  })

  return {
    identity: toStoredIdentity(stored),
    summary: toSummary(stored),
  }
}

export async function resolveStoredChatGPTIdentity(
  options: ResolveChatGPTIdentityOptions = {},
): Promise<ResolvedChatGPTIdentity> {
  const client = createCodeyAppClient()
  const stored = await client.getManagedIdentity({
    identityId: options.id,
    email: options.email,
  })

  return {
    identity: toStoredIdentity(stored),
    summary: toSummary(stored),
  }
}
