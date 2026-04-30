import { newAndroidSession, type AndroidSession } from '../../core/android'
import { FlowInterruptedError } from './run-with-session'

export interface RunWithAndroidSessionRuntime {
  abortSignal?: AbortSignal
}

function toFlowInterruptedError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason
  }

  if (typeof reason === 'string' && reason.trim()) {
    return new FlowInterruptedError(reason.trim())
  }

  return new FlowInterruptedError()
}

async function runAbortable<TResult>(
  task: Promise<TResult>,
  signal: AbortSignal | undefined,
  onAbort: () => Promise<void>,
): Promise<TResult> {
  if (!signal) {
    return task
  }

  if (signal.aborted) {
    await onAbort()
    throw toFlowInterruptedError(signal.reason)
  }

  let abortHandler: (() => void) | undefined
  const taskWithCleanup = task.finally(() => {
    if (abortHandler) {
      signal.removeEventListener('abort', abortHandler)
    }
  })

  void taskWithCleanup.catch(() => undefined)

  const abortPromise = new Promise<never>((_, reject) => {
    abortHandler = () => {
      void onAbort().finally(() => {
        reject(toFlowInterruptedError(signal.reason))
      })
    }

    signal.addEventListener('abort', abortHandler, { once: true })
  })

  return Promise.race([taskWithCleanup, abortPromise])
}

export async function runWithAndroidSession<TResult>(
  runner: (session: AndroidSession) => Promise<TResult>,
  runtime: RunWithAndroidSessionRuntime = {},
): Promise<TResult> {
  const session = await newAndroidSession()

  try {
    return await runAbortable(runner(session), runtime.abortSignal, () =>
      session.close(),
    )
  } finally {
    await session.close()
  }
}
