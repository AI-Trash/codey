import {
  resolveConfig,
  setRuntimeConfig,
  type CliRuntimeConfig,
} from '../../config'
import type { MachineStatus, StateMachineController } from '../../state-machine'
import { resolveChromeProfileLaunchConfig } from '../../utils/chrome-profile'

export interface CommonOptions {
  config?: string
  profile?: string
  chromeDefaultProfile?: string | boolean
  headless?: string | boolean
  slowMo?: string | number | boolean
  har?: string | boolean
  progressReporter?: FlowProgressReporter
}

export interface FlowOptions extends CommonOptions {
  record?: string | boolean
  waitMs?: string | number | boolean
  verificationTimeoutMs?: string | number | boolean
  pollIntervalMs?: string | number | boolean
  authorizeUrlOnly?: string | boolean
  password?: string
  identityId?: string
  email?: string
  workspaceIndex?: string | number | boolean
  target?: string
  redirectPort?: string | number | boolean
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
  maxItems?: string | number | boolean
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

export interface FlowArtifactPaths {
  harPath?: string
  apiHarPath?: string
}

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
  value: string | number | boolean | undefined,
  fallback?: number,
): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback
  }

  if (typeof value !== 'string') return fallback
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

export function applyFlowOptionDefaults<
  T extends CommonOptions & {
    record?: string | boolean
  },
>(options: T, defaults: Partial<T> = {}): T {
  const resolvedOptions = {
    ...defaults,
    ...options,
  } as T

  if (options.record !== undefined) {
    return resolvedOptions
  }

  // Reusing a real Chrome profile usually means the operator wants to
  // keep working in that session after the automated steps finish.
  if (parseBooleanFlag(resolvedOptions.chromeDefaultProfile, false)) {
    return {
      ...resolvedOptions,
      record: true,
    } as T
  }

  return resolvedOptions
}

export function keepBrowserOpenForHarWhenUnspecified<
  T extends {
    har?: string | boolean
    record?: string | boolean
  },
