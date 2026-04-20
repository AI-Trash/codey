import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Readable } from 'stream'
import { ensureDir, writeFileAtomic } from '../../utils/fs'
import {
  getCliFlowDefinition,
  listCliFlowOptionDefinitions,
  normalizeCliFlowTaskOptions,
  type CliFlowCommandId,
} from './flow-registry'
import { parseBooleanFlag, parseNumberFlag, type FlowOptions } from './helpers'
import {
  buildFailedFlowCommandExecution,
  type FlowCommandExecution,
} from './result-file'

const BATCH_METADATA_KEYS = new Set(['flowId', 'label', 'name', 'options'])
const BATCH_PARENT_OPTION_KEYS = new Set([
  'batchFile',
  'batchConcurrency',
  'summaryCsv',
])
const FLOW_RUNTIME_OPTION_KEYS = new Set(['config', 'profile'])

const BATCH_SUMMARY_COLUMNS = [
  'taskIndex',
  'rowNumber',
  'label',
  'flowId',
  'pageName',
  'status',
  'exitCode',
  'signal',
  'startedAt',
  'completedAt',
  'durationMs',
  'email',
  'identityId',
  'authenticated',
  'verified',
  'method',
  'inviteStrategy',
  'inviteRequested',
  'inviteInvited',
  'inviteSkipped',
  'inviteErrored',
  'sharedIdentityId',
  'sharedSessionId',
  'channel',
  'projectId',
  'redirectUri',
  'url',
  'harPath',
  'apiHarPath',
  'error',
] as const

interface RawBatchTaskInput {
  rowNumber: number
  source: Record<string, unknown>
}

export interface FlowBatchTask {
  taskIndex: number
  rowNumber: number
  label?: string
  flowId: CliFlowCommandId
  options: Partial<FlowOptions>
}

export interface FlowBatchTaskExecution {
  task: FlowBatchTask
  outcome: FlowCommandExecution
  exitCode?: number
  signal?: NodeJS.Signals
}

export interface FlowBatchRunResult {
  tasks: FlowBatchTask[]
  executions: FlowBatchTaskExecution[]
  summaryCsv: string
  summaryCsvPath: string
}

function timeStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripByteOrderMark(content: string): string {
  return content.replace(/^\uFEFF/, '')
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < content.length; index += 1) {
    const current = content[index]
    const next = content[index + 1]

    if (current === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        index += 1
        continue
      }

      inQuotes = !inQuotes
      continue
    }

    if (!inQuotes && current === ',') {
      row.push(cell)
      cell = ''
      continue
    }

    if (!inQuotes && (current === '\n' || current === '\r')) {
      if (current === '\r' && next === '\n') {
        index += 1
      }
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += current
  }

  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }

  return rows.filter((currentRow) =>
    currentRow.some((cellValue) => cellValue.trim().length),
  )
}

function parseCsvBatchTasks(batchFilePath: string): RawBatchTaskInput[] {
  const content = stripByteOrderMark(fs.readFileSync(batchFilePath, 'utf8'))
  const rows = parseCsvRows(content)
  if (!rows.length) {
    return []
  }

  const header = rows[0]!.map((cell) => cell.trim())
  if (!header.some(Boolean)) {
    return []
  }

  return rows.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    source: Object.fromEntries(
      header
        .map((key, columnIndex) => [key, row[columnIndex] ?? ''] as const)
        .filter(([key]) => key.length > 0),
    ),
  }))
}

function parseJsonBatchTasks(batchFilePath: string): RawBatchTaskInput[] {
  const content = stripByteOrderMark(fs.readFileSync(batchFilePath, 'utf8'))
  const parsed = JSON.parse(content) as unknown
  const tasks = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.tasks)
      ? parsed.tasks
      : undefined

  if (!tasks) {
    throw new Error(
      `Unsupported batch JSON in ${batchFilePath}. Expected an array or an object with a tasks array.`,
    )
  }

  return tasks.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(
        `Invalid batch task at item ${index + 1} in ${batchFilePath}. Each task must be an object.`,
      )
    }

    return {
      rowNumber: index + 1,
      source: entry,
    }
  })
}

