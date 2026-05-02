#!/usr/bin/env node
import { fileURLToPath } from 'url'

import { loadWorkspaceEnv } from './utils/env'
loadWorkspaceEnv()

import { runWithRuntimeConfig, setRuntimeConfig } from './config'
import { ExchangeClient } from './modules/exchange'
import {
  resolveCliNotificationsAuthState,
  REQUIRED_CLI_SCOPE,
  exchangeDeviceChallenge,
  startDeviceLogin,
  streamCliNotifications,
} from './modules/app-auth/device-login'
import { CliConnectionRuntimeReporter } from './modules/app-auth/cli-connection'
import {
  claimCliFlowTask,
  CliFlowTaskLeaseReporter,
} from './modules/app-auth/flow-tasks'
import {
  fetchCodeyProxyNodes,
  type CodeyProxyNode,
} from './modules/app-auth/proxy-nodes'
import { deriveCliTargetFromAuthState } from './modules/app-auth/target'
import { clearAppSession, readAppSession } from './modules/app-auth/token-store'
import { DEFAULT_CODEY_APP_BASE_URL } from './modules/app-auth/http'
import { resolveCliWorkerId } from './modules/app-auth/worker-id'
import { getDefaultCliName } from './utils/cli-name'
import {
  applyFlowOptionDefaults,
  attachFlowArtifactPaths,
  createConsoleFlowProgressReporter,
  execute,
  formatFlowProgressMessage,
  keepBrowserOpenForHarWhenUnspecified,
  parseBooleanFlag,
  parseNumberFlag,
  prepareRuntimeConfig,
  printFlowCompletionSummary,
  redactForOutput,
  sanitizeErrorForOutput,
  shouldRecordPageContent,
  shouldKeepFlowOpen,
  type AuthOptions,
  type ExchangeOptions,
  type FlowOptions,
  type FlowProgressUpdate,
} from './modules/flow-cli/helpers'
import {
  DEFAULT_CLI_BROWSER_LIMIT,
  getCliFlowDefinition,
  listCliFlowCommandIds,
  listCliFlowConfigFieldDefinitions,
  normalizeCliFlowCommandId,
  normalizeCliFlowTaskPayload,
  type CliFlowTaskBatchMetadata,
  type CliFlowCommandId,
  type CliFlowTaskMetadata,
} from './modules/flow-cli/flow-registry'
import {
  normalizeCommonCliArgs,
  normalizeFlowCliArgsForCommand,
} from './modules/flow-cli/parse-argv'
import {
  FlowInterruptedError,
  runWithSession,
} from './modules/flow-cli/run-with-session'
import { runWithAndroidSession } from './modules/flow-cli/run-with-android-session'
import { getCliFlowRunner } from './modules/flow-cli/flow-runners'
import { getFlowTaskFullRetryDecision } from './modules/flow-cli/task-retry'
import {
  buildFailedFlowCommandExecution,
  buildFlowCommandExecutionResult,
  writeFlowCommandExecutionResult,
  type FlowCommandExecution,
} from './modules/flow-cli/result-file'
import { assertFlowTaskExecutionSucceeded } from './modules/flow-cli/task-completion'
import { prepareFlowStorageState } from './modules/flow-cli/storage-state'
import { sleep } from './utils/wait'
import {
  initializeCliFileLogging,
  writeCliStderrLine,
  writeCliStdoutLine,
} from './utils/cli-output'
import {
  AppVerificationProviderClient,
  resolveVerificationAppConfig,
} from './modules/verification'
import {
  startWhatsAppNotificationWebhookServer,
  type WhatsAppNotificationWebhookServerHandle,
} from './modules/android/whatsapp-notifications'
import {
  logCliEvent,
  setObservabilityRuntimeState,
  traceCliOperation,
  withObservabilityContext,
} from './utils/observability'
import { resolveWorkspaceRoot } from './utils/workspace-root'
import {
  FlowTaskScheduler,
  FlowTaskSchedulerCancelledError,
} from './modules/flow-cli/task-scheduler'
import {
  formatSingBoxProxyStartupError,
  runWithCodeySingBoxProxyRuntime,
  startCodeySingBoxFlowProxy,
  summarizeProxyNodes,
  type CodeySingBoxProxyRuntime,
} from './modules/proxy/sing-box'

initializeCliFileLogging({
  rootDir: resolveWorkspaceRoot(fileURLToPath(import.meta.url)),
})

async function runFlowCommand(
  subcommand: CliFlowCommandId,
  options: FlowOptions,
  runtime: {
    abortSignal?: AbortSignal
    onBeforeExit?: () => Promise<void> | void
    onAfterSessionClose?: () => Promise<void> | void
    singBoxProxy?: CodeySingBoxProxyRuntime
  } = {},
): Promise<unknown> {
  let runtimeOptions: FlowOptions = {
    ...options,
    progressReporter:
      options.progressReporter ||
      createConsoleFlowProgressReporter(`flow:${subcommand}`),
  }
  const preparedStorageState = await prepareFlowStorageState({
    flowId: subcommand,
    options: runtimeOptions,
  })
  runtimeOptions = preparedStorageState.options
  if (preparedStorageState.storageState) {
    runtimeOptions.progressReporter?.({
      message: `Loaded local ChatGPT storage state for ${preparedStorageState.storageState.email}`,
    })
  }
  let result: unknown
  let browserHarPath: string | undefined
  let pageContentPath: string | undefined
  const flowRunner = getCliFlowRunner(subcommand)

  if (flowRunner.runtime === 'android') {
    await runWithAndroidSession(
      async (session) => {
        result = await flowRunner.run(session, runtimeOptions)
      },
      {
        abortSignal: runtime.abortSignal,
      },
    )
  } else {
    await runWithSession(
      {
        artifactName: subcommand,
        context: {},
        storageStatePath: preparedStorageState.storageState?.storageStatePath,
      },
      async (session) => {
        browserHarPath = session.harPath
        result = await flowRunner.run(session, runtimeOptions)
      },
      {
        closeOnComplete: !shouldKeepFlowOpen(runtimeOptions),
        abortSignal: runtime.abortSignal,
        onBeforeExit: runtime.onBeforeExit,
        onAfterSessionClose: runtime.onAfterSessionClose,
        singBoxProxy: runtime.singBoxProxy,
        pageContent: {
          enabled: shouldRecordPageContent(runtimeOptions),
          artifactName: subcommand,
          onPath(path) {
            pageContentPath = path
          },
        },
      },
    )
  }

  result = attachFlowArtifactPaths(result, {
    harPath: browserHarPath,
    pageContentPath,
  })
  printFlowCompletionSummary(`flow:${subcommand}`, result)
  if (flowRunner.runtime === 'browser' && shouldKeepFlowOpen(runtimeOptions)) {
    writeCliStderrLine(
      'Flow completed and the browser remains open because --record is enabled. Press Ctrl+C to exit or close the browser window.',
    )
  }

  return result
}

