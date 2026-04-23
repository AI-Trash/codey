import {
  initializeCliObservability,
  recordCliOutput,
  resetCliObservabilityForTests,
} from './observability'

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

export const consoleCliOutput: Required<CliOutput> = {
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
let runtimeCliLogFilePath: string | undefined

export function initializeCliFileLogging(input: {
  rootDir: string
  argv?: string[]
}): string {
  if (runtimeCliLogFilePath) {
    return runtimeCliLogFilePath
  }

  const observability = initializeCliObservability(input)
  runtimeCliLogFilePath = observability.humanLogPath
  return runtimeCliLogFilePath
}

export function getCliLogFilePath(): string | undefined {
  return runtimeCliLogFilePath
}

function resolveCliOutput(output?: CliOutput): Required<CliOutput> {
  return {
    stdoutLine:
      output?.stdoutLine ||
      runtimeCliOutput?.stdoutLine ||
      defaultCliOutput.stdoutLine,
    stderrLine:
      output?.stderrLine ||
      runtimeCliOutput?.stderrLine ||
      defaultCliOutput.stderrLine,
  }
}

export function writeCliStdoutLine(line: string, output?: CliOutput): void {
  recordCliOutput('stdout', line)
  resolveCliOutput(output).stdoutLine(line)
}

export function writeCliStderrLine(line: string, output?: CliOutput): void {
  recordCliOutput('stderr', line)
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
  runtimeCliLogFilePath = undefined
  resetCliObservabilityForTests()
}