function readRawBatchTasks(batchFilePath: string): RawBatchTaskInput[] {
  const ext = path.extname(batchFilePath).toLowerCase()
  if (ext === '.json') {
    return parseJsonBatchTasks(batchFilePath)
  }

  return parseCsvBatchTasks(batchFilePath)
}

function normalizeFlowBatchOptions(
  flowId: CliFlowCommandId,
  input: Record<string, unknown>,
): Partial<FlowOptions> {
  const normalized = normalizeCliFlowTaskOptions(
    flowId,
    input,
  ) as Partial<FlowOptions>
  const config =
    typeof input.config === 'string' ? input.config.trim() : undefined
  const profile =
    typeof input.profile === 'string' ? input.profile.trim() : undefined

  if (config) {
    normalized.config = config
  }

  if (profile) {
    normalized.profile = profile
  }

  return normalized
}

function resolveBatchTaskFlowId(
  source: Record<string, unknown>,
  defaultFlowId?: CliFlowCommandId,
): CliFlowCommandId {
  const rawFlowId =
    typeof source.flowId === 'string' ? source.flowId.trim() : undefined
  const flowId = (rawFlowId || defaultFlowId) as CliFlowCommandId | undefined
  if (!flowId || !getCliFlowDefinition(flowId)) {
    throw new Error(
      rawFlowId
        ? `Unsupported flowId "${rawFlowId}" in batch task.`
        : 'Each batch task must specify flowId when no default flow command is selected.',
    )
  }

  return flowId
}

function resolveBatchTaskLabel(
  source: Record<string, unknown>,
): string | undefined {
  for (const key of ['label', 'name']) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return undefined
}

function resolveRawBatchTaskOptions(
  source: Record<string, unknown>,
): Record<string, unknown> {
  if (isRecord(source.options)) {
    return source.options
  }

  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !BATCH_METADATA_KEYS.has(key)),
  )
}

function validateBatchTaskOptionKeys(
  flowId: CliFlowCommandId,
  rowNumber: number,
  source: Record<string, unknown>,
): void {
  const allowedOptionKeys = new Set([
    ...listCliFlowOptionDefinitions(flowId).map((definition) => definition.key),
    ...FLOW_RUNTIME_OPTION_KEYS,
  ])

  for (const [key, value] of Object.entries(source)) {
    if (allowedOptionKeys.has(key)) {
      continue
    }

    if (BATCH_METADATA_KEYS.has(key)) {
      continue
    }

    const isBlankString = typeof value === 'string' && !value.trim()
    if (value == null || isBlankString) {
      continue
    }

    throw new Error(
      `Unsupported option "${key}" in batch task row ${rowNumber} for ${flowId}.`,
    )
  }
}

function buildInheritedBatchOptions(
  flowId: CliFlowCommandId,
  options: Partial<FlowOptions>,
): Partial<FlowOptions> {
  return normalizeFlowBatchOptions(flowId, options as Record<string, unknown>)
}

function enforceBatchExitOptions(
  flowId: CliFlowCommandId,
  rowNumber: number,
  options: Partial<FlowOptions>,
): Partial<FlowOptions> {
  if (parseBooleanFlag(options.record) === true) {
    throw new Error(
      `Batch task row ${rowNumber} for ${flowId} cannot use --record true because the browser must close before the CSV summary is generated.`,
    )
  }

  return {
    ...options,
    record: false,
  }
}

