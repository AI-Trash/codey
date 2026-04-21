import Enquirer from 'enquirer'
import { ui, type VNode } from '@rezi-ui/core'
import { createNodeApp } from '@rezi-ui/node'

import type { CliRuntimeConfig } from '../../config'
import { setRuntimeConfig } from '../../config'
import { sleep } from '../../utils/wait'
import type { CliFlowCommandId } from '../flow-cli/flow-registry'
import {
  formatFlowCompletionSummary,
  sanitizeErrorForOutput,
  type FlowOptions,
  type FlowProgressReporter,
} from '../flow-cli/helpers'
import type { FlowCommandExecution } from '../flow-cli/result-file'
import {
  exchangeDeviceChallenge,
  resolveCliNotificationsAuthState,
  startDeviceLogin,
  streamCliNotifications,
  type CliNotificationsAuthState,
} from '../app-auth/device-login'
import { CliConnectionRuntimeReporter } from '../app-auth/cli-connection'
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
  setDashboardPhase,
  startDashboardFlow,
  touchDashboardState,
  updateDashboardFlowProgress,
  type DashboardFlowStatus,
  type DashboardPhase,
  type DashboardState,
} from './dashboard-model'
import { promptForManualFlowTask } from './manual-flow'
import { FlowInterruptedError } from '../flow-cli/run-with-session'

const REQUIRED_TUI_SCOPE = 'notifications:read'

function compactNodes(
  children: Array<VNode | null | undefined>,
): readonly VNode[] {
  return children.filter((child): child is VNode => Boolean(child))
}

function toDisplayValue(value: string | undefined, fallback = 'n/a'): string {
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim()
  return normalized || fallback
}

function formatTimestamp(value: string | undefined, nowMs: number): string {
  if (!value) {
    return 'n/a'
  }

  return `${value} (${formatRelativeTime(value, nowMs)})`
}

function formatPhaseLabel(phase: DashboardPhase): string {
  switch (phase) {
    case 'starting':
      return 'Starting'
    case 'listening':
      return 'Listening'
    case 'reconnecting':
      return 'Reconnecting'
    case 'error':
      return 'Error'
    default:
      return phase
  }
}

function mapPhaseStatus(
  phase: DashboardPhase,
): 'online' | 'offline' | 'away' | 'busy' | 'unknown' {
  switch (phase) {
    case 'listening':
      return 'online'
    case 'error':
      return 'busy'
    case 'starting':
    case 'reconnecting':
      return 'away'
    default:
      return 'unknown'
  }
}

function mapFlowVariant(
  status: DashboardFlowStatus | undefined,
): 'default' | 'success' | 'warning' | 'error' | 'info' {
  switch (status) {
    case 'running':
      return 'info'
    case 'passed':
      return 'success'
    case 'failed':
      return 'error'
    case 'idle':
    default:
      return 'default'
  }
}

function mapAuthVariant(
  authMode: string | undefined,
): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (authMode === 'client_credentials') {
    return 'success'
  }

  if (authMode === 'device_session') {
    return 'info'
  }

  return 'default'
}

function renderInfoRow(label: string, value: string): VNode {
  return ui.row(
    {
      gap: 1,
      wrap: true,
    },
    [
      ui.text(`${label}:`, { variant: 'label' }),
      ui.text(value, {
        wrap: true,
      }),
    ],
  )
}

function renderHint(keys: string, label: string): VNode {
  return ui.row(
    {
      gap: 1,
    },
    [ui.kbd(keys), ui.text(label, { variant: 'caption' })],
  )
}

function renderRecentEvents(state: DashboardState): VNode {
  if (!state.recentEvents.length) {
    return ui.text('No events yet.', { variant: 'caption' })
  }

  return ui.column(
    {
      gap: 1,
    },
    state.recentEvents.map((entry) =>
      ui.text(`[${entry.at}] ${entry.message}`, {
        wrap: true,
      }),
    ),
  )
}

