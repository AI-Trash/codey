const VERIFICATION_CODE_PATTERNS = [
  /(?:verification\s*code|one(?:-| )?time\s*code|security\s*code|passcode|验证码|驗證碼|校验码|校驗碼|code)\D{0,24}(\d(?:[\s-]?\d){5})/i,
  /(\d(?:[\s-]?\d){5})\D{0,24}(?:verification\s*code|one(?:-| )?time\s*code|security\s*code|passcode|验证码|驗證碼|校验码|校驗碼|is\s+your\s+code|is\s+your\s+verification\s*code)/i,
]

const TRAILING_CODE_PATTERN = /(\d(?:[\s-]?\d){5})\D*$/
const ISOLATED_CODE_PATTERN = /\b(\d(?:[\s-]?\d){5})\b/g

function normalizeDigits(value: string): string {
  return value.replace(/[０-９]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0),
  )
}

function normalizeCandidate(candidate?: string | null): string | null {
  if (!candidate) {
    return null
  }

  const digits = normalizeDigits(candidate).replace(/\D/g, '')
  return digits.length === 6 ? digits : null
}

function normalizeVerificationText(value: string): string {
  return normalizeDigits(value)
    .replace(/=\r?\n/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|td|th|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
}

function extractTailCode(value: string): string | null {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .reverse()

  for (const line of lines) {
    const isolatedCode = normalizeCandidate(
      line.match(/^\D*(\d(?:[\s-]?\d){5})\D*$/)?.[1],
    )
    if (isolatedCode) {
      return isolatedCode
    }

    const trailingCode = normalizeCandidate(
      line.match(/(\d(?:[\s-]?\d){5})(?!.*\d)/)?.[1],
    )
    if (trailingCode) {
      return trailingCode
    }
  }

  return null
}

export function extractVerificationCodeFromText(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim()
  if (!normalized) {
    return null
  }

  const cleaned = normalizeVerificationText(normalized)
  const compact = cleaned.replace(/\s+/g, ' ').trim()

  for (const pattern of VERIFICATION_CODE_PATTERNS) {
    const code = normalizeCandidate(compact.match(pattern)?.[1])
    if (code) {
      return code
    }
  }

  const tailCode = extractTailCode(cleaned)
  if (tailCode) {
    return tailCode
  }

  const trailingCode = normalizeCandidate(
    compact.match(TRAILING_CODE_PATTERN)?.[1],
  )
  if (trailingCode) {
    return trailingCode
  }

  const uniqueCodes = Array.from(compact.matchAll(ISOLATED_CODE_PATTERN))
    .map((match) => normalizeCandidate(match[1]))
    .filter((code): code is string => Boolean(code))

  const deduplicatedCodes = Array.from(new Set(uniqueCodes))
  return deduplicatedCodes.length === 1 ? deduplicatedCodes[0] : null
}
