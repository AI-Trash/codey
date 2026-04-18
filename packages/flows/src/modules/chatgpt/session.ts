import type { Page, Request, Response } from 'patchright'
import { CHATGPT_HOME_URL } from './common'

const CHATGPT_AUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CHATGPT_BACKEND_API_PREFIX = 'https://chatgpt.com/backend-api/'

interface ChatGPTTokenPayload {
  access_token?: string
  refresh_token?: string
  id_token?: string
}

type JwtClaims = Record<string, unknown>

export interface ChatGPTAuthSessionPayload {
  auth_mode: 'chatgpt'
  OPENAI_API_KEY: null
  tokens: {
    id_token: string | null
    access_token: string | null
    refresh_token: string | null
    account_id: string | null
  }
  last_refresh: string
}

export interface ChatGPTSessionSnapshot {
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
  capture(): Promise<ChatGPTSessionSnapshot | null>
  dispose(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
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

function parseTokenPayload(text: string): ChatGPTTokenPayload | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed)) {
      return null
    }

    const accessToken = asTrimmedString(parsed.access_token)
    const refreshToken = asTrimmedString(parsed.refresh_token)
    const idToken = asTrimmedString(parsed.id_token)

    if (!accessToken && !refreshToken && !idToken) {
      return null
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      id_token: idToken,
    }
  } catch {
    return null
  }
}

async function readCurrentAccountCookie(
  page: Page,
): Promise<string | undefined> {
  const cookie = (await page.context().cookies(CHATGPT_HOME_URL)).find(
    (entry) => entry.name === '_account',
  )
  return asTrimmedString(cookie?.value)
}

export function createChatGPTSessionCapture(page: Page): ChatGPTSessionCapture {
  let latestTokenPayload: ChatGPTTokenPayload | undefined
  let latestRequestAccessToken: string | undefined
  let latestRequestSessionId: string | undefined
  let latestRequestAccountId: string | undefined
  const pendingReads = new Set<Promise<void>>()

  const track = (promise: Promise<void>) => {
    pendingReads.add(promise)
    promise.finally(() => {
      pendingReads.delete(promise)
    })
  }

  const handleResponse = (response: Response) => {
    if (!response.url().startsWith(CHATGPT_AUTH_TOKEN_URL)) {
      return
    }

    track(
      (async () => {
        try {
          const text = await response.text()
          const parsed = parseTokenPayload(text)
          if (!parsed) {
            return
          }

          latestTokenPayload = {
            ...latestTokenPayload,
            ...parsed,
          }
        } catch {}
      })(),
    )
  }

  const handleRequest = (request: Request) => {
    if (!request.url().startsWith(CHATGPT_BACKEND_API_PREFIX)) {
      return
    }

    const headers = request.headers()
    const authorization = asTrimmedString(headers.authorization)
    if (authorization?.toLowerCase().startsWith('bearer ')) {
      latestRequestAccessToken = authorization.slice(7).trim()
    }

    latestRequestSessionId =
      asTrimmedString(headers['oai-session-id']) || latestRequestSessionId
    latestRequestAccountId =
      asTrimmedString(headers['chatgpt-account-id']) || latestRequestAccountId
  }

  page.on('response', handleResponse)
  page.on('request', handleRequest)

  return {
    async capture(): Promise<ChatGPTSessionSnapshot | null> {
      await Promise.allSettled(pendingReads)

      const accessToken =
        latestTokenPayload?.access_token || latestRequestAccessToken
      const refreshToken = latestTokenPayload?.refresh_token
      const idToken = latestTokenPayload?.id_token
      const accessClaims = decodeJwtClaims(accessToken)
      const idClaims = decodeJwtClaims(idToken)
      const capturedAt = new Date().toISOString()
      const accountId =
        (await readCurrentAccountCookie(page)) ||
        latestRequestAccountId ||
        extractAccountId(accessClaims) ||
        extractAccountId(idClaims)

      if (!accessToken && !refreshToken && !idToken && !accountId) {
        return null
      }

      const auth: ChatGPTAuthSessionPayload = {
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          id_token: idToken || null,
          access_token: accessToken || null,
          refresh_token: refreshToken || null,
          account_id: accountId || null,
        },
        last_refresh: capturedAt,
      }

      return {
        auth,
        capturedAt,
        sessionId:
          latestRequestSessionId ||
          extractSessionId(accessClaims) ||
          extractSessionId(idClaims),
        accountId,
        subject: extractSubject(idClaims) || extractSubject(accessClaims),
        email: extractEmail(idClaims) || extractEmail(accessClaims),
        authProvider:
          extractAuthProvider(idClaims) || extractAuthProvider(accessClaims),
        expiresAt:
          readJwtIsoTimestamp(accessClaims, 'exp') ||
          readJwtIsoTimestamp(idClaims, 'exp'),
        hasRefreshToken: Boolean(refreshToken),
        hasIdToken: Boolean(idToken),
      }
    },
    dispose(): void {
      page.off('response', handleResponse)
      page.off('request', handleRequest)
    },
  }
}
