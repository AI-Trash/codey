import fs from 'fs'
import path from 'path'
import { ensureDir } from './fs'

export interface CliOutput {
  stdoutLine?: (line: string) => void
  stderrLine?: (line: string) => void
}

const defaultCliOutput: Required<CliOutput> = {
  stdoutLine: (line) => {
    console.log(line)
  },
  stderrLine: (line) => {
    console.error(line)
  },
}

export const silentCliOutput: Required<CliOutput> = {
  stdoutLine: () => {},
  stderrLine: () => {},
}

let runtimeCliOutput: CliOutput | undefined
let fileCliOutput: Required<CliOutput> | undefined
let runtimeCliLogFilePath: string | undefined

function formatLogTimestamp(date: Date): string {
  return date.toISOString().replace(/:/g, '-')
}

function sanitizeLogFileSegment(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return normalized.replace(/^-+|-+$/g, '') || 'cli'
}

function resolveCliLogLabel(argv: string[]): string {
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
    return sanitizeLogFileSegment(`${primary}-${secondary}`)
  }

  return sanitizeLogFileSegment(primary)
}

function appendLogEntry(
  filePath: string,
  stream: 'stdout' | 'stderr' | 'session',
  line: string,
): void {
  const timestamp = new Date().toISOString()
  const entries = line.split(/\r?\n/)
  const content = `${entries
    .map((entry) => `${timestamp} [${stream}] ${entry}`)
    .join('\n')}\n`
  fs.appendFileSync(filePath, content, 'utf8')
}

export function initializeCliFileLogging(input: {
  rootDir: string
  argv?: string[]
}): string {
  if (runtimeCliLogFilePath) {
    return runtimeCliLogFilePath
  }

  const argv = input.argv || process.argv.slice(2)
  const logsDir = path.join(input.rootDir, '.codey', 'logs')
  const filePath = path.join(
    logsDir,
    `${formatLogTimestamp(new Date())}-${resolveCliLogLabel(argv)}-${process.pid}.log`,
  )

  ensureDir(logsDir)
  fileCliOutput = {
    stdoutLine: (line) => {
      appendLogEntry(filePath, 'stdout', line)
    },
    stderrLine: (line) => {
      appendLogEntry(filePath, 'stderr', line)
    },
  }
  runtimeCliLogFilePath = filePath

  appendLogEntry(filePath, 'session', `argv: ${JSON.stringify(argv)}`)
  appendLogEntry(filePath, 'session', `cwd: ${process.cwd()}`)
  appendLogEntry(filePath, 'session', `pid: ${process.pid}`)

  return filePath
}

export function getCliLogFilePath(): string | undefined {
  return runtimeCliLogFilePath
}

function resolveCliOutput(output?: CliOutput): Required<CliOutput> {
  const resolved = {
    stdoutLine:
      output?.stdoutLine ||
      runtimeCliOutput?.stdoutLine ||
      defaultCliOutput.stdoutLine,
    stderrLine:
      output?.stderrLine ||
      runtimeCliOutput?.stderrLine ||
      defaultCliOutput.stderrLine,
  }

  if (!fileCliOutput) {
    return resolved
  }

  return {
    stdoutLine: (line) => {
      resolved.stdoutLine(line)
      if (resolved.stdoutLine !== fileCliOutput?.stdoutLine) {
        fileCliOutput.stdoutLine(line)
      }
    },
    stderrLine: (line) => {
      resolved.stderrLine(line)
      if (resolved.stderrLine !== fileCliOutput?.stderrLine) {
        fileCliOutput.stderrLine(line)
      }
    },
  }
}

export function writeCliStdoutLine(line: string, output?: CliOutput): void {
  resolveCliOutput(output).stdoutLine(line)
}

export function writeCliStderrLine(line: string, output?: CliOutput): void {
  resolveCliOutput(output).stderrLine(line)
}

export async function withCliOutput<T>(
  output: CliOutput | undefined,
  task: () => T | Promise<T>,
): Promise<T> {
  const previousOutput = runtimeCliOutput
  runtimeCliOutput = output

  try {
    return await task()
  } finally {
    runtimeCliOutput = previousOutput
  }
}

export function resetCliOutputForTests(): void {
  runtimeCliOutput = undefined
  fileCliOutput = undefined
  runtimeCliLogFilePath = undefined
}
