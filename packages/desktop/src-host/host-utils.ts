import type {
  CliRuntimeConfig,
  DesktopFlowOptions,
  DesktopFlowProgressUpdate,
} from './types'
import { resolveConfig, setRuntimeConfig } from '../../cli/src/config'
import { resolveChromeProfileLaunchConfig } from '../../cli/src/utils/chrome-profile'
import {
  logCliEvent,
  setBaseObservabilityContext,
  setObservabilityRuntimeState,
} from '../../cli/src/utils/observability'

const redacted = '***redacted***'
const maxRedactionDepth = 50

export type FlowProgressUpdate = DesktopFlowProgressUpdate

export interface FlowArtifactPaths {
  harPath?: string
  pageContentPath?: string
}

function parseBooleanFlag(
  value: string | boolean | undefined,
  fallback?: boolean,
): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function parseNumberFlag(
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

export function prepareDesktopRuntimeConfig(
  command: string,
  options: DesktopFlowOptions,
): CliRuntimeConfig {
  const chromeProfile = resolveChromeProfileLaunchConfig({
    useDefaultProfile:
      parseBooleanFlag(options.chromeDefaultProfile, false) ?? false,
  })
  const runtimeConfigOverrides = options.runtimeConfigOverrides
  const androidOptions = options as DesktopFlowOptions & {
    codeyAndroidAppPackage?: string
  }
  const androidRuntimeOverrides: Partial<
    NonNullable<CliRuntimeConfig['android']>
  > = {
    ...runtimeConfigOverrides?.android,
    ...(androidOptions.appiumServerUrl !== undefined
      ? { appiumServerUrl: androidOptions.appiumServerUrl }
      : {}),
    ...(androidOptions.androidUdid !== undefined
      ? { udid: androidOptions.androidUdid }
      : {}),
    ...(androidOptions.androidDeviceName !== undefined
      ? { deviceName: androidOptions.androidDeviceName }
      : {}),
    ...(androidOptions.androidPlatformVersion !== undefined
      ? { platformVersion: androidOptions.androidPlatformVersion }
      : {}),
    ...(androidOptions.androidAutomationName !== undefined
      ? { automationName: androidOptions.androidAutomationName }
      : {}),
    ...(androidOptions.androidAppPackage !== undefined
      ? { appPackage: androidOptions.androidAppPackage }
      : {}),
    ...(androidOptions.androidAppActivity !== undefined
      ? { appActivity: androidOptions.androidAppActivity }
      : {}),
    ...(androidOptions.androidNoReset !== undefined
      ? { noReset: parseBooleanFlag(androidOptions.androidNoReset) }
      : {}),
    ...(androidOptions.codeyAndroidAppPackage !== undefined
      ? { codeyAppPackage: androidOptions.codeyAndroidAppPackage }
      : {}),
  }
  const config = resolveConfig({
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
      android: androidRuntimeOverrides,
    },
  })

  setRuntimeConfig(config)
  setBaseObservabilityContext({ command })
  setObservabilityRuntimeState({
    command,
    config: redactForDesktopOutput(config),
  })
  logCliEvent('info', 'command.runtime_configured', {
    command,
    config: redactForDesktopOutput(config),
  })
  return config
}

export function resolveDesktopFlowOptions(
  flowId: string,
  options: DesktopFlowOptions,
): DesktopFlowOptions {
  const resolvedOptions: DesktopFlowOptions = { ...options }

  if (
    resolvedOptions.record === undefined &&
    parseBooleanFlag(resolvedOptions.chromeDefaultProfile, false)
  ) {
    resolvedOptions.record = true
  }

  if (
    resolvedOptions.record === undefined &&
    (flowId === 'codex-oauth' || flowId === 'chatgpt-team-trial-gopay') &&
    parseBooleanFlag(resolvedOptions.har, false)
  ) {
    resolvedOptions.record = true
  }

  if (flowId === 'noop') {
    resolvedOptions.har ??= true
    resolvedOptions.record ??= true
  }

  return resolvedOptions
}

export function shouldKeepFlowOpen(
  options: Pick<DesktopFlowOptions, 'record'>,
): boolean {
  return parseBooleanFlag(options.record, false) ?? false
}

export function shouldRecordPageContent(
  options: Pick<DesktopFlowOptions, 'recordPageContent'>,
): boolean {
  return parseBooleanFlag(options.recordPageContent, false) ?? false
}

