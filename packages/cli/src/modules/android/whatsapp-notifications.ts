import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { URL } from 'node:url'
import type {
  AppWhatsAppNotificationIngestInput,
  AppWhatsAppNotificationIngestResponse,
} from '../verification/app-client'

export const DEFAULT_WHATSAPP_PACKAGE_NAME = 'com.whatsapp'
export const DEFAULT_WHATSAPP_WEBHOOK_HOST = '127.0.0.1'
export const DEFAULT_WHATSAPP_WEBHOOK_PORT = 3001
export const DEFAULT_WHATSAPP_WEBHOOK_PATH = '/webhooks/smsforwarder/whatsapp'

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024

export class WhatsAppNotificationWebhookParseError extends Error {
  constructor(
    message: string,
    readonly rawBody: string,
  ) {
    super(message)
    this.name = 'WhatsAppNotificationWebhookParseError'
  }
}

export interface WhatsAppNotificationEvent {
  packageName: string
  notificationId?: string
  sender?: string
  chatName?: string
  title?: string
  body?: string
  rawPayload?: Record<string, unknown>
  receivedAt: string
}

export interface WhatsAppNotificationWebhookOptions {
  enabled?: boolean
  host?: string
  port?: number
  path?: string
  deviceId?: string
  reservationId?: string
  email?: string
  dryRun?: boolean
  signal?: AbortSignal
  onStatus?: (message: string) => void
  onNotification?: (
    event: WhatsAppNotificationEvent,
    payload: AppWhatsAppNotificationIngestInput,
    result?: AppWhatsAppNotificationIngestResponse,
  ) => void | Promise<void>
  ingestNotification?: (
    payload: AppWhatsAppNotificationIngestInput,
  ) => Promise<AppWhatsAppNotificationIngestResponse>
}

export interface WhatsAppNotificationWebhookReadyState {
  url: string
  host: string
  port: number
  path: string
}

export interface WhatsAppNotificationWebhookServerHandle {
  ready: Promise<WhatsAppNotificationWebhookReadyState>
  done: Promise<void>
  stop(): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return undefined
}

function escapeJsonStringControlCharacter(value: string): string {
  switch (value) {
    case '\b':
      return '\\b'
    case '\f':
      return '\\f'
    case '\n':
      return '\\n'
    case '\r':
      return '\\r'
    case '\t':
      return '\\t'
    default:
      return `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`
  }
}

function escapeJsonStringControlCharacters(value: string): string {
  let result = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index)
    const code = char.charCodeAt(0)

    if (!inString) {
      if (char === '"') {
        inString = true
      }
      result += char
      continue
    }

    if (escaped) {
      escaped = false
      result += char
      continue
    }

    if (char === '\\') {
      escaped = true
      result += char
      continue
    }

    if (char === '"') {
      inString = false
      result += char
      continue
    }

    result += code < 0x20 ? escapeJsonStringControlCharacter(char) : char
  }

  return result
}

function parseJsonWithEscapedControlCharacters(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    const escaped = escapeJsonStringControlCharacters(value)
    if (escaped !== value) {
      try {
        return JSON.parse(escaped)
      } catch {}
    }
    throw error
  }
}

function parseJsonObject(
  value: string | undefined,
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined
  }

  const trimmed = value.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return undefined
  }

  try {
    const parsed = parseJsonWithEscapedControlCharacters(trimmed)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function collectCandidateRecords(
  payload: Record<string, unknown>,
): Record<string, unknown>[] {
  const candidates = [payload]
  const queue = [
    payload.data,
    payload.notification,
    payload.rawPayload,
    payload.extra,
    payload.extras,
  ]

  for (const value of queue) {
    if (isRecord(value)) {
      candidates.push(value)
      continue
    }

    const parsed = parseJsonObject(readString(value))
    if (parsed) {
      candidates.push(parsed)
    }
  }

  for (const key of ['content', 'message', 'text', 'body']) {
    const parsed = parseJsonObject(readString(payload[key]))
    if (parsed) {
      candidates.push(parsed)
    }
  }

  return candidates
}

function readStringFromCandidates(
  candidates: Record<string, unknown>[],
  keys: string[],
): string | undefined {
  for (const candidate of candidates) {
    for (const key of keys) {
      const direct = readString(candidate[key])
      if (direct) {
        return direct
      }

      const dotted = key.split('.')
      if (dotted.length > 1) {
        let current: unknown = candidate
        for (const part of dotted) {
          current = isRecord(current) ? current[part] : undefined
        }
        const nested = readString(current)
        if (nested) {
          return nested
        }
      }
    }
  }

  return undefined
}

function normalizePackageName(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  if (!normalized) {
    return undefined
  }

  if (/^com\.whatsapp(?:\.w4b)?$/i.test(normalized)) {
    return normalized.toLowerCase()
  }
  if (/whats\s*app/i.test(normalized)) {
    return /business|w4b/i.test(normalized)
      ? 'com.whatsapp.w4b'
      : DEFAULT_WHATSAPP_PACKAGE_NAME
  }
  if (/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(normalized)) {
    return normalized
  }

  return undefined
}

function normalizeReceivedAt(value: string | undefined): string {
  if (!value) {
    return new Date().toISOString()
  }

  const numeric = Number(value)
  if (Number.isFinite(numeric)) {
    const timestampMs = numeric < 10_000_000_000 ? numeric * 1000 : numeric
    const date = new Date(timestampMs)
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString()
    }
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString()
}

function normalizePath(value: string | undefined): string {
  const trimmed = value?.trim() || DEFAULT_WHATSAPP_WEBHOOK_PATH
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function normalizePort(value: number | undefined): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 65535
    ? value
    : DEFAULT_WHATSAPP_WEBHOOK_PORT
}

export function extractVerificationCodeFromNotificationText(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return undefined
  }

  const patterns = [
    /(?:verification\s*code|one[-\s]*time\s*code|otp|code|验证码|驗證碼|安全码|安全碼)[^\d]{0,32}(\d{4,8})/i,
    /\b(\d{6})\b/,
    /\b(\d{4,8})\b/,
  ]

  for (const pattern of patterns) {
    const match = pattern.exec(value)
    if (match?.[1]) {
      return match[1]
    }
  }

  return undefined
}

