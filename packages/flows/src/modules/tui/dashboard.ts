import type { CliRuntimeConfig } from '../../config'
import type { CliFlowCommandId } from '../flow-cli/flow-registry'
import {
  formatFlowCompletionSummary,
  sanitizeErrorForOutput,
  type FlowOptions,
  type FlowProgressReporter,
  type FlowProgressUpdate,
} from '../flow-cli/helpers'
import type { FlowCommandExecution } from '../flow-cli/result-file'
import type {
  AdminNotificationEvent,
  CliConnectionEvent,
} from '../app-auth/types'
import {
  resolveCliNotificationsAuthState,
  streamCliNotifications,
} from '../app-auth/device-login'
import { CliConnectionRuntimeReporter } from '../app-auth/cli-connection'
import { sleep } from '../../utils/wait'
import { setRuntimeConfig } from '../../config'

type DashboardPhase = 'starting' | 'listening' | 'reconnecting' | 'error'
type DashboardFlowStatus = 'idle' | 'running' | 'passed' | 'failed'

interface DashboardEventLogEntry {
  at: string
  message: string
}

interface DashboardFlowState {
  flowId: string
  status: DashboardFlowStatus
  notificationId?: string
  message?: string
  startedAt?: string
  completedAt?: string
}

interface DashboardState {
  phase: DashboardPhase
  cliName: string
  target?: string
  connectionId?: string
  connectedAt?: string
  authMode?: string
  authClientId?: string
  lastError?: string
  currentFlow: DashboardFlowState | null
  recentEvents: DashboardEventLogEntry[]
  snapshotAt: string
}

function truncate(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) {
    return value
  }

  if (maxWidth <= 1) {
    return value.slice(0, maxWidth)
  }

  return `${value.slice(0, Math.max(maxWidth - 1, 0))}…`
}

