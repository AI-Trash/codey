import { AsyncLocalStorage } from 'async_hooks'
import crypto from 'crypto'
import { createRequire } from 'module'
import path from 'path'
import { inspect } from 'util'
import type { Logger, LoggerOptions } from 'pino'

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
  humanLogPath: string
  baseContext: CliObservabilityContext
  runtimeState: Record<string, unknown>
  structuredLogger: Logger
  humanLogger: Logger
  structuredDestination: {
    flushSync?: () => void
    end: () => void
  }
  humanDestination: {
    end: () => void
  }
}

export interface CliDiagnosticArtifacts {
  snapshotPath?: string
  reportPath?: string
}

const contextStorage = new AsyncLocalStorage<CliObservabilityContext>()
const require = createRequire(import.meta.url)
const VALID_LOG_LEVELS = new Set<CliObservabilityLevel>([
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
])
const DEFAULT_STRUCTURED_LOG_LEVEL: CliObservabilityLevel = 'debug'
const DEFAULT_HUMAN_LOG_LEVEL: CliObservabilityLevel = 'info'

let observabilityState: CliObservabilityState | undefined
let exitListenerInstalled = false
let warningListenerInstalled = false
let uncaughtExceptionListenerInstalled = false
let unhandledRejectionListenerInstalled = false
let fatalInFlight = false
const shouldInstallFatalProcessListeners = !(
  process.env.VITEST || process.env.VITEST_WORKER_ID
)

let pinoModule:
  | (typeof import('pino')['default'] & {
      stdTimeFunctions: typeof import('pino')['stdTimeFunctions']
      destination: typeof import('pino')['destination']
    })
  | undefined
let pinoPrettyModule:
  | (typeof import('pino-pretty')['default'])
  | undefined

function getPino(): NonNullable<typeof pinoModule> {
  if (!pinoModule) {
    const loaded = require('pino') as
      | typeof import('pino')
      | typeof import('pino')['default']
    pinoModule = ('default' in loaded ? loaded.default : loaded) as typeof pinoModule
  }

  return pinoModule as NonNullable<typeof pinoModule>
}

function getPinoPretty(): NonNullable<typeof pinoPrettyModule> {
  if (!pinoPrettyModule) {
    const loaded = require('pino-pretty') as
      | typeof import('pino-pretty')
      | typeof import('pino-pretty')['default']
    pinoPrettyModule = ('default' in loaded ? loaded.default : loaded) as typeof pinoPrettyModule
  }

  return pinoPrettyModule as NonNullable<typeof pinoPrettyModule>
}

function resolveConfiguredLogLevel(
  envName: string,
  fallback: CliObservabilityLevel,
): CliObservabilityLevel {
  const configured = process.env[envName]?.trim().toLowerCase()
  if (!configured) {
    return fallback
  }

  return VALID_LOG_LEVELS.has(configured as CliObservabilityLevel)
    ? (configured as CliObservabilityLevel)
    : fallback
}

function resolveStructuredLogLevel(): CliObservabilityLevel {
  return resolveConfiguredLogLevel(
    'CODEY_LOG_LEVEL',
    DEFAULT_STRUCTURED_LOG_LEVEL,
  )
}

function resolveHumanLogLevel(): CliObservabilityLevel {
  return resolveConfiguredLogLevel(
    'CODEY_HUMAN_LOG_LEVEL',
    resolveConfiguredLogLevel('CODEY_LOG_LEVEL', DEFAULT_HUMAN_LOG_LEVEL),
  )
}

function createLoggerOptions(
  runId: string,
  level: CliObservabilityLevel,
): LoggerOptions {
  const pino = getPino()

  return {
    level,
    messageKey: 'message',
    errorKey: 'error',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      bindings: (bindings) => ({
        pid: bindings.pid,
        runId,
      }),
    },
  }
}

function createStructuredLogger(
  runId: string,
  structuredLogPath: string,
): {
  logger: Logger
  destination: CliObservabilityState['structuredDestination']
} {
  const pino = getPino()
  const destination = pino.destination({
    dest: structuredLogPath,
    mkdir: true,
    sync: true,
  })

  return {
    logger: pino(createLoggerOptions(runId, resolveStructuredLogLevel()), destination),
    destination,
  }
}

