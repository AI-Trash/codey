import crypto from 'crypto'
import type { Page, Route } from 'patchright'
import {
  waitForAuthorizationCode as waitForAuthorizationCodeViaServer,
  type AuthorizationCallbackPayload,
  type CallbackServerOptions as AuthorizationCallbackOptions,
} from './callback-server'

export interface PkcePair {
  verifier: string
  challenge: string
  method: 'S256'
}

export interface BuildAuthorizationUrlOptions {
  authorizeUrl: string
  clientId: string
  redirectUri: string
  scope?: string
  state?: string
  extraParams?: Record<string, string | number | boolean | null | undefined>
  pkce?: boolean
}

export interface BuildAuthorizationUrlResult {
  authorizationUrl: string
  state: string
  codeVerifier: string | null
  codeChallenge: string | null
  codeChallengeMethod: 'S256' | null
}

export interface RunAuthorizationCodeFlowOptions {
  startUrl: string
  callback?: AuthorizationCallbackOptions
  expectedState?: string
  afterNavigation?: (page: Page) => Promise<void>
}

export interface AuthorizationCallbackCaptureHandle {
  result: Promise<AuthorizationCallbackPayload>
  abort: () => Promise<void>
}

const defaultAuthorizationSuccessHtml =
  '<html><body><h1>Authorization received</h1><p>You can close this window now.</p></body></html>'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeCallbackPath(path = '/auth/callback'): string {
  return path.startsWith('/') ? path : `/${path}`
}

function buildAuthorizationCallbackPayload(
  callbackUrl: string,
): AuthorizationCallbackPayload {
  const url = new URL(callbackUrl)

  return {
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    scope: url.searchParams.get('scope'),
    rawQuery: `${url.pathname}${url.search}`,
    callbackUrl,
  }
}

export async function createAuthorizationCallbackCapture(
  page: Page,
  options: AuthorizationCallbackOptions = {},
): Promise<AuthorizationCallbackCaptureHandle> {
  const {
    host = 'localhost',
    port = 1455,
    path = '/auth/callback',
    timeoutMs = 180000,
    successHtml,
    signal,
  } = options
  const normalizedPath = normalizeCallbackPath(path)
  const callbackUrlPattern = new RegExp(
    `^http://${escapeRegExp(host)}:${port}${escapeRegExp(normalizedPath)}(?:\\?.*)?$`,
  )
  let settled = false
  let cleanedUp = false
  let timer: NodeJS.Timeout | undefined
  let abortListener: (() => void) | undefined
  let pageCloseListener: (() => void) | undefined
  let contextCloseListener: (() => void) | undefined
  let browserDisconnectListener: (() => void) | undefined
  let resolveResult!: (payload: AuthorizationCallbackPayload) => void
  let rejectResult!: (error: Error) => void
  const context = page.context()
  const browser = context.browser()

  const result = new Promise<AuthorizationCallbackPayload>(
    (resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    },
  )

  const cleanup = async () => {
    if (cleanedUp) return
    cleanedUp = true
    if (timer) {
      clearTimeout(timer)
    }
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener)
    }
    if (pageCloseListener) {
      page.off('close', pageCloseListener)
    }
    if (contextCloseListener) {
      context.off('close', contextCloseListener)
    }
    if (browser && browserDisconnectListener) {
      browser.off('disconnected', browserDisconnectListener)
    }
    await page.unroute(callbackUrlPattern, routeHandler).catch(() => undefined)
  }

  const resolveCapturedResult = (payload: AuthorizationCallbackPayload) => {
    if (settled) return false
    settled = true
    resolveResult(payload)
    return true
  }

  const rejectCapturedResult = (error: unknown) => {
    if (settled) return false
    settled = true
    rejectResult(error instanceof Error ? error : new Error(String(error)))
    return true
  }

  const settleWithError = async (error: unknown) => {
    if (!rejectCapturedResult(error)) return
    await cleanup().catch(() => undefined)
  }

  const routeHandler = async (route: Route) => {
    try {
      const payload = buildAuthorizationCallbackPayload(route.request().url())
      const captured = resolveCapturedResult(payload)
      await route
        .fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: successHtml || defaultAuthorizationSuccessHtml,
        })
        .catch(() => undefined)
      if (captured) {
        await cleanup().catch(() => undefined)
      }
    } catch (error) {
      await settleWithError(error)
    }
  }

  await page.route(callbackUrlPattern, routeHandler)

  abortListener = () => {
    void settleWithError(new Error('Authorization callback wait aborted.'))
  }
  pageCloseListener = () => {
    void settleWithError(
      new Error(
        'Authorization callback wait aborted because the browser page was closed.',
      ),
    )
  }
  contextCloseListener = () => {
    void settleWithError(
      new Error(
        'Authorization callback wait aborted because the browser context was closed.',
      ),
    )
  }
  browserDisconnectListener = () => {
    void settleWithError(
      new Error(
        'Authorization callback wait aborted because the browser disconnected.',
      ),
    )
  }

  timer = setTimeout(() => {
    void settleWithError(
      new Error(
        `Timed out waiting for browser callback navigation to http://${host}:${port}${normalizedPath}`,
      ),
    )
  }, timeoutMs)

  page.on('close', pageCloseListener)
  context.on('close', contextCloseListener)
  browser?.on('disconnected', browserDisconnectListener)

  if (signal?.aborted) {
    await settleWithError(new Error('Authorization callback wait aborted.'))
  } else if (signal) {
    signal.addEventListener('abort', abortListener, { once: true })
  }

  return {
    result,
    abort: async () => {
      await settleWithError(new Error('Authorization callback wait aborted.'))
    },
  }
}

