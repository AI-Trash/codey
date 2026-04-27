import type { CliRuntimeConfig } from '../../config'
import { setRuntimeConfig } from '../../config'
import {
  withCliOutput,
  writeCliStdoutLine,
  type CliOutput,
} from '../../utils/cli-output'
import {
  setObservabilityRuntimeState,
  withObservabilityContext,
} from '../../utils/observability'
import { sleep } from '../../utils/wait'
import {
  DEFAULT_CLI_BROWSER_LIMIT,
  normalizeCliFlowTaskPayload,
  type CliFlowTaskBatchMetadata,
  type CliFlowCommandId,
  type CliFlowTaskExternalServices,
} from '../flow-cli/flow-registry'
import {
  formatFlowCompletionSummary,
  sanitizeErrorForOutput,
  type FlowOptions,
  type FlowProgressReporter,
} from '../flow-cli/helpers'
import type { FlowCommandExecution } from '../flow-cli/result-file'
import {
  claimCliFlowTask,
  CliFlowTaskLeaseReporter,
} from '../app-auth/flow-tasks'
import { deriveCliTargetFromAuthState } from '../app-auth/target'
import {
  exchangeDeviceChallenge,
  resolveCliNotificationsAuthState,
  startDeviceLogin,
  streamCliNotifications,
  type CliNotificationsAuthState,
} from '../app-auth/device-login'
import { CliConnectionRuntimeReporter } from '../app-auth/cli-connection'
import { resolveCliWorkerId } from '../app-auth/worker-id'
import type { CliConnectionEvent } from '../app-auth/types'
import {
  applyAuthStateToDashboard,
  applyCliConnectionEvent,
  appendDashboardEvent,
  clearDashboardEvents,
  completeDashboardFlow,
  createDashboardState,
  deriveTargetFromAuthState,
  failDashboardFlow,
  formatProgressMessage,
  formatRelativeTime,
  handleDashboardNotification,
  isTuiAuthRecoveryError,
  setDashboardTaskCounts,
  setDashboardPhase,
  startDashboardFlow,
  touchDashboardState,
  updateDashboardFlowProgress,
  type DashboardState,
} from './dashboard-model'
import { promptForManualFlowTask } from './manual-flow'
import { FlowInterruptedError } from '../flow-cli/run-with-session'
import {
  FlowTaskScheduler,
  FlowTaskSchedulerCancelledError,
} from '../flow-cli/task-scheduler'
import { assertFlowTaskExecutionSucceeded } from '../flow-cli/task-completion'
import { PromptCanceledError } from './prompt-io'
import { PromptShell } from './prompt-shell'

const REQUIRED_OPERATOR_SCOPE = 'notifications:read'

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'AbortError')
  )
}

function normalizePromptTarget(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized ? normalized : undefined
}

function toPromptCancelError(error: unknown): Error {
  if (error instanceof PromptCanceledError) {
    return error
  }

  if (error instanceof Error) {
    const message = error.message.trim()
    if (!message || /cancel/i.test(message)) {
      return new PromptCanceledError()
    }
    return error
  }

  return new PromptCanceledError()
}

function formatTimestamp(value: string | undefined, nowMs: number): string {
  if (!value) {
    return 'n/a'
  }

  return `${value} (${formatRelativeTime(value, nowMs)})`
}

function formatRuntimeFlowLabel(state: DashboardState): string {
  const outstandingCount = state.activeFlowCount + state.queuedFlowCount
  if (outstandingCount > 1) {
    return 'task queue'
  }

  return state.currentFlow?.flowId || 'idle'
}

function formatRuntimeStatusLabel(state: DashboardState): string {
  if (state.activeFlowCount > 1) {
    return `${state.activeFlowCount} running`
  }

  if (state.activeFlowCount === 1) {
    return 'running'
  }

  if (state.queuedFlowCount > 0) {
    return `${state.queuedFlowCount} queued`
  }

  return state.currentFlow?.status || 'idle'
}

function formatRuntimeMessage(state: DashboardState): string {
  const outstandingCount = state.activeFlowCount + state.queuedFlowCount
  if (outstandingCount > 1) {
    const latest = state.currentFlow?.message || 'Task queue active.'
    return `${state.activeFlowCount} running, ${state.queuedFlowCount} queued. Latest: ${latest}`
  }

  if (outstandingCount === 1 && state.queuedFlowCount > 0) {
    return `${state.queuedFlowCount} queued. Waiting for a worker slot.`
  }

  return (
    state.currentFlow?.message ||
    'Waiting for a task from Codey web, or run `start` to launch one locally.'
  )
}

