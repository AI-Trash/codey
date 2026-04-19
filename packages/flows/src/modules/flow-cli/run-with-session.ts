import { getRuntimeConfig } from '../../config'
import { newSession } from '../../core/browser'
import type { Session } from '../../types'
import { printFlowArtifactPath } from './helpers'

function keepSessionAlive(session: Session): void {
  let closing = false
  let listenersDetached = false

  const detachListeners = () => {
    if (listenersDetached) return
    listenersDetached = true
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
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
  // In keep-open mode the operator is driving the browser manually. Avoid
  // inferring shutdown from Patchright connection events because Chrome
  // internal pages such as chrome://extensions can invalidate the automation
  // connection even while the visible browser window is still usable.
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
  printFlowArtifactPath(
    'browser HAR',
    session.harPath,
    getRuntimeConfig().command,
  )
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
