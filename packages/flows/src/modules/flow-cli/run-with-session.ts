import { newSession } from '../../core/browser'
import type { Session } from '../../types'

function keepSessionAlive(session: Session): void {
  let closing = false
  let listenersDetached = false

  const handlePageClose = () => {
    queueMicrotask(() => {
      if (closing) return
      const hasOpenPages = session.context
        .pages()
        .some((page) => !page.isClosed())
      if (!hasOpenPages) {
        void cleanup()
      }
    })
  }

  const attachPageListener = (page: Session['page']) => {
    page.on('close', handlePageClose)
  }

  const handleContextPage = (page: Session['page']) => {
    attachPageListener(page)
  }

  const detachListeners = () => {
    if (listenersDetached) return
    listenersDetached = true
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
    session.browser.off('disconnected', handleBrowserDisconnected)
    session.context.off('page', handleContextPage)
    for (const page of session.context.pages()) {
      page.off('close', handlePageClose)
    }
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

  const handleBrowserDisconnected = () => {
    void cleanup()
  }

  process.once('SIGINT', handleSigint)
  process.once('SIGTERM', handleSigterm)
  session.browser.once('disconnected', handleBrowserDisconnected)
  session.context.on('page', handleContextPage)
  for (const page of session.context.pages()) {
    attachPageListener(page)
  }
  process.stdin.resume()
}

export async function runWithSession<TResult>(
  options: Parameters<typeof newSession>[0],
  runner: (session: Awaited<ReturnType<typeof newSession>>) => Promise<TResult>,
  runtime: {
    closeOnComplete?: boolean
  } = {},
): Promise<TResult> {
  const session = await newSession(options)
  const closeOnComplete = runtime.closeOnComplete ?? true
  if (!closeOnComplete) {
    keepSessionAlive(session)
    try {
      return await runner(session)
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
