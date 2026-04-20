import { getRuntimeConfig } from '../../config'
import { newSession } from '../../core/browser'
import type { Session } from '../../types'
import { printFlowArtifactPath } from './helpers'

const FINAL_PAGE_CLOSE_GRACE_MS = 250

function keepSessionAlive(session: Session): () => void {
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

  return () => {
    flowCompleted = true
    if (!hasOpenPages()) {
      void cleanup()
    }
  }
}

export async function runWithSession<TResult>(
  options: Parameters<typeof newSession>[0],
  runner: (session: Awaited<ReturnType<typeof newSession>>) => Promise<TResult>,
  runtime: {
    closeOnComplete?: boolean
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
    const markFlowCompleted = keepSessionAlive(session)
    try {
      const result = await runner(session)
      markFlowCompleted()
      return result
    } catch (error) {
      await session.close()
      throw error
    }
  }

  try {
    return await runner(session)
  } finally {
    await session.close()
  }
}