export function loadFlowBatchTasks(input: {
  batchFile: string
  options: Partial<FlowOptions>
  defaultFlowId?: CliFlowCommandId
}): FlowBatchTask[] {
  const batchFilePath = path.resolve(input.batchFile)
  const rawTasks = readRawBatchTasks(batchFilePath)
  if (!rawTasks.length) {
    throw new Error(`No batch tasks were found in ${batchFilePath}.`)
  }

  return rawTasks.map((rawTask, taskIndex) => {
    const flowId = resolveBatchTaskFlowId(rawTask.source, input.defaultFlowId)
    const inheritedOptions = buildInheritedBatchOptions(flowId, input.options)
    const rawTaskOptions = resolveRawBatchTaskOptions(rawTask.source)
    validateBatchTaskOptionKeys(flowId, rawTask.rowNumber, rawTaskOptions)
    const normalizedTaskOptions = normalizeFlowBatchOptions(
      flowId,
      rawTaskOptions,
    )

    return {
      taskIndex: taskIndex + 1,
      rowNumber: rawTask.rowNumber,
      label: resolveBatchTaskLabel(rawTask.source),
      flowId,
      options: enforceBatchExitOptions(flowId, rawTask.rowNumber, {
        ...inheritedOptions,
        ...normalizedTaskOptions,
      }),
    }
  })
}

function serializeFlowOptionsForCli(options: Partial<FlowOptions>): string[] {
  const args: string[] = []

  for (const [key, value] of Object.entries(options)) {
    if (BATCH_PARENT_OPTION_KEYS.has(key) || key === 'progressReporter') {
      continue
    }

    if (value == null) {
      continue
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry !== 'string' || !entry.trim()) {
          continue
        }
        args.push(`--${key}`, entry)
      }
      continue
    }

    if (typeof value === 'boolean') {
      args.push(`--${key}`, value ? 'true' : 'false')
      continue
    }

    if (typeof value === 'number') {
      args.push(`--${key}`, String(value))
      continue
    }

    if (typeof value === 'string' && value.trim()) {
      args.push(`--${key}`, value)
    }
  }

  return args
}

function getPnpmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function createTempResultFilePath(): string {
  return path.join(
    os.tmpdir(),
    `codey-flow-batch-${process.pid}-${timeStamp()}-${Math.random()
      .toString(16)
      .slice(2)}.json`,
  )
}

function forwardPrefixedStream(stream: Readable | null, prefix: string): void {
  if (!stream) {
    return
  }

  let pending = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.length) {
        continue
      }
      process.stderr.write(`${prefix}${line}\n`)
    }
  })
  stream.on('end', () => {
    const line = pending.trimEnd()
    if (!line) {
      return
    }
    process.stderr.write(`${prefix}${line}\n`)
  })
}

function readFlowExecutionResultFile(
  resultFilePath: string,
): FlowCommandExecution | undefined {
  if (!fs.existsSync(resultFilePath)) {
    return undefined
  }

  const content = fs.readFileSync(resultFilePath, 'utf8')
  const parsed = JSON.parse(content) as unknown
  return isRecord(parsed) ? (parsed as FlowCommandExecution) : undefined
}