function renderDashboardView(state: DashboardState): VNode {
  const currentFlow = state.currentFlow
  const currentFlowStatus = currentFlow?.status || 'idle'

  return ui.column(
    {
      width: 'full',
      height: 'full',
      p: 1,
      gap: 1,
    },
    compactNodes([
      ui.box(
        {
          title: 'Codey TUI',
          border: 'single',
          p: 1,
        },
        [
          ui.row(
            {
              justify: 'between',
              items: 'center',
              gap: 1,
              wrap: true,
            },
            [
              ui.column(
                {
                  gap: 0,
                },
                [
                  ui.text('Realtime operator dashboard', {
                    variant: 'heading',
                  }),
                  ui.text('Rezi view with Enquirer startup prompts.', {
                    variant: 'caption',
                  }),
                ],
              ),
              ui.row(
                {
                  gap: 1,
                  wrap: true,
                },
                [
                  ui.status(mapPhaseStatus(state.phase), {
                    label: formatPhaseLabel(state.phase),
                  }),
                  ui.badge(`auth:${toDisplayValue(state.authMode)}`, {
                    variant: mapAuthVariant(state.authMode),
                  }),
                  ui.badge(`flow:${currentFlowStatus}`, {
                    variant: mapFlowVariant(currentFlowStatus),
                  }),
                ],
              ),
            ],
          ),
        ],
      ),
      state.lastError
        ? ui.callout(state.lastError, {
            title: 'Last error',
            variant: 'error',
          })
        : undefined,
      ui.row(
        {
          gap: 1,
          wrap: true,
        },
        [
          ui.box(
            {
              title: 'Connection',
              border: 'single',
              p: 1,
              flex: 1,
              minWidth: 36,
            },
            [
              renderInfoRow('CLI', state.cliName),
              renderInfoRow('Target', toDisplayValue(state.target)),
              renderInfoRow(
                'Connection ID',
                toDisplayValue(
                  state.connectionId,
                  'waiting for /api/cli/events',
                ),
              ),
              renderInfoRow(
                'Connected',
                state.connectedAt
                  ? formatTimestamp(state.connectedAt, state.nowMs)
                  : 'connecting',
              ),
              renderInfoRow(
                'Auth',
                state.authClientId
                  ? `${toDisplayValue(state.authMode)} (${state.authClientId})`
                  : toDisplayValue(state.authMode),
              ),
            ],
          ),
          ui.box(
            {
              title: 'Runtime',
              border: 'single',
              p: 1,
              flex: 1,
              minWidth: 36,
            },
            [
              renderInfoRow(
                'Flow',
                toDisplayValue(currentFlow?.flowId, 'idle'),
              ),
              renderInfoRow('Status', currentFlowStatus),
              renderInfoRow(
                'Message',
                toDisplayValue(
                  currentFlow?.message,
                  'Waiting for a task from Codey web, or press s to start one locally.',
                ),
              ),
              renderInfoRow(
                'Started',
                formatTimestamp(currentFlow?.startedAt, state.nowMs),
              ),
              renderInfoRow(
                'Completed',
                formatTimestamp(currentFlow?.completedAt, state.nowMs),
              ),
            ],
          ),
        ],
      ),
      ui.box(
        {
          title: 'Recent Events',
          border: 'single',
          p: 1,
          flex: 1,
          overflow: 'scroll',
        },
        [renderRecentEvents(state)],
      ),
      ui.box(
        {
          border: 'single',
          p: 1,
        },
        [
          ui.column(
            {
              gap: 1,
            },
            [
              ui.text(
                'Open Codey web at /admin/cli to inspect connected clients, or press s to start a flow locally.',
                {
                  variant: 'caption',
                  wrap: true,
                },
              ),
              ui.row(
                {
                  gap: 2,
                  wrap: true,
                },
                [
                  renderHint('s', 'start local flow'),
                  renderHint('x', 'stop flow'),
                  renderHint('q', 'quit after flow'),
                  renderHint('r', 'reconnect'),
                  renderHint('c', 'clear events'),
                  renderHint('Ctrl+C', 'quit now'),
                ],
              ),
            ],
          ),
        ],
      ),
    ]),
  )
}

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
  if (error instanceof Error) {
    const message = error.message.trim()
    if (!message || /cancel/i.test(message)) {
      return new Error('TUI startup canceled.')
    }
    return error
  }

  return new Error('TUI startup canceled.')
}

