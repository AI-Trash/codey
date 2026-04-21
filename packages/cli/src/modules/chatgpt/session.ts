import type { Page, Request, Response } from 'patchright'
import { CHATGPT_HOME_URL } from './common'

const CHATGPT_AUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CHATGPT_BACKEND_API_PREFIX = 'https://chatgpt.com/backend-api/'
const CHATGPT_CAPTURE_ORIGINS = [
  'https://auth.openai.com',
  'https://chatgpt.com',
] as const
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
const CLIENT_ID_PATTERN =
  /(?:["'](?:client_id|clientId)["']\s*:\s*["']|[?&]client_id=)([^"'&\s<>{}]+)/g
const MAX_CAPTURED_TEXT_LENGTH = 750_000

interface ChatGPTTokenPayload {
  access_token?: string
  refresh_token?: string
  id_token?: string
  client_id?: string
}

type JwtClaims = Record<string, unknown>

type ObservedTokenKind =
  | 'access_token'
  | 'refresh_token'
  | 'id_token'
  | 'bearer'
  | 'jwt'

interface ObservedToken {
  kind: ObservedTokenKind
  token: string
  url: string
  observedAt: string
  clientIdHint?: string
  sessionIdHint?: string
  accountIdHint?: string
}

interface RankedToken {
  token: string
  priority: number
}

interface SessionBucket {
  clientId: string
  accessToken?: RankedToken
  refreshToken?: RankedToken
  idToken?: RankedToken
  sessionIds: Set<string>
  accountIds: Set<string>
  emails: Set<string>
  subjects: Set<string>
  authProviders: Set<string>
}

export interface ChatGPTAuthSessionPayload {
  auth_mode: 'chatgpt'
  OPENAI_API_KEY: null
  client_id: string
  tokens: {
    id_token: string | null
    access_token: string | null
    refresh_token: string | null
    account_id: string | null
  }
  last_refresh: string
}

export interface ChatGPTSessionSnapshot {
  clientId: string
  auth: ChatGPTAuthSessionPayload
  capturedAt: string
  sessionId?: string
  accountId?: string
  subject?: string
  email?: string
  authProvider?: string
  expiresAt?: string
  hasRefreshToken: boolean
  hasIdToken: boolean
}

export interface ChatGPTSessionCapture {
  capture(): Promise<ChatGPTSessionSnapshot[]>
  dispose(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function pickFirst(values: Iterable<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = asTrimmedString(value)
    if (normalized) {
      return normalized
    }
  }

  return undefined
}

function readNestedValue(
  value: Record<string, unknown> | undefined,
  path: string[],
): unknown {
  let current: unknown = value

  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined
    }
    current = current[segment]
  }

  return current
}

function readNestedString(
  value: Record<string, unknown> | undefined,
  paths: string[][],
): string | undefined {
  for (const path of paths) {
    const resolved = asTrimmedString(readNestedValue(value, path))
    if (resolved) {
      return resolved
    }
  }

  return undefined
}

function decodeJwtClaims(token: string | undefined): JwtClaims | undefined {
  if (!token) {
    return undefined
  }

  const [, payload] = token.split('.')
  if (!payload) {
    return undefined
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as unknown
    return isRecord(decoded) ? decoded : undefined
  } catch {
    return undefined
  }
}

function readJwtIsoTimestamp(
  claims: JwtClaims | undefined,
  key: string,
): string | undefined {
  const value = readNestedValue(claims, [key])
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : undefined
}

function extractAccountId(claims: JwtClaims | undefined): string | undefined {
  return readNestedString(claims, [
    ['account_id'],
    ['chatgpt_account_id'],
    ['https://api.openai.com/auth', 'chatgpt_account_id'],
  ])
}

function extractEmail(claims: JwtClaims | undefined): string | undefined {
  return readNestedString(claims, [
    ['email'],
    ['https://api.openai.com/profile', 'email'],
  ])
}

function extractSessionId(claims: JwtClaims | undefined): string | undefined {
  return readNestedString(claims, [['session_id'], ['sid']])
}

function extractSubject(claims: JwtClaims | undefined): string | undefined {
  return readNestedString(claims, [['sub']])
}

function extractAuthProvider(
  claims: JwtClaims | undefined,
): string | undefined {
  return readNestedString(claims, [
    ['auth_provider'],
    ['https://api.openai.com/auth', 'auth_provider'],
  ])
}

function extractClientId(claims: JwtClaims | undefined): string | undefined {
  return readNestedString(claims, [
    ['client_id'],
    ['azp'],
    ['https://api.openai.com/auth', 'client_id'],
  ])
}

function parseJson(text: string | undefined): Record<string, unknown> | null {
  if (!text) {
    return null
  }

  try {
    const parsed = JSON.parse(text) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseTokenPayload(text: string): ChatGPTTokenPayload | null {
  const parsed = parseJson(text)
  if (!parsed) {
    return null
  }

  const accessToken = asTrimmedString(parsed.access_token)
  const refreshToken = asTrimmedString(parsed.refresh_token)
  const idToken = asTrimmedString(parsed.id_token)
  const clientId =
    asTrimmedString(parsed.client_id) || asTrimmedString(parsed.clientId)

  if (!accessToken && !refreshToken && !idToken && !clientId) {
    return null
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    id_token: idToken,
    client_id: clientId,
  }
}

function scanJwtTokens(text: string | undefined): string[] {
  if (!text) {
    return []
  }

  const limitedText = text.slice(0, MAX_CAPTURED_TEXT_LENGTH)
  return Array.from(new Set(limitedText.match(JWT_PATTERN) || []))
}

function scanClientIds(text: string | undefined): string[] {
  if (!text) {
    return []
  }

  const limitedText = text.slice(0, MAX_CAPTURED_TEXT_LENGTH)
  const results = new Set<string>()
  for (const match of limitedText.matchAll(CLIENT_ID_PATTERN)) {
    const rawValue = asTrimmedString(match[1])
    if (!rawValue) {
      continue
    }

    try {
      results.add(decodeURIComponent(rawValue))
    } catch {
      results.add(rawValue)
    }
  }

  return Array.from(results)
}

function scanJwtTokensInValue(
  value: unknown,
  accumulator: Set<string> = new Set<string>(),
): Set<string> {
  if (!value) {
    return accumulator
  }

  if (typeof value === 'string') {
    for (const token of scanJwtTokens(value)) {
      accumulator.add(token)
    }
    return accumulator
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      scanJwtTokensInValue(item, accumulator)
    }
    return accumulator
  }

  if (isRecord(value)) {
    for (const entry of Object.values(value)) {
      scanJwtTokensInValue(entry, accumulator)
    }
  }

  return accumulator
}

function collectClientIdsFromValue(
  value: unknown,
  accumulator: Set<string> = new Set<string>(),
): Set<string> {
  if (!value) {
    return accumulator
  }

  if (typeof value === 'string') {
    for (const clientId of scanClientIds(value)) {
      accumulator.add(clientId)
    }
    return accumulator
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectClientIdsFromValue(item, accumulator)
    }
    return accumulator
  }

  if (isRecord(value)) {
    const directClientId =
      asTrimmedString(value.client_id) || asTrimmedString(value.clientId)
    if (directClientId) {
      accumulator.add(directClientId)
    }

    for (const entry of Object.values(value)) {
      collectClientIdsFromValue(entry, accumulator)
    }
  }

  return accumulator
}

function hasCaptureOrigin(url: string): boolean {
  return CHATGPT_CAPTURE_ORIGINS.some((origin) => url.startsWith(origin))
}

function shouldInspectResponse(response: Response): boolean {
  const url = response.url()
  if (url.startsWith(CHATGPT_AUTH_TOKEN_URL)) {
    return true
  }

  if (!hasCaptureOrigin(url)) {
    return false
  }

  const contentType = response.headers()['content-type'] || ''
  return /application\/json|text\/html|text\/plain/i.test(contentType)
}

function shouldInspectRequest(request: Request): boolean {
  const url = request.url()
  return url.startsWith(CHATGPT_BACKEND_API_PREFIX) || hasCaptureOrigin(url)
}

function readClientIdFromUrl(url: string): string | undefined {
  try {
    return asTrimmedString(new URL(url).searchParams.get('client_id'))
  } catch {
    return undefined
  }
}

function classifyGenericJwtKind(
  claims: JwtClaims | undefined,
): ObservedTokenKind {
  const audience = readNestedValue(claims, ['aud'])
  const normalizedAudience = Array.isArray(audience)
    ? audience.map((entry) => String(entry))
    : typeof audience === 'string'
      ? [audience]
      : []

  if (
    normalizedAudience.some((entry) =>
      entry.includes('https://api.openai.com/v1'),
    ) ||
    asTrimmedString(readNestedValue(claims, ['scope']))
  ) {
    return 'access_token'
  }

  if (extractEmail(claims) || extractAuthProvider(claims)) {
    return 'id_token'
  }

  return 'jwt'
}

function getTokenPriority(kind: ObservedTokenKind): number {
  switch (kind) {
    case 'access_token':
      return 40
    case 'refresh_token':
      return 30
    case 'id_token':
      return 30
    case 'bearer':
      return 20
    default:
      return 10
  }
}

function setRankedToken(
  current: RankedToken | undefined,
  token: string,
  priority: number,
): RankedToken {
  if (!current || priority >= current.priority) {
    return {
      token,
      priority,
    }
  }

  return current
}

async function readCurrentAccountCookie(
  page: Page,
): Promise<string | undefined> {
  const cookie = (await page.context().cookies(CHATGPT_HOME_URL)).find(
    (entry) => entry.name === '_account',
  )
  return asTrimmedString(cookie?.value)
}

function getOrCreateBucket(
  buckets: Map<string, SessionBucket>,
  clientId: string,
): SessionBucket {
  const existing = buckets.get(clientId)
  if (existing) {
    return existing
  }

  const created: SessionBucket = {
    clientId,
    sessionIds: new Set<string>(),
    accountIds: new Set<string>(),
    emails: new Set<string>(),
    subjects: new Set<string>(),
    authProviders: new Set<string>(),
  }
  buckets.set(clientId, created)
  return created
}

export function createChatGPTSessionCapture(page: Page): ChatGPTSessionCapture {
  const observedTokens: ObservedToken[] = []
  const observedTokenKeys = new Set<string>()
  const observedClientIds = new Set<string>()
  const observedSessionIds = new Set<string>()
  const observedAccountIds = new Set<string>()
  const pendingReads = new Set<Promise<void>>()

  const track = (promise: Promise<void>) => {
    pendingReads.add(promise)
    promise.finally(() => {
      pendingReads.delete(promise)
    })
  }

  const recordClientIds = (clientIds: Iterable<string | undefined>) => {
    for (const clientId of clientIds) {
      const normalized = asTrimmedString(clientId)
      if (normalized) {
        observedClientIds.add(normalized)
      }
    }
  }

  const recordObservedToken = (input: {
    kind: ObservedTokenKind
    token: string | undefined
    url: string
    observedAt: string
    clientIdHint?: string
    sessionIdHint?: string
    accountIdHint?: string
  }) => {
    const token = asTrimmedString(input.token)
    if (!token) {
      return
    }

    const key = `${input.kind}:${token}`
    if (observedTokenKeys.has(key)) {
      return
    }

    observedTokenKeys.add(key)
    observedTokens.push({
      kind: input.kind,
      token,
      url: input.url,
      observedAt: input.observedAt,
      clientIdHint: asTrimmedString(input.clientIdHint),
      sessionIdHint: asTrimmedString(input.sessionIdHint),
      accountIdHint: asTrimmedString(input.accountIdHint),
    })
  }

  const handleRequest = (request: Request) => {
    if (!shouldInspectRequest(request)) {
      return
    }

    const url = request.url()
    const observedAt = new Date().toISOString()
    const headers = request.headers()
    const postData = request.postData() || ''
    const parsedBody = parseJson(postData)
    const clientIdHint =
      asTrimmedString(parsedBody?.client_id) ||
      asTrimmedString(parsedBody?.clientId) ||
      readClientIdFromUrl(url) ||
      scanClientIds(postData)[0]
    const sessionIdHint = asTrimmedString(headers['oai-session-id'])
    const accountIdHint = asTrimmedString(headers['chatgpt-account-id'])

    recordClientIds([
      clientIdHint,
      ...scanClientIds(postData),
      ...collectClientIdsFromValue(parsedBody),
    ])

    if (sessionIdHint) {
      observedSessionIds.add(sessionIdHint)
    }
    if (accountIdHint) {
      observedAccountIds.add(accountIdHint)
    }

    const authorization = asTrimmedString(headers.authorization)
    if (authorization?.toLowerCase().startsWith('bearer ')) {
      recordObservedToken({
        kind: 'bearer',
        token: authorization.slice(7).trim(),
        url,
        observedAt,
        clientIdHint,
        sessionIdHint,
        accountIdHint,
      })
    }

    for (const token of scanJwtTokens(postData)) {
      recordObservedToken({
        kind: 'jwt',
        token,
        url,
        observedAt,
        clientIdHint,
        sessionIdHint,
        accountIdHint,
      })
    }
  }

  const handleResponse = (response: Response) => {
    if (!shouldInspectResponse(response)) {
      return
    }

    track(
      (async () => {
        try {
          const observedAt = new Date().toISOString()
          const url = response.url()
          const text = (await response.text()).slice(
            0,
            MAX_CAPTURED_TEXT_LENGTH,
          )
          const parsedJson = parseJson(text)
          const parsedTokenPayload = parseTokenPayload(text)
          const request = response.request()
          const requestPostData = request.postData() || ''
          const requestJson = parseJson(requestPostData)
          const requestClientId =
            asTrimmedString(requestJson?.client_id) ||
            asTrimmedString(requestJson?.clientId) ||
            readClientIdFromUrl(request.url()) ||
            readClientIdFromUrl(url)

          recordClientIds([
            requestClientId,
            parsedTokenPayload?.client_id,
            ...scanClientIds(text),
            ...collectClientIdsFromValue(parsedJson),
          ])

          if (parsedTokenPayload) {
            recordObservedToken({
              kind: 'access_token',
              token: parsedTokenPayload.access_token,
              url,
              observedAt,
              clientIdHint: parsedTokenPayload.client_id || requestClientId,
            })
            recordObservedToken({
              kind: 'refresh_token',
              token: parsedTokenPayload.refresh_token,
              url,
              observedAt,
              clientIdHint: parsedTokenPayload.client_id || requestClientId,
            })
            recordObservedToken({
              kind: 'id_token',
              token: parsedTokenPayload.id_token,
              url,
              observedAt,
              clientIdHint: parsedTokenPayload.client_id || requestClientId,
            })
          }

          for (const token of scanJwtTokens(text)) {
            recordObservedToken({
              kind: 'jwt',
              token,
              url,
              observedAt,
              clientIdHint: requestClientId,
            })
          }

          for (const token of scanJwtTokensInValue(parsedJson || {})) {
            recordObservedToken({
              kind: 'jwt',
              token,
              url,
              observedAt,
              clientIdHint: requestClientId,
            })
          }
        } catch {}
      })(),
    )
  }

  page.on('response', handleResponse)
  page.on('request', handleRequest)

  return {
    async capture(): Promise<ChatGPTSessionSnapshot[]> {
      await Promise.allSettled(pendingReads)

      const capturedAt = new Date().toISOString()
      const accountCookie = await readCurrentAccountCookie(page)
      if (accountCookie) {
        observedAccountIds.add(accountCookie)
      }

      try {
        const pageMarkup = (await page.content()).slice(
          0,
          MAX_CAPTURED_TEXT_LENGTH,
        )
        recordClientIds(scanClientIds(pageMarkup))
        for (const token of scanJwtTokens(pageMarkup)) {
          recordObservedToken({
            kind: 'jwt',
            token,
            url: page.url(),
            observedAt: capturedAt,
          })
        }
      } catch {}

      const onlyObservedClientId =
        observedClientIds.size === 1
          ? Array.from(observedClientIds)[0]
          : undefined
      const buckets = new Map<string, SessionBucket>()

      for (const observation of observedTokens) {
        const claims = decodeJwtClaims(observation.token)
        const normalizedKind =
          observation.kind === 'jwt'
            ? classifyGenericJwtKind(claims)
            : observation.kind
        const clientId =
          observation.clientIdHint ||
          extractClientId(claims) ||
          onlyObservedClientId ||
          'unknown'
        const bucket = getOrCreateBucket(buckets, clientId)

        if (observation.sessionIdHint) {
          bucket.sessionIds.add(observation.sessionIdHint)
        }
        if (observation.accountIdHint) {
          bucket.accountIds.add(observation.accountIdHint)
        }

        const claimsSessionId = extractSessionId(claims)
        if (claimsSessionId) {
          bucket.sessionIds.add(claimsSessionId)
        }

        const claimsAccountId = extractAccountId(claims)
        if (claimsAccountId) {
          bucket.accountIds.add(claimsAccountId)
        }

        const email = extractEmail(claims)
        if (email) {
          bucket.emails.add(email)
        }

        const subject = extractSubject(claims)
        if (subject) {
          bucket.subjects.add(subject)
        }

        const authProvider = extractAuthProvider(claims)
        if (authProvider) {
          bucket.authProviders.add(authProvider)
        }

        switch (normalizedKind) {
          case 'access_token':
          case 'bearer':
            bucket.accessToken = setRankedToken(
              bucket.accessToken,
              observation.token,
              getTokenPriority(normalizedKind),
            )
            break
          case 'refresh_token':
            bucket.refreshToken = setRankedToken(
              bucket.refreshToken,
              observation.token,
              getTokenPriority(normalizedKind),
            )
            break
          case 'id_token':
            bucket.idToken = setRankedToken(
              bucket.idToken,
              observation.token,
              getTokenPriority(normalizedKind),
            )
            break
          default:
            break
        }
      }

      if (buckets.size === 0 && (onlyObservedClientId || accountCookie)) {
        const fallbackClientId = onlyObservedClientId || 'unknown'
        const bucket = getOrCreateBucket(buckets, fallbackClientId)
        for (const sessionId of observedSessionIds) {
          bucket.sessionIds.add(sessionId)
        }
        for (const accountId of observedAccountIds) {
          bucket.accountIds.add(accountId)
        }
      }

      const snapshots = Array.from(buckets.values())
        .map((bucket) => {
          const accessToken = bucket.accessToken?.token
          const refreshToken = bucket.refreshToken?.token
          const idToken = bucket.idToken?.token
          const accessClaims = decodeJwtClaims(accessToken)
          const idClaims = decodeJwtClaims(idToken)
          const accountId = pickFirst([
            ...bucket.accountIds,
            accountCookie,
            extractAccountId(accessClaims),
            extractAccountId(idClaims),
          ])

          if (!accessToken && !refreshToken && !idToken && !accountId) {
            return null
          }

          const auth: ChatGPTAuthSessionPayload = {
            auth_mode: 'chatgpt',
            OPENAI_API_KEY: null,
            client_id: bucket.clientId,
            tokens: {
              id_token: idToken || null,
              access_token: accessToken || null,
              refresh_token: refreshToken || null,
              account_id: accountId || null,
            },
            last_refresh: capturedAt,
          }

          return {
            clientId: bucket.clientId,
            auth,
            capturedAt,
            sessionId: pickFirst([
              ...bucket.sessionIds,
              extractSessionId(accessClaims),
              extractSessionId(idClaims),
            ]),
            accountId,
            subject: pickFirst([
              ...bucket.subjects,
              extractSubject(idClaims),
              extractSubject(accessClaims),
            ]),
            email: pickFirst([
              ...bucket.emails,
              extractEmail(idClaims),
              extractEmail(accessClaims),
            ]),
            authProvider: pickFirst([
              ...bucket.authProviders,
              extractAuthProvider(idClaims),
              extractAuthProvider(accessClaims),
            ]),
            expiresAt:
              readJwtIsoTimestamp(accessClaims, 'exp') ||
              readJwtIsoTimestamp(idClaims, 'exp'),
            hasRefreshToken: Boolean(refreshToken),
            hasIdToken: Boolean(idToken),
          } satisfies ChatGPTSessionSnapshot
        })
        .filter((snapshot): snapshot is ChatGPTSessionSnapshot =>
          Boolean(snapshot),
        )

      return snapshots.sort((left, right) => {
        const leftScore =
          Number(left.hasRefreshToken) * 8 +
          Number(left.hasIdToken) * 4 +
          Number(Boolean(left.auth.tokens.access_token)) * 2 +
          Number(left.clientId !== 'unknown')
        const rightScore =
          Number(right.hasRefreshToken) * 8 +
          Number(right.hasIdToken) * 4 +
          Number(Boolean(right.auth.tokens.access_token)) * 2 +
          Number(right.clientId !== 'unknown')
        return rightScore - leftScore
      })
    },
    dispose(): void {
      page.off('response', handleResponse)
      page.off('request', handleRequest)
    },
  }
}