export function createPkcePair(): PkcePair {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url')
  return { verifier, challenge, method: 'S256' }
}

export function buildAuthorizationUrl(
  options: BuildAuthorizationUrlOptions,
): BuildAuthorizationUrlResult {
  const {
    authorizeUrl,
    clientId,
    redirectUri,
    scope,
    state = crypto.randomUUID(),
    extraParams = {},
    pkce = true,
  } = options

  if (!authorizeUrl || !clientId || !redirectUri) {
    throw new Error('authorizeUrl, clientId and redirectUri are required')
  }

  const url = new URL(authorizeUrl)
  const pkcePair = pkce ? createPkcePair() : null

  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  if (scope) url.searchParams.set('scope', scope)
  if (pkcePair) {
    url.searchParams.set('code_challenge', pkcePair.challenge)
    url.searchParams.set('code_challenge_method', pkcePair.method)
  }

  for (const [key, value] of Object.entries(extraParams)) {
    if (value != null) url.searchParams.set(key, String(value))
  }

  return {
    authorizationUrl: url.toString(),
    state,
    codeVerifier: pkcePair?.verifier || null,
    codeChallenge: pkcePair?.challenge || null,
    codeChallengeMethod: pkcePair?.method || null,
  }
}

export async function runAuthorizationCodeFlow(
  page: Page,
  options: RunAuthorizationCodeFlowOptions,
): Promise<AuthorizationCallbackPayload> {
  const { startUrl, callback = {}, expectedState, afterNavigation } = options
  if (!startUrl) {
    throw new Error('startUrl is required')
  }

  const callbackCapture = await createAuthorizationCallbackCapture(
    page,
    callback,
  )

  try {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded' })
    if (afterNavigation) {
      await afterNavigation(page)
    }

    const result = await callbackCapture.result
    if (!result.code) {
      throw new Error(
        `Authorization callback did not contain code: ${result.callbackUrl}`,
      )
    }
    if (expectedState && result.state !== expectedState) {
      throw new Error(
        `Authorization state mismatch, expected "${expectedState}" got "${result.state}"`,
      )
    }

    return result
  } catch (error) {
    await callbackCapture.abort()
    await callbackCapture.result.catch(() => undefined)
    throw error
  }
}

export { waitForAuthorizationCodeViaServer as waitForAuthorizationCode }
