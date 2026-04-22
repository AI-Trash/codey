import { fileURLToPath } from 'url'
import { loadWorkspaceEnv } from './utils/env'
import {
  initializeCliFileLogging,
  writeCliStderrLine,
  writeCliStdoutLine,
} from './utils/cli-output'
import { resolveWorkspaceRoot } from './utils/workspace-root'
loadWorkspaceEnv()

initializeCliFileLogging({
  rootDir: resolveWorkspaceRoot(fileURLToPath(import.meta.url)),
})

import { newSession } from './core/browser'
import { saveScreenshot, writeJson } from './core/report'
import type { FlowHandler } from './types'
import { captureCliDiagnostics } from './utils/observability'

export async function runFlow(name: string, flow: FlowHandler): Promise<void> {
  const session = await newSession()

  try {
    const result = await flow(session.page)
    const screenshotPath = await saveScreenshot(session.page, name)
    const reportPath = writeJson(name, {
      status: 'passed',
      ...result,
      screenshotPath,
      capturedAt: new Date().toISOString(),
    })

    writeCliStdoutLine(
      JSON.stringify(
        { status: 'passed', name, screenshotPath, reportPath, result },
        null,
        2,
      ),
    )
  } catch (error) {
    const err = error as Error
    let screenshotPath: string | null = null
    try {
      screenshotPath = await saveScreenshot(session.page, `${name}-failed`)
    } catch {}
    const diagnostics = captureCliDiagnostics({
      reason: 'run-flow-error',
      error,
      handled: true,
    })

    const reportPath = writeJson(name, {
      status: 'failed',
      error: err.message,
      screenshotPath,
      diagnostics,
      capturedAt: new Date().toISOString(),
    })

    writeCliStderrLine(
      JSON.stringify(
        {
          status: 'failed',
          name,
          error: err.message,
          screenshotPath,
          reportPath,
          diagnostics,
        },
        null,
        2,
      ),
    )
    process.exitCode = 1
  } finally {
    await session.close()
  }
}
