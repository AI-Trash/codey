import { DEFAULT_CLI_BROWSER_LIMIT } from './flow-registry'

export class FlowTaskSchedulerCancelledError extends Error {
  constructor(message = 'Queued flow task was canceled before start.') {
    super(message)
    this.name = 'FlowTaskSchedulerCancelledError'
  }
}

export interface FlowTaskSchedulerTask<TResult> {
  taskId: string
  batchId?: string
  parallelism?: number
  kind?: 'default' | 'identity-maintenance'
  run: () => Promise<TResult>
}

export interface FlowTaskSchedulerSnapshot {
  activeCount: number
  pendingCount: number
  activeMaintenanceCount: number
  pendingMaintenanceCount: number
  browserLimit: number
}

interface FlowTaskSchedulerEntry<
  TResult,
> extends FlowTaskSchedulerTask<TResult> {
  order: number
  batchId: string
  resolve: (value: TResult | PromiseLike<TResult>) => void
  reject: (reason?: unknown) => void
}

interface FlowTaskSchedulerBatch<TResult> {
  id: string
  queue: FlowTaskSchedulerEntry<TResult>[]
}

function normalizeBrowserLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return DEFAULT_CLI_BROWSER_LIMIT
  }

  return value
}

export class FlowTaskScheduler<TResult> {
  private readonly batches = new Map<string, FlowTaskSchedulerBatch<TResult>>()
  private readonly activeEntries = new Map<
    string,
    FlowTaskSchedulerEntry<TResult>
  >()
  private readonly idleResolvers: Array<() => void> = []
  private nextOrder = 0
  private activeCount = 0
  private browserLimit: number

  constructor(input: { browserLimit?: number } = {}) {
    this.browserLimit = normalizeBrowserLimit(input.browserLimit)
  }

  setBrowserLimit(value: number | undefined): void {
    const nextLimit = normalizeBrowserLimit(value)
    if (nextLimit === this.browserLimit) {
      return
    }

    this.browserLimit = nextLimit
    this.drain()
  }

  getBrowserLimit(): number {
    return this.browserLimit
  }

  enqueue(task: FlowTaskSchedulerTask<TResult>): Promise<TResult> {
    const batchId = task.batchId?.trim() || `task:${task.taskId}`
    const batch =
      this.batches.get(batchId) ||
      ({
        id: batchId,
        queue: [],
      } satisfies FlowTaskSchedulerBatch<TResult>)

    this.batches.set(batchId, batch)

    return new Promise<TResult>((resolve, reject) => {
      batch.queue.push({
        ...task,
        order: this.nextOrder++,
        batchId,
        resolve,
        reject,
      })
      this.drain()
    })
  }

  hasActiveTasks(): boolean {
    return this.activeCount > 0
  }

  hasPendingTasks(): boolean {
    return this.getPendingCount() > 0
  }

  hasMaintenanceTasks(): boolean {
    return (
      this.getPendingCount(isIdentityMaintenanceTask) +
        this.getActiveCount(isIdentityMaintenanceTask) >
      0
    )
  }

  getSnapshot(): FlowTaskSchedulerSnapshot {
    return {
      activeCount: this.activeCount,
      pendingCount: this.getPendingCount(),
      activeMaintenanceCount: this.getActiveCount(isIdentityMaintenanceTask),
      pendingMaintenanceCount: this.getPendingCount(isIdentityMaintenanceTask),
      browserLimit: this.browserLimit,
    }
  }

  clearPending(
    message?: string,
    predicate?: (task: FlowTaskSchedulerTask<TResult>) => boolean,
  ): number {
    let cleared = 0
    const error = new FlowTaskSchedulerCancelledError(message)

    for (const [batchId, batch] of this.batches.entries()) {
      const pending = predicate
        ? batch.queue.filter((entry) => predicate(entry))
        : batch.queue.splice(0)
      if (predicate) {
        batch.queue = batch.queue.filter((entry) => !predicate(entry))
      }
      cleared += pending.length

      for (const entry of pending) {
        entry.reject(error)
      }

      if (!batch.queue.length) {
        this.batches.delete(batchId)
      }
    }

    this.resolveIdleIfNeeded()
    return cleared
  }

  clearPendingTaskIds(taskIds: Iterable<string>, message?: string): number {
    const taskIdSet = new Set(
      [...taskIds].map((taskId) => taskId.trim()).filter(Boolean),
    )
    if (!taskIdSet.size) {
      return 0
    }

    return this.clearPending(message, (task) => taskIdSet.has(task.taskId))
  }

  async waitForIdle(): Promise<void> {
    if (!this.hasActiveTasks() && !this.hasPendingTasks()) {
      return
    }

    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve)
    })
  }

  private getPendingCount(
    predicate?: (task: FlowTaskSchedulerTask<TResult>) => boolean,
  ): number {
    let count = 0
    for (const batch of this.batches.values()) {
      count += predicate
        ? batch.queue.filter((entry) => predicate(entry)).length
        : batch.queue.length
    }
    return count
  }

  private getActiveCount(
    predicate?: (task: FlowTaskSchedulerTask<TResult>) => boolean,
  ): number {
    if (!predicate) {
      return this.activeCount
    }

    let count = 0
    for (const entry of this.activeEntries.values()) {
      if (predicate(entry)) {
        count += 1
      }
    }
    return count
  }

  private pickNextEntry():
    | {
        batch: FlowTaskSchedulerBatch<TResult>
        entry: FlowTaskSchedulerEntry<TResult>
      }
    | undefined {
    let candidate:
      | {
          batch: FlowTaskSchedulerBatch<TResult>
          entry: FlowTaskSchedulerEntry<TResult>
        }
      | undefined

    for (const batch of this.batches.values()) {
      if (!batch.queue.length) {
        continue
      }

      const [entry] = batch.queue
      if (!entry) {
        continue
      }

      if (!candidate || entry.order < candidate.entry.order) {
        candidate = { batch, entry }
      }
    }

    return candidate
  }

  private drain(): void {
    while (this.activeCount < this.browserLimit) {
      const candidate = this.pickNextEntry()
      if (!candidate) {
        break
      }

      const nextEntry = candidate.batch.queue.shift()
      if (!nextEntry) {
        continue
      }

      this.activeCount += 1
      this.activeEntries.set(nextEntry.taskId, nextEntry)
      void this.runEntry(candidate.batch, nextEntry)
    }

    this.resolveIdleIfNeeded()
  }

  private async runEntry(
    batch: FlowTaskSchedulerBatch<TResult>,
    entry: FlowTaskSchedulerEntry<TResult>,
  ): Promise<void> {
    try {
      entry.resolve(await entry.run())
    } catch (error) {
      entry.reject(error)
    } finally {
      this.activeCount = Math.max(this.activeCount - 1, 0)
      this.activeEntries.delete(entry.taskId)

      if (!batch.queue.length) {
        this.batches.delete(batch.id)
      }

      this.drain()
    }
  }

  private resolveIdleIfNeeded(): void {
    if (this.hasActiveTasks() || this.hasPendingTasks()) {
      return
    }

    for (const resolve of this.idleResolvers.splice(0)) {
      resolve()
    }
  }
}

function isIdentityMaintenanceTask<TResult>(
  task: FlowTaskSchedulerTask<TResult>,
): boolean {
  return task.kind === 'identity-maintenance'
}