function restoreTerminalState(): void {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    try {
      process.stdin.setRawMode(false)
    } catch {}
  }

  if (process.stdout.isTTY) {
    process.stdout.write(
      '\u001b[0m\u001b[?25h\u001b[?2004l\u001b[?1000l\u001b[?1002l\u001b[?1003l\u001b[?1006l\u001b[?1049l',
    )
  }

  process.stdin.pause()
}

async function promptForStartupAuth(input: {
  cliName: string
  target?: string
  reason: string
}): Promise<string | undefined> {
  let shouldLogin = false
  try {
    const loginPrompt = new Enquirer<{ shouldLogin: boolean }>()
    const answer = await loginPrompt.prompt({
      type: 'confirm',
      name: 'shouldLogin',
      message: `${input.reason}\nStart Codey device login now?`,
      initial: true,
    })
    shouldLogin = Boolean(answer.shouldLogin)
  } catch (error) {
    throw toPromptCancelError(error)
  }

  if (!shouldLogin) {
    throw new Error('TUI startup canceled.')
  }

  let target = normalizePromptTarget(input.target)
  if (!target) {
    try {
      const targetPrompt = new Enquirer<{ target: string }>()
      const answer = await targetPrompt.prompt({
        type: 'input',
        name: 'target',
        message:
          'Optional target label shown in Codey web (press Enter to skip)',
        initial: '',
      })
      target = normalizePromptTarget(answer.target)
    } catch (error) {
      throw toPromptCancelError(error)
    }
  }

  const challenge = await startDeviceLogin({
    cliName: input.cliName,
    scope: REQUIRED_TUI_SCOPE,
  })

  console.log('')
  console.log('Codey device login')
  console.log(
    `Open: ${challenge.verificationUriComplete || challenge.verificationUri}`,
  )
  console.log(`User code: ${challenge.userCode}`)
  console.log(`Expires at: ${challenge.expiresAt}`)
  console.log('Waiting for approval...')

  const approved = await exchangeDeviceChallenge(challenge, target)
  const approvedAs =
    approved.user?.githubLogin ||
    approved.user?.email ||
    approved.subject ||
    'this terminal'

  console.log(`Approved for ${approvedAs}. Launching TUI...`)
  console.log('')

  return target
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

export async function runTuiDashboard(input: {
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

  const app = createNodeApp<DashboardState>({
    initialState: createDashboardState({
      cliName: input.cliName,
      target: startup.target,
    }),
    config: {
      executionMode: 'inline',
      fpsCap: 10,
      rootPadding: 0,
    },
  })
  app.view(renderDashboardView)

  let dashboardState = createDashboardState({
    cliName: input.cliName,
    target: startup.target,
  })
  let initialAuthState: CliNotificationsAuthState | undefined =
    startup.authState
  let stopRequested = false
  let forceStopRequested = false
  let reconnectRequested = false
  let streamAbortController: AbortController | null = null
  let currentFlowAbortController: AbortController | null = null
  let runtimeReporter: CliConnectionRuntimeReporter | null = null
  let flowExecutionChain: Promise<void> = Promise.resolve()
  let localPromptInFlight = false
  let appStarted = false

  const updateState = (
    updater:
      | DashboardState
      | ((prev: Readonly<DashboardState>) => DashboardState),
  ): DashboardState => {
    const next =
      typeof updater === 'function' ? updater(dashboardState) : updater
    dashboardState = touchDashboardState(next)
    app.update(dashboardState)
    return dashboardState
  }

  const requestReconnect = () => {
    if (stopRequested) {
      return
    }

    reconnectRequested = true
    updateState((state) =>
      appendDashboardEvent(
        state,
        state.currentFlow?.status === 'running'
          ? 'Reconnect requested. Waiting for the current flow to finish.'
          : 'Reconnect requested.',
      ),
    )
    streamAbortController?.abort()
  }

  const requestGracefulStop = () => {
    if (stopRequested) {
      return
    }

    stopRequested = true
    updateState((state) =>
      appendDashboardEvent(
        state,
        state.currentFlow?.status === 'running'
          ? 'Exit requested. Waiting for the current flow to finish.'
          : 'Exit requested.',
      ),
    )

    if (dashboardState.currentFlow?.status !== 'running') {
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

    const flowAbortController = currentFlowAbortController
    updateState((state) =>
      appendDashboardEvent(
        state,
        flowAbortController
          ? `${message} Stopping the current flow now.`
          : message,
      ),
    )

    if (flowAbortController && !flowAbortController.signal.aborted) {
      flowAbortController.abort(new FlowInterruptedError(flowAbortMessage))
    }

    streamAbortController?.abort()
  }

  const requestCurrentFlowStop = () => {
    const flowAbortController = currentFlowAbortController

    if (
      dashboardState.currentFlow?.status !== 'running' ||
      !flowAbortController
    ) {
      updateState((state) =>
        appendDashboardEvent(state, 'No running flow to stop.'),
      )
      return
    }

    if (flowAbortController.signal.aborted) {
      updateState((state) =>
        appendDashboardEvent(state, 'Flow stop is already in progress.'),
      )
      return
    }

    updateState((state) =>
      appendDashboardEvent(
        state,
        `Stopping ${dashboardState.currentFlow?.flowId || 'the current flow'}...`,
      ),
    )
    flowAbortController.abort(
      new FlowInterruptedError('Flow stopped by operator.'),
    )
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
  }

  const withDashboardSuspended = async <T>(
    task: () => Promise<T>,
  ): Promise<T> => {
    if (!appStarted) {
      return task()
    }

    await app.stop()

    try {
      return await task()
    } finally {
      if (!stopRequested) {
        await app.start()
        app.update(dashboardState)
      }
    }
  }

  const runDashboardFlowTask = async (task: {
    flowId: CliFlowCommandId
    options: FlowOptions
    notificationId: string
    message: string
  }): Promise<void> => {
    const executeTask = async () => {
      const startedAt = new Date().toISOString()
      const flowAbortController = new AbortController()
      let flowSettled = false
      currentFlowAbortController = flowAbortController

      updateState((state) =>
        startDashboardFlow(state, {
          flowId: task.flowId,
          notificationId: task.notificationId,
          message: task.message,
          startedAt,
        }),
      )
      runtimeReporter?.update({
        runtimeFlowId: task.flowId,
        runtimeTaskId: task.notificationId,
        runtimeFlowStatus: 'running',
        runtimeFlowMessage: task.message,
        runtimeFlowStartedAt: startedAt,
        runtimeFlowCompletedAt: null,
      })

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
          runtimeReporter?.update({
            runtimeFlowId: task.flowId,
            runtimeTaskId: task.notificationId,
            runtimeFlowStatus:
              update.status === 'failed' ? 'failed' : 'running',
            runtimeFlowMessage: message,
            runtimeFlowStartedAt: startedAt,
          })
        }
      }

      try {
        const execution = await input.executeFlow(
          task.flowId,
          {
            ...task.options,
            progressReporter,
          },
          {
            abortSignal: flowAbortController.signal,
          },
        )
        const completedAt = execution.completedAt || new Date().toISOString()
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
      } catch (error) {
        const sanitized = sanitizeErrorForOutput(error)
        const completedAt = new Date().toISOString()

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
      } finally {
        flowSettled = true
        if (currentFlowAbortController === flowAbortController) {
          currentFlowAbortController = null
        }
        await runtimeReporter?.flush()
        setRuntimeConfig(input.config)

        if (
          (stopRequested || reconnectRequested || forceStopRequested) &&
          dashboardState.currentFlow?.status !== 'running'
        ) {
          streamAbortController?.abort()
        }
      }
    }

    const scheduled = flowExecutionChain.then(executeTask, executeTask)
    flowExecutionChain = scheduled.catch(() => undefined)
    await scheduled
  }

  const requestLocalFlowStart = () => {
    if (stopRequested) {
      return
    }

    if (localPromptInFlight) {
      updateState((state) =>
        appendDashboardEvent(state, 'Local flow launcher is already open.'),
      )
      return
    }

    if (dashboardState.currentFlow?.status === 'running') {
      updateState((state) =>
        appendDashboardEvent(
          state,
          'A flow is already running. Wait for it to finish before starting another one locally.',
        ),
      )
      return
    }

    localPromptInFlight = true
    updateState((state) =>
      appendDashboardEvent(state, 'Opening local flow launcher...'),
    )

    void (async () => {
      try {
        const task = await withDashboardSuspended(() =>
          promptForManualFlowTask(),
        )

        if (stopRequested) {
          return
        }

        if (dashboardState.currentFlow?.status === 'running') {
          updateState((state) =>
            appendDashboardEvent(
              state,
              'Another flow started while the local launcher was open. Try again once it finishes.',
            ),
          )
          return
        }

        await runDashboardFlowTask({
          flowId: task.flowId,
          options: task.options,
          notificationId: `local:${Date.now()}`,
          message: 'Local task started',
        })
      } catch (error) {
        const normalized = toPromptCancelError(error)
        const message =
          normalized.message === 'TUI startup canceled.'
            ? 'Local flow start canceled.'
            : `Local flow start failed: ${normalized.message}`
        updateState((state) => appendDashboardEvent(state, message))
      } finally {
        localPromptInFlight = false
      }
    })()
  }

  app.keys({
    s: {
      description: 'Start a local flow',
      handler: () => {
        requestLocalFlowStart()
      },
    },
    q: {
      description: 'Quit after the current flow finishes',
      handler: () => {
        requestGracefulStop()
      },
    },
    x: {
      description: 'Stop the current flow',
      handler: () => {
        requestCurrentFlowStop()
      },
    },
    r: {
      description: 'Reconnect to Codey web',
      handler: () => {
        requestReconnect()
      },
    },
    c: {
      description: 'Clear recent events',
      handler: () => {
        updateState((state) => clearDashboardEvents(state))
      },
    },
    'ctrl+c': {
      description: 'Quit immediately',
      handler: () => {
        requestImmediateStop('Immediate exit requested from Ctrl+C.')
      },
    },
  })

  const handleSigint = () => {
    handleSignalStop('SIGINT')
  }
  const handleSigterm = () => {
    handleSignalStop('SIGTERM')
  }

  process.on('SIGINT', handleSigint)
  process.on('SIGTERM', handleSigterm)

  try {
    await app.start()
    appStarted = true

    const clockInterval = setInterval(() => {
      updateState((state) => state)
    }, 1000)

    try {
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
            ? `${sanitized.message} Press q to exit and rerun codey to sign in again.`
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
              target: input.target,
            },
            authState,
            {
              onConnection: (event: CliConnectionEvent) => {
                connectionOpened = true
                connectionRuntimeReporter.setConnectionId(event.connectionId)
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

            if (
              notification.payload?.kind !== 'flow_task' ||
              typeof notification.payload.flowId !== 'string'
            ) {
              if (stopRequested) {
                break
              }
              continue
            }

            const flowId = notification.payload.flowId as CliFlowCommandId
            const taskOptions = (notification.payload.options ||
              {}) as FlowOptions
            await runDashboardFlowTask({
              flowId,
              options: taskOptions,
              notificationId: notification.id,
              message: notification.title || 'Task started',
            })

            if (stopRequested) {
              break
            }
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
          runtimeReporter = null
        }

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
    } finally {
      clearInterval(clockInterval)
    }
  } finally {
    streamAbortController?.abort()
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)

    if (appStarted) {
      await app.stop()
    }
    app.dispose()
    restoreTerminalState()
  }
}