function resolveFlowCommandOptions(
  subcommand: CliFlowCommandId,
  options: FlowOptions,
): FlowOptions {
  if (subcommand === 'codex-oauth') {
    return keepBrowserOpenForHarWhenUnspecified(
      applyFlowOptionDefaults(options),
    )
  }

  if (subcommand === 'chatgpt-team-trial-gopay') {
    return keepBrowserOpenForHarWhenUnspecified(
      applyFlowOptionDefaults(options),
    )
  }

  if (subcommand === 'noop') {
    return applyFlowOptionDefaults(options, {
      har: true,
      record: true,
    })
  }

  return applyFlowOptionDefaults(options)
}

function normalizeFlowCommandOptions(
  subcommand: CliFlowCommandId,
  input: Record<string, unknown> | null | undefined,
): FlowOptions {
  return normalizeFlowCliArgsForCommand(subcommand, input)
}

function formatRuntimeProgressMessage(
  update: FlowProgressUpdate,
): string | undefined {
  return formatFlowProgressMessage(update)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
    ? value
    : []
}

function buildFlowTaskCompletionResult(
  flowId: CliFlowCommandId,
  result: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(result)) {
    return undefined
  }

  if (flowId === 'chatgpt-invite') {
    const invites = isRecord(result.invites) ? result.invites : null
    if (!invites) {
      return undefined
    }

    return {
      pageName: 'chatgpt-invite',
      workspaceId:
        typeof result.workspaceId === 'string' ? result.workspaceId : undefined,
      accountId:
        typeof invites.accountId === 'string' ? invites.accountId : undefined,
      invitedEmails: readStringArray(invites.invitedEmails),
      skippedEmails: readStringArray(invites.skippedEmails),
      erroredEmails: readStringArray(invites.erroredEmails),
    }
  }

  const trialResult =
    flowId === 'chatgpt-team-trial'
      ? result
      : flowId === 'chatgpt-team-trial-gopay'
        ? result
      : flowId === 'chatgpt-register'
        ? isRecord(result.trial)
          ? result.trial
          : isRecord(result.teamTrial)
            ? result.teamTrial
            : null
        : null
  if (!trialResult) {
    return undefined
  }

  const paypalApprovalUrl =
    typeof trialResult.paypalApprovalUrl === 'string'
      ? trialResult.paypalApprovalUrl.trim()
      : ''
  if (!paypalApprovalUrl) {
    return undefined
  }

  const paypalApprovalUrlPath =
    typeof trialResult.paypalApprovalUrlPath === 'string'
      ? trialResult.paypalApprovalUrlPath.trim()
      : ''

  return {
    pageName:
      flowId === 'chatgpt-register'
        ? 'chatgpt-register'
        : flowId === 'chatgpt-team-trial-gopay'
          ? 'chatgpt-team-trial-gopay'
          : 'chatgpt-team-trial',
    ...(typeof trialResult.paymentMethod === 'string'
      ? { paymentMethod: trialResult.paymentMethod }
      : {}),
    paymentRedirectUrl: paypalApprovalUrl,
    paypalApprovalUrl,
    ...(paypalApprovalUrlPath ? { paypalApprovalUrlPath } : {}),
    ...(paypalApprovalUrlPath
      ? { paymentRedirectUrlPath: paypalApprovalUrlPath }
      : {}),
    ...(typeof trialResult.paypalBaTokenCaptured === 'boolean'
      ? { paypalBaTokenCaptured: trialResult.paypalBaTokenCaptured }
      : {}),
  }
}

