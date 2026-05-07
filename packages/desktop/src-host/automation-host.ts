#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

import { loadWorkspaceEnv } from '../../cli/src/utils/env'
loadWorkspaceEnv()

import { runWithRuntimeConfig } from '../../cli/src/config'
import {
  fetchCodeyProxyNodes,
  type CodeyProxyNode,
} from '../../cli/src/modules/app-auth/proxy-nodes'
import { resolveCliNotificationsAuthState } from '../../cli/src/modules/app-auth/device-login'
import {
  attachFlowArtifactPaths,
  formatFlowCompletionSummary,
  formatFlowProgressMessage,
  keepBrowserOpenForHarWhenUnspecified,
  applyFlowOptionDefaults,
  prepareRuntimeConfig,
  redactForOutput,
  sanitizeErrorForOutput,
  shouldKeepFlowOpen,
  shouldRecordPageContent,
  type FlowOptions,
  type FlowProgressUpdate,
} from '../../cli/src/modules/flow-cli/helpers'
import {
  normalizeCliFlowConfig,
  normalizeCliFlowCommandId,
  type CliFlowCommandId,
} from '../../cli/src/modules/flow-cli/flow-registry'
import { getCliFlowRunner } from '../../cli/src/modules/flow-cli/flow-runners'
import { prepareFlowStorageState } from '../../cli/src/modules/flow-cli/storage-state'
import { runWithAndroidSession } from '../../cli/src/modules/flow-cli/run-with-android-session'
import {
  runWithSession,
} from '../../cli/src/modules/flow-cli/run-with-session'
import {
  normalizeCodeySingBoxProxyTag,
  runWithCodeySingBoxProxyRuntime,
  startCodeySingBoxFlowProxy,
  type CodeySingBoxProxyRuntime,
} from '../../cli/src/modules/proxy/sing-box'
import { resolveWorkspaceRoot } from '../../cli/src/utils/workspace-root'
import {
  setObservabilityRuntimeState,
  traceCliOperation,
  withObservabilityContext,
} from '../../cli/src/utils/observability'

interface AutomationTaskPayload {
  taskId: string
  flowId: string
  config?: Record<string, unknown>
}

interface DesktopHostEvent {
  kind: 'codey-desktop-event'
  taskId: string
  event: string
  message?: string
  flowId?: string
  data?: unknown
}

const taskFileFlag = '--taskFile'

function emit(event: Omit<DesktopHostEvent, 'kind'>): void {
  process.stdout.write(
    `${JSON.stringify({
      kind: 'codey-desktop-event',
      ...event,
    } satisfies DesktopHostEvent)}\n`,
  )
}

function emitProgress(
  taskId: string,
  flowId: CliFlowCommandId,
  update: FlowProgressUpdate,
): void {
  const message = formatFlowProgressMessage(update)
  emit({
    taskId,
    flowId,
    event: 'flow.progress',
    message,
    data: redactForOutput(update),
  })
}

function resolveTaskFilePath(argv: string[]): string {
  const index = argv.indexOf(taskFileFlag)
  const taskFile = index >= 0 ? argv[index + 1] : undefined
  if (!taskFile) {
    throw new Error(`Missing ${taskFileFlag}`)
  }

  return taskFile
}

async function readTaskPayload(): Promise<AutomationTaskPayload> {
  const taskFile = resolveTaskFilePath(process.argv.slice(2))
  const content = await readFile(taskFile, 'utf8')
  const payload = JSON.parse(content) as AutomationTaskPayload

  if (!payload.taskId || typeof payload.taskId !== 'string') {
    throw new Error('Automation task payload is missing taskId')
  }

  if (!payload.flowId || typeof payload.flowId !== 'string') {
    throw new Error('Automation task payload is missing flowId')
  }

  return payload
}

function resolveFlowCommandOptions(
  flowId: CliFlowCommandId,
  options: FlowOptions,
): FlowOptions {
  if (flowId === 'codex-oauth' || flowId === 'chatgpt-team-trial-gopay') {
    return keepBrowserOpenForHarWhenUnspecified(applyFlowOptionDefaults(options))
  }

  if (flowId === 'noop') {
    return applyFlowOptionDefaults(options, {
      har: true,
      record: true,
    })
  }

  return applyFlowOptionDefaults(options)
}

async function startFlowProxyOverride(input: {
  config: ReturnType<typeof prepareRuntimeConfig>
  flowId: CliFlowCommandId
  options: Pick<FlowOptions, 'proxyTag'>
  taskId: string
  nodes?: CodeyProxyNode[]
}): Promise<CodeySingBoxProxyRuntime | undefined> {
  const selectedTag = normalizeCodeySingBoxProxyTag(input.options.proxyTag)
  if (!selectedTag) {
    return undefined
  }

  const nodes =
    input.nodes ||
    (await fetchCodeyProxyNodes({
      authState: await resolveCliNotificationsAuthState(),
    }))
  const runtime = await startCodeySingBoxFlowProxy({
    config: input.config,
    nodes,
    flowId: input.flowId,
    taskId: input.taskId,
    selectedTag,
  })

  if (!runtime) {
    throw new Error(`Codey proxy tag ${selectedTag} is not available`)
  }

  return runtime
}

