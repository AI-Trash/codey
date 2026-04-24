#!/usr/bin/env node
import { cac } from 'cac'
import { fileURLToPath } from 'url'

import { loadWorkspaceEnv } from './utils/env'
loadWorkspaceEnv()

import { setRuntimeConfig } from './config'
import {
  loginChatGPTAndInviteMembers,
  loginChatGPT,
  openNoopFlow,
  registerChatGPT,
  runCodexOAuthFlow,
} from './flows'
import { ExchangeClient } from './modules/exchange'
import {
  resolveCliNotificationsAuthState,
  exchangeDeviceChallenge,
  startDeviceLogin,
  streamCliNotifications,
} from './modules/app-auth/device-login'
import { CliConnectionRuntimeReporter } from './modules/app-auth/cli-connection'
import {
  claimCliFlowTask,
  CliFlowTaskLeaseReporter,
} from './modules/app-auth/flow-tasks'
import { deriveCliTargetFromAuthState } from './modules/app-auth/target'
import { clearAppSession, readAppSession } from './modules/app-auth/token-store'
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
  shouldKeepFlowOpen,
  type AuthOptions,
  type CommonOptions,
  type ExchangeOptions,
  type FlowOptions,
  type FlowProgressUpdate,
} from './modules/flow-cli/helpers'
import {
  DEFAULT_CLI_FLOW_TASK_PARALLELISM,
  MAX_CLI_FLOW_TASK_PARALLELISM,
  normalizeCliFlowTaskPayload,
  type CliFlowTaskBatchMetadata,
  type CliFlowCommandId,
} from './modules/flow-cli/flow-registry'
import { normalizeFlowCliArgsForCommand } from './modules/flow-cli/parse-argv'
import { runPromptDashboard } from './modules/tui/dashboard'
import { runWithSession } from './modules/flow-cli/run-with-session'
import {
  buildFailedFlowCommandExecution,
  buildFlowCommandExecutionResult,
  writeFlowCommandExecutionResult,
  type FlowCommandExecution,
} from './modules/flow-cli/result-file'
import { assertFlowTaskExecutionSucceeded } from './modules/flow-cli/task-completion'
import { sleep } from './utils/wait'
import {
  initializeCliFileLogging,
  writeCliStderrLine,
  writeCliStdoutLine,
} from './utils/cli-output'
import {
  setObservabilityRuntimeState,
  traceCliOperation,
  withObservabilityContext,
} from './utils/observability'
import { resolveWorkspaceRoot } from './utils/workspace-root'
import { FlowTaskScheduler } from './modules/flow-cli/task-scheduler'

initializeCliFileLogging({
  rootDir: resolveWorkspaceRoot(fileURLToPath(import.meta.url)),
})