function createHumanLogger(
  runId: string,
  humanLogPath: string,
): {
  logger: Logger
  destination: CliObservabilityState['humanDestination']
} {
  const pino = getPino()
  const pretty = getPinoPretty()
  const destination = pretty({
    colorize: false,
    destination: humanLogPath,
    mkdir: true,
    singleLine: false,
    sync: true,
    translateTime: 'SYS:standard',
  })

  return {
    logger: pino(createLoggerOptions(runId, resolveHumanLogLevel()), destination),
    destination,
  }
}

const handleProcessExit = (code: number) => {
  if (!observabilityState) {
    return
  }

  writeRecord({
    level: 'info',
    event: 'process.exit',
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
      observabilityState?.humanLogPath
        ? `log: ${observabilityState.humanLogPath}`
        : undefined,
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
      observabilityState?.humanLogPath
        ? `log: ${observabilityState.humanLogPath}`
        : undefined,
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

function buildLogFilePrefix(argv: string[], runId: string): string {
  return `${formatTimestampForPath(new Date())}-${resolveLogLabel(argv)}-${process.pid}-${runId}`
}

function getCurrentContext(): CliObservabilityContext {
  const base = observabilityState?.baseContext || {}
  const active = contextStorage.getStore()
  return active ? mergeContext(base, active) : base
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

function writeRecord(input: {
  level: CliObservabilityLevel
  event: string
  data?: unknown
  message?: string
}): void {
  if (!observabilityState) {
    return
  }

  const context = getCurrentContext()
  const record = {
    event: input.event,
    ...(Object.keys(context).length ? { context } : {}),
    ...(input.data === undefined ? {} : { data: redactForOutput(input.data) }),
  }
  const message = input.message || input.event

  observabilityState.structuredLogger[input.level](record, message)
  observabilityState.humanLogger[input.level](record, message)
}

export function initializeCliObservability(input: {
  rootDir: string
  argv?: string[]
}): {
  runId: string
  structuredLogPath: string
  humanLogPath: string
} {
  if (observabilityState) {
    return {
      runId: observabilityState.runId,
      structuredLogPath: observabilityState.structuredLogPath,
      humanLogPath: observabilityState.humanLogPath,
    }
  }

  const argv = input.argv || process.argv.slice(2)
  const logsDir = path.join(input.rootDir, '.codey', 'logs')
  ensureDir(logsDir)

  const runId = crypto.randomUUID()
  const logFilePrefix = buildLogFilePrefix(argv, runId)
  const structuredLogPath = path.join(logsDir, `${logFilePrefix}.ndjson`)
  const humanLogPath = path.join(logsDir, `${logFilePrefix}.log`)
  const structured = createStructuredLogger(runId, structuredLogPath)
  const human = createHumanLogger(runId, humanLogPath)

  observabilityState = {
    rootDir: input.rootDir,
    logsDir,
    runId,
    argv: [...argv],
    pid: process.pid,
    structuredLogPath,
    humanLogPath,
    baseContext: {
      runId,
    },
    runtimeState: {},
    structuredLogger: structured.logger,
    humanLogger: human.logger,
    structuredDestination: structured.destination,
    humanDestination: human.destination,
  }

  installProcessListeners()
  writeRecord({
    level: 'info',
    event: 'process.start',
    data: {
      argv,
      cwd: process.cwd(),
      humanLogPath,
      structuredLogPath,
    },
  })

  return {
    runId,
    structuredLogPath,
    humanLogPath,
  }
}

export function getCliObservabilityLogPath(): string | undefined {
  return observabilityState?.structuredLogPath
}

export function getCliObservabilityRunId(): string | undefined {
  return observabilityState?.runId
}

export function setCliHumanLogPath(filePath: string | undefined): void {
  if (!observabilityState || !filePath) {
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
  writeRecord({
    level,
    event,
    data,
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

  writeRecord({
    level: 'info',
    event: 'cli.output',
    data: {
      stream,
      line: normalized,
    },
    message: `[${stream}] ${normalized}`,
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

function closeLoggerStreams(): void {
  if (!observabilityState) {
    return
  }

  try {
    observabilityState.structuredDestination.flushSync()
  } catch {}

  try {
    observabilityState.structuredDestination.end()
  } catch {}

  try {
    observabilityState.humanDestination.end()
  } catch {}
}

export function resetCliObservabilityForTests(): void {
  closeLoggerStreams()

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
