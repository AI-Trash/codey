import { invoke } from '@tauri-apps/api/core'

export type TaskStatus = 'queued' | 'running' | 'passed' | 'failed' | 'canceled'
export type WebConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type TokenEndpointAuthMethod = 'client_secret_basic' | 'client_secret_post'

export interface TaskLogLine {
  at: number
  stream: 'stdout' | 'stderr' | 'system' | 'event'
  text: string
}

export interface DesktopTask {
  id: string
  kind: 'flow'
  flowId?: string
  remoteTaskId?: string
  remoteConnectionId?: string
  title: string
  payload: Record<string, unknown>
  config: Record<string, unknown>
  status: TaskStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
  pid?: number
  exitCode?: number
  message?: string
  logs: TaskLogLine[]
  cancelRequested?: boolean
}

export interface DesktopSettings {
  concurrency: number
  target?: string
  appBaseUrl?: string
  appClientId?: string
  appClientSecret?: string
  cliName?: string
  cliWebSocketPath?: string
  oidcIssuer?: string
  oidcBasePath?: string
  tokenEndpointAuthMethod?: TokenEndpointAuthMethod
}

export interface WebConnectionSnapshot {
  status: WebConnectionStatus
  message?: string
  connectionId?: string
  workerId?: string
  cliName?: string
  target?: string
  browserLimit?: number
  connectedAt?: string
  lastError?: string
}

export interface DesktopSnapshot {
  workspaceRoot: string
  settings: DesktopSettings
  webConnection: WebConnectionSnapshot
  tasks: DesktopTask[]
}

export interface EnqueueFlowTaskInput {
  flowId: string
  config: Record<string, unknown>
  title?: string
}

export interface UpdateSettingsInput {
  concurrency?: number
  target?: string
  appBaseUrl?: string
  appClientId?: string
  appClientSecret?: string
  cliName?: string
  cliWebSocketPath?: string
  oidcIssuer?: string
  oidcBasePath?: string
  tokenEndpointAuthMethod?: TokenEndpointAuthMethod
}

export function getDesktopState(): Promise<DesktopSnapshot> {
  return invoke('get_desktop_state')
}

export function enqueueFlowTask(input: EnqueueFlowTaskInput): Promise<DesktopTask> {
  return invoke('enqueue_flow_task', { input })
}

export function cancelTask(taskId: string): Promise<DesktopTask | null> {
  return invoke('cancel_task', { taskId })
}

export function updateSettings(input: UpdateSettingsInput): Promise<DesktopSettings> {
  return invoke('update_desktop_settings', { input })
}

export function clearFinishedTasks(): Promise<DesktopSnapshot> {
  return invoke('clear_finished_tasks')
}

export function connectCodeyWeb(): Promise<WebConnectionSnapshot> {
  return invoke('connect_codey_web')
}

export function disconnectCodeyWeb(): Promise<WebConnectionSnapshot> {
  return invoke('disconnect_codey_web')
}
