import {
  resolveConfig,
  setRuntimeConfig,
  type CliRuntimeConfig,
} from '../../config'
import type {
  MachineStatus,
  StateMachineController,
} from '../../state-machine'

export interface CommonOptions {
  config?: string
  profile?: string
  headless?: string | boolean
  slowMo?: string | boolean
  har?: string | boolean
  progressReporter?: FlowProgressReporter
}

export interface FlowOptions extends CommonOptions {
  record?: string | boolean
  waitMs?: string | boolean
  verificationTimeoutMs?: string | boolean
  pollIntervalMs?: string | boolean
  password?: string
  createPasskey?: string | boolean
  sameSessionPasskeyCheck?: string | boolean
  identityId?: string
  email?: string
  target?: string
  redirectPort?: string | boolean
  projectId?: string
  channelName?: string
  inviteEmail?: string | string[]
  inviteFile?: string
}

export interface AuthOptions extends CommonOptions {
  flowType?: string
  cliName?: string
  scope?: string
  target?: string
}

export interface ExchangeOptions extends CommonOptions {
  folderId?: string
  maxItems?: string | boolean
  unreadOnly?: string | boolean
}

const REDACTED = '***redacted***'

export interface FlowProgressUpdate {
  status?: MachineStatus
  state?: string
  event?: string
  message?: string
  attempt?: number
  error?: string
}

export type FlowProgressReporter = (update: FlowProgressUpdate) => void