>(options: T): T {
  if (options.record !== undefined) {
    return options
  }

  if (parseBooleanFlag(options.har, false)) {
    return {
      ...options,
      record: true,
    }
  }

  return options
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
  const chromeProfile = resolveChromeProfileLaunchConfig({
    useDefaultProfile:
      parseBooleanFlag(options.chromeDefaultProfile, false) ?? false,
  })

  return resolveConfig({
    command,
    configFile: options.config,
    profile: options.profile,
    overrides: {
      browser: {
        headless: parseBooleanFlag(options.headless),
        slowMo: parseNumberFlag(options.slowMo),
        recordHar: parseBooleanFlag(options.har),
        userDataDir: chromeProfile?.userDataDir,
        profileDirectory: chromeProfile?.profileDirectory,
        cloneUserDataDirToTemp: chromeProfile ? true : undefined,
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

function appendSummaryLine(
  lines: string[],
  label: string,
  value: unknown,
): void {
  const formatted = formatSummaryValue(value)
  if (!formatted) return
  lines.push(`${label}: ${formatted}`)
}

function appendExactSummaryLine(
  lines: string[],
  label: string,
  value: unknown,
): void {
  if (typeof value !== 'string') {
    return
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return
  }

  lines.push(`${label}: ${trimmed}`)
}

function appendArtifactSummaryLines(
  lines: string[],
  artifacts: FlowArtifactPaths,
): void {
  appendSummaryLine(lines, 'har', artifacts.harPath)
  appendSummaryLine(lines, 'api har', artifacts.apiHarPath)
}

function formatInviteCounts(
  result: Record<string, unknown>,
): string | undefined {
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
    appendSummaryLine(lines, 'identity', asRecord(record.storedIdentity)?.id)
    appendSummaryLine(
      lines,
      'session',
      asRecord(record.storedSession)?.clientId ||
        asRecord(record.storedSession)?.sessionId ||
        asRecord(record.storedSession)?.accountId,
    )
    appendSummaryLine(lines, 'page', record.url)
    appendArtifactSummaryLines(lines, record)
    return lines.join('\n')
  }

  if (pageName === 'chatgpt-login') {
    appendSummaryLine(lines, 'email', record.email)
    appendSummaryLine(lines, 'authenticated', asBoolean(record.authenticated))
    appendSummaryLine(lines, 'method', record.method)
    appendSummaryLine(lines, 'identity', asRecord(record.storedIdentity)?.id)
    appendSummaryLine(
      lines,
      'session',
      asRecord(record.storedSession)?.clientId ||
        asRecord(record.storedSession)?.sessionId ||
        asRecord(record.storedSession)?.accountId,
    )
    appendSummaryLine(lines, 'page', record.url)
    appendArtifactSummaryLines(lines, record)
    return lines.join('\n')
  }

  if (pageName === 'chatgpt-login-invite') {
    const invites = asRecord(record.invites)
    appendSummaryLine(lines, 'email', record.email)
    appendSummaryLine(lines, 'authenticated', asBoolean(record.authenticated))
    appendSummaryLine(lines, 'strategy', invites?.strategy)
    appendSummaryLine(
      lines,
      'invites',
      invites ? formatInviteCounts(invites) : undefined,
    )
    appendSummaryLine(lines, 'page', record.url)
    appendArtifactSummaryLines(lines, record)
    return lines.join('\n')
  }

  if (pageName === 'codex-oauth') {
    const codeyApp = asRecord(record.codeyApp)
    const sub2api = asRecord(record.sub2api)
    appendSummaryLine(lines, 'email', record.email)
    appendSummaryLine(lines, 'shared identity', codeyApp?.identityId)
    appendSummaryLine(lines, 'shared session', codeyApp?.sessionRecordId)
    appendSummaryLine(
      lines,
      'sub2api',
      sub2api
        ? `${sub2api.action || 'synced'} account ${sub2api.accountId || ''}`.trim()
        : undefined,
    )
    appendSummaryLine(lines, 'redirect', record.redirectUri)
    appendSummaryLine(lines, 'token', 'stored in Codey app')
    appendSummaryLine(lines, 'page', record.url)
    appendArtifactSummaryLines(lines, record)
    return lines.join('\n')
  }

  if (pageName === 'codex-oauth-authorize-url') {
    appendSummaryLine(lines, 'redirect', record.redirectUri)
    appendExactSummaryLine(lines, 'oauth url', record.oauthUrl)
    appendArtifactSummaryLines(lines, record)
    return lines.join('\n')
  }

  appendSummaryLine(lines, 'page', record.url)
  appendSummaryLine(lines, 'title', record.title)
  appendArtifactSummaryLines(lines, record)
  return lines.join('\n')
}

export function attachFlowArtifactPaths<TResult>(
  result: TResult,
  artifacts: FlowArtifactPaths,
): TResult {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result
  }

  const entries = Object.entries(artifacts).filter(
    (entry): entry is [keyof FlowArtifactPaths, string] =>
      typeof entry[1] === 'string' && entry[1].trim().length > 0,
  )
  if (!entries.length) {
    return result
  }

  return {
    ...(result as Record<string, unknown>),
    ...Object.fromEntries(entries),
  } as TResult
}

export function printFlowCompletionSummary(
  command: string,
  result: unknown,
): void {
  console.log(formatFlowCompletionSummary(command, result))
}

export function printFlowArtifactPath(
  label: string,
  path: string | undefined,
  command?: string,
): void {
  if (typeof path !== 'string' || !path.trim()) {
    return
  }

  const prefix = command?.trim() ? `[${command}] ` : ''
  console.error(`${prefix}${label}: ${path.trim()}`)
}

export function formatFlowProgressUpdate(
  command: string,
  update: FlowProgressUpdate,
): string | undefined {
  if (update.status === 'failed' && !update.error) {
    return undefined
  }

  let body =
    typeof update.message === 'string'
      ? sanitizeSummaryString(update.message)
      : undefined

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
        typeof context?.lastMessage === 'string'
          ? context.lastMessage
          : undefined,
      attempt:
        typeof context?.lastAttempt === 'number'
          ? context.lastAttempt
          : undefined,
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