function sanitizeText(value: string): string {
  return value
    .replace(/\b(Bearer|bearer)\s+[A-Za-z0-9\-._~+/]+=*/g, '$1 ***redacted***')
    .replace(
      /([?&](?:code|state|access_token|refresh_token|id_token|token|client_secret|api_key))=([^&\s]+)/gi,
      `$1=${redacted}`,
    )
    .replace(
      /\b(code|state|access_token|refresh_token|id_token|token|password|secret|client_secret|api_key|pin)\b\s*[:=]\s*([^\s,;"'}&]+)/gi,
      (_match, key) => `${key}=***redacted***`,
    )
    .replace(
      /(["']?)(code|state|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|secret|client[_-]?secret|api[_-]?key|pin)(["']?\s*:\s*["']?)([^"'\s,}]+)/gi,
      (_match, open, key, separator) => `${open}${key}${separator}${redacted}`,
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
  return /^https?:\/\//i.test(value.trim())
    ? sanitizeUrlString(value)
    : sanitizeText(value)
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
    return redacted
  }

  if (typeof current === 'string') {
    if (/authorizationUrl/i.test(key)) return redacted
    if (/^(url|href)$/i.test(key) || key.endsWith('Url')) {
      return sanitizeUrlString(current)
    }
    return sanitizeText(current)
  }

  if (Array.isArray(current)) {
    if (depth >= maxRedactionDepth) return `[MaxDepth:${maxRedactionDepth}]`
    if (ancestors.has(current)) return '[Circular]'
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
    if (depth >= maxRedactionDepth) return `[MaxDepth:${maxRedactionDepth}]`
    if (ancestors.has(current)) return '[Circular]'
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

export function redactForDesktopOutput<T>(value: T): T {
  return sanitizeValue('', value) as T
}

export function sanitizeErrorForDesktopOutput(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(sanitizeText(message))
}

function normalizeProgressField(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const sanitized = sanitizeSummaryString(value).replace(
    /\bhttps?:\/\/[^\s<>"')]+/gi,
    (url) => {
      const sanitizedUrl = sanitizeUrlString(url)
      try {
        const parsed = new URL(sanitizedUrl)
        return `${parsed.protocol}//${parsed.host}/...`
      } catch {
        return sanitizedUrl
      }
    },
  )
  return sanitized.trim() ? sanitized.trim() : undefined
}

function formatAttemptSuffix(attempt: number | undefined): string {
  return typeof attempt === 'number' && Number.isFinite(attempt) && attempt > 1
    ? ` (attempt ${attempt})`
    : ''
}

function isInternalProgressEvent(event: string | undefined): boolean {
  return event === 'machine.started' || event === 'context.updated'
}

function formatFlowProgressTransition(input: {
  fromState?: string
  toState?: string
  event?: string
}): string | undefined {
  if (input.event === 'machine.started' && input.toState) {
    return `state ${input.toState} (${input.event})`
  }
  if (input.fromState && input.toState && input.event) {
    return `${input.fromState} --${input.event}--> ${input.toState}`
  }
  if (input.fromState && input.toState) {
    return `${input.fromState} -> ${input.toState}`
  }
  if (input.toState && input.event) {
    return `${input.toState} (${input.event})`
  }
  return input.toState || input.event || input.fromState
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
  const attempt = formatAttemptSuffix(update.attempt)

  if (message) {
    let body = `${message}${attempt}`
    if (update.status === 'failed' && update.error) {
      const error = sanitizeSummaryString(update.error)
      if (!body.includes(error)) body += `: ${error}`
    }
    return body
  }

  if (update.status === 'failed') {
    const error = normalizeProgressField(update.error)
    return error ? `Flow failed: ${error}` : undefined
  }

  if (isInternalProgressEvent(event)) return undefined

  const body =
    formatFlowProgressTransition({ fromState, toState, event }) ||
    normalizeProgressField(update.status)

  return body ? `${body}${attempt}` : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function appendSummaryLine(
  lines: string[],
  label: string,
  value: unknown,
): void {
  if (value === undefined || value === null || value === '') return
  lines.push(`${label}: ${sanitizeSummaryString(String(value))}`)
}

export function formatFlowCompletionSummary(
  command: string,
  result: unknown,
): string {
  const record = asRecord(result)
  const pageName = typeof record?.pageName === 'string' ? record.pageName : ''
  const lines = [`${command} ${pageName === 'noop' ? 'ready' : 'completed'}`]

  if (!record) return lines.join('\n')

  appendSummaryLine(lines, 'email', record.email)
  appendSummaryLine(lines, 'identity', asRecord(record.storedIdentity)?.id)
  appendSummaryLine(lines, 'workspace', record.workspaceId)
  appendSummaryLine(lines, 'payment method', record.paymentMethod)
  appendSummaryLine(lines, 'page', record.url)
  appendSummaryLine(lines, 'title', record.title)
  appendSummaryLine(lines, 'HAR', record.harPath)
  appendSummaryLine(lines, 'page content', record.pageContentPath)

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
  if (!entries.length) return result
  return {
    ...(result as Record<string, unknown>),
    ...Object.fromEntries(entries),
  } as TResult
}
