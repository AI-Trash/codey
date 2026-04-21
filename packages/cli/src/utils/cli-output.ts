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
