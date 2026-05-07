import { listen } from '@tauri-apps/api/event'
import { check } from '@tauri-apps/plugin-updater'
import {
  Activity,
  CircleStop,
  Download,
  Layers,
  Link,
  Link2Off,
  Play,
  RefreshCcw,
  RotateCw,
  SquareTerminal,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { flowDefinitions, getFlowDefinition, type FlowField } from './flows'
import { t } from './i18n'
import {
  cancelTask,
  clearFinishedTasks,
  connectCodeyWeb,
  disconnectCodeyWeb,
  enqueueFlowTask,
  getDesktopState,
  updateSettings,
  type DesktopSettings,
  type DesktopSnapshot,
  type DesktopTask,
  type TaskLogLine,
  type TaskStatus,
  type WebConnectionSnapshot,
  type WebConnectionStatus,
} from './tauri'

type FormValue = string | number | boolean | string[]

const statusLabels: Record<TaskStatus, string> = {
  queued: t('queued'),
  running: t('running'),
  passed: t('passed'),
  failed: t('failed'),
  canceled: t('canceled'),
}

const webStatusLabels: Record<WebConnectionStatus, string> = {
  disconnected: t('disconnected'),
  connecting: t('connecting'),
  connected: t('connected'),
  error: t('failed'),
}

const terminalLineLimit = 500

function formatTime(value?: number): string {
  if (!value) {
    return t('none')
  }

  return new Date(value).toLocaleString()
}

function normalizeInputValue(field: FlowField, value: FormValue | undefined): unknown {
  if (value === undefined || value === '') {
    return undefined
  }

  if (field.type === 'stringList') {
    if (Array.isArray(value)) {
      return value.length ? value : undefined
    }

    if (typeof value !== 'string') {
      return undefined
    }

    const items = value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
    return items.length ? items : undefined
  }

  if (field.type === 'number') {
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return value
}

function taskSortValue(task: DesktopTask): number {
  if (task.status === 'running') {
    return 0
  }

  if (task.status === 'queued') {
    return 1
  }

  return 2
}

function patchTasks(tasks: DesktopTask[], nextTask: DesktopTask): DesktopTask[] {
  const next = tasks.some((task) => task.id === nextTask.id)
    ? tasks.map((task) => (task.id === nextTask.id ? nextTask : task))
    : [nextTask, ...tasks]

  return [...next].sort((left, right) => {
    const statusDelta = taskSortValue(left) - taskSortValue(right)
    return statusDelta || right.createdAt - left.createdAt
  })
}

function mergeTaskLog(tasks: DesktopTask[], payload: TaskLogEvent): DesktopTask[] {
  return tasks.map((task) => {
    if (task.id !== payload.taskId) {
      return task
    }

    return {
      ...task,
      logs: [...task.logs, payload.line].slice(-terminalLineLimit),
    }
  })
}

interface TaskLogEvent {
  taskId: string
  line: TaskLogLine
}

interface UpdateStatus {
  phase: 'idle' | 'checking' | 'ready' | 'installing' | 'done' | 'error'
  message: string
}

function App() {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null)
  const [webConnection, setWebConnection] = useState<WebConnectionSnapshot>({
    status: 'disconnected',
  })
  const [tasks, setTasks] = useState<DesktopTask[]>([])
  const [selectedFlowId, setSelectedFlowId] = useState(flowDefinitions[0]?.id || '')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<Record<string, FormValue>>({})
  const [settingsDraft, setSettingsDraft] = useState<DesktopSettings>({
    concurrency: 2,
  })
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    phase: 'idle',
    message: '',
  })

  const selectedFlow = useMemo(
    () => getFlowDefinition(selectedFlowId) || flowDefinitions[0],
    [selectedFlowId],
  )
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || tasks[0],
    [selectedTaskId, tasks],
  )

  const loadState = useCallback(async () => {
    const next = await getDesktopState()
    setSnapshot(next)
    setWebConnection(next.webConnection)
    setTasks(next.tasks)
    setSettingsDraft(next.settings)
    setSelectedTaskId((current) => current || next.tasks[0]?.id || null)
  }, [])

  useEffect(() => {
    void loadState()

    const unlisteners = [
      listen<DesktopTask>('task-changed', (event) => {
        setTasks((current) => patchTasks(current, event.payload))
        setSelectedTaskId((current) => current || event.payload.id)
      }),
      listen<TaskLogEvent>('task-log', (event) => {
        setTasks((current) => mergeTaskLog(current, event.payload))
      }),
      listen<WebConnectionSnapshot>('web-connection-changed', (event) => {
        setWebConnection(event.payload)
        setSnapshot((current) =>
          current
            ? {
                ...current,
                webConnection: event.payload,
              }
            : current,
        )
      }),
    ]

    return () => {
      void Promise.all(unlisteners).then((items) => {
        for (const unlisten of items) {
          unlisten()
        }
      })
    }
  }, [loadState])

  useEffect(() => {
    setFormValues({})
  }, [selectedFlowId])

  async function saveSettings(next: Partial<DesktopSettings>) {
    const saved = await updateSettings(next)
    setSettingsDraft(saved)
    setSnapshot((current) =>
      current
        ? {
            ...current,
            settings: saved,
          }
        : current,
    )
  }

  async function queueSelectedFlow() {
    if (!selectedFlow) {
      return
    }

    const config = selectedFlow.fields.reduce<Record<string, unknown>>(
      (output, field) => {
        const normalized = normalizeInputValue(field, formValues[field.key])
        if (normalized !== undefined) {
          output[field.key] = normalized
        }
        return output
      },
      {},
    )

    const task = await enqueueFlowTask({
      flowId: selectedFlow.id,
      config,
      title: selectedFlow.label,
    })
    setTasks((current) => patchTasks(current, task))
    setSelectedTaskId(task.id)
  }

  async function handleCancelTask(taskId: string) {
    const task = await cancelTask(taskId)
    if (task) {
      setTasks((current) => patchTasks(current, task))
    }
  }

  async function handleClearFinished() {
    const next = await clearFinishedTasks()
    setSnapshot(next)
    setWebConnection(next.webConnection)
    setTasks(next.tasks)
    setSelectedTaskId(next.tasks[0]?.id || null)
  }

  async function handleConnectWeb() {
    const next = await connectCodeyWeb()
    setWebConnection(next)
    setSnapshot((current) =>
      current
        ? {
            ...current,
            webConnection: next,
          }
        : current,
    )
  }

  async function handleDisconnectWeb() {
    const next = await disconnectCodeyWeb()
    setWebConnection(next)
    setSnapshot((current) =>
      current
        ? {
            ...current,
            webConnection: next,
          }
        : current,
    )
  }

  async function handleCheckUpdates() {
    setUpdateStatus({ phase: 'checking', message: t('updateChecking') })

    try {
      const update = await check()
      if (!update) {
        setUpdateStatus({ phase: 'done', message: t('noUpdate') })
        return
      }

      setUpdateStatus({
        phase: 'ready',
        message: `${t('updateReady')}: ${update.version}`,
      })
    } catch (error) {
      setUpdateStatus({
        phase: 'error',
        message:
          error instanceof Error ? error.message : t('updateNotConfigured'),
      })
    }
  }

  async function handleInstallUpdate() {
    setUpdateStatus({ phase: 'installing', message: t('updateInstalling') })

    try {
      const update = await check()
      if (!update) {
        setUpdateStatus({ phase: 'done', message: t('noUpdate') })
        return
      }

      await update.downloadAndInstall()
      setUpdateStatus({ phase: 'done', message: t('installUpdate') })
    } catch (error) {
      setUpdateStatus({
        phase: 'error',
        message:
          error instanceof Error ? error.message : t('updateNotConfigured'),
      })
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label={t('flows')}>
        <div className="brand-block">
          <div className="brand-mark">
            <Activity size={24} />
          </div>
          <div>
            <h1>{t('appTitle')}</h1>
            <p>{t('appSubtitle')}</p>
          </div>
        </div>

        <section className="sidebar-section">
          <div className="section-heading">
            <Layers size={16} />
            <span>{t('flows')}</span>
          </div>
          <div className="flow-list">
            {flowDefinitions.map((flow) => (
              <button
                key={flow.id}
                className={`flow-button ${
                  selectedFlowId === flow.id ? 'is-selected' : ''
                }`}
                onClick={() => setSelectedFlowId(flow.id)}
                type="button"
                title={flow.description}
              >
                <span>{flow.label}</span>
                <small>{flow.runtime}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section update-panel">
          <div className="section-heading">
            <Download size={16} />
            <span>{t('settings')}</span>
          </div>
          <label className="field-label">
            {t('concurrency')}
            <input
              min={1}
              max={10}
              type="number"
              value={settingsDraft.concurrency}
              onChange={(event) => {
                const concurrency = Number(event.target.value)
                void saveSettings({ concurrency })
              }}
            />
          </label>
          <div className="button-row">
            <button className="icon-text-button" onClick={handleCheckUpdates} type="button">
              <RefreshCcw size={16} />
              {t('checkUpdates')}
            </button>
            <button
              className="icon-button"
              disabled={updateStatus.phase === 'installing'}
              onClick={handleInstallUpdate}
              title={t('installUpdate')}
              type="button"
            >
              <RotateCw size={16} />
            </button>
          </div>
          {updateStatus.message ? (
            <p className={`update-status ${updateStatus.phase}`}>
              {updateStatus.message}
            </p>
          ) : null}
        </section>
      </aside>

      <section className="main-column">
        <div className="top-grid">
          <section className="panel flow-panel">
            <div className="panel-title-row">
              <div>
                <p className="eyebrow">{t('flowConfig')}</p>
                <h2>{selectedFlow?.label || t('chooseFlow')}</h2>
              </div>
              <button className="primary-button" onClick={queueSelectedFlow} type="button">
                <Play size={17} />
                {t('enqueue')}
              </button>
            </div>
            <p className="panel-copy">{selectedFlow?.description}</p>
            <FieldGrid
              fields={selectedFlow?.fields || []}
              values={formValues}
              onChange={(key, value) =>
                setFormValues((current) => ({ ...current, [key]: value }))
              }
            />
          </section>

          <section className="panel runtime-panel">
            <div className="panel-title-row">
              <div>
                <p className="eyebrow">{t('runMode')}</p>
                <h2>{t('runtime')}</h2>
              </div>
              <Activity size={22} />
            </div>
            <p className="panel-copy">{t('runtimeHint')}</p>
            <div className="runtime-grid">
              <label className="field-label">
                {t('target')}
                <input
                  value={settingsDraft.target || ''}
                  onBlur={() => void saveSettings({ target: settingsDraft.target })}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      target: event.target.value,
                    }))
                  }
                  placeholder={t('textPlaceholder')}
                />
              </label>
              <label className="field-label wide">
                {t('appBaseUrl')}
                <input
                  value={settingsDraft.appBaseUrl || ''}
                  onBlur={() => void saveSettings({ appBaseUrl: settingsDraft.appBaseUrl })}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      appBaseUrl: event.target.value,
                    }))
                  }
                  placeholder="http://localhost:3000"
                />
              </label>
            </div>
          </section>

          <section className="panel web-panel">
            <div className="panel-title-row">
              <div>
                <p className="eyebrow">{t('webConnection')}</p>
                <h2>{webStatusLabels[webConnection.status]}</h2>
              </div>
              <button
                className={webConnection.status === 'connected' ? 'icon-button danger' : 'primary-button'}
                disabled={webConnection.status === 'connecting'}
                onClick={
                  webConnection.status === 'connected'
                    ? () => void handleDisconnectWeb()
                    : () => void handleConnectWeb()
                }
                title={
                  webConnection.status === 'connected'
                    ? t('disconnectWeb')
                    : t('connectWeb')
                }
                type="button"
              >
                {webConnection.status === 'connected' ? (
                  <Link2Off size={17} />
                ) : (
                  <Link size={17} />
                )}
                {webConnection.status === 'connected'
                  ? t('disconnectWeb')
                  : t('connectWeb')}
              </button>
            </div>
            <p className="panel-copy">
              {webConnection.message || t('webConnectionHint')}
            </p>
            <div className="connection-summary">
              <StatusMetric label={t('connectionId')} value={webConnection.connectionId} />
              <StatusMetric label={t('workerId')} value={webConnection.workerId} />
              <StatusMetric
                label={t('browserLimit')}
                value={webConnection.browserLimit?.toString()}
              />
              <StatusMetric label={t('connectedAt')} value={webConnection.connectedAt} />
            </div>
            <div className="runtime-grid">
              <label className="field-label">
                {t('cliName')}
                <input
                  value={settingsDraft.cliName || 'Codey Desktop'}
                  onBlur={() => void saveSettings({ cliName: settingsDraft.cliName })}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      cliName: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field-label">
                {t('tokenEndpointAuthMethod')}
                <select
                  value={settingsDraft.tokenEndpointAuthMethod || 'client_secret_basic'}
                  title={t('tokenEndpointAuthMethod')}
                  onChange={(event) => {
                    const tokenEndpointAuthMethod = event.target
                      .value as DesktopSettings['tokenEndpointAuthMethod']
                    setSettingsDraft((current) => ({
                      ...current,
                      tokenEndpointAuthMethod,
                    }))
                    void saveSettings({ tokenEndpointAuthMethod })
                  }}
                >
                  <option value="client_secret_basic">{t('clientSecretBasic')}</option>
                  <option value="client_secret_post">{t('clientSecretPost')}</option>
                </select>
              </label>
              <label className="field-label">
                {t('appClientId')}
                <input
                  value={settingsDraft.appClientId || ''}
                  onBlur={() => void saveSettings({ appClientId: settingsDraft.appClientId })}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      appClientId: event.target.value,
                    }))
                  }
                  placeholder={t('textPlaceholder')}
                />
              </label>
              <label className="field-label">
                {t('appClientSecret')}
                <input
                  type="password"
                  value={settingsDraft.appClientSecret || ''}
                  onBlur={() =>
                    void saveSettings({
                      appClientSecret: settingsDraft.appClientSecret,
                    })
                  }
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      appClientSecret: event.target.value,
                    }))
                  }
                  placeholder={t('textPlaceholder')}
                />
              </label>
              <label className="field-label">
                {t('cliWebSocketPath')}
                <input
                  value={settingsDraft.cliWebSocketPath || '/api/cli/ws'}
                  onBlur={() =>
                    void saveSettings({
                      cliWebSocketPath: settingsDraft.cliWebSocketPath,
                    })
                  }
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      cliWebSocketPath: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field-label">
                {t('oidcBasePath')}
                <input
                  value={settingsDraft.oidcBasePath || '/oidc'}
                  onBlur={() => void saveSettings({ oidcBasePath: settingsDraft.oidcBasePath })}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      oidcBasePath: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field-label wide">
                {t('oidcIssuer')}
                <input
                  value={settingsDraft.oidcIssuer || ''}
                  onBlur={() => void saveSettings({ oidcIssuer: settingsDraft.oidcIssuer })}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      oidcIssuer: event.target.value,
                    }))
                  }
                  placeholder={t('textPlaceholder')}
                />
              </label>
            </div>
          </section>
        </div>

        <section className="tasks-layout">
          <div className="panel task-panel">
            <div className="panel-title-row compact">
              <div>
                <p className="eyebrow">{snapshot?.workspaceRoot || t('workspaceRoot')}</p>
                <h2>{t('tasks')}</h2>
              </div>
              <div className="button-row">
                <button className="icon-button" onClick={loadState} title={t('refresh')} type="button">
                  <RefreshCcw size={16} />
                </button>
                <button
                  className="icon-button"
                  onClick={handleClearFinished}
                  title={t('clearFinished')}
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <TaskList
              selectedTaskId={selectedTask?.id}
              tasks={tasks}
              onCancel={(taskId) => void handleCancelTask(taskId)}
              onSelect={setSelectedTaskId}
            />
          </div>

          <div className="panel log-panel">
            <div className="panel-title-row compact">
              <div>
                <p className="eyebrow">{selectedTask?.id || t('emptyLogs')}</p>
                <h2>{t('logs')}</h2>
              </div>
              <SquareTerminal size={20} />
            </div>
            <TaskDetails task={selectedTask} />
          </div>
        </section>
      </section>
    </main>
  )
}