function getNewRecentEvents(
  previousState: DashboardState,
  nextState: DashboardState,
): readonly { at: string; message: string }[] {
  const previousKeys = new Set(
    previousState.recentEvents.map((entry) => `${entry.at}:${entry.message}`),
  )

  return nextState.recentEvents
    .filter((entry) => !previousKeys.has(`${entry.at}:${entry.message}`))
    .slice()
    .reverse()
}

function formatShellHelpLines(): string[] {
  return [
    'Codey operator CLI commands:',
    '  help        Show this command list.',
    '  status      Show the current connection and runtime state.',
    '  events      Show the recent event buffer.',
    '  start       Launch a local flow with prompt-driven questions.',
    '  stop        Stop running tasks and clear queued tasks.',
    '  reconnect   Reconnect the SSE stream after the queue drains.',
    '  clear       Clear the recent event buffer.',
    '  quit        Exit after running tasks finish.',
    '  Ctrl+C      Exit immediately.',
  ]
}

function formatStatusLines(state: DashboardState): string[] {
  return [
    'Current status:',
    `  Phase: ${state.phase}`,
    `  CLI: ${state.cliName}`,
    `  Target: ${state.target || 'n/a'}`,
    `  Connection ID: ${state.connectionId || 'waiting for /api/cli/events'}`,
    `  Connected: ${
      state.connectedAt
        ? formatTimestamp(state.connectedAt, state.nowMs)
        : 'connecting'
    }`,
    `  Auth: ${
      state.authClientId
        ? `${state.authMode || 'n/a'} (${state.authClientId})`
        : state.authMode || 'n/a'
    }`,
    `  Flow: ${formatRuntimeFlowLabel(state)}`,
    `  Status: ${formatRuntimeStatusLabel(state)}`,
    `  Message: ${formatRuntimeMessage(state)}`,
    `  Running: ${state.activeFlowCount}`,
    `  Queued: ${state.queuedFlowCount}`,
    `  Started: ${formatTimestamp(state.currentFlow?.startedAt, state.nowMs)}`,
    `  Completed: ${formatTimestamp(
      state.currentFlow?.completedAt,
      state.nowMs,
    )}`,
    `  Last error: ${state.lastError || 'n/a'}`,
  ]
}

function formatRecentEventLines(state: DashboardState): string[] {
  if (!state.recentEvents.length) {
    return ['No events yet.']
  }

  return [
    'Recent events:',
    ...state.recentEvents.map((entry) => `  [${entry.at}] ${entry.message}`),
  ]
}

async function resolveTaskFlowOptions(input: {
  config: FlowOptions
}): Promise<FlowOptions> {
  return input.config
}

async function promptForStartupAuth(input: {
  cliName: string
  target?: string
  reason: string
}): Promise<string | undefined> {
  return input.reason
    ? await import('./prompt-io').then(async ({ withPromptSession }) =>
        withPromptSession(async (prompts) => {
          const shouldLogin = await prompts.confirm({
            message: `${input.reason}\nStart Codey device login now?`,
            initial: true,
          })
          if (!shouldLogin) {
            throw new PromptCanceledError('Operator CLI startup canceled.')
          }

          let target = normalizePromptTarget(input.target)
          if (!target) {
            target = normalizePromptTarget(
              await prompts.input({
                message:
                  'Optional target label shown in Codey web (press Enter to skip)',
                initial: '',
                allowBlank: true,
              }),
            )
          }

          const challenge = await startDeviceLogin({
            cliName: input.cliName,
            scope: REQUIRED_OPERATOR_SCOPE,
          })

          writeCliStdoutLine('')
          writeCliStdoutLine('Codey device login')
          writeCliStdoutLine(
            `Open: ${challenge.verificationUriComplete || challenge.verificationUri}`,
          )
          writeCliStdoutLine(`User code: ${challenge.userCode}`)
          writeCliStdoutLine(`Expires at: ${challenge.expiresAt}`)
          writeCliStdoutLine('Waiting for approval...')

          const approved = await exchangeDeviceChallenge(challenge, target)
          const approvedAs =
            approved.user?.githubLogin ||
            approved.user?.email ||
            approved.subject ||
            'this terminal'

          writeCliStdoutLine(`Approved for ${approvedAs}. Launching CLI...`)
          writeCliStdoutLine('')

          return target
        }),
      )
    : undefined
}