async function executeFlowSubcommand(
  subcommand: CliFlowCommandId,
  options: FlowOptions,
  runtime: {
    abortSignal?: AbortSignal
    onBeforeExit?: () => Promise<void> | void
    onAfterSessionClose?: () => Promise<void> | void
    singBoxProxy?: CodeySingBoxProxyRuntime
  } = {},
): Promise<FlowCommandExecution> {
  const resolvedOptions = resolveFlowCommandOptions(subcommand, options)
  const command = `flow:${subcommand}`
  const startedAt = new Date().toISOString()
  const config = prepareRuntimeConfig(command, resolvedOptions)
  return runWithCodeySingBoxProxyRuntime(runtime.singBoxProxy, () =>
    runWithRuntimeConfig(config, () =>
      withObservabilityContext(
        {
          flowId: subcommand,
        },
        () =>
          traceCliOperation(
            'flow.execute',
            {
              flowId: subcommand,
              command,
            },
            async () => {
              setObservabilityRuntimeState({
                flowId: subcommand,
                status: 'running',
                message: 'Flow started',
                startedAt,
              })

              try {
                const result = await runFlowCommand(
                  subcommand,
                  resolvedOptions,
                  runtime,
                )
                const completedAt = new Date().toISOString()
                setObservabilityRuntimeState({
                  flowId: subcommand,
                  status: 'passed',
                  message: 'Flow completed',
                  startedAt,
                  completedAt,
                })

                return buildFlowCommandExecutionResult({
                  flowId: subcommand,
                  command,
                  status: 'passed',
                  startedAt,
                  completedAt,
                  config: redactForOutput(resolvedOptions),
                  result: redactForOutput(result),
                  completionResult: buildFlowTaskCompletionResult(
                    subcommand,
                    result,
                  ),
                })
              } catch (error) {
                setObservabilityRuntimeState({
                  flowId: subcommand,
                  status: 'failed',
                  message: sanitizeErrorForOutput(error).message,
                  startedAt,
                  completedAt: new Date().toISOString(),
                })
                throw error
              }
            },
          ),
      ),
    ),
  )
}

async function executeFlowSubcommandWithReporting(
  subcommand: CliFlowCommandId,
  options: FlowOptions,
): Promise<FlowCommandExecution> {
  const startedAt = new Date().toISOString()

  try {
    const execution = await executeFlowSubcommand(subcommand, options)
    writeFlowCommandExecutionResult(execution)
    return execution
  } catch (error) {
    const failure = buildFailedFlowCommandExecution({
      flowId: subcommand,
      command: `flow:${subcommand}`,
      startedAt,
      completedAt: new Date().toISOString(),
      config: redactForOutput(options),
      error,
    })
    writeFlowCommandExecutionResult(failure)
    throw error
  }
}

async function runExchangeCommand(
  subcommand: string,
  options: ExchangeOptions,
  config: ReturnType<typeof prepareRuntimeConfig>,
): Promise<void> {
  if (!config.exchange) {
    throw new Error(
      'Exchange config is required. Provide Microsoft Graph client credentials in env or JSON config.',
    )
  }

  const client = new ExchangeClient(config.exchange)

  if (subcommand === 'verify') {
    const result = await client.verifyAccess()
    writeCliStdoutLine(
      JSON.stringify(
        { command: 'exchange:verify', config: redactForOutput(config), result },
        null,
        2,
      ),
    )
    return
  }

  if (subcommand === 'folders') {
    const result = await client.listFolders()
    writeCliStdoutLine(
      JSON.stringify(
        {
          command: 'exchange:folders',
          config: redactForOutput(config),
          result,
        },
        null,
        2,
      ),
    )
    return
  }

  if (subcommand === 'messages') {
    const result = await client.listMessages({
      folderId: options.folderId,
      maxItems: parseNumberFlag(options.maxItems, 20) ?? 20,
      unreadOnly: parseBooleanFlag(options.unreadOnly, false) ?? false,
    })
    writeCliStdoutLine(
      JSON.stringify(
        {
          command: 'exchange:messages',
          config: redactForOutput(config),
          result,
        },
        null,
        2,
      ),
    )
    return
  }

  throw new Error(`Unsupported exchange command: ${subcommand || '(missing)'}`)
}

async function runAuthCommand(
  subcommand: string,
  options: AuthOptions,
  config: ReturnType<typeof prepareRuntimeConfig>,
): Promise<void> {
  if (subcommand === 'login') {
    const cliName = options.cliName || getDefaultCliName()
    const challenge = await startDeviceLogin({
      flowType: options.flowType || 'flow-cli',
      cliName,
      scope: options.scope || REQUIRED_CLI_SCOPE,
    })
    writeCliStdoutLine(
      JSON.stringify(
        {
          command: 'auth:login:start',
          config: redactForOutput(config),
          challenge: {
            userCode: challenge.userCode,
            verificationUri: challenge.verificationUri,
            verificationUriComplete: challenge.verificationUriComplete,
            expiresAt: challenge.expiresAt,
            interval: challenge.interval,
            scope: challenge.scope,
          },
          instructions: [
            challenge.verificationUriComplete
              ? `Open ${challenge.verificationUriComplete} in a browser, or visit ${challenge.verificationUri} and enter the user code ${challenge.userCode} manually to authorize this CLI session.`
              : `Visit ${challenge.verificationUri} and enter the user code ${challenge.userCode} to authorize this CLI session.`,
          ],
        },
        null,
        2,
      ),
    )

    const session = await exchangeDeviceChallenge(challenge, options.target)
    writeCliStdoutLine(
      JSON.stringify(
        {
          command: 'auth:login:completed',
          config: redactForOutput(config),
          status: {
            status: session.status,
            expiresAt: session.expiresAt,
          },
          session: redactForOutput({
            target: options.target,
            subject: session.subject,
            tokenType: session.tokenType,
            scope: session.scope,
            expiresAt: session.expiresAt,
          }),
        },
        null,
        2,
      ),
    )
    return
  }

  if (subcommand === 'status') {
    const session = readAppSession()
    writeCliStdoutLine(
      JSON.stringify(
        {
          command: 'auth:status',
          config: redactForOutput(config),
          session: redactForOutput(session),
        },
        null,
        2,
      ),
    )
    return
  }

  if (subcommand === 'logout') {
    clearAppSession()
    writeCliStdoutLine(
      JSON.stringify(
        {
          command: 'auth:logout',
          config: redactForOutput(config),
          ok: true,
        },
        null,
        2,
      ),
    )
    return
  }

  throw new Error(`Unsupported auth command: ${subcommand || '(missing)'}`)
}