function sanitizeText(value: string): string {
  return value
    .replace(/\b(Bearer|bearer)\s+[A-Za-z0-9\-._~+/]+=*/g, '$1 ***redacted***')
    .replace(
      /([?&](?:code|state|access_token|refresh_token|id_token|token|client_secret|api_key))=([^&\s]+)/gi,
      `$1=${REDACTED}`,
    )
    .replace(
      /\b(code|state|access_token|refresh_token|id_token|token|password|secret|client_secret|api_key)\b\s*[:=]\s*([^\s,;"'}]+)/gi,
      (_match, key) => `${key}=***redacted***`,
    )
    .replace(
      /(["']?)(code|state|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret|client[_-]?secret|api[_-]?key)(["']?\s*:\s*["']?)([^"'\s,}]+)/gi,
      (_match, open, key, separator) => `${open}${key}${separator}${REDACTED}`,
    )
}

function sanitizeUrlString(value: string): string {
  try {
    const parsed = new URL(value)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return value
  }
}

function sanitizeSummaryString(value: string): string {
  if (/^https?:\/\//i.test(value.trim())) {
    return sanitizeUrlString(value)
  }

  return sanitizeText(value)
}

function sanitizeValue(key: string, current: unknown): unknown {
  if (
    /(?:secret|password|apiKey)s?$/i.test(key) ||
    /^(code|state|accessToken|refreshToken|idToken|token)$/i.test(key)
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
    return current.map((entry) => sanitizeValue(key, entry))
  }

  if (current && typeof current === 'object') {
    return Object.fromEntries(
      Object.entries(current).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeValue(entryKey, entryValue),
      ]),
    )
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

export function parseBooleanFlag(
  value: string | boolean | undefined,
  fallback?: boolean,
): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

export function parseNumberFlag(
  value: string | boolean | undefined,
  fallback?: number,
): number | undefined {
  if (typeof value !== 'string') return fallback
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

export function applyFlowOptionDefaults<
  T extends CommonOptions & {
    record?: string | boolean
  },
>(options: T, defaults: Partial<T> = {}): T {
  return {
    ...defaults,
    ...options,
  } as T
}

export function shouldKeepFlowOpen(options: {
  record?: string | boolean
}): boolean {
  return parseBooleanFlag(options.record, false) ?? false
}

export function buildRuntimeConfig(
  command: string,
  options: CommonOptions,
): CliRuntimeConfig {
  return resolveConfig({
    command,
    configFile: options.config,
    profile: options.profile,
    overrides: {
      browser: {
        headless: parseBooleanFlag(options.headless),
        slowMo: parseNumberFlag(options.slowMo),
        recordHar: parseBooleanFlag(options.har),
      },
    },
  })
}

export function prepareRuntimeConfig(
  command: string,
  options: CommonOptions,
): CliRuntimeConfig {
  const config = buildRuntimeConfig(command, options)
  setRuntimeConfig(config)
  return config
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function formatSummaryValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const sanitized = sanitizeSummaryString(value)
    return sanitized.trim() ? sanitized : undefined
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }

  return undefined
}

function formatBooleanLabel(
  value: boolean | undefined,
  yesLabel: string,
  noLabel: string,
): string | undefined {
  if (value == null) return undefined
  return value ? yesLabel : noLabel
}

function appendSummaryLine(
  lines: string[],
  label: string,
  value: unknown,
): void {
  const formatted = formatSummaryValue(value)
  if (!formatted) return
  lines.push(`${label}: ${formatted}`)
}

function formatInviteCounts(result: Record<string, unknown>): string | undefined {
  const requested = asStringArray(result.requestedEmails)?.length
  const invited = asStringArray(result.invitedEmails)?.length
  const skipped = asStringArray(result.skippedEmails)?.length
  const errored = asStringArray(result.erroredEmails)?.length

  const parts = [
    requested != null ? `requested ${requested}` : undefined,
    invited != null ? `invited ${invited}` : undefined,
    skipped != null ? `skipped ${skipped}` : undefined,
    errored != null ? `errored ${errored}` : undefined,
  ].filter((part): part is string => Boolean(part))

  return parts.length ? parts.join(', ') : undefined
}

export function formatFlowCompletionSummary(
  command: string,
  result: unknown,
): string {
  const record = asRecord(result)
  const pageName = typeof record?.pageName === 'string' ? record.pageName : ''
  const lines = [`${command} ${pageName === 'noop' ? 'ready' : 'completed'}`]

  if (!record) {
    return lines.join('\n')
  }

  if (pageName === 'chatgpt-register') {
    appendSummaryLine(lines, 'email', record.email)
    appendSummaryLine(lines, 'verified', asBoolean(record.verified))
    appendSummaryLine(
      lines,
      'passkey',
      formatBooleanLabel(asBoolean(record.passkeyCreated), 'created', 'not created'),
    )
    appendSummaryLine(
      lines,
      'passkey check',
      formatBooleanLabel(
        asBoolean(asRecord(record.sameSessionPasskeyCheck)?.authenticated),
        'passed',
        'failed',
      ),
    )
    appendSummaryLine(lines, 'identity', asRecord(record.storedIdentity)?.id)
    appendSummaryLine(lines, 'page', record.url)
    return lines.join('\n')
  }

  if (pageName === 'chatgpt-login-passkey') {
    appendSummaryLine(lines, 'email', record.email)
    appendSummaryLine(lines, 'authenticated', asBoolean(record.authenticated))
    appendSummaryLine(lines, 'method', record.method)
    appendSummaryLine(lines, 'identity', asRecord(record.storedIdentity)?.id)
    appendSummaryLine(lines, 'page', record.url)
    return lines.join('\n')
  }

  if (pageName === 'chatgpt-login-invite') {
    const invites = asRecord(record.invites)
    appendSummaryLine(lines, 'email', record.email)
    appendSummaryLine(lines, 'authenticated', asBoolean(record.authenticated))
    appendSummaryLine(lines, 'strategy', invites?.strategy)
    appendSummaryLine(lines, 'invites', invites ? formatInviteCounts(invites) : undefined)
    appendSummaryLine(lines, 'page', record.url)
    return lines.join('\n')
  }

  if (pageName === 'codex-oauth') {
    const axonHub = asRecord(record.axonHub)
    const channel = asRecord(axonHub?.channel)
    appendSummaryLine(lines, 'channel', channel?.name ?? channel?.id)
    appendSummaryLine(lines, 'project', axonHub?.projectId)
    appendSummaryLine(lines, 'redirect', record.redirectUri)
    appendSummaryLine(lines, 'token', 'stored locally')
    appendSummaryLine(lines, 'page', record.url)
    return lines.join('\n')
  }

  appendSummaryLine(lines, 'page', record.url)
  appendSummaryLine(lines, 'title', record.title)
  return lines.join('\n')
}

export function printFlowCompletionSummary(
  command: string,
  result: unknown,
): void {
  console.log(formatFlowCompletionSummary(command, result))
}

export function formatFlowProgressUpdate(
  command: string,
  update: FlowProgressUpdate,
): string | undefined {
  if (update.status === 'failed' && !update.error) {
    return undefined
  }

  let body = typeof update.message === 'string' ? sanitizeSummaryString(update.message) : undefined

  if (!body && update.event && update.event !== 'machine.started') {
    body = update.event
  }

  if (!body && update.state && update.state !== 'idle') {
    body = update.state
  }

  if (!body) {
    return undefined
  }

  if (typeof update.attempt === 'number' && Number.isFinite(update.attempt)) {
    body += ` (attempt ${update.attempt})`
  }

  if (update.status === 'failed' && update.error) {
    const error = sanitizeSummaryString(update.error)
    if (!body.includes(error)) {
      body += `: ${error}`
    }
  }

  return `[${command}] ${body}`
}

export function createConsoleFlowProgressReporter(
  command: string,
): FlowProgressReporter {
  let lastLine: string | undefined

  return (update) => {
    const line = formatFlowProgressUpdate(command, update)
    if (!line || line === lastLine) {
      return
    }

    lastLine = line
    console.error(line)
  }
}

export function attachStateMachineProgressReporter<
  State extends string,
  Context extends object,
  Event extends string = string,
>(
  machine: StateMachineController<State, Context, Event>,
  reporter?: FlowProgressReporter,
): () => void {
  if (!reporter) {
    return () => {}
  }

  return machine.subscribe((snapshot) => {
    const context = asRecord(snapshot.context)
    reporter({
      status: snapshot.status,
      state: snapshot.state,
      event: snapshot.lastEvent,
      message:
        typeof context?.lastMessage === 'string' ? context.lastMessage : undefined,
      attempt:
        typeof context?.lastAttempt === 'number' ? context.lastAttempt : undefined,
      error: snapshot.error?.message,
    })
  })
}

export function reportError(error: unknown): never {
  const message = sanitizeErrorForOutput(error).message
  console.error(
    JSON.stringify(
      redactForOutput({ status: 'failed', error: message }),
      null,
      2,
    ),
  )
  process.exit(1)
}

export function execute(task: Promise<void>): void {
  task.catch(reportError)
}