async function runFlowCommand(
  subcommand: CliFlowCommandId,
  options: FlowOptions,
  runtime: {
    abortSignal?: AbortSignal
  } = {},
): Promise<unknown> {
  const runtimeOptions: FlowOptions = {
    ...options,
    progressReporter:
      options.progressReporter ||
      createConsoleFlowProgressReporter(`flow:${subcommand}`),
  }
  let result: unknown
  let browserHarPath: string | undefined

  await runWithSession(
    { artifactName: subcommand, context: {} },
    async (session) => {
      browserHarPath = session.harPath
      if (subcommand === 'chatgpt-register') {
        result = await registerChatGPT(session.page, runtimeOptions)
        return
      }

      if (subcommand === 'chatgpt-login') {
        result = await loginChatGPT(session.page, runtimeOptions)
        return
      }

      if (subcommand === 'chatgpt-login-invite') {
        result = await loginChatGPTAndInviteMembers(
          session.page,
          runtimeOptions,
        )
        return
      }

      if (subcommand === 'codex-oauth') {
        result = await runCodexOAuthFlow(session.page, runtimeOptions)
        return
      }

      if (subcommand === 'noop') {
        result = await openNoopFlow(session.page)
        return
      }

      throw new Error(`Unsupported flow command: ${subcommand || '(missing)'}`)
    },
    {
      closeOnComplete: !shouldKeepFlowOpen(runtimeOptions),
      abortSignal: runtime.abortSignal,
    },
  )

  result = attachFlowArtifactPaths(result, {
    harPath: browserHarPath,
  })
  printFlowCompletionSummary(`flow:${subcommand}`, result)
  if (shouldKeepFlowOpen(runtimeOptions)) {
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

async function executeFlowSubcommand(
  subcommand: CliFlowCommandId,
  options: FlowOptions,
  runtime: {
    abortSignal?: AbortSignal
  } = {},
): Promise<FlowCommandExecution> {
  const resolvedOptions = resolveFlowCommandOptions(subcommand, options)
  const command = `flow:${subcommand}`
  const startedAt = new Date().toISOString()
  prepareRuntimeConfig(command, resolvedOptions)
  return withObservabilityContext(
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
      scope: options.scope,
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

async function runDaemonCommand(
  subcommand: string,
  options: AuthOptions,
  config: ReturnType<typeof prepareRuntimeConfig>,
): Promise<void> {
  if (subcommand !== 'start') {
    throw new Error(`Unsupported daemon command: ${subcommand || '(missing)'}`)
  }

  const cliName = options.cliName || getDefaultCliName()
  let announced = false
  setObservabilityRuntimeState({
    cliName,
    target: options.target || null,
    phase: 'starting',
  })

  while (true) {
    setRuntimeConfig(config)
    const authState = await resolveCliNotificationsAuthState()
    const target = options.target || deriveCliTargetFromAuthState(authState)
    const workerId = resolveCliWorkerId({
      cliName,
      target,
    })
    const runtimeReporter = new CliConnectionRuntimeReporter({
      authState,
      onError: (error) => {
        writeCliStderrLine(
          JSON.stringify(
            {
              command: 'daemon:runtime:error',
              error: error.message,
            },
            null,
            2,
          ),
        )
      },
    })
    const taskScheduler = new FlowTaskScheduler<void>()
    const taskLeaseReporters = new Map<string, CliFlowTaskLeaseReporter>()
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
          parallelism: snapshot.parallelism,
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
        runtimeFlowMessage: `${snapshot.activeCount} running, ${snapshot.pendingCount} queued (parallelism ${snapshot.parallelism || DEFAULT_CLI_FLOW_TASK_PARALLELISM})`,
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
        parallelism: snapshot.parallelism,
        flowId:
          snapshot.activeCount + snapshot.pendingCount > 1
            ? 'task-queue'
            : lastRuntimeState?.flowId || 'task-queue',
        taskId:
          snapshot.activeCount === 1 && !snapshot.pendingCount
            ? lastRuntimeState?.notificationId || null
            : null,
        status: 'running',
        message: `${snapshot.activeCount} running, ${snapshot.pendingCount} queued (parallelism ${snapshot.parallelism || DEFAULT_CLI_FLOW_TASK_PARALLELISM})`,
        startedAt: outstandingStartedAt || lastRuntimeState?.startedAt || null,
        completedAt: null,
      })
    }

    const getClaimedTaskCount = () => {
      const snapshot = taskScheduler.getSnapshot()
      return snapshot.activeCount + snapshot.pendingCount
    }

    const logTaskLeaseError = (taskId: string, error: Error) => {
      writeCliStderrLine(
        JSON.stringify(
          {
            command: 'daemon:task:lease:error',
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
      leaseReporter?: CliFlowTaskLeaseReporter
    }) => {
      const scheduled = taskScheduler.enqueue({
        taskId: task.notificationId,
        batchId: task.batch?.batchId,
        parallelism: task.batch?.parallelism,
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
              if (
                !outstandingStartedAt ||
                Date.parse(startedAt) < Date.parse(outstandingStartedAt)
              ) {
                outstandingStartedAt = startedAt
              }

              writeCliStdoutLine(
                JSON.stringify(
                  {
                    command: 'daemon:task:start',
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

              const consoleProgressReporter = createConsoleFlowProgressReporter(
                `flow:${task.flowId}`,
              )

              try {
                const execution = await executeFlowSubcommand(task.flowId, {
                  ...task.config,
                  progressReporter: (update) => {
                    consoleProgressReporter(update)

                    const message = formatRuntimeProgressMessage(update)
                    if (!message) {
                      return
                    }

                    lastRuntimeState = {
                      flowId: task.flowId,
                      notificationId: task.notificationId,
                      status: update.status === 'failed' ? 'failed' : 'running',
                      message,
                      startedAt,
                    }
                    syncRuntimeReporterState()
                    task.leaseReporter?.reportProgress(message)
                  },
                })
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
                      command: 'daemon:task:completed',
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
                lastRuntimeState = {
                  flowId: task.flowId,
                  notificationId: task.notificationId,
                  status: 'failed',
                  message: sanitized.message,
                  startedAt,
                  completedAt: new Date().toISOString(),
                }
                syncRuntimeReporterState()
                writeCliStderrLine(
                  JSON.stringify(
                    {
                      command: 'daemon:task:error',
                      notificationId: task.notificationId,
                      flowId: task.flowId,
                      error: sanitized.message,
                    },
                    null,
                    2,
                  ),
                )
                if (task.leaseReporter) {
                  try {
                    await task.leaseReporter.complete({
                      status: 'FAILED',
                      error: sanitized.message,
                      message: sanitized.message,
                    })
                  } catch (leaseError) {
                    logTaskLeaseError(
                      task.notificationId,
                      sanitizeErrorForOutput(leaseError),
                    )
                  } finally {
                    taskLeaseReporters.delete(task.notificationId)
                  }
                }
              } finally {
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

    const tryClaimTasks = async () => {
      if (!connectionId || claimInFlight) {
        return
      }

      claimInFlight = true
      try {
        while (
          connectionId &&
          getClaimedTaskCount() < MAX_CLI_FLOW_TASK_PARALLELISM
        ) {
          const claimedTask = await claimCliFlowTask({
            connectionId,
            authState,
          })
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
            leaseReporter,
          }).catch((error) => {
            writeCliStderrLine(
              JSON.stringify(
                {
                  command: 'daemon:task:schedule:error',
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
              command: 'daemon:task:claim:error',
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
          command: announced ? 'daemon:reconnect' : 'daemon:start',
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
                  command: 'daemon:connected',
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
              command: 'daemon:event',
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
            command: 'daemon:stream:error',
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
}

async function runInteractiveCommand(
  subcommand: string,
  options: AuthOptions,
  config: ReturnType<typeof prepareRuntimeConfig>,
): Promise<void> {
  if (subcommand !== 'start') {
    throw new Error(`Unsupported tui command: ${subcommand || '(missing)'}`)
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    throw new Error(
      'The prompt-driven CLI requires an interactive terminal. Use `codey daemon start` for non-interactive streaming mode.',
    )
  }

  const cliName = options.cliName || getDefaultCliName()
  setObservabilityRuntimeState({
    cliName,
    target: options.target || null,
    phase: 'starting',
  })
  await runPromptDashboard({
    cliName,
    target: options.target,
    config,
    executeFlow: executeFlowSubcommand,
  })
}

const cli = cac('codey')
const flowCli = cac('codey flow')
const exchangeCli = cac('codey exchange')
const authCli = cac('codey auth')
const daemonCli = cac('codey daemon')
const tuiCli = cac('codey tui')

function withCommonOptions<
  TCommand extends {
    option(name: string, description?: string, config?: never): TCommand
  },
>(command: TCommand): TCommand {
  return command
    .option('--config <file>', 'JSON config file')
    .option('--profile <name>', 'Reserved for future config profile selection')
    .option(
      '--chromeDefaultProfile <bool>',
      'Use the local Chrome Default profile for browser-based flow startup (implies --record true unless explicitly disabled)',
    )
    .option('--headless <bool>', 'Override browser headless')
    .option('--slowMo <ms>', 'Override browser slow motion delay')
}

withCommonOptions(
  flowCli
    .command(
      'chatgpt-register',
      'Register a ChatGPT account using the configured Exchange mailbox',
    )
    .option('--password <password>', 'Optional password override')
    .option('--har <bool>', 'Whether to record a HAR file for this flow run')
    .option(
      '--record <bool>',
      'Whether to keep the browser session open after the flow completes',
    )
    .option(
      '--verificationTimeoutMs <ms>',
      'How long to wait for the verification email',
    )
    .option(
      '--pollIntervalMs <ms>',
      'How often to poll Exchange for the verification email',
    )
    .example('codey flow chatgpt-register --verificationTimeoutMs 180000'),
).action((rawOptions: Record<string, unknown>) => {
  execute(
    (async () => {
      const options = normalizeFlowCommandOptions(
        'chatgpt-register',
        rawOptions,
      )
      await executeFlowSubcommandWithReporting('chatgpt-register', options)
    })(),
  )
})

withCommonOptions(
  flowCli
    .command(
      'chatgpt-login',
      'Sign in to ChatGPT with a previously shared identity',
    )
    .option('--har <bool>', 'Whether to record a HAR file for this flow run')
    .option(
      '--record <bool>',
      'Whether to keep the browser session open after the flow completes',
    )
    .option(
      '--identityId <id>',
      'Shared identity id from a previous chatgpt-register run',
    )
    .option(
      '--email <email>',
      'Shared identity email; defaults to the latest shared identity',
    )
    .example('codey flow chatgpt-login')
    .example('codey flow chatgpt-login --email someone@example.com'),
).action((rawOptions: Record<string, unknown>) => {
  execute(
    (async () => {
      const options = normalizeFlowCommandOptions('chatgpt-login', rawOptions)
      await executeFlowSubcommandWithReporting('chatgpt-login', options)
    })(),
  )
})

withCommonOptions(
  flowCli
    .command(
      'chatgpt-login-invite',
      'Sign in with a shared ChatGPT identity and invite workspace members',
    )
    .option('--har <bool>', 'Whether to record a HAR file for this flow run')
    .option(
      '--record <bool>',
      'Whether to keep the browser session open after the flow completes',
    )
    .option(
      '--identityId <id>',
      'Shared identity id from a previous chatgpt-register run',
    )
    .option(
      '--email <email>',
      'Shared identity email; defaults to the latest shared identity',
    )
    .option(
      '--inviteEmail <email>',
      'Invite email(s), repeatable or comma-separated',
    )
    .option(
      '--inviteFile <file>',
      'CSV or JSON file containing invite email addresses',
    )
    .example(
      'codey flow chatgpt-login-invite --inviteEmail a@example.com --inviteEmail b@example.com',
    )
    .example(
      'codey flow chatgpt-login-invite --inviteEmail a@example.com,b@example.com',
    )
    .example(
      'codey flow chatgpt-login-invite --inviteFile ./members.csv --record true',
    ),
).action((rawOptions: Record<string, unknown>) => {
  execute(
    (async () => {
      const options = normalizeFlowCommandOptions(
        'chatgpt-login-invite',
        rawOptions,
      )
      await executeFlowSubcommandWithReporting('chatgpt-login-invite', options)
    })(),
  )
})

withCommonOptions(
  flowCli
    .command('codex-oauth', 'Run Codex OAuth and save the session in Codey app')
    .option('--har <bool>', 'Whether to record a HAR file for this flow run')
    .option(
      '--record <bool>',
      'Whether to keep the browser session open after the flow completes',
    )
    .option(
      '--identityId <id>',
      'Shared identity id to use if the OpenAI login flow needs credentials',
    )
    .option(
      '--email <email>',
      'Shared identity email to use if the OpenAI login flow needs credentials; defaults to the latest shared identity',
    )
    .option(
      '--workspaceId <id>',
      'Explicit OpenAI workspace id to request during Codex OAuth',
    )
    .option(
      '--workspaceIndex <index>',
      '1-based workspace position to select on the Codex consent page (defaults to 1)',
    )
    .option('--redirectPort <port>', 'Override OAuth callback redirect port')
    .option(
      '--authorizeUrlOnly <bool>',
      'Generate the OAuth URL and exit before continuing browser login',
    )
    .example('codey flow codex-oauth --redirectPort 3005')
    .example('codey flow codex-oauth --authorizeUrlOnly true')
    .example('codey flow codex-oauth --email someone@example.com')
    .example('codey flow codex-oauth --workspaceId ws_123')
    .example('codey flow codex-oauth --workspaceIndex 2'),
).action((rawOptions: Record<string, unknown>) => {
  execute(
    (async () => {
      const options = normalizeFlowCommandOptions('codex-oauth', rawOptions)
      await executeFlowSubcommandWithReporting('codex-oauth', options)
    })(),
  )
})

withCommonOptions(
  flowCli
    .command(
      'noop',
      'Open an empty browser page and keep it available for manual inspection',
    )
    .option('--har <bool>', 'Whether to record a HAR file for this flow run')
    .option(
      '--record <bool>',
      'Whether to keep the browser session open after the flow completes',
    )
    .example('codey flow noop')
    .example('codey flow noop --record false --har false'),
).action((rawOptions: Record<string, unknown>) => {
  execute(
    (async () => {
      const options = normalizeFlowCommandOptions('noop', rawOptions)
      await executeFlowSubcommandWithReporting('noop', options)
    })(),
  )
})

withCommonOptions(
  authCli
    .command(
      'login',
      'Authenticate this CLI client with the Codey app via device flow',
    )
    .option('--flowType <name>', 'Logical flow type for the device challenge')
    .option('--cliName <name>', 'CLI instance label')
    .option('--scope <scope>', 'Requested CLI scope')
    .option(
      '--target <target>',
      'Notification target label, such as a GitHub login',
    )
    .example('codey auth login --target octocat'),
).action((options: AuthOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('auth:login', options)
      await runAuthCommand('login', options, config)
    })(),
  )
})

withCommonOptions(
  authCli.command('status', 'Show stored Codey app authentication status'),
).action((options: AuthOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('auth:status', options)
      await runAuthCommand('status', options, config)
    })(),
  )
})

withCommonOptions(
  authCli.command('logout', 'Clear stored Codey app authentication'),
).action((options: AuthOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('auth:logout', options)
      await runAuthCommand('logout', options, config)
    })(),
  )
})

withCommonOptions(
  tuiCli
    .command(
      'start',
      'Run the Codey prompt-driven operator CLI for local starts and web-dispatched flow tasks',
    )
    .option('--cliName <name>', 'CLI instance label')
    .option(
      '--target <target>',
      'Notification target label, such as a GitHub login',
    )
    .example('codey prompt start --target octocat')
    .example('codey'),
).action((options: AuthOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('tui:start', options)
      await runInteractiveCommand('start', options, config)
    })(),
  )
})

withCommonOptions(
  daemonCli
    .command(
      'start',
      'Run the legacy stream client (non-interactive alias for the CLI worker loop)',
    )
    .option('--cliName <name>', 'CLI instance label')
    .option(
      '--target <target>',
      'Notification target label, such as a GitHub login',
    )
    .example('codey daemon start --target octocat'),
).action((options: AuthOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('daemon:start', options)
      await runDaemonCommand('start', options, config)
    })(),
  )
})

withCommonOptions(
  exchangeCli
    .command(
      'verify',
      'Verify Exchange token, mailbox folder access, and inbox message access',
    )
    .example('codey exchange verify'),
).action((options: CommonOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('exchange:verify', options)
      await runExchangeCommand('verify', options, config)
    })(),
  )
})

