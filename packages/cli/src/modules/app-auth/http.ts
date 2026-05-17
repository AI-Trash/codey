import { getRuntimeConfig } from '../../config'
import { sanitizeText, sanitizeUrlString } from '../../utils/redaction'

export const DEFAULT_CODEY_APP_BASE_URL = 'http://localhost:3000'

export function resolveAppBaseUrl(): string {
  const config = getRuntimeConfig()
  const baseUrl =
    config.app?.baseUrl ||
    config.verification?.app?.baseUrl ||
    process.env.APP_BASE_URL ||
    DEFAULT_CODEY_APP_BASE_URL
  return baseUrl
}

export function resolveAppUrl(pathname: string): string {
  const baseUrl = resolveAppBaseUrl()
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(pathname, normalizedBase).toString()
}

export function resolveAppWebSocketUrl(pathname: string): string {
  const url = new URL(resolveAppUrl(pathname))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export async function ensureJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const responseUrl = response.url ? ` ${sanitizeUrlString(response.url)}` : ''
    const message = body.trim()
      ? sanitizeText(body.trim())
      : response.statusText.trim() || 'Request failed'
    throw new Error(
      `Request${responseUrl} failed with ${response.status}: ${message}`,
    )
  }
  return response.json() as Promise<T>
}
