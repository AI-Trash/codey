import { newSession } from '../../core/browser'

export async function runWithSession(
  options: Parameters<typeof newSession>[0],
  runner: (session: Awaited<ReturnType<typeof newSession>>) => Promise<void>,
): Promise<void> {
  const session = await newSession(options)
  try {
    await runner(session)
  } finally {
    await session.close()
  }
}