withCommonOptions(
  exchangeCli
    .command('folders', 'List mailbox folders')
    .example('codey exchange folders --config path/to/config.json'),
).action((options: CommonOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('exchange:folders', options)
      await runExchangeCommand('folders', options, config)
    })(),
  )
})

withCommonOptions(
  exchangeCli
    .command('messages', 'List mailbox messages')
    .option('--folderId <id>', 'Mailbox folder id')
    .option('--maxItems <count>', 'Maximum number of messages to return')
    .option('--unreadOnly <bool>', 'Only return unread messages')
    .example(
      'codey exchange messages --folderId id --maxItems 20 --unreadOnly true',
    ),
).action((options: ExchangeOptions) => {
  execute(
    (async () => {
      const config = prepareRuntimeConfig('exchange:messages', options)
      await runExchangeCommand('messages', options, config)
    })(),
  )
})

cli
  .command('flow', 'Run OpenAI flow commands')
  .example('codey flow chatgpt-register --verificationTimeoutMs 180000')
  .example('codey flow chatgpt-login --email someone@example.com')
  .example(
    'codey flow chatgpt-login-invite --inviteEmail a@example.com,b@example.com',
  )
  .example('codey flow codex-oauth --workspaceIndex 2')
  .action(() => {
    flowCli.outputHelp()
  })