async function resolveStartupAuthState(input: {
  cliName: string
  target?: string
}): Promise<{
  authState: CliNotificationsAuthState
  target?: string
}> {
  try {
    const authState = await resolveCliNotificationsAuthState()
    return {
      authState,
      target:
        normalizePromptTarget(input.target) ||
        deriveTargetFromAuthState(authState),
    }
  } catch (error) {
    if (!isTuiAuthRecoveryError(error)) {
      throw error
    }

    const reason = sanitizeErrorForOutput(error).message
    const target = await promptForStartupAuth({
      cliName: input.cliName,
      target: input.target,
      reason,
    })
    const authState = await resolveCliNotificationsAuthState()

    return {
      authState,
      target:
        normalizePromptTarget(input.target) ||
        target ||
        deriveTargetFromAuthState(authState),
    }
  }
}

export async function runPromptDashboard(input: {
  cliName: string
  target?: string
  config: CliRuntimeConfig
  executeFlow: (
    flowId: CliFlowCommandId,
    options: FlowOptions,
    runtime?: {
      abortSignal?: AbortSignal
    },
  ) => Promise<FlowCommandExecution>
}): Promise<void> {
  setRuntimeConfig(input.config)
  const startup = await resolveStartupAuthState({
    cliName: input.cliName,
    target: input.target,
  })

  let dashboardState = createDashboardState({
    cliName: input.cliName,
    target: startup.target,
  })
  let initialAuthState: CliNotificationsAuthState | undefined =
    startup.authState
  let currentClaimAuthState: CliNotificationsAuthState | undefined =
    startup.authState
  let stopRequested = false
  let forceStopRequested = false
  let reconnectRequested = false
  let streamAbortController: AbortController | null = null
  const activeFlowAbortControllers = new Map<string, AbortController>()
  const taskLeaseReporters = new Map<string, CliFlowTaskLeaseReporter>()
  const taskScheduler = new FlowTaskScheduler<{
    interrupted: boolean
  }>()
  let runtimeReporter: CliConnectionRuntimeReporter | null = null
  let outstandingStartedAt: string | undefined
  let claimConnectionId: string | undefined
  let claimInFlight = false
  let claimInterval: ReturnType<typeof setInterval> | undefined
  let localPromptInFlight = false
  const shell = new PromptShell()

  const printLines = (lines: readonly string[]) => {
    for (const line of lines) {
      shell.print(line)
    }
  }

  const updateState = (
    updater:
      | DashboardState
      | ((prev: Readonly<DashboardState>) => DashboardState),
  ): DashboardState => {
    const previousState = dashboardState
    const next =
      typeof updater === 'function' ? updater(dashboardState) : updater
    dashboardState = touchDashboardState(next)

    for (const event of getNewRecentEvents(previousState, dashboardState)) {
      shell.print(`[${event.at}] ${event.message}`)
    }

    setObservabilityRuntimeState({
      phase: dashboardState.phase,
      cliName: dashboardState.cliName,
      target: dashboardState.target || null,
      connectionId: dashboardState.connectionId || null,
      authMode: dashboardState.authMode || null,
      activeTaskCount: dashboardState.activeFlowCount,
      pendingTaskCount: dashboardState.queuedFlowCount,
      flowId: dashboardState.currentFlow?.flowId || null,
      taskId: dashboardState.currentFlow?.notificationId || null,
      status: dashboardState.currentFlow?.status || null,
      message: dashboardState.currentFlow?.message || null,
      startedAt: dashboardState.currentFlow?.startedAt || null,
      completedAt: dashboardState.currentFlow?.completedAt || null,
      lastError: dashboardState.lastError || null,
    })
    return dashboardState
  }

  const appendCliOutputToDashboard = (line: string) => {
    const entries = line
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (!entries.length) {
      return
    }

    updateState((state) =>
      entries.reduce(
        (nextState, entry) => appendDashboardEvent(nextState, entry),
        state,
      ),
    )
  }

  const dashboardCliOutput: CliOutput = {
    stdoutLine: appendCliOutputToDashboard,
    stderrLine: appendCliOutputToDashboard,
  }

  const syncDashboardTaskState = () => {
    const snapshot = taskScheduler.getSnapshot()
    updateState((state) =>
      setDashboardTaskCounts(state, {
        activeFlowCount: snapshot.activeCount,
        queuedFlowCount: snapshot.pendingCount,
      }),
    )
  }

  const syncRuntimeReporterState = () => {
    if (!runtimeReporter) {
      return
    }

    const snapshot = taskScheduler.getSnapshot()
    if (!snapshot.activeCount && !snapshot.pendingCount) {
      outstandingStartedAt = undefined
      runtimeReporter.update({
        runtimeFlowId: dashboardState.currentFlow?.flowId || null,
        runtimeTaskId: dashboardState.currentFlow?.notificationId || null,
        runtimeFlowStatus: dashboardState.currentFlow?.status || null,
        runtimeFlowMessage: dashboardState.currentFlow?.message || null,
        runtimeFlowStartedAt: dashboardState.currentFlow?.startedAt || null,
        runtimeFlowCompletedAt: dashboardState.currentFlow?.completedAt || null,
      })
      return
    }

    runtimeReporter.update({
      runtimeFlowId:
        snapshot.activeCount + snapshot.pendingCount > 1
          ? 'task-queue'
          : dashboardState.currentFlow?.flowId || 'task-queue',
      runtimeTaskId:
        snapshot.activeCount === 1 && !snapshot.pendingCount
          ? dashboardState.currentFlow?.notificationId || null
          : null,
      runtimeFlowStatus: 'running',
      runtimeFlowMessage: `${snapshot.activeCount} running, ${snapshot.pendingCount} queued (browser limit ${snapshot.browserLimit || DEFAULT_CLI_BROWSER_LIMIT})`,
      runtimeFlowStartedAt:
        outstandingStartedAt || dashboardState.currentFlow?.startedAt || null,
      runtimeFlowCompletedAt: null,
    })
  }

  const hasOutstandingTasks = () => {
    const snapshot = taskScheduler.getSnapshot()
    return snapshot.activeCount > 0 || snapshot.pendingCount > 0
  }

  const hasActiveTasks = () => taskScheduler.getSnapshot().activeCount > 0

  const getClaimedTaskCount = () => {
    const snapshot = taskScheduler.getSnapshot()
    return snapshot.activeCount + snapshot.pendingCount
  }

  const logTaskLeaseError = (taskId: string, error: Error) => {
    updateState((state) =>
      appendDashboardEvent(
        state,
        `Task lease update failed for ${taskId}: ${error.message}`,
      ),
    )
  }

  const requestReconnect = () => {
    if (stopRequested) {
      return
    }

    reconnectRequested = true
    const waitingForTasks = hasOutstandingTasks()
    updateState((state) =>
      appendDashboardEvent(
        state,
        waitingForTasks
          ? 'Reconnect requested. Waiting for queued and running tasks to finish.'
          : 'Reconnect requested.',
      ),
    )
    if (!waitingForTasks) {
      streamAbortController?.abort()
    }
  }

  const requestGracefulStop = () => {
    if (stopRequested) {
      return
    }

    stopRequested = true
    const cleared = taskScheduler.clearPending(
      'Queued task canceled because the CLI is shutting down.',
    )
    updateState((state) =>
      appendDashboardEvent(
        state,
        hasActiveTasks()
          ? cleared
            ? `Exit requested. Waiting for running tasks to finish and cleared ${cleared} queued tasks.`
            : 'Exit requested. Waiting for running tasks to finish.'
          : cleared
            ? `Exit requested. Cleared ${cleared} queued tasks.`
            : 'Exit requested.',
      ),
    )
    syncDashboardTaskState()
    syncRuntimeReporterState()
    if (!hasActiveTasks()) {
      streamAbortController?.abort()
    }
  }

  const requestImmediateStop = (
    message = 'Immediate exit requested.',
    flowAbortMessage = 'Flow interrupted by Ctrl+C.',
  ) => {
    if (forceStopRequested) {
      return
    }

    stopRequested = true
    forceStopRequested = true
    reconnectRequested = false

    const activeTaskCount = activeFlowAbortControllers.size
    const cleared = taskScheduler.clearPending(
      'Queued task canceled because the CLI was interrupted.',
    )
    updateState((state) =>
      appendDashboardEvent(
        state,
        activeTaskCount
          ? `${message} Stopping ${activeTaskCount} running task${activeTaskCount === 1 ? '' : 's'} now.${cleared ? ` Cleared ${cleared} queued tasks.` : ''}`
          : message,
      ),
    )

    for (const controller of activeFlowAbortControllers.values()) {
      if (!controller.signal.aborted) {
        controller.abort(new FlowInterruptedError(flowAbortMessage))
      }
    }

    syncDashboardTaskState()
    syncRuntimeReporterState()
    streamAbortController?.abort()
  }

  const requestCurrentFlowStop = () => {
    const activeTaskCount = activeFlowAbortControllers.size
    if (!activeTaskCount) {
      updateState((state) =>
        appendDashboardEvent(state, 'No running tasks to stop.'),
      )
      return
    }

    const pendingCount = taskScheduler.getSnapshot().pendingCount
    const allAborted = Array.from(activeFlowAbortControllers.values()).every(
      (controller) => controller.signal.aborted,
    )
    if (allAborted) {
      updateState((state) =>
        appendDashboardEvent(state, 'Task stop is already in progress.'),
      )
      return
    }

    const cleared = taskScheduler.clearPending(
      'Queued task canceled because the operator stopped the task queue.',
    )
    updateState((state) =>
      appendDashboardEvent(
        state,
        `Stopping ${activeTaskCount} running task${activeTaskCount === 1 ? '' : 's'}${pendingCount || cleared ? ` and clearing ${Math.max(pendingCount, cleared)} queued tasks` : ''}...`,
      ),
    )

    for (const controller of activeFlowAbortControllers.values()) {
      if (!controller.signal.aborted) {
        controller.abort(new FlowInterruptedError('Flow stopped by operator.'))
      }
    }

    syncDashboardTaskState()
    syncRuntimeReporterState()
  }

  const handleSignalStop = (signal: 'SIGINT' | 'SIGTERM') => {
    requestImmediateStop(
      signal === 'SIGINT'
        ? 'Immediate exit requested from Ctrl+C.'
        : 'Process termination requested.',
      signal === 'SIGINT'
        ? 'Flow interrupted by Ctrl+C.'
        : 'Flow interrupted by process termination.',
    )
    shell.stopPrompt()
  }

  const queueDashboardFlowTask = (task: {
    flowId: CliFlowCommandId
    config: FlowOptions
    notificationId: string
    message: string
    batch?: CliFlowTaskBatchMetadata
    externalServices?: CliFlowTaskExternalServices
    leaseReporter?: CliFlowTaskLeaseReporter
  }) => {
    const scheduled = taskScheduler.enqueue({
      taskId: task.notificationId,
      batchId: task.batch?.batchId,
      run: async (): Promise<{
        interrupted: boolean
      }> =>
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
            let flowSettled = false
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

            updateState((state) =>
              startDashboardFlow(state, {
                flowId: task.flowId,
                notificationId: task.notificationId,
                message: task.message,
                startedAt,
              }),
            )
            syncDashboardTaskState()
            runtimeReporter?.update({
              runtimeFlowId: task.flowId,
              runtimeTaskId: task.notificationId,
              runtimeFlowStatus: 'running',
              runtimeFlowMessage: task.message,
              runtimeFlowStartedAt: startedAt,
              runtimeFlowCompletedAt: null,
            })
            syncRuntimeReporterState()
            task.leaseReporter?.markRunning(task.message)

            const progressReporter: FlowProgressReporter = (update) => {
              if (flowSettled) {
                return
              }

              const message = formatProgressMessage(update)
              updateState((state) =>
                updateDashboardFlowProgress(state, {
                  status: update.status,
                  message,
                }),
              )

              if (message) {
                shell.print(`[progress:${task.flowId}] ${message}`)
                runtimeReporter?.update({
                  runtimeFlowId: task.flowId,
                  runtimeTaskId: task.notificationId,
                  runtimeFlowStatus:
                    update.status === 'failed' ? 'failed' : 'running',
                  runtimeFlowMessage: message,
                  runtimeFlowStartedAt: startedAt,
                })
                task.leaseReporter?.reportProgress(message)
              }

              syncRuntimeReporterState()
            }

            try {
              const taskFlowOptions = await resolveTaskFlowOptions({
                config: task.config,
              })
              const execution = await withCliOutput(dashboardCliOutput, () =>
                input.executeFlow(
                  task.flowId,
                  {
                    ...taskFlowOptions,
                    progressReporter,
                  },
                  {
                    abortSignal: flowAbortController.signal,
                  },
                ),
              )
              assertFlowTaskExecutionSucceeded(task.flowId, execution)
              const completedAt =
                execution.completedAt || new Date().toISOString()
              const summary =
                formatFlowCompletionSummary(execution.command, execution.result)
                  .split('\n')
                  .find((line) => line.trim()) || 'Flow completed'

              updateState((state) =>
                completeDashboardFlow(state, {
                  flowId: task.flowId,
                  message: summary,
                  completedAt,
                }),
              )
              runtimeReporter?.update({
                runtimeFlowId: task.flowId,
                runtimeTaskId: task.notificationId,
                runtimeFlowStatus: execution.status,
                runtimeFlowMessage: 'Flow completed',
                runtimeFlowStartedAt: startedAt,
                runtimeFlowCompletedAt: completedAt,
              })
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
              return {
                interrupted: false,
              }
            } catch (error) {
              const sanitized = sanitizeErrorForOutput(error)
              const completedAt = new Date().toISOString()
              const interrupted =
                error instanceof FlowInterruptedError || isAbortError(error)

              updateState((state) =>
                failDashboardFlow(state, {
                  flowId: task.flowId,
                  message: sanitized.message,
                  completedAt,
                }),
              )
              runtimeReporter?.update({
                runtimeFlowId: task.flowId,
                runtimeTaskId: task.notificationId,
                runtimeFlowStatus: 'failed',
                runtimeFlowMessage: sanitized.message,
                runtimeFlowStartedAt: startedAt,
                runtimeFlowCompletedAt: completedAt,
              })
              if (task.leaseReporter) {
                try {
                  await task.leaseReporter.complete({
                    status: interrupted ? 'CANCELED' : 'FAILED',
                    error: interrupted ? undefined : sanitized.message,
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
              return {
                interrupted,
              }
            } finally {
              flowSettled = true
              activeFlowAbortControllers.delete(task.notificationId)
              await runtimeReporter?.flush()
              setRuntimeConfig(input.config)
            }
          },
        ),
    })

    syncDashboardTaskState()
    syncRuntimeReporterState()
    return scheduled.finally(() => {
      syncDashboardTaskState()
      syncRuntimeReporterState()
      void tryClaimTasks()

      if (
        (stopRequested || reconnectRequested || forceStopRequested) &&
        !hasOutstandingTasks()
      ) {
        streamAbortController?.abort()
      }
    })
  }

  const tryClaimTasks = async () => {
    const authState = currentClaimAuthState
    if (!claimConnectionId || !authState || claimInFlight) {
      return
    }

    claimInFlight = true
    try {
      while (
        claimConnectionId &&
        getClaimedTaskCount() < taskScheduler.getBrowserLimit()
      ) {
        const claimResult = await claimCliFlowTask({
          connectionId: claimConnectionId,
          authState,
        })
        if (claimResult.browserLimit !== undefined) {
          taskScheduler.setBrowserLimit(claimResult.browserLimit)
          syncRuntimeReporterState()
        }
        const claimedTask = claimResult.task
        if (!claimedTask) {
          break
        }

        const leaseReporter = new CliFlowTaskLeaseReporter({
          connectionId: claimConnectionId,
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

        void queueDashboardFlowTask({
          flowId: taskPayload.flowId,
          config: taskPayload.config as FlowOptions,
          notificationId: claimedTask.id,
          message: claimedTask.title || 'Task started',
          batch: taskPayload.batch,
          externalServices: taskPayload.externalServices,
          leaseReporter,
        }).catch((error) => {
          if (error instanceof FlowTaskSchedulerCancelledError) {
            void leaseReporter
              .complete({
                status: 'CANCELED',
                message: 'Flow canceled',
              })
              .catch((leaseError) => {
                logTaskLeaseError(
                  claimedTask.id,
                  sanitizeErrorForOutput(leaseError),
                )
              })
              .finally(() => {
                taskLeaseReporters.delete(claimedTask.id)
              })
            return
          }

          logTaskLeaseError(claimedTask.id, sanitizeErrorForOutput(error))
        })
      }
    } catch (error) {
      updateState((state) =>
        appendDashboardEvent(
          state,
          `Task claim failed: ${sanitizeErrorForOutput(error).message}`,
        ),
      )
    } finally {
      claimInFlight = false
    }
  }

  const runLocalFlowBatch = async (task: {
    flowId: CliFlowCommandId
    config: FlowOptions
    repeatCount: number
  }) => {
    const repeatCount = Math.max(task.repeatCount, 1)
    const notificationSeed = Date.now()
    const batchId =
      repeatCount > 1 ? `local-batch:${notificationSeed}` : undefined

    if (repeatCount > 1) {
      updateState((state) =>
        appendDashboardEvent(
          state,
          `Queued ${repeatCount} local ${task.flowId} tasks with browser limit ${taskScheduler.getBrowserLimit()}.`,
        ),
      )
    }

    const results = await Promise.allSettled(
      Array.from({ length: repeatCount }, (_, index) =>
        queueDashboardFlowTask({
          flowId: task.flowId,
          config: task.config,
          notificationId: `local:${notificationSeed}:${index + 1}`,
          message:
            repeatCount > 1
              ? `Local task ${index + 1}/${repeatCount}`
              : 'Local task started',
          batch:
            batchId || repeatCount > 1
              ? {
                  ...(batchId ? { batchId } : {}),
                  sequence: index + 1,
                  total: repeatCount,
                }
              : undefined,
        }),
      ),
    )

    const interruptedCount = results.filter((result) => {
      if (result.status === 'fulfilled') {
        return result.value.interrupted
      }

      return result.reason instanceof FlowTaskSchedulerCancelledError
    }).length

    if (interruptedCount && !forceStopRequested) {
      updateState((state) =>
        appendDashboardEvent(
          state,
          `${interruptedCount} local ${task.flowId} task${interruptedCount === 1 ? '' : 's'} did not finish because the queue was interrupted.`,
        ),
      )
    }
  }

  const requestLocalFlowStart = async () => {
    if (stopRequested) {
      return
    }

    if (localPromptInFlight) {
      updateState((state) =>
        appendDashboardEvent(state, 'Local flow launcher is already open.'),
      )
      return
    }

    if (hasOutstandingTasks()) {
      updateState((state) =>
        appendDashboardEvent(
          state,
          'The local task queue is busy. Wait for it to finish before starting another batch locally.',
        ),
      )
      return
    }

    localPromptInFlight = true
    updateState((state) =>
      appendDashboardEvent(state, 'Opening local flow launcher...'),
    )

    try {
      const task = await shell.runModalPrompt((prompts) =>
        promptForManualFlowTask(prompts),
      )

      if (stopRequested) {
        return
      }

      if (hasOutstandingTasks()) {
        updateState((state) =>
          appendDashboardEvent(
            state,
            'Another task started while the local launcher was open. Try again once the queue finishes.',
          ),
        )
        return
      }

      await runLocalFlowBatch({
        flowId: task.flowId,
        config: task.config,
        repeatCount: task.repeatCount,
      })
    } catch (error) {
      const normalized = toPromptCancelError(error)
      const message =
        normalized instanceof PromptCanceledError
          ? 'Local flow start canceled.'
          : `Local flow start failed: ${normalized.message}`
      updateState((state) => appendDashboardEvent(state, message))
    } finally {
      localPromptInFlight = false
    }
  }

  const handleShellCommand = async (
    rawCommand: string,
  ): Promise<'close' | void> => {
    const command = rawCommand.trim().toLowerCase()
    if (!command) {
      return
    }

    if (command === 'help' || command === 'h' || command === '?') {
      printLines(formatShellHelpLines())
      return
    }

    if (command === 'status') {
      printLines(formatStatusLines(dashboardState))
      return
    }

    if (command === 'events' || command === 'logs') {
      printLines(formatRecentEventLines(dashboardState))
      return
    }

    if (command === 'start' || command === 'run') {
      await requestLocalFlowStart()
      return
    }

    if (command === 'stop' || command === 'cancel') {
      requestCurrentFlowStop()
      return
    }

    if (command === 'reconnect' || command === 'retry') {
      requestReconnect()
      return
    }

    if (command === 'clear') {
      updateState((state) => clearDashboardEvents(state))
      shell.print('Recent events cleared.')
      return
    }

    if (command === 'quit' || command === 'exit' || command === 'q') {
      requestGracefulStop()
      if (hasOutstandingTasks()) {
        shell.print('Waiting for running tasks to finish before exit...')
      }
      return 'close'
    }

    shell.print(
      `Unknown command: ${rawCommand}. Run \`help\` to see available commands.`,
    )
  }

  const handleSigint = () => {
    handleSignalStop('SIGINT')
  }
  const handleSigterm = () => {
    handleSignalStop('SIGTERM')
  }

  process.on('SIGINT', handleSigint)
  process.on('SIGTERM', handleSigterm)

  const runConnectionLoop = async () => {
    let announced = false

    while (!stopRequested) {
      setRuntimeConfig(input.config)
      updateState((state) =>
        setDashboardPhase(state, announced ? 'reconnecting' : 'starting'),
      )

      let authState = initialAuthState
      initialAuthState = undefined

      try {
        authState = authState || (await resolveCliNotificationsAuthState())
      } catch (error) {
        const sanitized = sanitizeErrorForOutput(error)
        const message = isTuiAuthRecoveryError(error)
          ? `${sanitized.message} Run \`codey auth login\` again, then relaunch this CLI.`
          : sanitized.message

        updateState((state) =>
          appendDashboardEvent(
            setDashboardPhase(state, 'error', message),
            `Connection lost: ${message}`,
          ),
        )

        if (stopRequested) {
          break
        }

        announced = true
        const shouldSleep = !reconnectRequested
        reconnectRequested = false
        if (shouldSleep) {
          await sleep(1000)
        }
        continue
      }

      updateState((state) =>
        applyAuthStateToDashboard(
          setDashboardPhase(state, announced ? 'reconnecting' : 'starting'),
          authState,
        ),
      )
      currentClaimAuthState = authState
      const target = input.target || deriveCliTargetFromAuthState(authState)
      const workerId = resolveCliWorkerId({
        cliName: input.cliName,
        target,
      })

      const connectionRuntimeReporter = new CliConnectionRuntimeReporter({
        authState,
        onError: (error) => {
          updateState((state) =>
            appendDashboardEvent(
              state,
              `Runtime state update failed: ${error.message}`,
            ),
          )
        },
        onBrowserLimit: (browserLimit) => {
          taskScheduler.setBrowserLimit(browserLimit)
          syncRuntimeReporterState()
          void tryClaimTasks()
        },
      })
      runtimeReporter = connectionRuntimeReporter

      updateState((state) =>
        appendDashboardEvent(
          state,
          announced
            ? 'Reconnecting to Codey web app...'
            : 'Connecting to Codey web app...',
        ),
      )

      streamAbortController = new AbortController()
      let connectionOpened = false

      try {
        for await (const notification of streamCliNotifications(
          {
            cliName: input.cliName,
            target,
            workerId,
          },
          authState,
          {
            onConnection: (event: CliConnectionEvent) => {
              connectionOpened = true
              claimConnectionId = event.connectionId
              if (event.browserLimit !== undefined) {
                taskScheduler.setBrowserLimit(event.browserLimit)
              }
              connectionRuntimeReporter.setConnectionId(event.connectionId)
              if (claimInterval) {
                clearInterval(claimInterval)
              }
              claimInterval = setInterval(() => {
                void tryClaimTasks()
              }, 2000)
              void tryClaimTasks()
              updateState((state) => applyCliConnectionEvent(state, event))
            },
          },
          {
            signal: streamAbortController.signal,
          },
        )) {
          announced = true
          updateState((state) =>
            handleDashboardNotification(state, notification),
          )
        }

        if (!stopRequested && !reconnectRequested && connectionOpened) {
          updateState((state) =>
            appendDashboardEvent(state, 'Connection closed. Reconnecting...'),
          )
        }
      } catch (error) {
        if (isAbortError(error)) {
          if (!stopRequested && reconnectRequested) {
            updateState((state) => setDashboardPhase(state, 'reconnecting'))
          }
        } else {
          const sanitized = sanitizeErrorForOutput(error)
          updateState((state) =>
            appendDashboardEvent(
              setDashboardPhase(state, 'error', sanitized.message),
              `Connection lost: ${sanitized.message}`,
            ),
          )
        }
      } finally {
        streamAbortController = null
        claimConnectionId = undefined
        if (claimInterval) {
          clearInterval(claimInterval)
          claimInterval = undefined
        }
      }

      if (hasOutstandingTasks()) {
        updateState((state) =>
          appendDashboardEvent(
            state,
            stopRequested
              ? 'Waiting for running tasks to finish before exit.'
              : reconnectRequested
                ? 'Waiting for queued and running tasks to finish before reconnecting.'
                : 'Connection closed while tasks are still running. Waiting for the queue to drain before reconnecting.',
          ),
        )
        await taskScheduler.waitForIdle()
      }
      await runtimeReporter?.flush()

      runtimeReporter = null

      if (stopRequested) {
        break
      }

      announced = true
      const shouldSleep = !reconnectRequested
      reconnectRequested = false
      if (shouldSleep) {
        await sleep(1000)
      }
    }
  }

  try {
    printLines([
      'Codey operator CLI',
      'This terminal stays connected to the Codey web app and accepts prompt-driven commands.',
      ...formatShellHelpLines(),
    ])

    const connectionLoop = runConnectionLoop().finally(() => {
      shell.stopPrompt()
    })

    await shell.start(handleShellCommand)

    if (!stopRequested && !forceStopRequested) {
      requestGracefulStop()
    }

    await connectionLoop
  } finally {
    const activeStreamAbortController = streamAbortController as unknown
    if (
      activeStreamAbortController &&
      typeof activeStreamAbortController === 'object' &&
      'abort' in activeStreamAbortController &&
      typeof activeStreamAbortController.abort === 'function'
    ) {
      activeStreamAbortController.abort()
    }
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
    shell.dispose()
  }
}
