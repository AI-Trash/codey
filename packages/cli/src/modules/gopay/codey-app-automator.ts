import { spawn } from 'node:child_process'
import { getRuntimeConfig } from '../../config'
import { traceCliOperation } from '../../utils/observability'
import type {
  GoPayAndroidUnlinkOptions,
  GoPayAndroidUnlinkResult,
} from './android-unlink'

export interface CodeyAppAutomatorCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface CodeyAppAutomatorOptions {
  timeoutMs?: number
  packageName?: string
  allowAppiumFallback?: boolean
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function readLastJsonObject(
  value: string,
): Record<string, unknown> | undefined {
  const lines = value.trim().split(/\r?\n/).reverse()
  for (const line of lines) {
    const trimmed = line.trim()
    const resultMatch =
      /^INSTRUMENTATION_(?:RESULT|STATUS):\s*codey_result=(\{.*\})$/.exec(
        trimmed,
      )
    const candidate = resultMatch?.[1] ?? trimmed
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) {
      continue
    }

    try {
      const parsed = JSON.parse(candidate) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined
    } catch {}
  }

  return undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readBoolean(value: unknown): boolean {
  return value === true
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeGoPayUnlinkPayload(
  payload: Record<string, unknown>,
): GoPayAndroidUnlinkResult {
  const status = readString(payload.status)
  if (status !== 'already-unlinked' && status !== 'unlinked') {
    throw new Error(
      'CodeyApp automator returned an invalid GoPay unlink status.',
    )
  }

  return {
    status,
    appiumSessionId: readString(payload.automatorSessionId),
    currentPackage: readString(payload.currentPackage),
    currentActivity: readString(payload.currentActivity),
    launchedGoPay: readBoolean(payload.launchedGoPay),
    clickedProfile: readBoolean(payload.clickedProfile),
    clickedAccountSettings: readBoolean(payload.clickedAccountSettings),
    clickedLinkedApps: readBoolean(payload.clickedLinkedApps),
    clickedInitialUnlink: readBoolean(payload.clickedInitialUnlink),
    clickedConfirmUnlink: readBoolean(payload.clickedConfirmUnlink),
    unlinkedAppCount: readNumber(payload.unlinkedAppCount) ?? 0,
    exitedLinkedApps: readBoolean(payload.exitedLinkedApps),
  }
}

async function runAdbShellCommand(
  command: string,
  timeoutMs: number,
): Promise<CodeyAppAutomatorCommandResult> {
  const config = getRuntimeConfig()
  const androidConfig = config.android
  const adbPath = androidConfig?.adbPath || 'adb'
  const args = [
    ...(androidConfig?.udid ? ['-s', androidConfig.udid] : []),
    'shell',
    command,
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(adbPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(
      () => {
        if (settled) {
          return
        }
        settled = true
        child.kill()
        reject(new Error('Timed out running CodeyApp automator through adb.'))
      },
      Math.max(1, timeoutMs),
    )

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (exitCode) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      })
    })
  })
}

async function stopKnownUiAutomationRunners(): Promise<void> {
  const commands = [
    `am force-stop ${shellQuote('dev.mobile.maestro')}`,
    `am force-stop ${shellQuote('dev.mobile.maestro.test')}`,
  ].join('; ')
  try {
    await runAdbShellCommand(commands, 10_000)
  } catch {}
}

export async function runCodeyAppGoPayUnlink(
  options: GoPayAndroidUnlinkOptions = {},
  runnerOptions: CodeyAppAutomatorOptions = {},
): Promise<GoPayAndroidUnlinkResult> {
  const timeoutMs = Math.max(
    1,
    runnerOptions.timeoutMs ?? options.timeoutMs ?? 60_000,
  )
  const packageName =
    runnerOptions.packageName ||
    getRuntimeConfig().android?.codeyAppPackage ||
    'com.codey.app'

  return traceCliOperation(
    'android.codey_app.gopay_unlink',
    {
      packageName,
      timeoutMs,
    },
    async () => {
      await options.onProgress?.({
        step: 'session-opened',
        message: 'Starting CodeyApp UiAutomator GoPay unlink',
      })
      await stopKnownUiAutomationRunners()
      const instrumentationCommand = [
        'am',
        'instrument',
        '-w',
        '-r',
        '-e',
        'command',
        shellQuote('gopay-unlink'),
        '-e',
        'timeoutMs',
        String(timeoutMs),
        shellQuote(`${packageName}/.CodeyAutomatorInstrumentation`),
      ].join(' ')
      const command = `su -c ${shellQuote(instrumentationCommand)}`

      const result = await runAdbShellCommand(command, timeoutMs + 30_000)
      const payload = readLastJsonObject(result.stdout)
      if (payload?.ok !== true) {
        const payloadError = readString(payload?.error)
        throw new Error(
          payloadError ||
            result.stderr.trim() ||
            result.stdout.trim() ||
            `CodeyApp automator exited with code ${result.exitCode}.`,
        )
      }

      const unlink = normalizeGoPayUnlinkPayload(payload)
      await options.onProgress?.({
        step: 'completed',
        message:
          unlink.status === 'already-unlinked'
            ? 'CodeyApp confirmed GoPay has no linked apps'
            : 'CodeyApp unlinked GoPay linked app',
      })
      return unlink
    },
  )
}