async function runRemoteWorker(
  options: AuthOptions,
  config: ReturnType<typeof prepareRuntimeConfig>,
): Promise<void> {
  const cliName = options.cliName || getDefaultCliName()
  let announced = false
  setObservabilityRuntimeState({
    cliName,
    target: options.target || null,
    phase: 'starting',
  })

  let whatsAppWebhook: WhatsAppNotificationWebhookServerHandle | undefined
  let proxyNodes: CodeyProxyNode[] = []
  let proxyNodesLoaded = false

  try {
    while (true) {
      setRuntimeConfig(config)
      const authState = await resolveCliNotificationsAuthState()
      if (!proxyNodesLoaded) {
        try {
          proxyNodes = await fetchCodeyProxyNodes({ authState })
          proxyNodesLoaded = true
          if (proxyNodes.some((node) => node.protocol === 'hysteria2')) {
            writeCliStderrLine(
              `[cli:singbox] Loaded ${proxyNodes.length} proxy node(s); flow tasks will use isolated mixed proxy instances.`,
            )
          } else if (proxyNodes.length) {
            writeCliStderrLine(
              `[cli:singbox] No usable hysteria2 proxy node found in ${proxyNodes.length} configured node(s).`,
            )
          }
          logCliEvent('info', 'singbox.proxy_nodes.loaded', {
            nodes: summarizeProxyNodes(proxyNodes),
            started: false,
            mode: 'flow-scoped',
          })
        } catch (error) {
          writeCliStderrLine(
            `[cli:singbox] ${formatSingBoxProxyStartupError(error)}`,
          )
          proxyNodes = []
          proxyNodesLoaded = true
        }
      }
      whatsAppWebhook ??= startCliWhatsAppNotificationWebhook(
        'cli',
        options,
        config,
      )
      const target = options.target || deriveCliTargetFromAuthState(authState)
      const workerId = resolveCliWorkerId({
        cliName,
        target,
      })
      const taskScheduler = new FlowTaskScheduler<void>()
      const runtimeReporter = new CliConnectionRuntimeReporter({
        authState,
        onError: (error) => {
          writeCliStderrLine(
            JSON.stringify(
              {
                command: 'cli:runtime:error',
                error: error.message,
              },
              null,
              2,
            ),
          )
        },
        onBrowserLimit: (browserLimit) => {
          taskScheduler.setBrowserLimit(browserLimit)
          syncRuntimeReporterState()
          void tryClaimTasks()
        },
      })
      const taskLeaseReporters = new Map<string, CliFlowTaskLeaseReporter>()
      const activeFlowAbortControllers = new Map<string, AbortController>()
      const serverCanceledTaskIds = new Set<string>()
      let outstandingStartedAt: string | undefined
      let connectionId: string | undefined
      let claimInFlight = false
      let claimInterval: ReturnType<typeof setInterval> | undefined
      let lastRuntimeState:
        | {
            flowId?: string
            notificationId?: string
            status?: string
            message?: string
            startedAt?: string
            completedAt?: string
          }
        | undefined

      const syncRuntimeReporterState = () => {
        const snapshot = taskScheduler.getSnapshot()
        if (!snapshot.activeCount && !snapshot.pendingCount) {
          outstandingStartedAt = undefined
          runtimeReporter.update({
            runtimeFlowId: lastRuntimeState?.flowId || null,
            runtimeTaskId: lastRuntimeState?.notificationId || null,
            runtimeFlowStatus: lastRuntimeState?.status || null,
            runtimeFlowMessage: lastRuntimeState?.message || null,
            runtimeFlowStartedAt: lastRuntimeState?.startedAt || null,
            runtimeFlowCompletedAt: lastRuntimeState?.completedAt || null,
          })
          setObservabilityRuntimeState({
            cliName,
            target: target || null,
            phase: 'listening',
            activeTaskCount: snapshot.activeCount,
            pendingTaskCount: snapshot.pendingCount,
            browserLimit: snapshot.browserLimit,
            flowId: lastRuntimeState?.flowId || null,
            taskId: lastRuntimeState?.notificationId || null,
            status: lastRuntimeState?.status || null,
            message: lastRuntimeState?.message || null,
            startedAt: lastRuntimeState?.startedAt || null,
            completedAt: lastRuntimeState?.completedAt || null,
          })
          return
        }

        runtimeReporter.update({
          runtimeFlowId:
            snapshot.activeCount + snapshot.pendingCount > 1
              ? 'task-queue'
              : lastRuntimeState?.flowId || 'task-queue',
          runtimeTaskId:
            snapshot.activeCount === 1 && !snapshot.pendingCount
              ? lastRuntimeState?.notificationId || null
              : null,
          runtimeFlowStatus: 'running',
          runtimeFlowMessage: `${snapshot.activeCount} running, ${snapshot.pendingCount} queued (browser limit ${snapshot.browserLimit || DEFAULT_CLI_BROWSER_LIMIT})`,
          runtimeFlowStartedAt:
            outstandingStartedAt || lastRuntimeState?.startedAt || null,
          runtimeFlowCompletedAt: null,
        })
        setObservabilityRuntimeState({
          cliName,
          target: target || null,
          phase: 'running',
          activeTaskCount: snapshot.activeCount,
          pendingTaskCount: snapshot.pendingCount,
          browserLimit: snapshot.browserLimit,
          flowId:
            snapshot.activeCount + snapshot.pendingCount > 1
              ? 'task-queue'
              : lastRuntimeState?.flowId || 'task-queue',
          taskId:
            snapshot.activeCount === 1 && !snapshot.pendingCount
              ? lastRuntimeState?.notificationId || null
              : null,
          status: 'running',
          message: `${snapshot.activeCount} running, ${snapshot.pendingCount} queued (browser limit ${snapshot.browserLimit || DEFAULT_CLI_BROWSER_LIMIT})`,
          startedAt:
            outstandingStartedAt || lastRuntimeState?.startedAt || null,
          completedAt: null,
        })
      }

      const getClaimedTaskCount = () => {
        const snapshot = taskScheduler.getSnapshot()
        return snapshot.activeCount + snapshot.pendingCount
      }

      const canClaimMoreTasks = () =>
        getClaimedTaskCount() < taskScheduler.getBrowserLimit() ||
        taskScheduler.hasMaintenanceTasks()

      const logTaskLeaseError = (taskId: string, error: Error) => {
        writeCliStderrLine(
          JSON.stringify(
            {
              command: 'cli:task:lease:error',
              taskId,
              error: error.message,
            },
            null,
            2,
          ),
        )
      }

      const scheduleDaemonFlowTask = (task: {
        flowId: CliFlowCommandId
        config: FlowOptions
        notificationId: string
        message: string
        batch?: CliFlowTaskBatchMetadata
        metadata?: CliFlowTaskMetadata
        leaseReporter?: CliFlowTaskLeaseReporter
      }) => {
        const scheduled = taskScheduler.enqueue({
          taskId: task.notificationId,
          batchId: task.batch?.batchId,
          kind: task.metadata?.identityMaintenance
            ? 'identity-maintenance'
            : 'default',
          run: async () =>
            withObservabilityContext(
              {
                flowId: task.flowId,
                taskId: task.notificationId,
                notificationId: task.notificationId,
                batchId: task.batch?.batchId || null,
              },
              async () => {
                const startedAt = new Date().toISOString()
                const flowAbortController = new AbortController()
                activeFlowAbortControllers.set(
                  task.notificationId,
                  flowAbortController,
                )
                if (
                  !outstandingStartedAt ||
                  Date.parse(startedAt) < Date.parse(outstandingStartedAt)
                ) {
                  outstandingStartedAt = startedAt
                }

                writeCliStdoutLine(
                  JSON.stringify(
                    {
                      command: 'cli:task:start',
                      notificationId: task.notificationId,
                      flowId: task.flowId,
                      config: redactForOutput(task.config),
                    },
                    null,
                    2,
                  ),
                )

                lastRuntimeState = {
                  flowId: task.flowId,
                  notificationId: task.notificationId,
                  status: 'running',
                  message: task.message,
                  startedAt,
                }
                syncRuntimeReporterState()
                task.leaseReporter?.markRunning(task.message)

                const consoleProgressReporter =
                  createConsoleFlowProgressReporter(`flow:${task.flowId}`)
                let flowSingBoxProxy: CodeySingBoxProxyRuntime | undefined

                try {
                  flowSingBoxProxy = await startCodeySingBoxFlowProxy({
                    config,
                    nodes: proxyNodes,
                    flowId: task.flowId,
                    taskId: task.notificationId,
                  })
                  if (flowSingBoxProxy) {
                    writeCliStderrLine(
                      `[cli:singbox] Task ${task.notificationId} using ${flowSingBoxProxy.mixedProxy.server}; selected tag ${flowSingBoxProxy.selectedTag || 'default'}.`,
                    )
                  }
                  const execution = await executeFlowSubcommand(
                    task.flowId,
                    {
                      ...task.config,
                      ...(task.metadata ? { taskMetadata: task.metadata } : {}),
                      progressReporter: (update) => {
                        consoleProgressReporter(update)

                        const message = formatRuntimeProgressMessage(update)
                        if (!message) {
                          return
                        }

                        lastRuntimeState = {
                          flowId: task.flowId,
                          notificationId: task.notificationId,
                          status:
                            update.status === 'failed' ? 'failed' : 'running',
                          message,
                          startedAt,
                        }
                        syncRuntimeReporterState()
                        task.leaseReporter?.reportProgress(message)
                      },
                    },
                    {
                      abortSignal: flowAbortController.signal,
                      onBeforeExit: async () => {
                        await flowSingBoxProxy?.stop()
                      },
                      onAfterSessionClose: async () => {
                        await flowSingBoxProxy?.stop()
                      },
                      singBoxProxy: flowSingBoxProxy,
                    },
                  )
                  assertFlowTaskExecutionSucceeded(task.flowId, execution)

                  lastRuntimeState = {
                    flowId: task.flowId,
                    notificationId: task.notificationId,
                    status: execution.status,
                    message: 'Flow completed',
                    startedAt,
                    completedAt:
                      execution.completedAt || new Date().toISOString(),
                  }
                  syncRuntimeReporterState()
                  writeCliStdoutLine(
                    JSON.stringify(
                      {
                        command: 'cli:task:completed',
                        notificationId: task.notificationId,
                        flowId: task.flowId,
                        execution: redactForOutput({
                          status: execution.status,
                          completedAt: execution.completedAt,
                        }),
                      },
                      null,
                      2,
                    ),
                  )
                  if (task.leaseReporter) {
                    try {
                      await task.leaseReporter.complete({
                        status: 'SUCCEEDED',
                        message: 'Flow completed',
                        ...(execution.completionResult
                          ? { result: execution.completionResult }
                          : {}),
                      })
                    } catch (error) {
                      logTaskLeaseError(
                        task.notificationId,
                        sanitizeErrorForOutput(error),
                      )
                    } finally {
                      taskLeaseReporters.delete(task.notificationId)
                    }
                  }
                } catch (error) {
                  const sanitized = sanitizeErrorForOutput(error)
                  const serverCanceled = serverCanceledTaskIds.has(
                    task.notificationId,
                  )
                  const retryDecision = getFlowTaskFullRetryDecision({
                    flowId: task.flowId,
                    error,
                  })
                  const failureMessage = retryDecision
                    ? retryDecision.message
                    : sanitized.message
                  lastRuntimeState = {
                    flowId: task.flowId,
                    notificationId: task.notificationId,
                    status: 'failed',
                    message: failureMessage,
                    startedAt,
                    completedAt: new Date().toISOString(),
                  }
                  syncRuntimeReporterState()
                  writeCliStderrLine(
                    JSON.stringify(
                      {
                        command: 'cli:task:error',
                        notificationId: task.notificationId,
                        flowId: task.flowId,
                        error: sanitized.message,
                      },
                      null,
                      2,
                    ),
                  )
                  if (task.leaseReporter && !serverCanceled) {
                    try {
                      await task.leaseReporter.complete({
                        status: serverCanceled ? 'CANCELED' : 'FAILED',
                        error: serverCanceled ? undefined : sanitized.message,
                        message: failureMessage,
                        ...(retryDecision ? { retry: retryDecision } : {}),
                      })
                    } catch (leaseError) {
                      logTaskLeaseError(
                        task.notificationId,
                        sanitizeErrorForOutput(leaseError),
                      )
                    } finally {
                      taskLeaseReporters.delete(task.notificationId)
                    }
                  } else if (serverCanceled) {
                    taskLeaseReporters.delete(task.notificationId)
                  }
                } finally {
                  await flowSingBoxProxy?.stop()
                  activeFlowAbortControllers.delete(task.notificationId)
                  serverCanceledTaskIds.delete(task.notificationId)
                  await runtimeReporter.flush()
                  setRuntimeConfig(config)
                }
              },
            ),
        })

        syncRuntimeReporterState()
        return scheduled.finally(() => {
          syncRuntimeReporterState()
          void tryClaimTasks()
        })
      }

      const cancelServerCanceledTasks = (taskIds: string[]) => {
        const normalizedTaskIds = Array.from(
          new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)),
        )
        if (!normalizedTaskIds.length) {
          return
        }

        for (const taskId of normalizedTaskIds) {
          serverCanceledTaskIds.add(taskId)
        }

        taskScheduler.clearPendingTaskIds(
          normalizedTaskIds,
          'Identity maintenance canceled because normal flow work needs browser capacity.',
        )
        for (const taskId of normalizedTaskIds) {
          const controller = activeFlowAbortControllers.get(taskId)
          if (controller && !controller.signal.aborted) {
            controller.abort(
              new FlowInterruptedError(
                'Identity maintenance canceled because normal flow work needs browser capacity.',
              ),
            )
          }
        }

        syncRuntimeReporterState()
      }

      const tryClaimTasks = async () => {
        if (!connectionId || claimInFlight) {
          return
        }

        claimInFlight = true
        try {
          while (connectionId && canClaimMoreTasks()) {
            const claimResult = await claimCliFlowTask({
              connectionId,
              authState,
            })
            if (claimResult.browserLimit !== undefined) {
              taskScheduler.setBrowserLimit(claimResult.browserLimit)
              syncRuntimeReporterState()
            }
            cancelServerCanceledTasks(claimResult.canceledTaskIds)
            const claimedTask = claimResult.task
            if (!claimedTask) {
              break
            }

            const leaseReporter = new CliFlowTaskLeaseReporter({
              connectionId,
              taskId: claimedTask.id,
              authState,
              onError: (error) => {
                logTaskLeaseError(claimedTask.id, error)
              },
            })
            leaseReporter.start()
            taskLeaseReporters.set(claimedTask.id, leaseReporter)

            const taskPayload = normalizeCliFlowTaskPayload(claimedTask.payload)
            if (!taskPayload) {
              try {
                await leaseReporter.complete({
                  status: 'FAILED',
                  error: 'Received malformed flow task payload.',
                  message: 'Received malformed flow task payload.',
                })
              } catch (error) {
                logTaskLeaseError(claimedTask.id, sanitizeErrorForOutput(error))
              } finally {
                taskLeaseReporters.delete(claimedTask.id)
              }
              continue
            }

            void scheduleDaemonFlowTask({
              flowId: taskPayload.flowId,
              config: taskPayload.config as FlowOptions,
              notificationId: claimedTask.id,
              message: claimedTask.title || 'Task started',
              batch: taskPayload.batch,
              metadata: taskPayload.metadata,
              leaseReporter,
            }).catch((error) => {
              if (error instanceof FlowTaskSchedulerCancelledError) {
                if (serverCanceledTaskIds.delete(claimedTask.id)) {
                  taskLeaseReporters.delete(claimedTask.id)
                  return
                }
              }

              writeCliStderrLine(
                JSON.stringify(
                  {
                    command: 'cli:task:schedule:error',
                    notificationId: claimedTask.id,
                    flowId: taskPayload.flowId,
                    error: sanitizeErrorForOutput(error).message,
                  },
                  null,
                  2,
                ),
              )
            })
          }
        } catch (error) {
          writeCliStderrLine(
            JSON.stringify(
              {
                command: 'cli:task:claim:error',
                error: sanitizeErrorForOutput(error).message,
              },
              null,
              2,
            ),
          )
        } finally {
          claimInFlight = false
        }
      }

      writeCliStdoutLine(
        JSON.stringify(
          {
            command: announced ? 'cli:reconnect' : 'cli:start',
            config: redactForOutput(config),
            cliName,
            auth: redactForOutput({
              mode: authState.mode,
              clientId: authState.clientId,
              target,
              subject: authState.session?.subject,
              expiresAt: authState.session?.tokenSet.expiresAt,
            }),
            session:
              authState.mode === 'device_session'
                ? redactForOutput(authState.session)
                : undefined,
            status: 'listening',
          },
          null,
          2,
        ),
      )
      announced = true

      try {
        for await (const notification of streamCliNotifications(
          {
            cliName,
            target,
            workerId,
          },
          authState,
          {
            onConnection: (connection) => {
              connectionId = connection.connectionId
              if (connection.browserLimit !== undefined) {
                taskScheduler.setBrowserLimit(connection.browserLimit)
              }
              runtimeReporter.setConnectionId(connection.connectionId)
              if (claimInterval) {
                clearInterval(claimInterval)
              }
              claimInterval = setInterval(() => {
                void tryClaimTasks()
              }, 2000)
              void tryClaimTasks()
              writeCliStdoutLine(
                JSON.stringify(
                  {
                    command: 'cli:connected',
                    connection,
                  },
                  null,
                  2,
                ),
              )
            },
          },
        )) {
          writeCliStdoutLine(
            JSON.stringify(
              {
                command: 'cli:event',
                notification,
              },
              null,
              2,
            ),
          )
        }
      } catch (error) {
        writeCliStderrLine(
          JSON.stringify(
            {
              command: 'cli:stream:error',
              error: sanitizeErrorForOutput(error).message,
            },
            null,
            2,
          ),
        )
      }

      connectionId = undefined
      if (claimInterval) {
        clearInterval(claimInterval)
        claimInterval = undefined
      }

      await taskScheduler.waitForIdle()
      await runtimeReporter.flush()

      await sleep(1000)
    }
  } finally {
    await whatsAppWebhook?.stop()
  }
}

function readTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function startCliWhatsAppNotificationWebhook(
  command: string,
  options: AuthOptions,
  config: ReturnType<typeof prepareRuntimeConfig>,
): WhatsAppNotificationWebhookServerHandle | undefined {
  const webhookConfig = config.smsForwarderWebhook
  const enabled =
    parseBooleanFlag(
      options.smsForwarderWebhook,
      webhookConfig?.enabled ?? true,
    ) ?? true

  if (!enabled) {
    writeCliStderrLine(`[${command}] WhatsApp notification webhook disabled.`)
    return undefined
  }

  const appConfig = resolveVerificationAppConfig(config)
  const appClient = new AppVerificationProviderClient({
    ...appConfig,
    baseUrl:
      appConfig.baseUrl ||
      process.env.APP_BASE_URL ||
      DEFAULT_CODEY_APP_BASE_URL,
  })

  return startWhatsAppNotificationWebhookServer({
    enabled,
    host: readTrimmed(webhookConfig?.host),
    port: webhookConfig?.port,
    path: readTrimmed(webhookConfig?.path),
    deviceId:
      readTrimmed(webhookConfig?.deviceId) || readTrimmed(config.android?.udid),
    ingestNotification: (payload) =>
      appClient.ingestWhatsAppNotification(payload),
    onStatus(message) {
      writeCliStderrLine(`[${command}:whatsapp-webhook] ${message}`)
    },
    onNotification(event, payload, ingestResult) {
      writeCliStderrLine(
        `[${command}:whatsapp-webhook] ${event.packageName} notification${
          payload.extractedCode ? ` code=${payload.extractedCode}` : ''
        }${
          ingestResult?.match.matched
            ? ` reservation=${ingestResult.match.reservationId}`
            : ingestResult
              ? ` unmatched=${ingestResult.match.reason || 'unknown'}`
              : ''
        }`,
      )
    },
  })
}