async function runFlowTask(input: {
  taskId: string
  flowId: CliFlowCommandId
  options: FlowOptions
}): Promise<unknown> {
  let runtimeOptions: FlowOptions = {
    ...input.options,
    progressReporter: (update) =>
      emitProgress(input.taskId, input.flowId, update),
  }
  const preparedStorageState = await prepareFlowStorageState({
    flowId: input.flowId,
    options: runtimeOptions,
  })
  runtimeOptions = preparedStorageState.options

  if (preparedStorageState.storageState) {
    emit({
      taskId: input.taskId,
      flowId: input.flowId,
      event: 'flow.storage_state_loaded',
      message: `Loaded local ChatGPT storage state for ${preparedStorageState.storageState.email}`,
      data: redactForOutput(preparedStorageState.storageState),
    })
  }

  let result: unknown
  let browserHarPath: string | undefined
  let pageContentPath: string | undefined
  const flowRunner = getCliFlowRunner(input.flowId)

  if (flowRunner.runtime === 'android') {
    await runWithAndroidSession(async (session) => {
      result = await flowRunner.run(session, runtimeOptions)
    })
  } else {
    await runWithSession(
      {
        artifactName: input.flowId,
        context: {},
        storageStatePath: preparedStorageState.storageState?.storageStatePath,
      },
      async (session) => {
        browserHarPath = session.harPath
        result = await flowRunner.run(session, runtimeOptions)
      },
      {
        closeOnComplete: !shouldKeepFlowOpen(runtimeOptions),
        pageContent: {
          enabled: shouldRecordPageContent(runtimeOptions),
          artifactName: input.flowId,
          onPath(path) {
            pageContentPath = path
          },
        },
      },
    )
  }

  return attachFlowArtifactPaths(result, {
    harPath: browserHarPath,
    pageContentPath,
  })
}

async function executeAutomationTask(payload: AutomationTaskPayload): Promise<void> {
  const flowId = normalizeCliFlowCommandId(payload.flowId)
  if (!flowId) {
    throw new Error(`Unsupported Codey flow: ${payload.flowId}`)
  }

  const normalizedConfig = normalizeCliFlowConfig(
    flowId,
    payload.config || {},
  ) as FlowOptions
  const options = resolveFlowCommandOptions(flowId, normalizedConfig)
  const command = `desktop:${flowId}`
  const startedAt = new Date().toISOString()
  const runtimeConfig = prepareRuntimeConfig(command, options)
  let ownedSingBoxProxy: CodeySingBoxProxyRuntime | undefined

  emit({
    taskId: payload.taskId,
    flowId,
    event: 'flow.started',
    message: 'Flow started',
    data: {
      config: redactForOutput(options),
    },
  })

  try {
    ownedSingBoxProxy = await startFlowProxyOverride({
      config: runtimeConfig,
      flowId,
      options,
      taskId: payload.taskId,
    })

    const result = await runWithCodeySingBoxProxyRuntime(
      ownedSingBoxProxy,
      () =>
        runWithRuntimeConfig(runtimeConfig, () =>
          withObservabilityContext(
            {
              flowId,
              taskId: payload.taskId,
            },
            () =>
              traceCliOperation(
                'desktop.flow.execute',
                {
                  flowId,
                  taskId: payload.taskId,
                },
                async () => {
                  setObservabilityRuntimeState({
                    flowId,
                    status: 'running',
                    message: 'Flow started',
                    startedAt,
                  })

                  const flowResult = await runFlowTask({
                    taskId: payload.taskId,
                    flowId,
                    options,
                  })

                  setObservabilityRuntimeState({
                    flowId,
                    status: 'passed',
                    message: 'Flow completed',
                    startedAt,
                    completedAt: new Date().toISOString(),
                  })

                  return flowResult
                },
              ),
          ),
        ),
    )

    emit({
      taskId: payload.taskId,
      flowId,
      event: 'flow.completed',
      message: formatFlowCompletionSummary(command, result),
      data: redactForOutput(result),
    })
  } catch (error) {
    const sanitized = sanitizeErrorForOutput(error)
    setObservabilityRuntimeState({
      flowId,
      status: 'failed',
      message: sanitized.message,
      startedAt,
      completedAt: new Date().toISOString(),
    })
    emit({
      taskId: payload.taskId,
      flowId,
      event: 'flow.failed',
      message: sanitized.message,
      data: {
        error: sanitized,
      },
    })
    process.exitCode = 1
  } finally {
    await ownedSingBoxProxy?.stop()
  }
}

async function main(): Promise<void> {
  const payload = await readTaskPayload()
  emit({
    taskId: payload.taskId,
    flowId: payload.flowId,
    event: 'host.ready',
    message: `Codey Desktop automation host running in ${resolveWorkspaceRoot(
      fileURLToPath(import.meta.url),
    )}`,
  })
  await executeAutomationTask(payload)
}

main().catch((error) => {
  const sanitized = sanitizeErrorForOutput(error)
  process.stdout.write(
    `${JSON.stringify({
      kind: 'codey-desktop-event',
      taskId: 'unknown',
      event: 'host.failed',
      message: sanitized.message,
      data: {
        error: sanitized,
      },
    } satisfies DesktopHostEvent)}\n`,
  )
  process.exitCode = 1
})
