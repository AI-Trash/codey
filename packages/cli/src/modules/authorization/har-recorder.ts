import path from 'path'
import { getRuntimeConfig } from '../../config'
import { writeFileAtomic } from '../../utils/fs'

interface HarHeader {
  name: string
  value: string
}

interface HarQueryParam {
  name: string
  value: string
}

interface HarPostData {
  mimeType: string
  text: string
  params?: HarQueryParam[]
  comment?: string
}

interface HarRequestEntry {
  method: string
  url: string
  httpVersion: string
  cookies: []
  headers: HarHeader[]
  queryString: HarQueryParam[]
  headersSize: number
  bodySize: number
  postData?: HarPostData
}

interface HarResponseContent {
  size: number
  mimeType: string
  text?: string
  encoding?: 'base64'
}

interface HarResponseEntry {
  status: number
  statusText: string
  httpVersion: string
  cookies: []
  headers: HarHeader[]
  content: HarResponseContent
  redirectURL: string
  headersSize: number
  bodySize: number
}

interface HarTimings {
  blocked: number
  dns: number
  connect: number
  send: number
  wait: number
  receive: number
  ssl: number
}

interface HarEntry {
  startedDateTime: string
  time: number
  request: HarRequestEntry
  response: HarResponseEntry
  cache: {}
  timings: HarTimings
  comment?: string
}

interface HarLogFile {
  log: {
    version: '1.2'
    creator: {
      name: string
      version: string
    }
    entries: HarEntry[]
  }
}

export interface NodeHarRecorder {
  path: string
  record(entry: HarEntry): void
  flush(): void
}

function timeStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function sanitizeArtifactName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'flow'
  )
}

function buildHarPath(
  artifactsDir: string,
  artifactName?: string,
  command?: string,
): string {
  const safeName = sanitizeArtifactName(artifactName || command || 'flow')
  return path.join(artifactsDir, `${timeStamp()}-${safeName}.har`)
}

function serializeHeaders(headers?: HeadersInit): HarHeader[] {
  if (!headers) return []
  return Array.from(new Headers(headers).entries()).map(([name, value]) => ({
    name,
    value,
  }))
}

function mergeHeaders(
  requestHeaders?: HeadersInit,
  overrideHeaders?: HeadersInit,
): Headers {
  const merged = new Headers(requestHeaders)
  const overrides = new Headers(overrideHeaders)
  overrides.forEach((value, key) => {
    merged.set(key, value)
  })
  return merged
}

function serializeQueryString(url: string): HarQueryParam[] {
  const parsed = new URL(url)
  return Array.from(parsed.searchParams.entries()).map(([name, value]) => ({
    name,
    value,
  }))
}

function isTextMimeType(mimeType: string): boolean {
  return /(?:^text\/|json|javascript|xml|x-www-form-urlencoded|graphql)/i.test(
    mimeType,
  )
}

function createEmptyHarResponse(statusText: string): HarResponseEntry {
  return {
    status: 0,
    statusText,
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: [],
    content: {
      size: 0,
      mimeType: 'x-unknown',
    },
    redirectURL: '',
    headersSize: -1,
    bodySize: 0,
  }
}

function normalizeRequestBodyText(
  body: Exclude<BodyInit | null | undefined, ReadableStream<Uint8Array>>,
): {
  text: string
  mimeType?: string
  bodySize: number
  params?: HarQueryParam[]
  comment?: string
} {
  if (typeof body === 'string') {
    return {
      text: body,
      bodySize: Buffer.byteLength(body),
    }
  }

  if (body instanceof URLSearchParams) {
    const text = body.toString()
    return {
      text,
      mimeType: 'application/x-www-form-urlencoded;charset=UTF-8',
      bodySize: Buffer.byteLength(text),
      params: Array.from(body.entries()).map(([name, value]) => ({
        name,
        value,
      })),
    }
  }

  if (body instanceof FormData) {
    return {
      text: '[form-data omitted]',
      mimeType: 'multipart/form-data',
      bodySize: 0,
      comment: 'Original multipart form-data body omitted from HAR capture.',
    }
  }

  if (body instanceof Blob) {
    return {
      text: '[blob omitted]',
      mimeType: body.type || 'application/octet-stream',
      bodySize: body.size,
      comment: 'Original blob body omitted from HAR capture.',
    }
  }

  const buffer =
    body instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(body))
      : ArrayBuffer.isView(body)
        ? Buffer.from(body.buffer, body.byteOffset, body.byteLength)
        : Buffer.from(String(body))
  return {
    text: buffer.toString('base64'),
    bodySize: buffer.length,
    comment: 'Request body base64 encoded.',
  }
}

