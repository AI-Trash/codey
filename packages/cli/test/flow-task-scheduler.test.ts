import { describe, expect, it } from 'vitest'

import {
  FlowTaskScheduler,
  FlowTaskSchedulerCancelledError,
} from '../src/modules/flow-cli/task-scheduler'

function createDeferredTask(label: string) {
  let resolveStarted: (() => void) | undefined
  let resolveTask: (() => void) | undefined
  const started = new Promise<string>((resolve) => {
    resolveStarted = () => resolve(label)
  })
  const settled = new Promise<void>((resolve) => {
    resolveTask = resolve
  })

  return {
    started,
    finish: () => resolveTask?.(),
    run: async () => {
      resolveStarted?.()
      await settled
      return label
    },
  }
}

describe('flow task scheduler', () => {
  it('runs default tasks up to the default browser limit', async () => {
    const scheduler = new FlowTaskScheduler<string>()
    const execution: string[] = []
    let releaseFirst: (() => void) | undefined
    let releaseSecond: (() => void) | undefined

    const first = scheduler.enqueue({
      taskId: 'task-1',
      run: async () => {
        execution.push('task-1:start')
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
        execution.push('task-1:end')
        return 'task-1'
      },
    })

    const second = scheduler.enqueue({
      taskId: 'task-2',
      run: async () => {
        execution.push('task-2:start')
        await new Promise<void>((resolve) => {
          releaseSecond = resolve
        })
        execution.push('task-2:end')
        return 'task-2'
      },
    })

    await Promise.resolve()
    expect(execution).toEqual(['task-1:start', 'task-2:start'])

    releaseFirst?.()
    releaseSecond?.()
    await Promise.all([first, second])

    expect(execution).toEqual([
      'task-1:start',
      'task-2:start',
      'task-1:end',
      'task-2:end',
    ])
  })

  it('respects the global browser limit for batched tasks', async () => {
    const scheduler = new FlowTaskScheduler<string>({ browserLimit: 2 })
    const started: string[] = []
    const deferred = ['one', 'two', 'three'].map((label) =>
      createDeferredTask(label),
    )
    for (const task of deferred) {
      void task.started.then((label) => {
        started.push(label)
      })
    }

    const tasks = deferred.map((task, index) =>
      scheduler.enqueue({
        taskId: `task-${index + 1}`,
        batchId: 'batch-1',
        parallelism: 1,
        run: task.run,
      }),
    )

    await Promise.all([deferred[0].started, deferred[1].started])
    expect(started).toEqual(['one', 'two'])

    deferred[0]?.finish()
    await deferred[2].started
    expect(started).toEqual(['one', 'two', 'three'])

    deferred[1]?.finish()
    deferred[2]?.finish()
    await Promise.all(tasks)
  })

  it('drains more queued work after the browser limit increases', async () => {
    const scheduler = new FlowTaskScheduler<string>({ browserLimit: 1 })
    const started: string[] = []
    const deferred = ['one', 'two'].map((label) => createDeferredTask(label))
    for (const task of deferred) {
      void task.started.then((label) => {
        started.push(label)
      })
    }

    const tasks = deferred.map((task, index) =>
      scheduler.enqueue({
        taskId: `task-${index + 1}`,
        run: task.run,
      }),
    )

    await deferred[0].started
    expect(started).toEqual(['one'])

    scheduler.setBrowserLimit(2)
    await deferred[1].started
    expect(started).toEqual(['one', 'two'])

    deferred[0]?.finish()
    deferred[1]?.finish()
    await Promise.all(tasks)
  })

  it('cancels queued tasks before they start', async () => {
    const scheduler = new FlowTaskScheduler<string>({ browserLimit: 1 })
    let releaseFirst: (() => void) | undefined

    const first = scheduler.enqueue({
      taskId: 'task-1',
      run: async () => {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
        return 'task-1'
      },
    })

    const second = scheduler.enqueue({
      taskId: 'task-2',
      run: async () => 'task-2',
    })

    await Promise.resolve()
    expect(scheduler.clearPending('queue cleared')).toBe(1)

    await expect(second).rejects.toBeInstanceOf(FlowTaskSchedulerCancelledError)

    releaseFirst?.()
    await first
    await scheduler.waitForIdle()
  })
})
