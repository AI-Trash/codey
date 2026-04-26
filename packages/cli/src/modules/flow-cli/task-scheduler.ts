import { DEFAULT_CLI_FLOW_TASK_PARALLELISM } from './flow-registry'

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
  run: () => Promise<TResult>
}

export interface FlowTaskSchedulerSnapshot {
  activeCount: number
  pendingCount: number
  parallelism: number
}

interface FlowTaskSchedulerEntry<
  TResult,
> extends FlowTaskSchedulerTask<TResult> {
  order: number
  batchId: string
  parallelism: number
  resolve: (value: TResult | PromiseLike<TResult>) => void
  reject: (reason?: unknown) => void
}

interface FlowTaskSchedulerBatch<TResult> {
  id: string
  parallelism: number
  activeCount: number
  queue: FlowTaskSchedulerEntry<TResult>[]
}

function normalizeParallelism(value: number | undefined): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < DEFAULT_CLI_FLOW_TASK_PARALLELISM
  ) {
    return DEFAULT_CLI_FLOW_TASK_PARALLELISM
  }

  return value
}

export class FlowTaskScheduler<TResult> {
  private readonly batches = new Map<string, FlowTaskSchedulerBatch<TResult>>()
  private readonly idleResolvers: Array<() => void> = []
  private nextOrder = 0
  private activeCount = 0

  enqueue(task: FlowTaskSchedulerTask<TResult>): Promise<TResult> {
    const batchId = task.batchId?.trim() || `task:${task.taskId}`
    const parallelism = normalizeParallelism(task.parallelism)
    const batch =
      this.batches.get(batchId) ||
      ({
        id: batchId,
        parallelism,
        activeCount: 0,
        queue: [],
      } satisfies FlowTaskSchedulerBatch<TResult>)

    batch.parallelism = Math.max(batch.parallelism, parallelism)
    this.batches.set(batchId, batch)

    return new Promise<TResult>((resolve, reject) => {
      batch.queue.push({
        ...task,
        order: this.nextOrder++,
        batchId,
        parallelism,
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

  getSnapshot(): FlowTaskSchedulerSnapshot {
    return {
      activeCount: this.activeCount,
      pendingCount: this.getPendingCount(),
      parallelism: this.getGlobalParallelism(),
    }
  }

  clearPending(message?: string): number {
    let cleared = 0
    const error = new FlowTaskSchedulerCancelledError(message)

    for (const [batchId, batch] of this.batches.entries()) {
      const pending = batch.queue.splice(0)
      cleared += pending.length

      for (const entry of pending) {
        entry.reject(error)
      }

      if (!batch.activeCount && !batch.queue.length) {
        this.batches.delete(batchId)
      }
    }

    this.resolveIdleIfNeeded()
    return cleared
  }

  async waitForIdle(): Promise<void> {
    if (!this.hasActiveTasks() && !this.hasPendingTasks()) {
      return
    }

    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve)
    })
  }

  private getPendingCount(): number {
    let count = 0
    for (const batch of this.batches.values()) {
      count += batch.queue.length
    }
    return count
  }

  private getGlobalParallelism(): number {
    let parallelism = DEFAULT_CLI_FLOW_TASK_PARALLELISM

    for (const batch of this.batches.values()) {
      if (!batch.activeCount && !batch.queue.length) {
        continue
      }

      parallelism = Math.max(parallelism, batch.parallelism)
    }

    return parallelism
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
      if (batch.activeCount >= batch.parallelism || !batch.queue.length) {
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
    while (this.activeCount < this.getGlobalParallelism()) {
      const candidate = this.pickNextEntry()
      if (!candidate) {
        break
      }

      const nextEntry = candidate.batch.queue.shift()
      if (!nextEntry) {
        continue
      }

      candidate.batch.activeCount += 1
      this.activeCount += 1
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
      batch.activeCount = Math.max(batch.activeCount - 1, 0)
      this.activeCount = Math.max(this.activeCount - 1, 0)

      if (!batch.activeCount && !batch.queue.length) {
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
