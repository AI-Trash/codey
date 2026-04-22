import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  initializeCliFileLogging,
  resetCliOutputForTests,
  silentCliOutput,
  withCliOutput,
  writeCliStdoutLine,
} from '../src/utils/cli-output'
import {
  captureCliDiagnostics,
  getCliObservabilityLogPath,
  setBaseObservabilityContext,
  setObservabilityRuntimeState,
  withObservabilityContext,
} from '../src/utils/observability'

const tempDirs: string[] = []

function createTempRoot(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codey-observability-'))
  tempDirs.push(rootDir)
  return rootDir
}

function readStructuredLog(filePath: string): Array<Record<string, unknown>> {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('cli observability', () => {
  afterEach(() => {
    resetCliOutputForTests()

    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('records structured cli output with run and task context', async () => {
    const rootDir = createTempRoot()

    initializeCliFileLogging({
      rootDir,
      argv: ['tui', 'start'],
    })
    setBaseObservabilityContext({
      command: 'tui:start',
    })

    await withCliOutput(silentCliOutput, async () => {
      await withObservabilityContext(
        {
          flowId: 'chatgpt-register',
          taskId: 'task-1',
          batchId: 'batch-1',
        },
        async () => {
          writeCliStdoutLine('verification code=123456')
        },
      )
    })

    const structuredLogPath = getCliObservabilityLogPath()
    expect(structuredLogPath).toBeTruthy()

    const records = readStructuredLog(structuredLogPath!)
    const outputRecord = records.find(
      (entry) =>
        entry.event === 'cli.output' &&
        typeof entry.data === 'object' &&
        entry.data !== null &&
        (entry.data as Record<string, unknown>).stream === 'stdout',
    )

    expect(outputRecord).toBeTruthy()
    expect(outputRecord?.context).toMatchObject({
      runId: expect.any(String),
      command: 'tui:start',
      flowId: 'chatgpt-register',
      taskId: 'task-1',
      batchId: 'batch-1',
    })
    expect(outputRecord?.data).toMatchObject({
      stream: 'stdout',
      line: 'verification code=***redacted***',
    })
  })

  it('writes a fatal snapshot with sanitized error details and runtime state', () => {
    const rootDir = createTempRoot()

    initializeCliFileLogging({
      rootDir,
      argv: ['flow', 'chatgpt-register'],
    })
    setBaseObservabilityContext({
      command: 'flow:chatgpt-register',
    })
    setObservabilityRuntimeState({
      phase: 'running',
      flowId: 'chatgpt-register',
      activeTaskCount: 4,
      pendingTaskCount: 16,
    })

    const diagnostics = withObservabilityContext(
      {
        taskId: 'task-9',
        batchId: 'batch-2',
      },
      () =>
        captureCliDiagnostics({
          reason: 'handled-top-level-error',
          error: new Error('password=hunter2'),
          handled: true,
          includeNodeReport: false,
        }),
    )

    expect(diagnostics.snapshotPath).toBeTruthy()
    expect(diagnostics.reportPath).toBeUndefined()

    const snapshot = JSON.parse(
      fs.readFileSync(diagnostics.snapshotPath!, 'utf8'),
    ) as Record<string, unknown>

    expect(snapshot.reason).toBe('handled-top-level-error')
    expect(snapshot.handled).toBe(true)
    expect(snapshot.context).toMatchObject({
      runId: expect.any(String),
      command: 'flow:chatgpt-register',
      taskId: 'task-9',
      batchId: 'batch-2',
    })
    expect(snapshot.runtimeState).toMatchObject({
      phase: 'running',
      flowId: 'chatgpt-register',
      activeTaskCount: 4,
      pendingTaskCount: 16,
    })
    expect(snapshot.error).toMatchObject({
      message: 'password=***redacted***',
    })
    expect(snapshot.logPaths).toMatchObject({
      structuredLogPath: getCliObservabilityLogPath(),
    })
  })
})
