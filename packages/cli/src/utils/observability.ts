import { AsyncLocalStorage } from 'async_hooks'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { inspect } from 'util'

import { ensureDir, writeFileAtomic } from './fs'
import {
  redactForOutput,
  sanitizeErrorForOutput,
  sanitizeText,
} from './redaction'

type CliObservabilityPrimitive = string | number | boolean | null
type CliObservabilityContextValue =
  | CliObservabilityPrimitive
  | undefined

export type CliObservabilityContext = Record<
  string,
  CliObservabilityContextValue
>

export type CliObservabilityLevel =
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'

interface CliObservabilityState {
  rootDir: string
  logsDir: string
  runId: string
  argv: string[]
  pid: number
  structuredLogPath: string
  humanLogPath?: string
  baseContext: CliObservabilityContext
  runtimeState: Record<string, unknown>
}

interface CliObservabilityRecord {
  timestamp: string
  level: CliObservabilityLevel
  event: string
  runId: string
  pid: number
  context?: CliObservabilityContext
  data?: unknown
}

export interface CliDiagnosticArtifacts {
  snapshotPath?: string
  reportPath?: string
}

const contextStorage = new AsyncLocalStorage<CliObservabilityContext>()

let observabilityState: CliObservabilityState | undefined
let exitListenerInstalled = false
let warningListenerInstalled = false
let uncaughtExceptionListenerInstalled = false
let unhandledRejectionListenerInstalled = false
let fatalInFlight = false
const shouldInstallFatalProcessListeners = !(
  process.env.VITEST || process.env.VITEST_WORKER_ID
)

const handleProcessExit = (code: number) => {
  if (!observabilityState) {
    return
  }

  appendRecord({
    timestamp: new Date().toISOString(),
    level: 'info',
    event: 'process.exit',
    runId: observabilityState.runId,
    pid: observabilityState.pid,
    context: getCurrentContext(),
    data: { code },
  })
}

const handleProcessWarning = (warning: Error) => {
  logCliEvent('warn', 'process.warning', {
    warning: serializeError(warning),
  })
}