function formatRelativeTime(value: string | undefined): string {
  if (!value) {
    return 'n/a'
  }

  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return value
  }

  const deltaSeconds = Math.max(Math.round((Date.now() - timestamp) / 1000), 0)
  if (deltaSeconds < 5) {
    return 'just now'
  }
  if (deltaSeconds < 60) {
    return `${deltaSeconds}s ago`
  }

  const deltaMinutes = Math.round(deltaSeconds / 60)
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`
  }

  const deltaHours = Math.round(deltaMinutes / 60)
  if (deltaHours < 24) {
    return `${deltaHours}h ago`
  }

  const deltaDays = Math.round(deltaHours / 24)
  return `${deltaDays}d ago`
}

function formatProgressMessage(update: FlowProgressUpdate): string | undefined {
  if (typeof update.message === 'string' && update.message.trim()) {
    return update.message.trim()
  }

  if (typeof update.state === 'string' && update.state.trim()) {
    return update.state.trim()
  }

  if (typeof update.event === 'string' && update.event.trim()) {
    return update.event.trim()
  }

  return update.status
}

function createDashboardRenderer(state: DashboardState) {
  const isInteractive =
    Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY)

  const render = () => {
    if (!isInteractive) {
      return
    }

    state.snapshotAt = new Date().toISOString()

    const width = Math.max(process.stdout.columns || 100, 72)
    const lines = [
      'Codey TUI',
      ''.padEnd(Math.min(width, 72), '='),
      `Connection: ${state.phase}`,
      `CLI: ${state.cliName}`,
      `Target: ${state.target || 'n/a'}`,
      `Connection ID: ${state.connectionId || 'waiting for /api/cli/events'}`,
      `Connected: ${
        state.connectedAt
          ? `${state.connectedAt} (${formatRelativeTime(state.connectedAt)})`
          : 'connecting'
      }`,
      `Auth: ${state.authMode || 'n/a'}${state.authClientId ? ` (${state.authClientId})` : ''}`,
      ...(state.lastError ? [`Last error: ${state.lastError}`] : []),
      '',
      'Runtime',
      `Flow: ${state.currentFlow?.flowId || 'idle'}`,
      `Status: ${state.currentFlow?.status || 'idle'}`,
      `Message: ${state.currentFlow?.message || 'Waiting for a task from Codey web...'}`,
      `Started: ${
        state.currentFlow?.startedAt
          ? `${state.currentFlow.startedAt} (${formatRelativeTime(state.currentFlow.startedAt)})`
          : 'n/a'
      }`,
      `Completed: ${
        state.currentFlow?.completedAt
          ? `${state.currentFlow.completedAt} (${formatRelativeTime(state.currentFlow.completedAt)})`
          : 'n/a'
      }`,
      '',
      'Recent Events',
      ...(state.recentEvents.length
        ? state.recentEvents.map((entry) =>
            truncate(`[${entry.at}] ${entry.message}`, width),
          )
        : ['No events yet.']),
      '',
      'Open Codey web at /admin/cli to inspect connected clients.',
      'Press Ctrl+C to exit.',
    ]

    process.stdout.write('\x1Bc')
    process.stdout.write(`${lines.join('\n')}\n`)
  }

  if (isInteractive) {
    process.stdout.write('\x1b[?25l')
    process.once('exit', () => {
      process.stdout.write('\x1b[?25h')
    })
  }

  return {
    interactive: isInteractive,
    render,
  }
}

function appendEvent(state: DashboardState, message: string): void {
  state.recentEvents.unshift({
    at: new Date().toISOString(),
    message,
  })
  state.recentEvents = state.recentEvents.slice(0, 8)
}

export async function runTuiDashboard(input: {
  cliName: string
  target?: string
  config: CliRuntimeConfig
  executeFlow: (
    flowId: CliFlowCommandId,
    options: FlowOptions,
  ) => Promise<FlowCommandExecution>
}): Promise<void> {
  const state: DashboardState = {
    phase: 'starting',
    cliName: input.cliName,
    target: input.target,
    currentFlow: null,
    recentEvents: [],
    snapshotAt: new Date().toISOString(),
  }
  const renderer = createDashboardRenderer(state)
  const refreshInterval = renderer.interactive
    ? setInterval(() => {
        renderer.render()
      }, 1000)
    : null

  try {
    renderer.render()

    let announced = false

    while (true) {
      setRuntimeConfig(input.config)
      state.phase = announced ? 'reconnecting' : 'starting'
      state.lastError = undefined
      renderer.render()

      const authState = await resolveCliNotificationsAuthState()
      state.authMode = authState.mode
      state.authClientId = authState.clientId
      state.target =
        input.target ||
        authState.session?.target ||
        authState.session?.user?.githubLogin ||
        authState.session?.user?.email ||
        authState.session?.subject ||
        state.target
      renderer.render()

      const runtimeReporter = new CliConnectionRuntimeReporter({
        authState,
        onError: (error) => {
          appendEvent(state, `runtime state update failed: ${error.message}`)
          renderer.render()
        },
      })

      appendEvent(
        state,
        announced
          ? 'Reconnecting to Codey web app...'
          : 'Connecting to Codey web app...',
      )
      renderer.render()

      try {
        for await (const notification of streamCliNotifications(
          {
            cliName: input.cliName,
            target: input.target,
          },
          authState,
          {
            onConnection: (event: CliConnectionEvent) => {
              state.phase = 'listening'
              state.connectionId = event.connectionId
              state.connectedAt = event.connectedAt
              state.target = event.target || state.target
              runtimeReporter.setConnectionId(event.connectionId)
              appendEvent(
                state,
                `Connected to Codey web app as ${input.cliName}.`,
              )
              renderer.render()
            },
          },
        )) {
          announced = true
          handleNotification(state, notification)
          renderer.render()

          if (
            notification.payload?.kind !== 'flow_task' ||
            typeof notification.payload.flowId !== 'string'
          ) {
            continue
          }

          const flowId = notification.payload.flowId as CliFlowCommandId
          const taskOptions = (notification.payload.options ||
            {}) as FlowOptions
          const startedAt = new Date().toISOString()

          state.currentFlow = {
            flowId,
            status: 'running',
            notificationId: notification.id,
            message: notification.title || 'Task started',
            startedAt,
          }
          appendEvent(state, `Starting ${flowId}.`)
          runtimeReporter.update({
            runtimeFlowId: flowId,
            runtimeTaskId: notification.id,
            runtimeFlowStatus: 'running',
            runtimeFlowMessage: notification.title || 'Task started',
            runtimeFlowStartedAt: startedAt,
            runtimeFlowCompletedAt: null,
          })
          renderer.render()

          const progressReporter: FlowProgressReporter = (update) => {
            const message = formatProgressMessage(update)
            if (!state.currentFlow) {
              return
            }

            state.currentFlow = {
              ...state.currentFlow,
              status: update.status === 'failed' ? 'failed' : 'running',
              message: message || state.currentFlow.message,
            }
            if (message) {
              runtimeReporter.update({
                runtimeFlowId: flowId,
                runtimeTaskId: notification.id,
                runtimeFlowStatus:
                  update.status === 'failed' ? 'failed' : 'running',
                runtimeFlowMessage: message,
                runtimeFlowStartedAt: startedAt,
              })
            }
            renderer.render()
          }

          try {
            const execution = await input.executeFlow(flowId, {
              ...taskOptions,
              progressReporter,
            })
            const completedAt =
              execution.completedAt || new Date().toISOString()
            const summary =
              formatFlowCompletionSummary(execution.command, execution.result)
                .split('\n')
                .find((line) => line.trim()) || 'Flow completed'
            state.currentFlow = {
              ...state.currentFlow,
              flowId,
              status: 'passed',
              message: summary,
              completedAt,
            }
            appendEvent(state, `${flowId} completed.`)
            runtimeReporter.update({
              runtimeFlowId: flowId,
              runtimeTaskId: notification.id,
              runtimeFlowStatus: execution.status,
              runtimeFlowMessage: 'Flow completed',
              runtimeFlowStartedAt: startedAt,
              runtimeFlowCompletedAt: completedAt,
            })
          } catch (error) {
            const sanitized = sanitizeErrorForOutput(error)
            const completedAt = new Date().toISOString()
            state.currentFlow = {
              ...state.currentFlow,
              flowId,
              status: 'failed',
              message: sanitized.message,
              completedAt,
            }
            appendEvent(state, `${flowId} failed: ${sanitized.message}`)
            runtimeReporter.update({
              runtimeFlowId: flowId,
              runtimeTaskId: notification.id,
              runtimeFlowStatus: 'failed',
              runtimeFlowMessage: sanitized.message,
              runtimeFlowStartedAt: startedAt,
              runtimeFlowCompletedAt: completedAt,
            })
          } finally {
            await runtimeReporter.flush()
            setRuntimeConfig(input.config)
            renderer.render()
          }
        }
      } catch (error) {
        const sanitized = sanitizeErrorForOutput(error)
        state.phase = 'error'
        state.lastError = sanitized.message
        appendEvent(state, `Connection lost: ${sanitized.message}`)
        renderer.render()
      }

      await sleep(1000)
    }
  } finally {
    if (refreshInterval) {
      clearInterval(refreshInterval)
    }
  }
}

function handleNotification(
  state: DashboardState,
  notification: AdminNotificationEvent,
): void {
  const title = notification.title?.trim()
  const body = notification.body?.trim()
  if (title && body) {
    appendEvent(state, `${title}: ${body}`)
    return
  }

  if (title) {
    appendEvent(state, title)
    return
  }

  if (body) {
    appendEvent(state, body)
  }
}
