export interface ManagedSessionExportSource {
  id: string
  identityLabel: string
  email: string
  clientId: string
  authMode: string
  flowType: string
  sessionData: Record<string, unknown>
}

const DEFAULT_CHATGPT_TOKEN_KEYS = [
  'id_token',
  'access_token',
  'refresh_token',
  'account_id',
] as const

const DEFAULT_CODEX_TOKEN_KEYS = [
  'id_token',
  'access_token',
  'refresh_token',
  'account_id',
  'token_type',
  'scope',
  'expires_at',
] as const

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeScalar(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.trim() || null
  }

  return value ?? null
}

function getDefaultTokenKeys(authMode: string) {
  return authMode === 'codex-oauth'
    ? DEFAULT_CODEX_TOKEN_KEYS
    : DEFAULT_CHATGPT_TOKEN_KEYS
}

function slugifyFilePart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'session'
}

export function isCodexAuthManagedSession(
  session: ManagedSessionExportSource,
): boolean {
  const sessionData = asRecord(session.sessionData) ?? {}
  const authMode =
    asTrimmedString(sessionData.auth_mode)?.toLowerCase() ||
    session.authMode.trim().toLowerCase()
  const flowType = session.flowType.trim().toLowerCase()
  const provider = asTrimmedString(sessionData.provider)?.toLowerCase()

  return (
    authMode === 'codex-oauth' ||
    flowType === 'codex-oauth' ||
    provider === 'codex'
  )
}

export function buildManagedSessionAuthJson(
  session: ManagedSessionExportSource,
): Record<string, unknown> | null {
  const sessionData = asRecord(session.sessionData)
  if (!sessionData) {
    return null
  }

  const authMode =
    asTrimmedString(sessionData.auth_mode) ||
    session.authMode.trim() ||
    session.flowType.trim() ||
    'unknown'
  const normalizedAuthMode = authMode.toLowerCase()
  const tokensRecord = asRecord(sessionData.tokens) ?? {}
  const normalizedTokens: Record<string, unknown> = {}

  for (const key of getDefaultTokenKeys(normalizedAuthMode)) {
    normalizedTokens[key] = normalizeScalar(tokensRecord[key])
  }

  for (const [key, value] of Object.entries(tokensRecord)) {
    if (key in normalizedTokens) {
      continue
    }

    normalizedTokens[key] = normalizeScalar(value)
  }

  return {
    ...sessionData,
    auth_mode: authMode,
    OPENAI_API_KEY:
      sessionData.OPENAI_API_KEY === null
        ? null
        : asTrimmedString(sessionData.OPENAI_API_KEY) ?? null,
    client_id: asTrimmedString(sessionData.client_id) ?? session.clientId,
    provider:
      asTrimmedString(sessionData.provider) ??
      (isCodexAuthManagedSession(session) ? 'codex' : undefined),
    last_refresh: asTrimmedString(sessionData.last_refresh) ?? null,
    tokens: normalizedTokens,
  }
}

export function buildManagedSessionAuthJsonFileName(
  session: ManagedSessionExportSource,
): string {
  const flowPart = isCodexAuthManagedSession(session) ? 'codex-auth' : 'auth'
  const identityPart = slugifyFilePart(session.email || session.identityLabel)
  const clientPart = slugifyFilePart(session.clientId || 'client')
  const suffix = slugifyFilePart(session.id).slice(-8) || 'session'

  return `${flowPart}-${identityPart}-${clientPart}-${suffix}-auth.json`
}
