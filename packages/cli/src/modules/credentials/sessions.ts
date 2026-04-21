import type { CodeyAppConfig } from '../../config'
import { getRuntimeConfig } from '../../config'
import type {
  ChatGPTAuthSessionPayload,
  ChatGPTSessionSnapshot,
} from '../chatgpt/session'
import { AppVerificationProviderClient } from '../verification/app-client'

const STORE_VERSION = 1
const APP_SESSION_STORE_ROOT = 'codey-app://managed-sessions'

export interface StoredChatGPTSession {
  version: number
  identityId: string
  email: string
  flowType: 'chatgpt-register' | 'chatgpt-login'
  clientId: string
  auth: ChatGPTAuthSessionPayload
  sessionId?: string
  accountId?: string
  subject?: string
  authProvider?: string
  expiresAt?: string
  createdAt: string
  updatedAt: string
}

export interface StoredChatGPTSessionSummary {
  identityId: string
  email: string
  flowType: 'chatgpt-register' | 'chatgpt-login'
  clientId: string
  authMode: 'chatgpt'
  sessionId?: string
  accountId?: string
  expiresAt?: string
  lastRefresh: string
  hasRefreshToken: boolean
  hasIdToken: boolean
  storePath: string
}

export interface PersistedChatGPTSessionsResult {
  sessions: StoredChatGPTSession[]
  summaries: StoredChatGPTSessionSummary[]
  primarySummary?: StoredChatGPTSessionSummary
}

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
      'Codey app session storage is required. Set CODEY_APP_BASE_URL and app auth settings before running this flow.',
    )
  }

  return new AppVerificationProviderClient(config)
}

function buildStorePath(recordId: string): string {
  return `${APP_SESSION_STORE_ROOT}/${recordId}`
}

function summarize(
  session: StoredChatGPTSession,
  recordId: string,
): StoredChatGPTSessionSummary {
  return {
    identityId: session.identityId,
    email: session.email,
    flowType: session.flowType,
    clientId: session.clientId,
    authMode: session.auth.auth_mode,
    sessionId: session.sessionId,
    accountId: session.accountId,
    expiresAt: session.expiresAt,
    lastRefresh: session.auth.last_refresh,
    hasRefreshToken: Boolean(session.auth.tokens.refresh_token),
    hasIdToken: Boolean(session.auth.tokens.id_token),
    storePath: buildStorePath(recordId),
  }
}

function buildStoredSession(input: {
  identityId: string
  email: string
  flowType: 'chatgpt-register' | 'chatgpt-login'
  snapshot: ChatGPTSessionSnapshot
}): StoredChatGPTSession {
  const normalizedEmail = input.email.trim().toLowerCase()
  const normalizedClientId = input.snapshot.clientId.trim() || 'unknown'

  return {
    version: STORE_VERSION,
    identityId: input.identityId,
    email: normalizedEmail,
    flowType: input.flowType,
    clientId: normalizedClientId,
    auth: input.snapshot.auth,
    sessionId: input.snapshot.sessionId,
    accountId: input.snapshot.accountId,
    subject: input.snapshot.subject,
    authProvider: input.snapshot.authProvider,
    expiresAt: input.snapshot.expiresAt,
    createdAt: input.snapshot.capturedAt,
    updatedAt: input.snapshot.capturedAt,
  }
}

async function persistSingleChatGPTSession(
  client: AppVerificationProviderClient,
  input: {
    identityId: string
    email: string
    flowType: 'chatgpt-register' | 'chatgpt-login'
    snapshot: ChatGPTSessionSnapshot
  },
): Promise<{
  session: StoredChatGPTSession
  summary: StoredChatGPTSessionSummary
}> {
  const session = buildStoredSession(input)
  const response = await client.upsertManagedSession({
    identityId: session.identityId,
    email: session.email,
    flowType: session.flowType,
    clientId: session.clientId,
    authMode: session.auth.auth_mode,
    accountId: session.accountId,
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    lastRefreshAt: session.auth.last_refresh,
    sessionData: session.auth,
  })

  return {
    session,
    summary: summarize(session, response.id),
  }
}

export async function persistChatGPTSessions(input: {
  identityId: string
  email: string
  flowType: 'chatgpt-register' | 'chatgpt-login'
  snapshots: ChatGPTSessionSnapshot[]
}): Promise<PersistedChatGPTSessionsResult> {
  const client = createCodeyAppClient()
  const persisted = await Promise.all(
    input.snapshots.map((snapshot) =>
      persistSingleChatGPTSession(client, {
        identityId: input.identityId,
        email: input.email,
        flowType: input.flowType,
        snapshot,
      }),
    ),
  )

  return {
    sessions: persisted.map((entry) => entry.session),
    summaries: persisted.map((entry) => entry.summary),
    primarySummary: persisted[0]?.summary,
  }
}

export async function persistChatGPTSession(input: {
  identityId: string
  email: string
  flowType: 'chatgpt-register' | 'chatgpt-login'
  snapshot: ChatGPTSessionSnapshot
}): Promise<{
  session: StoredChatGPTSession
  summary: StoredChatGPTSessionSummary
}> {
  const persisted = await persistChatGPTSessions({
    identityId: input.identityId,
    email: input.email,
    flowType: input.flowType,
    snapshots: [input.snapshot],
  })

  const session = persisted.sessions[0]
  const summary = persisted.primarySummary
  if (!session || !summary) {
    throw new Error('Unable to persist ChatGPT session snapshot')
  }

  return {
    session,
    summary,
  }
}