async function runFlowBatchTask(
  task: FlowBatchTask,
  totalTasks: number,
  workspaceRoot: string,
): Promise<FlowBatchTaskExecution> {
  const label = task.label || `${task.flowId}#${task.taskIndex}`
  const prefix = `[flow:batch ${task.taskIndex}/${totalTasks} ${label}] `
  const resultFilePath = createTempResultFilePath()
  const startedAt = new Date().toISOString()

  console.error(`${prefix}starting`)

  const child = spawn(
    getPnpmCommand(),
    [
      '--filter',
      './packages/flows',
      'exec',
      'jiti',
      'src/cli.ts',
      'flow',
      task.flowId,
      ...serializeFlowOptionsForCli(task.options),
    ],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CODEY_WORKSPACE_ROOT: workspaceRoot,
        CODEY_FLOW_RESULT_JSON_FILE: resultFilePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  forwardPrefixedStream(child.stdout, prefix)
  forwardPrefixedStream(child.stderr, prefix)

  const completion = await new Promise<{
    exitCode?: number
    signal?: NodeJS.Signals
    spawnError?: unknown
  }>((resolve) => {
    child.once('error', (error) => {
      resolve({
        spawnError: error,
      })
    })
    child.once('close', (exitCode, signal) => {
      resolve({
        exitCode: exitCode ?? undefined,
        signal: signal ?? undefined,
      })
    })
  })

  const fileOutcome = readFlowExecutionResultFile(resultFilePath)
  fs.rmSync(resultFilePath, { force: true })

  let outcome = fileOutcome
  if (!outcome) {
    outcome = buildFailedFlowCommandExecution({
      flowId: task.flowId,
      command: `flow:${task.flowId}`,
      startedAt,
      completedAt: new Date().toISOString(),
      options: task.options,
      error:
        completion.spawnError ||
        completion.signal ||
        completion.exitCode != null
          ? `Flow worker exited without a result file (exit=${completion.exitCode ?? 'unknown'}, signal=${completion.signal ?? 'none'}).`
          : 'Flow worker did not produce a result file.',
    })
  } else if (completion.exitCode && outcome.status !== 'failed') {
    outcome = buildFailedFlowCommandExecution({
      flowId: task.flowId,
      command: outcome.command || `flow:${task.flowId}`,
      startedAt: outcome.startedAt,
      completedAt: outcome.completedAt,
      options: outcome.options || task.options,
      error: `Flow worker exited with code ${completion.exitCode} after reporting success.`,
    })
  }

  const durationMs =
    typeof outcome.durationMs === 'number' &&
    Number.isFinite(outcome.durationMs)
      ? outcome.durationMs
      : 0
  console.error(`${prefix}${outcome.status} in ${durationMs}ms`)

  return {
    task,
    outcome,
    exitCode: completion.exitCode,
    signal: completion.signal,
  }
}

function csvEscape(value: unknown): string {
  if (value == null) {
    return ''
  }

  const text = String(value)
  if (!/[",\r\n]/.test(text)) {
    return text
  }

  return `"${text.replace(/"/g, '""')}"`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : undefined
}

function booleanCsvValue(value: boolean | undefined): string | undefined {
  return value == null ? undefined : value ? 'true' : 'false'
}

function numericCsvValue(value: number | undefined): string | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : undefined
}

function countCsvValue(values: string[] | undefined): string | undefined {
  return values ? String(values.length) : undefined
}

function buildBatchSummaryRow(
  execution: FlowBatchTaskExecution,
): Record<(typeof BATCH_SUMMARY_COLUMNS)[number], string | undefined> {
  const result = asRecord(execution.outcome.result)
  const storedIdentity = asRecord(result?.storedIdentity)
  const invites = asRecord(result?.invites)
  const codeyApp = asRecord(result?.codeyApp)
  const axonHub = asRecord(result?.axonHub)
  const channel = asRecord(axonHub?.channel)
  const inputOptions = execution.outcome.options || execution.task.options

  return {
    taskIndex: String(execution.task.taskIndex),
    rowNumber: String(execution.task.rowNumber),
    label: execution.task.label,
    flowId: execution.task.flowId,
    pageName: asString(result?.pageName),
    status: execution.outcome.status,
    exitCode: numericCsvValue(execution.exitCode),
    signal: execution.signal,
    startedAt: execution.outcome.startedAt,
    completedAt: execution.outcome.completedAt,
    durationMs: numericCsvValue(execution.outcome.durationMs),
    email: asString(result?.email) || asString(inputOptions.email),
    identityId:
      asString(storedIdentity?.id) || asString(inputOptions.identityId),
    authenticated: booleanCsvValue(asBoolean(result?.authenticated)),
    verified: booleanCsvValue(asBoolean(result?.verified)),
    method: asString(result?.method),
    inviteStrategy: asString(invites?.strategy),
    inviteRequested: countCsvValue(asStringArray(invites?.requestedEmails)),
    inviteInvited: countCsvValue(asStringArray(invites?.invitedEmails)),
    inviteSkipped: countCsvValue(asStringArray(invites?.skippedEmails)),
    inviteErrored: countCsvValue(asStringArray(invites?.erroredEmails)),
    sharedIdentityId: asString(codeyApp?.identityId),
    sharedSessionId: asString(codeyApp?.sessionRecordId),
    channel: asString(channel?.name) || asString(channel?.id),
    projectId: asString(axonHub?.projectId),
    redirectUri: asString(result?.redirectUri),
    url: asString(result?.url),
    harPath: asString(result?.harPath),
    apiHarPath: asString(result?.apiHarPath),
    error: asString(execution.outcome.error),
  }
}

export function buildFlowBatchSummaryCsv(
  executions: FlowBatchTaskExecution[],
): string {
  const lines = [
    BATCH_SUMMARY_COLUMNS.join(','),
    ...executions.map((execution) => {
      const row = buildBatchSummaryRow(execution)
      return BATCH_SUMMARY_COLUMNS.map((column) => csvEscape(row[column])).join(
        ',',
      )
    }),
  ]

  return `${lines.join('\n')}\n`
}

async function runFlowBatchTasks(
  tasks: FlowBatchTask[],
  options: {
    concurrency: number
    workspaceRoot: string
  },
): Promise<FlowBatchTaskExecution[]> {
  const executions: FlowBatchTaskExecution[] = []
  let nextTaskIndex = 0

  const workerCount = Math.max(1, Math.min(options.concurrency, tasks.length))

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextTaskIndex
        nextTaskIndex += 1
        if (currentIndex >= tasks.length) {
          return
        }

        executions[currentIndex] = await runFlowBatchTask(
          tasks[currentIndex]!,
          tasks.length,
          options.workspaceRoot,
        )
      }
    }),
  )

  return executions
}

