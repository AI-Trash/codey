import {
  resolveConfig,
  setRuntimeConfig,
  type CliRuntimeConfig,
  type RuntimeConfigOverrides,
} from '../../config'
import type { CliFlowTaskMetadata } from './flow-registry'
import type { MachineStatus, StateMachineController } from '../../state-machine'
import { writeCliStderrLine, writeCliStdoutLine } from '../../utils/cli-output'
import { resolveChromeProfileLaunchConfig } from '../../utils/chrome-profile'
import {
  captureCliDiagnostics,
  logCliEvent,
  setBaseObservabilityContext,
  setObservabilityRuntimeState,
} from '../../utils/observability'
import {
  redactForOutput,
  sanitizeErrorForOutput,
  sanitizeSummaryString,
} from '../../utils/redaction'

export interface CommonOptions {
  config?: string
  profile?: string
  chromeDefaultProfile?: string | boolean
  headless?: string | boolean
  slowMo?: string | number | boolean
  har?: string | boolean
  recordPageContent?: string | boolean
  progressReporter?: FlowProgressReporter
  runtimeConfigOverrides?: RuntimeConfigOverrides
}

export interface FlowOptions extends CommonOptions {
  record?: boolean
  restoreStorageState?: string | boolean
  waitMs?: number
  verificationTimeoutMs?: number
  pollIntervalMs?: number
  authorizeUrlOnly?: boolean
  password?: string
  claimTrial?: string | boolean
  claimTeamTrial?: string | boolean
  identityId?: string
  email?: string
  billingName?: string
  billingCountry?: string
  billingAddressLine1?: string
  billingAddressLine2?: string
  billingCity?: string
  billingState?: string
  billingPostalCode?: string
  workspaceId?: string
  workspaceIndex?: number
  target?: string
  redirectPort?: number
  inviteEmail?: string[]
  inviteFile?: string
  pruneUnmanagedWorkspaceMembers?: boolean
  chatgptStorageStatePath?: string
  chatgptStorageStateIdentityId?: string
  chatgptStorageStateEmail?: string
  autoSelectFirstWorkspace?: boolean
  taskMetadata?: CliFlowTaskMetadata
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

export interface FlowProgressUpdate {
  status?: MachineStatus
  state?: string
  event?: string
  message?: string
  attempt?: number
  error?: string
  fromState?: string
  toState?: string
}

export type FlowProgressReporter = (update: FlowProgressUpdate) => void

export interface FlowArtifactPaths {
  harPath?: string
  apiHarPath?: string
  pageContentPath?: string
}

function normalizeProgressField(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const sanitized = sanitizeSummaryString(value)
  return sanitized.trim() ? sanitized.trim() : undefined
}

export { redactForOutput, sanitizeErrorForOutput }

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

export function shouldRecordPageContent(options: {
  recordPageContent?: string | boolean
}): boolean {
  return parseBooleanFlag(options.recordPageContent, false) ?? false
}

export function buildRuntimeConfig(
  command: string,
  options: CommonOptions,
): CliRuntimeConfig {
  const chromeProfile = resolveChromeProfileLaunchConfig({
    useDefaultProfile:
      parseBooleanFlag(options.chromeDefaultProfile, false) ?? false,
  })
  const runtimeConfigOverrides = options.runtimeConfigOverrides

  return resolveConfig({
    command,
    configFile: options.config,
    profile: options.profile,
    overrides: {
      ...runtimeConfigOverrides,
      browser: {
        ...runtimeConfigOverrides?.browser,
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
  setBaseObservabilityContext({
    command,
  })
  setObservabilityRuntimeState({
    command,
    config: redactForOutput(config),
  })
  logCliEvent('info', 'command.runtime_configured', {
    command,
    config: redactForOutput(config),
  })
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
  appendSummaryLine(lines, 'page content', artifacts.pageContentPath)
}

function formatInviteCounts(
  result: Record<string, unknown>,
): string | undefined {
  const requested = asStringArray(result.requestedEmails)?.length
  const invited = asStringArray(result.invitedEmails)?.length
  const skipped = asStringArray(result.skippedEmails)?.length
  const errored = asStringArray(result.erroredEmails)?.length
  const removed = asStringArray(result.removedMemberEmails)?.length
  const removedInvites = asStringArray(result.removedInviteEmails)?.length

  const parts = [
    requested != null ? `requested ${requested}` : undefined,
    invited != null ? `invited ${invited}` : undefined,
    skipped != null ? `skipped ${skipped}` : undefined,
    errored != null ? `errored ${errored}` : undefined,
    removed != null ? `removed ${removed}` : undefined,
    removedInvites != null ? `removed invites ${removedInvites}` : undefined,
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
    const trial = asRecord(record.trial) || asRecord(record.teamTrial)
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
    appendSummaryLine(lines, 'trial', trial?.plan || trial?.coupon)
    appendSummaryLine(lines, 'payment method', trial?.paymentMethod)
    appendExactSummaryLine(
      lines,
      'payment url',
      trial?.paymentRedirectUrl || trial?.paypalApprovalUrl,
    )
    appendSummaryLine(
      lines,
      'payment url file',
      trial?.paymentRedirectUrlPath || trial?.paypalApprovalUrlPath,
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

  if (pageName === 'chatgpt-invite') {
    const invites = asRecord(record.invites)
    appendSummaryLine(lines, 'email', record.email)
    appendSummaryLine(lines, 'authenticated', asBoolean(record.authenticated))
    appendSummaryLine(lines, 'workspace', record.workspaceId)
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

  if (pageName === 'chatgpt-team-trial') {
    appendSummaryLine(lines, 'email', record.email)
    appendSummaryLine(lines, 'authenticated', asBoolean(record.authenticated))
    appendSummaryLine(lines, 'checkout', record.checkoutUrl)
    appendSummaryLine(lines, 'payment method', record.paymentMethod)
    appendExactSummaryLine(
      lines,
      'payment url',
      record.paymentRedirectUrl || record.paypalApprovalUrl,
    )
    appendSummaryLine(
      lines,
      'payment url file',
      record.paymentRedirectUrlPath || record.paypalApprovalUrlPath,
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
  logCliEvent('info', 'flow.summary', {
    command,
    result: redactForOutput(result),
  })
  writeCliStdoutLine(formatFlowCompletionSummary(command, result))
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
  logCliEvent('info', 'flow.artifact', {
    command,
    label,
    path: path.trim(),
  })
  writeCliStderrLine(`${prefix}${label}: ${path.trim()}`)
}

export function formatFlowProgressUpdate(
  command: string,
  update: FlowProgressUpdate,
): string | undefined {
  const body = formatFlowProgressMessage(update)
  if (!body) {
    return undefined
  }

  return `[${command}] ${body}`
}

export function formatFlowProgressMessage(
  update: FlowProgressUpdate,
): string | undefined {
  const fromState = normalizeProgressField(update.fromState)
  const toState =
    normalizeProgressField(update.toState) ||
    (update.state !== 'idle' ? normalizeProgressField(update.state) : undefined)
  const event = normalizeProgressField(update.event)
  const message = normalizeProgressField(update.message)
  const transition = formatFlowProgressTransition({
    fromState,
    toState,
    event,
  })

  let body = transition

  if (message) {
    body = body ? `${body} | ${message}` : message
  }

  if (!body && event && event !== 'machine.started') {
    body = `event ${event}`
  }

  if (!body && toState) {
    body = `state ${toState}`
  }

  if (!body && update.status === 'failed' && !update.error) {
    return undefined
  }

  if (!body) {
    body = normalizeProgressField(update.status)
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

  return body
}

function formatFlowProgressTransition(input: {
  fromState?: string
  toState?: string
  event?: string
}): string | undefined {
  const fromState = input.fromState
  const toState = input.toState
  const event = input.event

  if (event === 'machine.started' && toState) {
    return `state ${toState} (${event})`
  }

  if (fromState && toState && event) {
    return `${fromState} --${event}--> ${toState}`
  }

  if (fromState && toState) {
    return `${fromState} -> ${toState}`
  }

  if (toState && event) {
    return `${toState} (${event})`
  }

  if (toState) {
    return `state ${toState}`
  }

  if (event && event !== 'machine.started') {
    return `event ${event}`
  }

  return undefined
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
    logCliEvent('debug', 'flow.progress', {
      command,
      update,
    })
    writeCliStderrLine(line)
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
    const lastTransition = snapshot.history.at(-1)
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
      fromState: lastTransition?.from,
      toState: lastTransition?.to || snapshot.state,
    })
  })
}

export function reportError(error: unknown): void {
  const message = sanitizeErrorForOutput(error).message
  const diagnostics = captureCliDiagnostics({
    reason: 'handled-top-level-error',
    error,
    handled: true,
  })
  logCliEvent('fatal', 'command.failed', {
    error,
    diagnostics,
  })
  writeCliStderrLine(
    JSON.stringify(
      redactForOutput({
        status: 'failed',
        error: message,
        diagnostics,
      }),
      null,
      2,
    ),
  )
  process.exitCode = 1
}

export function execute(task: Promise<void>): void {
  task.catch(reportError)
}