export function normalizeSmsForwarderWhatsAppNotificationPayload(
  payload: Record<string, unknown>,
): WhatsAppNotificationEvent {
  const candidates = collectCandidateRecords(payload)
  const appOrPackage = readStringFromCandidates(candidates, [
    'packageName',
    'package',
    'package_name',
    'appPackage',
    'app_package',
    'pkg',
    'app',
    'appName',
    'app_name',
    'msg_app',
  ])
  const sender = readStringFromCandidates(candidates, [
    'sender',
    'senderPhone',
    'from',
    'msg_from',
    'phone',
    'address',
    'contact',
  ])
  const title = readStringFromCandidates(candidates, [
    'title',
    'notificationTitle',
    'msg_title',
    'android.title',
    'conversationTitle',
    'subject',
  ])
  const body = readStringFromCandidates(candidates, [
    'body',
    'content',
    'text',
    'message',
    'msg',
    'msg_content',
    'notificationContent',
    'notificationText',
    'android.text',
    'android.bigText',
    'bigText',
    'tickerText',
    'summary',
  ])
  const chatName = readStringFromCandidates(candidates, [
    'chatName',
    'conversation',
    'conversationTitle',
    'group',
    'thread',
  ])
  const receivedAt = normalizeReceivedAt(
    readStringFromCandidates(candidates, [
      'receivedAt',
      'received_at',
      'timestamp',
      'time',
      'date',
      'msg_time',
    ]),
  )

  return {
    packageName:
      normalizePackageName(appOrPackage) || DEFAULT_WHATSAPP_PACKAGE_NAME,
    notificationId: readStringFromCandidates(candidates, [
      'notificationId',
      'notification_id',
      'key',
      'id',
      'msg_id',
    ]),
    sender,
    chatName,
    title,
    body,
    rawPayload: payload,
    receivedAt,
  }
}

export function buildWhatsAppNotificationIngestPayload(
  event: WhatsAppNotificationEvent,
  options: {
    reservationId?: string
    email?: string
    deviceId?: string
  } = {},
): AppWhatsAppNotificationIngestInput {
  const text = [event.title, event.body].filter(Boolean).join('\n')

  return {
    reservationId: options.reservationId,
    email: options.email,
    deviceId: options.deviceId,
    notificationId: event.notificationId,
    packageName: event.packageName,
    sender: event.sender,
    chatName: event.chatName,
    title: event.title,
    body: event.body,
    rawPayload: event.rawPayload,
    extractedCode: extractVerificationCodeFromNotificationText(text),
    receivedAt: event.receivedAt,
  }
}

