import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getCliLogFilePath,
  initializeCliFileLogging,
  resetCliOutputForTests,
  silentCliOutput,
  withCliOutput,
  writeCliStderrLine,
  writeCliStdoutLine,
} from '../src/utils/cli-output'

describe('cli output file logging', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    resetCliOutputForTests()
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes runtime stdout and stderr lines into .codey/logs', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codey-cli-logs-'))
    tempDirs.push(rootDir)

    const logFilePath = initializeCliFileLogging({
      rootDir,
      argv: ['flow', 'chatgpt-login'],
    })

    await withCliOutput(silentCliOutput, async () => {
      writeCliStdoutLine('flow completed')
      writeCliStderrLine('har: C:/tmp/run.har')
    })

    expect(logFilePath).toContain(path.join('.codey', 'logs'))
    expect(logFilePath).toContain('flow-chatgpt-login')
    expect(getCliLogFilePath()).toBe(logFilePath)

    const content = fs.readFileSync(logFilePath, 'utf8')
    expect(content).toContain('[session] argv: ["flow","chatgpt-login"]')
    expect(content).toContain('[stdout] flow completed')
    expect(content).toContain('[stderr] har: C:/tmp/run.har')
  })

  it('keeps file logging enabled while cli output is redirected', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codey-cli-logs-'))
    tempDirs.push(rootDir)

    const logFilePath = initializeCliFileLogging({
      rootDir,
      argv: ['tui', 'start'],
    })
    const redirectedStdout: string[] = []
    const redirectedStderr: string[] = []

    await withCliOutput(
      {
        stdoutLine: (line) => {
          redirectedStdout.push(line)
        },
        stderrLine: (line) => {
          redirectedStderr.push(line)
        },
      },
      async () => {
        writeCliStdoutLine('dashboard event')
        writeCliStderrLine('task failed')
      },
    )

    expect(redirectedStdout).toEqual(['dashboard event'])
    expect(redirectedStderr).toEqual(['task failed'])

    const content = fs.readFileSync(logFilePath, 'utf8')
    expect(content).toContain('[stdout] dashboard event')
    expect(content).toContain('[stderr] task failed')
  })

  it('reuses the same log file path when initialized more than once', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codey-cli-logs-'))
    tempDirs.push(rootDir)

    const first = initializeCliFileLogging({
      rootDir,
      argv: ['auth', 'login'],
    })
    const second = initializeCliFileLogging({
      rootDir,
      argv: ['flow', 'noop'],
    })

    expect(second).toBe(first)
    expect(fs.existsSync(first)).toBe(true)
  })
})