const handleUncaughtException = (error: Error) => {
  if (fatalInFlight) {
    writeDirectStderr(
      `[codey:fatal] secondary uncaught exception: ${sanitizeErrorForOutput(error).message}`,
    )
    process.exit(1)
    return
  }

  fatalInFlight = true
  const artifacts = captureCliDiagnostics({
    reason: 'uncaught-exception',
    error,
    handled: false,
  })
  writeDirectStderr(
    [
      `[codey:fatal] Uncaught exception: ${sanitizeErrorForOutput(error).message}`,
      artifacts.snapshotPath ? `snapshot: ${artifacts.snapshotPath}` : undefined,
      artifacts.reportPath ? `report: ${artifacts.reportPath}` : undefined,
      observabilityState?.structuredLogPath
        ? `trace: ${observabilityState.structuredLogPath}`
        : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
  )
  process.exit(1)
}

const handleUnhandledRejection = (reason: unknown) => {
  if (fatalInFlight) {
    writeDirectStderr(
      `[codey:fatal] secondary unhandled rejection: ${sanitizeErrorForOutput(reason).message}`,
    )
    process.exit(1)
    return
  }

  fatalInFlight = true
  const artifacts = captureCliDiagnostics({
    reason: 'unhandled-rejection',
    error: reason,
    handled: false,
  })
  writeDirectStderr(
    [
      `[codey:fatal] Unhandled rejection: ${sanitizeErrorForOutput(reason).message}`,
      artifacts.snapshotPath ? `snapshot: ${artifacts.snapshotPath}` : undefined,
      artifacts.reportPath ? `report: ${artifacts.reportPath}` : undefined,
      observabilityState?.structuredLogPath
        ? `trace: ${observabilityState.structuredLogPath}`
        : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
  )
  process.exit(1)
}

function normalizeContextValue(value: unknown): CliObservabilityContextValue {
  if (value == null) {
    return null
  }

  if (typeof value === 'string') {
    const normalized = sanitizeText(value).trim()
    return normalized || null
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  return sanitizeText(
    inspect(redactForOutput(value), {
      depth: 2,
      breakLength: Infinity,
      compact: true,
    }),
  )
}

function mergeContext(
  base: CliObservabilityContext,
  patch: CliObservabilityContext,
): CliObservabilityContext {
  const next = { ...base }

  for (const [key, value] of Object.entries(patch)) {
    const normalized = normalizeContextValue(value)
    if (normalized === undefined) {
      delete next[key]
      continue
    }

    next[key] = normalized
  }

  return next
}

function sanitizeLogLabel(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return normalized.replace(/^-+|-+$/g, '') || 'cli'
}

function resolveLogLabel(argv: string[]): string {
  const primary = argv[0]?.trim()
  const secondary = argv[1]?.trim()

  if (!primary) {
    return 'cli'
  }

  if (
    (primary === 'flow' ||
      primary === 'auth' ||
      primary === 'exchange' ||
      primary === 'tui' ||
      primary === 'daemon') &&
    secondary
  ) {
    return sanitizeLogLabel(`${primary}-${secondary}`)
  }

  return sanitizeLogLabel(primary)
}

function formatTimestampForPath(date: Date): string {
  return date.toISOString().replace(/:/g, '-')
}

function getCurrentContext(): CliObservabilityContext {
  const base = observabilityState?.baseContext || {}
  const active = contextStorage.getStore()
  return active ? mergeContext(base, active) : base
}

function appendRecord(record: CliObservabilityRecord): void {
  if (!observabilityState) {
    return
  }

  fs.appendFileSync(
    observabilityState.structuredLogPath,
    `${JSON.stringify(record)}\n`,
    'utf8',
  )
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return redactForOutput({
      name: error.name,
      message: sanitizeErrorForOutput(error).message,
      stack: sanitizeText(error.stack || error.message),
      cause:
        error.cause === undefined ? undefined : serializeError(error.cause),
    }) as Record<string, unknown>
  }

  return redactForOutput({
    message: sanitizeErrorForOutput(error).message,
    value: sanitizeText(
      inspect(error, {
        depth: 4,
        breakLength: Infinity,
        compact: true,
      }),
    ),
  }) as Record<string, unknown>
}

function writeNodeDiagnosticReport(
  filePath: string,
  error?: Error,
): string | undefined {
  if (!process.report || typeof process.report.writeReport !== 'function') {
    return undefined
  }

  try {
    process.report.writeReport(filePath, error)
    return filePath
  } catch {
    try {
      process.report.writeReport(filePath)
      return filePath
    } catch {
      return undefined
    }
  }
}

function buildDiagnosticPrefix(reason: string): string {
  const timestamp = formatTimestampForPath(new Date())
  const runPart = observabilityState?.runId || crypto.randomUUID()
  return `${timestamp}-${sanitizeLogLabel(reason)}-${process.pid}-${runPart}`
}

function writeDirectStderr(line: string): void {
  try {
    process.stderr.write(`${line}\n`)
  } catch {}
}

function installProcessListeners(): void {
  if (!exitListenerInstalled) {
    process.on('exit', handleProcessExit)
    exitListenerInstalled = true
  }

  if (!warningListenerInstalled) {
    process.on('warning', handleProcessWarning)
    warningListenerInstalled = true
  }

  if (shouldInstallFatalProcessListeners) {
    if (!uncaughtExceptionListenerInstalled) {
      process.on('uncaughtException', handleUncaughtException)
      uncaughtExceptionListenerInstalled = true
    }

    if (!unhandledRejectionListenerInstalled) {
      process.on('unhandledRejection', handleUnhandledRejection)
      unhandledRejectionListenerInstalled = true
    }
  }
}

export function initializeCliObservability(input: {
  rootDir: string
  argv?: string[]
}): {
  runId: string
  structuredLogPath: string
} {
  if (observabilityState) {
    return {
      runId: observabilityState.runId,
      structuredLogPath: observabilityState.structuredLogPath,
    }
  }

  const argv = input.argv || process.argv.slice(2)
  const logsDir = path.join(input.rootDir, '.codey', 'logs')
  ensureDir(logsDir)

  const runId = crypto.randomUUID()
  const structuredLogPath = path.join(
    logsDir,
    `${formatTimestampForPath(new Date())}-${resolveLogLabel(argv)}-${process.pid}-${runId}.ndjson`,
  )

  observabilityState = {
    rootDir: input.rootDir,
    logsDir,
    runId,
    argv: [...argv],
    pid: process.pid,
    structuredLogPath,
    baseContext: {
      runId,
    },
    runtimeState: {},
  }

  installProcessListeners()
  logCliEvent('info', 'process.start', {
    argv,
    cwd: process.cwd(),
  })

  return {
    runId,
    structuredLogPath,
  }
}

export function getCliObservabilityLogPath(): string | undefined {
  return observabilityState?.structuredLogPath
}

export function getCliObservabilityRunId(): string | undefined {
  return observabilityState?.runId
}

export function setCliHumanLogPath(filePath: string | undefined): void {
  if (!observabilityState) {
    return
  }

  observabilityState.humanLogPath = filePath
}

export function setBaseObservabilityContext(
  patch: CliObservabilityContext,
): void {
  if (!observabilityState) {
    return
  }

  observabilityState.baseContext = mergeContext(
    observabilityState.baseContext,
    patch,
  )
}

export function getCurrentObservabilityContext(): CliObservabilityContext {
  return getCurrentContext()
}

export function withObservabilityContext<T>(
  patch: CliObservabilityContext,
  task: () => T,
): T {
  const activeContext = contextStorage.getStore() || {}
  return contextStorage.run(mergeContext(activeContext, patch), task)
}

export function logCliEvent(
  level: CliObservabilityLevel,
  event: string,
  data?: unknown,
): void {
  if (!observabilityState) {
    return
  }

  const context = getCurrentContext()
  appendRecord({
    timestamp: new Date().toISOString(),
    level,
    event,
    runId: observabilityState.runId,
    pid: observabilityState.pid,
    ...(Object.keys(context).length ? { context } : {}),
    ...(data === undefined ? {} : { data: redactForOutput(data) }),
  })
}

export async function traceCliOperation<T>(
  event: string,
  data: Record<string, unknown> | undefined,
  task: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  logCliEvent('debug', `${event}.start`, data)

  try {
    const result = await task()
    logCliEvent('info', `${event}.complete`, {
      ...data,
      durationMs: Date.now() - startedAt,
    })
    return result
  } catch (error) {
    logCliEvent('error', `${event}.error`, {
      ...data,
      durationMs: Date.now() - startedAt,
      error: serializeError(error),
    })
    throw error
  }
}

export function recordCliOutput(
  stream: 'stdout' | 'stderr',
  line: string,
): void {
  const normalized = sanitizeText(line)
  if (!normalized.trim()) {
    return
  }

  logCliEvent('debug', 'cli.output', {
    stream,
    line: normalized,
  })
}

export function setObservabilityRuntimeState(
  patch: Record<string, unknown>,
): void {
  if (!observabilityState) {
    return
  }

  observabilityState.runtimeState = {
    ...observabilityState.runtimeState,
    ...redactForOutput(patch),
  }
}

export function captureCliDiagnostics(input: {
  reason: string
  error: unknown
  handled: boolean
  includeNodeReport?: boolean
}): CliDiagnosticArtifacts {
  if (!observabilityState) {
    return {}
  }

  const prefix = buildDiagnosticPrefix(input.reason)
  const snapshotPath = path.join(
    observabilityState.logsDir,
    `${prefix}.fatal.json`,
  )
  const reportPath =
    input.includeNodeReport === false
      ? undefined
      : writeNodeDiagnosticReport(
          path.join(observabilityState.logsDir, `${prefix}.report.json`),
          input.error instanceof Error ? input.error : undefined,
        )

  const snapshot = redactForOutput({
    reason: input.reason,
    handled: input.handled,
    capturedAt: new Date().toISOString(),
    runId: observabilityState.runId,
    pid: observabilityState.pid,
    argv: observabilityState.argv,
    cwd: process.cwd(),
    context: getCurrentContext(),
    runtimeState: observabilityState.runtimeState,
    logPaths: {
      humanLogPath: observabilityState.humanLogPath,
      structuredLogPath: observabilityState.structuredLogPath,
      reportPath,
    },
    error: serializeError(input.error),
  })

  writeFileAtomic(snapshotPath, JSON.stringify(snapshot, null, 2))
  logCliEvent('fatal', 'process.diagnostic', {
    reason: input.reason,
    handled: input.handled,
    snapshotPath,
    reportPath,
    error: serializeError(input.error),
  })

  return {
    snapshotPath,
    reportPath,
  }
}

export function resetCliObservabilityForTests(): void {
  if (exitListenerInstalled) {
    process.off('exit', handleProcessExit)
    exitListenerInstalled = false
  }
  if (warningListenerInstalled) {
    process.off('warning', handleProcessWarning)
    warningListenerInstalled = false
  }
  if (uncaughtExceptionListenerInstalled) {
    process.off('uncaughtException', handleUncaughtException)
    uncaughtExceptionListenerInstalled = false
  }
  if (unhandledRejectionListenerInstalled) {
    process.off('unhandledRejection', handleUnhandledRejection)
    unhandledRejectionListenerInstalled = false
  }
  observabilityState = undefined
  fatalInFlight = false
}