export function createWhatsAppNotificationDeduper(ttlMs = 10 * 60 * 1000): {
  shouldProcess(event: WhatsAppNotificationEvent, now?: number): boolean
} {
  const seen = new Map<string, number>()

  return {
    shouldProcess(event, now = Date.now()) {
      for (const [key, expiresAt] of seen.entries()) {
        if (expiresAt <= now) {
          seen.delete(key)
        }
      }

      const key = [
        event.packageName,
        event.notificationId,
        event.title,
        event.body,
      ]
        .filter(Boolean)
        .join('|')

      if (seen.has(key)) {
        return false
      }

      seen.set(key, now + ttlMs)
      return true
    },
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    totalBytes += buffer.byteLength
    if (totalBytes > MAX_WEBHOOK_BODY_BYTES) {
      throw new Error('Webhook request body is too large.')
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

function parseWebhookPayload(
  bodyText: string,
  contentType: string | undefined,
): Record<string, unknown> {
  const trimmed = bodyText.trim()
  if (!trimmed) {
    return {}
  }

  const normalizedContentType = contentType?.toLowerCase() || ''
  if (
    normalizedContentType.includes('application/json') ||
    normalizedContentType.includes('+json')
  ) {
    let parsed: unknown
    try {
      parsed = parseJsonWithEscapedControlCharacters(trimmed)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new WhatsAppNotificationWebhookParseError(message, bodyText)
    }
    return isRecord(parsed) ? parsed : { content: parsed }
  }

  if (normalizedContentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(bodyText))
  }

  const jsonPayload = parseJsonObject(trimmed)
  if (jsonPayload) {
    return jsonPayload
  }

  if (trimmed.includes('=')) {
    const formPayload = Object.fromEntries(new URLSearchParams(bodyText))
    if (Object.keys(formPayload).length) {
      return formPayload
    }
  }

  return { content: trimmed }
}

function readHeaderString(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export function startWhatsAppNotificationWebhookServer(
  options: WhatsAppNotificationWebhookOptions,
): WhatsAppNotificationWebhookServerHandle {
  const host = options.host?.trim() || DEFAULT_WHATSAPP_WEBHOOK_HOST
  const port = normalizePort(options.port)
  const webhookPath = normalizePath(options.path)
  const dryRun = options.dryRun === true
  const deduper = createWhatsAppNotificationDeduper()
  let serverClosed = false
  let resolveDone: () => void = () => undefined

  if (!dryRun && !options.ingestNotification) {
    throw new Error('ingestNotification is required unless dryRun is enabled.')
  }

  const server = http.createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url || '/', `http://${host}`)
      if (requestUrl.pathname !== webhookPath) {
        writeJson(response, 404, {
          ok: false,
          error: 'Not found',
        })
        return
      }

      if (request.method === 'GET') {
        writeJson(response, 200, {
          ok: true,
          path: webhookPath,
        })
        return
      }

      if (request.method !== 'POST') {
        writeJson(response, 405, {
          ok: false,
          error: 'Method not allowed',
        })
        return
      }

      let bodyText = ''
      try {
        bodyText = await readRequestBody(request)
        const rawPayload = parseWebhookPayload(
          bodyText,
          readHeaderString(request.headers['content-type']),
        )
        const notification =
          normalizeSmsForwarderWhatsAppNotificationPayload(rawPayload)

        if (!deduper.shouldProcess(notification)) {
          writeJson(response, 200, {
            ok: true,
            duplicate: true,
          })
          return
        }

        const ingestPayload = buildWhatsAppNotificationIngestPayload(
          notification,
          {
            reservationId: options.reservationId,
            email: options.email,
            deviceId: options.deviceId,
          },
        )
        const result = dryRun
          ? undefined
          : await options.ingestNotification?.(ingestPayload)

        await options.onNotification?.(notification, ingestPayload, result)
        writeJson(response, 200, {
          ok: true,
          extractedCode: ingestPayload.extractedCode,
          notificationRecordId: result?.notificationRecordId,
          codeRecordId: result?.codeRecordId,
          match: result?.match,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        options.onStatus?.(`SmsForwarder webhook request failed: ${message}`)
        const rawBody =
          error instanceof WhatsAppNotificationWebhookParseError
            ? error.rawBody
            : bodyText
        if (rawBody) {
          options.onStatus?.(`SmsForwarder webhook raw body: ${rawBody}`)
        }
        writeJson(response, 400, {
          ok: false,
          error: message,
          rawBody,
        })
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      options.onStatus?.(`SmsForwarder webhook request failed: ${message}`)
      writeJson(response, 500, {
        ok: false,
        error: message,
      })
    })
  })

  const ready = new Promise<WhatsAppNotificationWebhookReadyState>(
    (resolve, reject) => {
      const onError = (error: Error): void => {
        serverClosed = true
        resolveDone()
        reject(error)
      }
      server.once('error', onError)
      server.listen(port, host, () => {
        server.off('error', onError)
        const address = server.address()
        const resolvedPort =
          typeof address === 'object' && address ? address.port : port
        const state = {
          url: `http://${host}:${resolvedPort}${webhookPath}`,
          host,
          port: resolvedPort,
          path: webhookPath,
        }
        options.onStatus?.(
          `SmsForwarder WhatsApp webhook listening at ${state.url}`,
        )
        resolve(state)
      })
    },
  )

  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
    server.once('close', () => {
      serverClosed = true
      resolve()
    })
  })

  ready.catch((error) => {
    options.onStatus?.(
      `SmsForwarder WhatsApp webhook could not start: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  })

  const abortHandler = (): void => {
    if (!serverClosed) {
      void closeServer(server).catch(() => undefined)
    }
  }

  if (options.signal) {
    if (options.signal.aborted) {
      abortHandler()
    } else {
      options.signal.addEventListener('abort', abortHandler, { once: true })
    }
  }

  return {
    ready,
    done: done.finally(() => {
      options.signal?.removeEventListener('abort', abortHandler)
    }),
    async stop() {
      if (serverClosed) {
        return
      }
      await closeServer(server).catch((error) => {
        if (
          error instanceof Error &&
          error.message.includes('Server is not running')
        ) {
          return
        }
        throw error
      })
      await done
    },
  }
}