cli
  .command('exchange', 'Run Exchange commands')
  .example('codey exchange verify')
  .example('codey exchange folders --config path/to/config.json')
  .example(
    'codey exchange messages --folderId id --maxItems 20 --unreadOnly true',
  )
  .action(() => {
    exchangeCli.outputHelp()
  })

cli
  .command('auth', 'Run Codey app authentication commands')
  .example('codey auth login --target octocat')
  .example('codey auth logout')
  .action(() => {
    authCli.outputHelp()
  })

cli
  .command(
    'prompt',
    'Run the Codey prompt-driven operator CLI for local starts and web-dispatched tasks',
  )
  .example('codey')
  .example('codey prompt start --target octocat')
  .action(() => {
    tuiCli.outputHelp()
  })

cli
  .command(
    'tui',
    'Run the Codey prompt-driven operator CLI (legacy command name)',
  )
  .example('codey')
  .example('codey tui start --target octocat')
  .action(() => {
    tuiCli.outputHelp()
  })

cli
  .command('daemon', 'Run the legacy stream client and notification commands')
  .example('codey daemon start --target octocat')
  .action(() => {
    daemonCli.outputHelp()
  })

cli.help()
flowCli.help()
exchangeCli.help()
authCli.help()
tuiCli.help()
daemonCli.help()

const argv = process.argv.slice(2)

if (argv.length === 0) {
  if (process.stdout.isTTY && process.stdin.isTTY) {
    tuiCli.parse(['codey', 'tui', 'start'])
  } else {
    cli.outputHelp()
  }
} else if (argv[0] === 'flow') {
  flowCli.parse(['codey', 'flow', ...argv.slice(1)])
} else if (argv[0] === 'exchange') {
  exchangeCli.parse(['codey', 'exchange', ...argv.slice(1)])
} else if (argv[0] === 'auth') {
  authCli.parse(['codey', 'auth', ...argv.slice(1)])
} else if (argv[0] === 'prompt') {
  tuiCli.parse(['codey', 'tui', ...argv.slice(1)])
} else if (argv[0] === 'tui') {
  tuiCli.parse(['codey', 'tui', ...argv.slice(1)])
} else if (argv[0] === 'daemon') {
  daemonCli.parse(['codey', 'daemon', ...argv.slice(1)])
} else {
  cli.parse()
}