interface ParsedCliArgs {
  positionals: string[]
  options: Record<string, unknown>
}

const HELP_FLAGS = new Set(['--help', '-h'])

function normalizeOptionName(name: string): string {
  return name.replace(/-([a-z])/g, (_match, value: string) =>
    value.toUpperCase(),
  )
}

function appendRawOption(
  options: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const existing = options[key]
  if (existing === undefined) {
    options[key] = value
    return
  }

  if (Array.isArray(existing)) {
    existing.push(value)
    return
  }

  options[key] = [existing, value]
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const positionals: string[] = []
  const options: Record<string, unknown> = {}

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }

    if (HELP_FLAGS.has(current)) {
      options.help = true
      continue
    }

    if (!current.startsWith('--')) {
      positionals.push(current)
      continue
    }

    const equalsIndex = current.indexOf('=')
    const rawName =
      equalsIndex > -1 ? current.slice(2, equalsIndex) : current.slice(2)
    const key = normalizeOptionName(rawName)
    if (!key) {
      continue
    }

    if (equalsIndex > -1) {
      appendRawOption(options, key, current.slice(equalsIndex + 1))
      continue
    }

    const next = argv[index + 1]
    if (next && !next.startsWith('-')) {
      appendRawOption(options, key, next)
      index += 1
      continue
    }

    appendRawOption(options, key, true)
  }

  return {
    positionals,
    options,
  }
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeAuthCliOptions(input: Record<string, unknown>): AuthOptions {
  return {
    ...normalizeCommonCliArgs(input),
    flowType: readOptionalString(input.flowType),
    cliName: readOptionalString(input.cliName),
    scope: readOptionalString(input.scope),
    target: readOptionalString(input.target),
    smsForwarderWebhook:
      typeof input.smsForwarderWebhook === 'string' ||
      typeof input.smsForwarderWebhook === 'boolean'
        ? input.smsForwarderWebhook
        : undefined,
  }
}

