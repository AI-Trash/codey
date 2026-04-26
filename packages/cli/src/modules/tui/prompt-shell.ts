import {
  clearLine,
  createInterface,
  cursorTo,
  type Interface as ShellInterface,
} from 'readline'

import { consoleCliOutput, writeCliStdoutLine } from '../../utils/cli-output'
import { withPromptSession, type PromptSession } from './prompt-io'

export class PromptShell {
  private shell: ShellInterface | null = null
  private commandInFlight = false
  private modalPromptOpen = false
  private commandLoopEnded = false
  private disposed = false
  private readonly bufferedLines: string[] = []

  constructor(private readonly promptLabel = 'codey> ') {}

  private writeConsoleLine(line: string): void {
    writeCliStdoutLine(line, consoleCliOutput)
  }

  private repaintPrompt(): void {
    if (!this.shell || this.commandLoopEnded) {
      return
    }

    this.shell.prompt(true)
  }

  private clearCurrentPrompt(): void {
    if (!process.stdout.isTTY) {
      return
    }

    clearLine(process.stdout, 0)
    cursorTo(process.stdout, 0)
  }

  private flushBufferedLines(): void {
    if (!this.bufferedLines.length) {
      return
    }

    const lines = this.bufferedLines.splice(0)
    for (const line of lines) {
      this.writeConsoleLine(line)
    }
  }

  print(line: string): void {
    if (this.disposed) {
      return
    }

    if (this.modalPromptOpen) {
      this.bufferedLines.push(line)
      return
    }

    if (this.shell && !this.commandLoopEnded) {
      this.clearCurrentPrompt()
      this.writeConsoleLine(line)
      this.repaintPrompt()
      return
    }

    this.writeConsoleLine(line)
  }

  async runModalPrompt<T>(
    task: (session: PromptSession) => Promise<T>,
  ): Promise<T> {
    this.modalPromptOpen = true
    this.clearCurrentPrompt()
    this.shell?.pause()

    try {
      return await withPromptSession(task)
    } finally {
      this.modalPromptOpen = false
      this.flushBufferedLines()
      this.shell?.resume()
      this.repaintPrompt()
    }
  }

  async start(
    onCommand: (command: string) => Promise<'close' | void>,
  ): Promise<void> {
    this.commandLoopEnded = false
    this.shell = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      historySize: 100,
      removeHistoryDuplicates: true,
    })
    this.shell.setPrompt(this.promptLabel)

    try {
      await new Promise<void>((resolve) => {
        const shell = this.shell!

        const closeCommandLoop = () => {
          if (this.commandLoopEnded) {
            return
          }

          this.commandLoopEnded = true
          resolve()
        }

        shell.on('line', (line) => {
          if (this.commandLoopEnded || this.modalPromptOpen) {
            return
          }

          if (this.commandInFlight) {
            this.print('Another command is still running. Please wait.')
            return
          }

          const command = line.trim()
          if (!command) {
            this.repaintPrompt()
            return
          }

          this.commandInFlight = true
          void Promise.resolve(onCommand(command))
            .then((result) => {
              this.commandInFlight = false
              if (result === 'close') {
                closeCommandLoop()
                shell.close()
                return
              }

              this.repaintPrompt()
            })
            .catch((error) => {
              this.commandInFlight = false
              const message =
                error instanceof Error ? error.message : String(error)
              this.print(`Command failed: ${message}`)
            })
        })

        shell.once('close', () => {
          closeCommandLoop()
        })

        this.repaintPrompt()
      })
    } finally {
      this.shell = null
      this.commandLoopEnded = true
    }
  }

  stopPrompt(): void {
    if (!this.shell || this.commandLoopEnded) {
      return
    }

    this.commandLoopEnded = true
    this.shell.close()
    this.shell = null
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.stopPrompt()
  }
}
