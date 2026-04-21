import http, { type IncomingMessage, type ServerResponse } from 'http'
import { URL } from 'url'

export interface CallbackServerOptions {
  host?: string
  port?: number
  path?: string
  timeoutMs?: number
  successHtml?: string
  signal?: AbortSignal
}

export interface AuthorizationCallbackPayload {
  code: string | null
  state: string | null
  scope: string | null
  rawQuery: string
  callbackUrl: string
}

export function waitForAuthorizationCode(
  options: CallbackServerOptions = {},
): Promise<AuthorizationCallbackPayload> {
  const {
    host = 'localhost',
    port = 1455,
    path = '/auth/callback',
    timeoutMs = 180000,
    successHtml,
    signal,
  } = options

  return new Promise((resolve, reject) => {
    let settled = false
    let abortHandler: (() => void) | undefined

    const cleanup = (server: http.Server, timer: NodeJS.Timeout) => {
      clearTimeout(timer)
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler)
      }
      try {
        server.close()
      } catch {}
    }

    const server = http.createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url || '/', `http://${host}:${port}`)
        if (url.pathname !== path) {
          res.statusCode = 404
          res.end('Not Found')
          return
        }

        const payload: AuthorizationCallbackPayload = {
          code: url.searchParams.get('code'),
          state: url.searchParams.get('state'),
          scope: url.searchParams.get('scope'),
          rawQuery: req.url || '',
          callbackUrl: url.toString(),
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(
          successHtml ||
            '<html><body><h1>Authorization received</h1><p>You can close this window now.</p></body></html>',
        )

        if (!settled) {
          settled = true
          cleanup(server, timer)
          resolve(payload)
        }
      },
    )

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        cleanup(server, timer)
        reject(
          new Error(
            `Timed out waiting for localhost callback on ${host}:${port}${path}`,
          ),
        )
      }
    }, timeoutMs)

    server.on('error', (error) => {
      if (!settled) {
        settled = true
        cleanup(server, timer)
        reject(error)
      }
    })

    abortHandler = () => {
      if (!settled) {
        settled = true
        cleanup(server, timer)
        reject(new Error('Authorization callback wait aborted.'))
      }
    }

    if (signal?.aborted) {
      abortHandler()
      return
    }

    signal?.addEventListener('abort', abortHandler, { once: true })

    server.listen(port, host)
  })
}