function normalizeExchangeCliOptions(
  input: Record<string, unknown>,
): ExchangeOptions {
  return {
    ...normalizeCommonCliArgs(input),
    folderId: readOptionalString(input.folderId),
    maxItems:
      typeof input.maxItems === 'string' ||
      typeof input.maxItems === 'number' ||
      typeof input.maxItems === 'boolean'
        ? input.maxItems
        : undefined,
    unreadOnly:
      typeof input.unreadOnly === 'string' ||
      typeof input.unreadOnly === 'boolean'
        ? input.unreadOnly
        : undefined,
  }
}

function resolveRequestedFlowId(
  parsed: ParsedCliArgs,
): CliFlowCommandId | undefined {
  const optionFlow = readOptionalString(parsed.options.flow)
  if (optionFlow) {
    return normalizeCliFlowCommandId(optionFlow)
  }

  const [first] = parsed.positionals
  return first ? normalizeCliFlowCommandId(first) : undefined
}

function formatFlagValueLabel(type: string): string {
  if (type === 'boolean') {
    return '<bool>'
  }

  if (type === 'number') {
    return '<number>'
  }

  if (type === 'stringList') {
    return '<value>'
  }

  return '<value>'
}

function printRootHelp(): void {
  writeCliStdoutLine(
    [
      'codey',
      '',
      'Usage:',
      '  codey [worker options]',
      '  codey <flow-id> [flow options]',
      '  codey --flow <flow-id> [flow options]',
      '  codey --auth <login|status|logout> [auth options]',
      '  codey --exchange <verify|folders|messages> [exchange options]',
      '',
      'Flows:',
      ...listCliFlowCommandIds().map((flowId) => `  ${flowId}`),
      '',
      'Worker options:',
      '  --config <file>',
      '  --profile <name>',
      '  --cliName <name>',
      '  --target <target>',
      '  --smsForwarderWebhook <bool>',
      '',
      'Examples:',
      '  codey --target octocat',
      '  codey chatgpt-login --email someone@example.com',
      '  codey --flow codex-oauth --workspaceIndex 2',
      '  codey --auth login --target octocat',
    ].join('\n'),
  )
}

