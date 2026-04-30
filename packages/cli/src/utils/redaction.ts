const REDACTED = '***redacted***'
const CIRCULAR_REFERENCE = '[Circular]'
const MAX_REDACTION_DEPTH = 50

export function sanitizeText(value: string): string {
  return value
    .replace(/\b(Bearer|bearer)\s+[A-Za-z0-9\-._~+/]+=*/g, '$1 ***redacted***')
    .replace(
      /([?&](?:code|state|access_token|refresh_token|id_token|token|client_secret|api_key))=([^&\s]+)/gi,
      `$1=${REDACTED}`,
    )
    .replace(
      /\b(code|state|access_token|refresh_token|id_token|token|password|secret|client_secret|api_key|pin)\b\s*[:=]\s*([^\s,;"'}&]+)/gi,
      (_match, key) => `${key}=***redacted***`,
    )
    .replace(
      /(["']?)(code|state|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret|client[_-]?secret|api[_-]?key|pin)(["']?\s*:\s*["']?)([^"'\s,}]+)/gi,
      (_match, open, key, separator) => `${open}${key}${separator}${REDACTED}`,
    )
}

export function sanitizeUrlString(value: string): string {
  try {
    const parsed = new URL(value)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return value
  }
}

export function sanitizeSummaryString(value: string): string {
  if (/^https?:\/\//i.test(value.trim())) {
    return sanitizeUrlString(value)
  }

  return sanitizeText(value)
}

function sanitizeValue(
  key: string,
  current: unknown,
  ancestors: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (
    /(?:secret|password|apiKey)s?$/i.test(key) ||
    /^(code|state|accessToken|refreshToken|idToken|token|pin)$/i.test(key)
  ) {
    return REDACTED
  }

  if (typeof current === 'string') {
    if (/authorizationUrl/i.test(key)) {
      return REDACTED
    }

    if (/^(url|href)$/i.test(key) || key.endsWith('Url')) {
      return sanitizeUrlString(current)
    }

    return sanitizeText(current)
  }

  if (Array.isArray(current)) {
    if (depth >= MAX_REDACTION_DEPTH) {
      return `[MaxDepth:${MAX_REDACTION_DEPTH}]`
    }

    if (ancestors.has(current)) {
      return CIRCULAR_REFERENCE
    }

    ancestors.add(current)
    try {
      return current.map((entry) =>
        sanitizeValue(key, entry, ancestors, depth + 1),
      )
    } finally {
      ancestors.delete(current)
    }
  }

  if (current && typeof current === 'object') {
    if (depth >= MAX_REDACTION_DEPTH) {
      return `[MaxDepth:${MAX_REDACTION_DEPTH}]`
    }

    if (ancestors.has(current)) {
      return CIRCULAR_REFERENCE
    }

    ancestors.add(current)
    try {
      return Object.fromEntries(
        Object.entries(current).map(([entryKey, entryValue]) => [
          entryKey,
          sanitizeValue(entryKey, entryValue, ancestors, depth + 1),
        ]),
      )
    } finally {
      ancestors.delete(current)
    }
  }

  return current
}

export function sanitizeErrorForOutput(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(sanitizeText(message))
}

export function redactForOutput<T>(value: T): T {
  return sanitizeValue('', value) as T
}
