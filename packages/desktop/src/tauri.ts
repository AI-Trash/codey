import { invoke } from '@tauri-apps/api/core'

export type TaskStatus = 'queued' | 'running' | 'passed' | 'failed' | 'canceled'

export interface TaskLogLine {
  at: number
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

export interface DesktopTask {
  id: string
  kind: 'flow'
  flowId?: string
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
}

export interface DesktopSettings {
  concurrency: number
  target?: string
  appBaseUrl?: string
}

export interface DesktopSnapshot {
  workspaceRoot: string
  settings: DesktopSettings
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