function printFlowHelp(flowId: CliFlowCommandId): void {
  const definition = getCliFlowDefinition(flowId)
  const fields = listCliFlowConfigFieldDefinitions(flowId)
  writeCliStdoutLine(
    [
      `codey ${flowId}`,
      '',
      definition?.descriptionKey ? `Flow: ${flowId}` : `Flow: ${flowId}`,
      '',
      'Usage:',
      `  codey ${flowId} [options]`,
      `  codey --flow ${flowId} [options]`,
      '',
      'Options:',
      '  --config <file>',
      '  --profile <name>',
      ...fields.map(
        (field) => `  ${field.cliFlag} ${formatFlagValueLabel(field.type)}`,
      ),
    ].join('\n'),
  )
}

function printAuthHelp(): void {
  writeCliStdoutLine(
    [
      'codey --auth <login|status|logout>',
      '',
      'Options:',
      '  --config <file>',
      '  --profile <name>',
      '  --flowType <name>',
      '  --cliName <name>',
      '  --scope <scope>',
      '  --target <target>',
      '',
      'Examples:',
      '  codey --auth login --target octocat',
      '  codey --auth status',
      '  codey --auth logout',
    ].join('\n'),
  )
}

function printExchangeHelp(): void {
  writeCliStdoutLine(
    [
      'codey --exchange <verify|folders|messages>',
      '',
      'Options:',
      '  --config <file>',
      '  --profile <name>',
      '  --folderId <id>',
      '  --maxItems <count>',
      '  --unreadOnly <bool>',
      '',
      'Examples:',
      '  codey --exchange verify',
      '  codey --exchange folders',
      '  codey --exchange messages --maxItems 20',
    ].join('\n'),
  )
}

function failWithHelp(message: string): void {
  writeCliStderrLine(message)
  printRootHelp()
  process.exitCode = 1
}

function startRemoteWorkerFromOptions(
  rawOptions: Record<string, unknown>,
): void {
  const options = normalizeAuthCliOptions(rawOptions)
  execute(
    (async () => {
      const config = prepareRuntimeConfig('cli', options)
      await runRemoteWorker(options, config)
    })(),
  )
}

function startFlowFromOptions(
  flowId: CliFlowCommandId,
  rawOptions: Record<string, unknown>,
): void {
  execute(
    (async () => {
      const options = normalizeFlowCommandOptions(flowId, rawOptions)
      await executeFlowSubcommandWithReporting(flowId, options)
    })(),
  )
}

function startAuthFromOptions(
  action: string,
  rawOptions: Record<string, unknown>,
): void {
  const options = normalizeAuthCliOptions(rawOptions)
  execute(
    (async () => {
      const config = prepareRuntimeConfig(`auth:${action}`, options)
      await runAuthCommand(action, options, config)
    })(),
  )
}

function startExchangeFromOptions(
  action: string,
  rawOptions: Record<string, unknown>,
): void {
  const options = normalizeExchangeCliOptions(rawOptions)
  execute(
    (async () => {
      const config = prepareRuntimeConfig(`exchange:${action}`, options)
      await runExchangeCommand(action, options, config)
    })(),
  )
}

const argv = process.argv.slice(2)
const parsed = parseCliArgs(argv)
const authAction = readOptionalString(parsed.options.auth)
const exchangeAction = readOptionalString(parsed.options.exchange)
const flowId = resolveRequestedFlowId(parsed)

if (parsed.options.help) {
  if (flowId) {
    printFlowHelp(flowId)
  } else if (authAction) {
    printAuthHelp()
  } else if (exchangeAction) {
    printExchangeHelp()
  } else {
    printRootHelp()
  }
} else if (authAction) {
  startAuthFromOptions(authAction, parsed.options)
} else if (exchangeAction) {
  startExchangeFromOptions(exchangeAction, parsed.options)
} else if (flowId) {
  startFlowFromOptions(flowId, parsed.options)
} else if (parsed.positionals.length) {
  failWithHelp(`Unknown flow or option: ${parsed.positionals[0]}`)
} else {
  startRemoteWorkerFromOptions(parsed.options)
}