interface FieldGridProps {
  fields: FlowField[]
  values: Record<string, FormValue>
  onChange: (key: string, value: FormValue) => void
}

function FieldGrid({ fields, values, onChange }: FieldGridProps) {
  const grouped = fields.reduce<Record<FlowField['group'], FlowField[]>>(
    (output, field) => {
      output[field.group].push(field)
      return output
    },
    { common: [], flow: [], android: [] },
  )

  return (
    <div className="field-sections">
      {(['flow', 'common', 'android'] as const).map((group) => {
        const groupFields = grouped[group]
        if (!groupFields.length) {
          return null
        }

        const title =
          group === 'flow'
            ? t('flowConfig')
            : group === 'common'
              ? t('browserOptions')
              : t('androidOptions')

        return (
          <div className="field-section" key={group}>
            <h3>{title}</h3>
            <div className="field-grid">
              {groupFields.map((field) => (
                <FlowFieldInput
                  field={field}
                  key={field.key}
                  value={values[field.key]}
                  onChange={(value) => onChange(field.key, value)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface FlowFieldInputProps {
  field: FlowField
  value: FormValue | undefined
  onChange: (value: FormValue) => void
}

function FlowFieldInput({ field, value, onChange }: FlowFieldInputProps) {
  if (field.type === 'boolean') {
    return (
      <label className="toggle-label">
        <input
          checked={Boolean(value)}
          type="checkbox"
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.label}
      </label>
    )
  }

  if (field.type === 'select') {
    return (
      <label className="field-label">
        {field.label}
        <select
          value={typeof value === 'string' ? value : ''}
          title={field.label}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{t('selectPlaceholder')}</option>
          {(field.options || []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <label className="field-label">
      {field.label}
      <input
        type={field.type === 'number' ? 'number' : 'text'}
        value={Array.isArray(value) ? value.join(', ') : value?.toString() || ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={
          field.type === 'number'
            ? t('numberPlaceholder')
            : field.type === 'stringList'
              ? t('listPlaceholder')
              : t('textPlaceholder')
        }
      />
    </label>
  )
}

function StatusMetric({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || t('none')}</strong>
    </div>
  )
}

interface TaskListProps {
  selectedTaskId?: string
  tasks: DesktopTask[]
  onCancel: (taskId: string) => void
  onSelect: (taskId: string) => void
}

function TaskList({ selectedTaskId, tasks, onCancel, onSelect }: TaskListProps) {
  if (!tasks.length) {
    return <p className="empty-state">{t('emptyTasks')}</p>
  }

  return (
    <div className="task-list">
      {tasks.map((task) => (
        <button
          className={`task-row ${selectedTaskId === task.id ? 'is-selected' : ''}`}
          key={task.id}
          onClick={() => onSelect(task.id)}
          type="button"
        >
          <span className={`status-dot ${task.status}`} />
          <span className="task-main">
            <strong>{task.title}</strong>
            <small>{task.message || task.id}</small>
          </span>
          <span className={`status-pill ${task.status}`}>{statusLabels[task.status]}</span>
          {task.status === 'running' || task.status === 'queued' ? (
            <span
              className="inline-icon-button"
              onClick={(event) => {
                event.stopPropagation()
                onCancel(task.id)
              }}
              title={t('cancel')}
            >
              <CircleStop size={16} />
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

function TaskDetails({ task }: { task?: DesktopTask }) {
  if (!task) {
    return <p className="empty-state">{t('emptyLogs')}</p>
  }

  return (
    <div className="task-detail-grid">
      <dl className="task-meta">
        <div>
          <dt>{t('status')}</dt>
          <dd>{statusLabels[task.status]}</dd>
        </div>
        <div>
          <dt>{t('started')}</dt>
          <dd>{formatTime(task.startedAt)}</dd>
        </div>
        <div>
          <dt>{t('completed')}</dt>
          <dd>{formatTime(task.completedAt)}</dd>
        </div>
        <div>
          <dt>{t('pid')}</dt>
          <dd>{task.pid || t('none')}</dd>
        </div>
        <div>
          <dt>{t('exitCode')}</dt>
          <dd>{task.exitCode ?? t('none')}</dd>
        </div>
      </dl>

      <pre className="terminal">
        {task.logs.length
          ? task.logs
              .slice(-terminalLineLimit)
              .map((line) => {
                const stamp = new Date(line.at).toLocaleTimeString()
                return `[${stamp}] ${line.stream}> ${line.text}`
              })
              .join('\n')
          : t('emptyLogs')}
      </pre>
    </div>
  )
}

export default App
