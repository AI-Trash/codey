import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { newSessionMock, getRuntimeConfigMock, printFlowArtifactPathMock } =
  vi.hoisted(() => ({
    newSessionMock: vi.fn(),
    getRuntimeConfigMock: vi.fn(),
    printFlowArtifactPathMock: vi.fn(),
  }))

vi.mock('../src/core/browser', () => ({
  newSession: newSessionMock,
}))

vi.mock('../src/config', () => ({
  getRuntimeConfig: getRuntimeConfigMock,
}))

vi.mock('../src/modules/flow-cli/helpers', () => ({
  printFlowArtifactPath: printFlowArtifactPathMock,
}))

import { runWithSession } from '../src/modules/flow-cli/run-with-session'

class FakeBrowser extends EventEmitter {}

class FakeContext extends EventEmitter {}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('runWithSession keep-open mode', () => {
  const stdinResumeSpy = vi.spyOn(process.stdin, 'resume')
  const stdinPauseSpy = vi.spyOn(process.stdin, 'pause')

  beforeEach(() => {
    vi.resetAllMocks()
    stdinResumeSpy.mockImplementation(() => process.stdin)
    stdinPauseSpy.mockImplementation(() => process.stdin)
    getRuntimeConfigMock.mockReturnValue({
      command: 'flow:chatgpt-login',
    })
  })

  afterEach(() => {
    stdinResumeSpy.mockRestore()
    stdinPauseSpy.mockRestore()
  })

  it('does not close the session when the automation connection drops in keep-open mode', async () => {
    const browser = new FakeBrowser()
    const context = new FakeContext()
    const page = new EventEmitter() as EventEmitter & {
      isClosed(): boolean
    }
    page.isClosed = vi.fn(() => true)
    const session = {
      browser,
      context: Object.assign(context, {
        pages: vi.fn(() => []),
      }),
      page,
      harPath: 'C:/tmp/browser.har',
      close: vi.fn(async () => undefined),
    }

    newSessionMock.mockResolvedValue(session)

    const result = await runWithSession(
      {},
      async () => 'ok',
      { closeOnComplete: false },
    )

    expect(result).toBe('ok')
    expect(printFlowArtifactPathMock).toHaveBeenCalledWith(
      'browser HAR',
      'C:/tmp/browser.har',
      'flow:chatgpt-login',
    )

    page.emit('close')
    await flushAsync()

    expect(session.close).not.toHaveBeenCalled()

    browser.emit('disconnected')
    await flushAsync()

    expect(session.close).not.toHaveBeenCalled()
  })

  it('does not close the session when the browser context closes unexpectedly', async () => {
    const browser = new FakeBrowser()
    const context = new FakeContext()
    const session = {
      browser,
      context: Object.assign(context, {
        pages: vi.fn(() => []),
      }),
      page: new EventEmitter(),
      harPath: undefined,
      close: vi.fn(async () => undefined),
    }

    newSessionMock.mockResolvedValue(session)

    await runWithSession({}, async () => undefined, { closeOnComplete: false })

    context.emit('close')
    await flushAsync()

    expect(session.close).not.toHaveBeenCalled()
  })
})
