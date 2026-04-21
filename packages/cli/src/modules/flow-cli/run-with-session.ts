import { getRuntimeConfig } from '../../config'
import { newSession } from '../../core/browser'
import type { Session } from '../../types'
import { printFlowArtifactPath } from './helpers'

const FINAL_PAGE_CLOSE_GRACE_MS = 250

export class FlowInterruptedError extends Error {
  constructor(message = 'Flow stopped by operator.') {
    super(message)
    this.name = 'FlowInterruptedError'
  }
}

export function isFlowInterruptedError(error: unknown): boolean {
  return error instanceof Error && error.name === 'FlowInterruptedError'
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

  // If the abort path wins the race, the task may still reject once the
  // browser context finishes unwinding. Swallow that secondary rejection.
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

function keepSessionAlive(session: Session): {
  markFlowCompleted(): void
  closeNow(): Promise<void>
} {
  let closing = false
  let listenersDetached = false
  let flowCompleted = false
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  const trackedPages = new Set<Session['page']>()

  const hasOpenPages = (): boolean => {
    try {
      return session.context.pages().some((candidate) => !candidate.isClosed())
    } catch {
      return false
    }
  }

  const handlePageClose = () => {
    if (closing || !flowCompleted) return

    if (closeTimer) {
      clearTimeout(closeTimer)
    }

    // Give Chrome a brief moment to settle in case the operator just
    // replaced one tab/window with another before treating the session as
    // intentionally finished.
    closeTimer = setTimeout(() => {
      closeTimer = undefined
      if (!hasOpenPages()) {
        void cleanup()
      }
    }, FINAL_PAGE_CLOSE_GRACE_MS)
  }

  const trackPage = (page: Session['page']) => {
    if (trackedPages.has(page)) {
      return
    }

    trackedPages.add(page)
    page.on('close', handlePageClose)
  }

  const detachListeners = () => {
    if (listenersDetached) return
    listenersDetached = true
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = undefined
    }
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
    session.context.off('page', trackPage)
    for (const page of trackedPages) {
      page.off('close', handlePageClose)
    }
    trackedPages.clear()
  }

  const cleanup = async () => {
    if (closing) return
    closing = true
    detachListeners()
    process.stdin.pause()
    await session.close()
  }

  const handleSigint = () => {
    void cleanup().finally(() => {
      process.exit(130)
    })
  }

  const handleSigterm = () => {
    void cleanup().finally(() => {
      process.exit(143)
    })
  }

  process.once('SIGINT', handleSigint)
  process.once('SIGTERM', handleSigterm)
  session.context.on('page', trackPage)
  for (const page of session.context.pages()) {
    trackPage(page)
  }
  // In keep-open mode the operator is driving the browser manually. Avoid
  // inferring shutdown from Patchright connection events because Chrome
  // internal pages such as chrome://extensions can invalidate the automation
  // connection even while the visible browser window is still usable.
  process.stdin.resume()

  return {
    markFlowCompleted() {
      flowCompleted = true
      if (!hasOpenPages()) {
        void cleanup()
      }
    },
    closeNow: cleanup,
  }
}

export async function runWithSession<TResult>(
  options: Parameters<typeof newSession>[0],
  runner: (session: Awaited<ReturnType<typeof newSession>>) => Promise<TResult>,
  runtime: {
    closeOnComplete?: boolean
    abortSignal?: AbortSignal
  } = {},
): Promise<TResult> {
  const session = await newSession(options)
  printFlowArtifactPath(
    'browser HAR',
    session.harPath,
    getRuntimeConfig().command,
  )
  const closeOnComplete = runtime.closeOnComplete ?? true
  if (!closeOnComplete) {
    const keepAlive = keepSessionAlive(session)
    try {
      const result = await runAbortable(
        runner(session),
        runtime.abortSignal,
        keepAlive.closeNow,
      )
      keepAlive.markFlowCompleted()
      return result
    } catch (error) {
      await keepAlive.closeNow()
      throw error
    }
  }

  try {
    return await runAbortable(runner(session), runtime.abortSignal, () =>
      session.close(),
    )
  } finally {
    await session.close()
  }
}
