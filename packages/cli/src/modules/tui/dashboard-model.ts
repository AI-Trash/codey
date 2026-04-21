import type { CliNotificationsAuthState } from '../app-auth/device-login'
import type {
  AdminNotificationEvent,
  CliConnectionEvent,
} from '../app-auth/types'
import type { FlowProgressUpdate } from '../flow-cli/helpers'

export type DashboardPhase = 'starting' | 'listening' | 'reconnecting' | 'error'
export type DashboardFlowStatus = 'idle' | 'running' | 'passed' | 'failed'

export interface DashboardEventLogEntry {
  at: string
  message: string
}

export interface DashboardFlowState {
  flowId: string
  status: DashboardFlowStatus
  notificationId?: string
  message?: string
  startedAt?: string
  completedAt?: string
}

export interface DashboardState {
  phase: DashboardPhase
  cliName: string
  target?: string
  connectionId?: string
  connectedAt?: string
  authMode?: string
  authClientId?: string
  lastError?: string
  activeFlowCount: number
  queuedFlowCount: number
  currentFlow: DashboardFlowState | null
  recentEvents: DashboardEventLogEntry[]
  nowMs: number
}

export const MAX_RECENT_EVENTS = 8
const REQUIRED_TUI_SCOPE = 'notifications:read'

function normalizeOptionalText(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized ? normalized : undefined
}

export function createDashboardState(input: {
  cliName: string
  target?: string
}): DashboardState {
  return {
    phase: 'starting',
    cliName: input.cliName,
    target: normalizeOptionalText(input.target),
    activeFlowCount: 0,
    queuedFlowCount: 0,
    currentFlow: null,
    recentEvents: [],
    nowMs: Date.now(),
  }
}

export function touchDashboardState(state: DashboardState): DashboardState {
  return {
    ...state,
    nowMs: Date.now(),
  }
}

export function clearDashboardEvents(state: DashboardState): DashboardState {
  return {
    ...state,
    recentEvents: [],
  }
}

export function setDashboardTaskCounts(
  state: DashboardState,
  input: {
    activeFlowCount: number
    queuedFlowCount: number
  },
): DashboardState {
  return {
    ...state,
    activeFlowCount: Math.max(input.activeFlowCount, 0),
    queuedFlowCount: Math.max(input.queuedFlowCount, 0),
  }
}

export function setDashboardPhase(
  state: DashboardState,
  phase: DashboardPhase,
  lastError?: string,
): DashboardState {
  return {
    ...state,
    phase,
    lastError: normalizeOptionalText(lastError),
  }
}

export function deriveTargetFromAuthState(
  authState: CliNotificationsAuthState,
): string | undefined {
  return (
    normalizeOptionalText(authState.session?.target) ||
    normalizeOptionalText(authState.session?.user?.githubLogin) ||
    normalizeOptionalText(authState.session?.user?.email) ||
    normalizeOptionalText(authState.session?.subject)
  )
}

export function applyAuthStateToDashboard(
  state: DashboardState,
  authState: CliNotificationsAuthState,
): DashboardState {
  return {
    ...state,
    authMode: authState.mode,
    authClientId: normalizeOptionalText(authState.clientId),
    target: state.target || deriveTargetFromAuthState(authState),
  }
}

export function appendDashboardEvent(
  state: DashboardState,
  message: string,
): DashboardState {
  const normalized = normalizeOptionalText(message)
  if (!normalized) {
    return state
  }

  return {
    ...state,
    recentEvents: [
      {
        at: new Date().toISOString(),
        message: normalized,
      },
      ...state.recentEvents,
    ].slice(0, MAX_RECENT_EVENTS),
  }
}

export function applyCliConnectionEvent(
  state: DashboardState,
  event: CliConnectionEvent,
): DashboardState {
  return appendDashboardEvent(
    {
      ...state,
      phase: 'listening',
      connectionId: event.connectionId,
      connectedAt: event.connectedAt,
      target: normalizeOptionalText(event.target) || state.target,
      lastError: undefined,
    },
    `Connected to Codey web app as ${state.cliName}.`,
  )
}

export function handleDashboardNotification(
  state: DashboardState,
  notification: AdminNotificationEvent,
): DashboardState {
  const title = normalizeOptionalText(notification.title)
  const body = normalizeOptionalText(notification.body)

  if (title && body) {
    return appendDashboardEvent(state, `${title}: ${body}`)
  }

  if (title) {
    return appendDashboardEvent(state, title)
  }

  if (body) {
    return appendDashboardEvent(state, body)
  }

  return state
}

export function startDashboardFlow(
  state: DashboardState,
  input: {
    flowId: string
    notificationId: string
    message?: string
    startedAt: string
  },
): DashboardState {
  return appendDashboardEvent(
    {
      ...state,
      currentFlow: {
        flowId: input.flowId,
        status: 'running',
        notificationId: input.notificationId,
        message: normalizeOptionalText(input.message) || 'Task started',
        startedAt: input.startedAt,
      },
      lastError: undefined,
    },
    `Starting ${input.flowId}.`,
  )
}

export function updateDashboardFlowProgress(
  state: DashboardState,
  input: {
    status: FlowProgressUpdate['status']
    message?: string
  },
): DashboardState {
  if (!state.currentFlow) {
    return state
  }

  return {
    ...state,
    currentFlow: {
      ...state.currentFlow,
      status: input.status === 'failed' ? 'failed' : 'running',
      message:
        normalizeOptionalText(input.message) || state.currentFlow.message,
    },
  }
}

export function completeDashboardFlow(
  state: DashboardState,
  input: {
    flowId: string
    message?: string
    completedAt: string
  },
): DashboardState {
  return appendDashboardEvent(
    {
      ...state,
      currentFlow: {
        ...(state.currentFlow || {
          flowId: input.flowId,
          status: 'passed' as const,
        }),
        flowId: input.flowId,
        status: 'passed',
        message: normalizeOptionalText(input.message) || 'Flow completed',
        completedAt: input.completedAt,
      },
    },
    `${input.flowId} completed.`,
  )
}

export function failDashboardFlow(
  state: DashboardState,
  input: {
    flowId: string
    message: string
    completedAt: string
  },
): DashboardState {
  const normalized = normalizeOptionalText(input.message) || 'Flow failed'
  return appendDashboardEvent(
    {
      ...state,
      currentFlow: {
        ...(state.currentFlow || {
          flowId: input.flowId,
          status: 'failed' as const,
        }),
        flowId: input.flowId,
        status: 'failed',
        message: normalized,
        completedAt: input.completedAt,
      },
      lastError: normalized,
    },
    `${input.flowId} failed: ${normalized}`,
  )
}

export function formatRelativeTime(
  value: string | undefined,
  nowMs = Date.now(),
): string {
  if (!value) {
    return 'n/a'
  }

  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return value
  }

  const deltaSeconds = Math.max(Math.round((nowMs - timestamp) / 1000), 0)
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

export function formatProgressMessage(
  update: FlowProgressUpdate,
): string | undefined {
  return (
    normalizeOptionalText(update.message) ||
    normalizeOptionalText(update.state) ||
    normalizeOptionalText(update.event) ||
    normalizeOptionalText(update.status)
  )
}

export function isTuiAuthRecoveryError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : normalizeOptionalText(String(error))

  if (!message) {
    return false
  }

  return (
    /No stored app session found/i.test(message) ||
    /Stored app session is expired/i.test(message) ||
    new RegExp(`missing the required ${REQUIRED_TUI_SCOPE} scope`, 'i').test(
      message,
    )
  )
}