function resolveSummaryCsvPath(
  summaryCsv: string | undefined,
  artifactsDir: string,
): string {
  if (typeof summaryCsv === 'string' && summaryCsv.trim()) {
    return path.resolve(summaryCsv)
  }

  ensureDir(artifactsDir)
  return path.join(artifactsDir, `${timeStamp()}-flow-batch-summary.csv`)
}

function toBatchBaseOptions(
  options: Partial<FlowOptions>,
): Partial<FlowOptions> {
  return Object.fromEntries(
    Object.entries(options).filter(
      ([key]) =>
        !BATCH_PARENT_OPTION_KEYS.has(key) && key !== 'progressReporter',
    ),
  ) as Partial<FlowOptions>
}

export async function runFlowBatch(input: {
  command: string
  options: Partial<FlowOptions>
  artifactsDir: string
  workspaceRoot: string
  defaultFlowId?: CliFlowCommandId
}): Promise<FlowBatchRunResult> {
  const batchFile =
    typeof input.options.batchFile === 'string'
      ? input.options.batchFile.trim()
      : ''
  if (!batchFile) {
    throw new Error('Batch mode requires --batchFile <file>.')
  }

  const concurrency = Math.max(
    1,
    parseNumberFlag(input.options.batchConcurrency, 1) ?? 1,
  )
  const tasks = loadFlowBatchTasks({
    batchFile,
    options: toBatchBaseOptions(input.options),
    defaultFlowId: input.defaultFlowId,
  })

  console.error(
    `[${input.command}] running ${tasks.length} batch task(s) with concurrency ${concurrency}`,
  )

  const executions = await runFlowBatchTasks(tasks, {
    concurrency,
    workspaceRoot: input.workspaceRoot,
  })
  const summaryCsv = buildFlowBatchSummaryCsv(executions)
  const summaryCsvPath = resolveSummaryCsvPath(
    typeof input.options.summaryCsv === 'string'
      ? input.options.summaryCsv
      : undefined,
    input.artifactsDir,
  )

  writeFileAtomic(summaryCsvPath, summaryCsv)
  console.error(`[${input.command}] batch summary csv: ${summaryCsvPath}`)
  process.stdout.write(summaryCsv)

  if (executions.some((execution) => execution.outcome.status === 'failed')) {
    process.exitCode = 1
  }

  return {
    tasks,
    executions,
    summaryCsv,
    summaryCsvPath,
  }
}