async function buildHarRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<HarRequestEntry> {
  const request = input instanceof Request ? input : undefined
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
  const method = init?.method || request?.method || 'GET'
  const headers = mergeHeaders(request?.headers, init?.headers)
  const body =
    init?.body ??
    (request && !request.bodyUsed
      ? ((await request.clone().text()) as BodyInit)
      : undefined)

  let postData: HarPostData | undefined
  let bodySize = 0
  if (body != null && !(body instanceof ReadableStream)) {
    const normalized = normalizeRequestBodyText(body)
    bodySize = normalized.bodySize
    postData = {
      mimeType:
        headers.get('content-type') ||
        normalized.mimeType ||
        'application/octet-stream',
      text: normalized.text,
      params: normalized.params,
      comment: normalized.comment,
    }
  }

  return {
    method,
    url,
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers: serializeHeaders(headers),
    queryString: serializeQueryString(url),
    headersSize: -1,
    bodySize,
    postData,
  }
}

async function buildHarResponse(response: Response): Promise<HarResponseEntry> {
  const headers = serializeHeaders(response.headers)
  const mimeType =
    response.headers.get('content-type') || 'application/octet-stream'
  const bodyBuffer = Buffer.from(await response.clone().arrayBuffer())
  const content: HarResponseContent = {
    size: bodyBuffer.length,
    mimeType,
  }

  if (bodyBuffer.length > 0) {
    if (isTextMimeType(mimeType)) {
      content.text = bodyBuffer.toString('utf8')
    } else {
      content.text = bodyBuffer.toString('base64')
      content.encoding = 'base64'
    }
  }

  return {
    status: response.status,
    statusText: response.statusText,
    httpVersion: 'HTTP/1.1',
    cookies: [],
    headers,
    content,
    redirectURL: response.headers.get('location') || '',
    headersSize: -1,
    bodySize: bodyBuffer.length,
  }
}

export function createNodeHarRecorder(
  artifactName?: string,
): NodeHarRecorder | undefined {
  const config = getRuntimeConfig()
  if (!config.browser.recordHar) {
    return undefined
  }

  const file: HarLogFile = {
    log: {
      version: '1.2',
      creator: {
        name: 'codey',
        version: '1.0.0',
      },
      entries: [],
    },
  }

  const harPath = buildHarPath(
    config.artifactsDir,
    artifactName,
    config.command,
  )

  return {
    path: harPath,
    record(entry) {
      file.log.entries.push(entry)
      writeFileAtomic(harPath, `${JSON.stringify(file, null, 2)}\n`)
    },
    flush() {
      writeFileAtomic(harPath, `${JSON.stringify(file, null, 2)}\n`)
    },
  }
}

export async function fetchWithHarCapture(
  recorder: NodeHarRecorder | undefined,
  input: RequestInfo | URL,
  init?: RequestInit,
  options: {
    comment?: string
  } = {},
): Promise<Response> {
  if (!recorder) {
    return fetch(input, init)
  }

  const startedDateTime = new Date().toISOString()
  const request = await buildHarRequest(input, init)
  const startedAt = Date.now()

  try {
    const response = await fetch(input, init)
    recorder.record({
      startedDateTime,
      time: Date.now() - startedAt,
      request,
      response: await buildHarResponse(response),
      cache: {},
      timings: {
        blocked: 0,
        dns: -1,
        connect: -1,
        send: 0,
        wait: Date.now() - startedAt,
        receive: 0,
        ssl: -1,
      },
      comment: options.comment,
    })
    return response
  } catch (error) {
    recorder.record({
      startedDateTime,
      time: Date.now() - startedAt,
      request,
      response: createEmptyHarResponse(
        error instanceof Error ? error.message : String(error),
      ),
      cache: {},
      timings: {
        blocked: 0,
        dns: -1,
        connect: -1,
        send: 0,
        wait: Date.now() - startedAt,
        receive: 0,
        ssl: -1,
      },
      comment: options.comment,
    })
    throw error
  }
}
