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

function createPage(isClosed: () => boolean) {
  const page = new EventEmitter() as EventEmitter & {
    isClosed(): boolean
  }
  page.isClosed = vi.fn(isClosed)
  return page
}

describe('runWithSession keep-open mode', () => {
  const stdinResumeSpy = vi.spyOn(process.stdin, 'resume')
  const stdinPauseSpy = vi.spyOn(process.stdin, 'pause')

  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    stdinResumeSpy.mockImplementation(() => process.stdin)
    stdinPauseSpy.mockImplementation(() => process.stdin)
    getRuntimeConfigMock.mockReturnValue({
      command: 'flow:chatgpt-login',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    stdinResumeSpy.mockRestore()
    stdinPauseSpy.mockRestore()
  })

  it('closes the session when the last browser page closes in keep-open mode', async () => {
    const browser = new FakeBrowser()
    const context = new FakeContext()
    let pageClosed = false
    const page = createPage(() => pageClosed)
    const session = {
      browser,
      context: Object.assign(context, {
        pages: vi.fn(() => (pageClosed ? [] : [page])),
      }),
      page,
      harPath: 'C:/tmp/browser.har',
      close: vi.fn(async () => undefined),
    }

    newSessionMock.mockResolvedValue(session)

    const result = await runWithSession({}, async () => 'ok', {
      closeOnComplete: false,
    })

    expect(result).toBe('ok')
    expect(printFlowArtifactPathMock).toHaveBeenCalledWith(
      'browser HAR',
      'C:/tmp/browser.har',
      'flow:chatgpt-login',
    )

    pageClosed = true
    page.emit('close')
    await vi.runAllTimersAsync()

    expect(session.close).toHaveBeenCalledOnce()
    expect(stdinPauseSpy).toHaveBeenCalled()
  })

  it('waits for the flow to finish before treating page closure as manual shutdown', async () => {
    const browser = new FakeBrowser()
    const context = new FakeContext()
    let pageClosed = false
    const page = createPage(() => pageClosed)
    const session = {
      browser,
      context: Object.assign(context, {
        pages: vi.fn(() => (pageClosed ? [] : [page])),
      }),
      page,
      harPath: undefined,
      close: vi.fn(async () => undefined),
    }

    newSessionMock.mockResolvedValue(session)

    const result = await runWithSession(
      {},
      async () => {
        pageClosed = true
        page.emit('close')
        await vi.runAllTimersAsync()
        expect(session.close).not.toHaveBeenCalled()
        return 'ok'
      },
      { closeOnComplete: false },
    )

    await vi.runAllTimersAsync()

    expect(result).toBe('ok')
    expect(session.close).toHaveBeenCalledOnce()
  })

  it('does not close the session when another page is still open', async () => {
    const browser = new FakeBrowser()
    const context = new FakeContext()
    let firstPageClosed = false
    const firstPage = createPage(() => firstPageClosed)
    const secondPage = createPage(() => false)
    const session = {
      browser,
      context: Object.assign(context, {
        pages: vi.fn(() =>
          [firstPageClosed ? null : firstPage, secondPage].filter(Boolean),
        ),
      }),
      page: firstPage,
      harPath: undefined,
      close: vi.fn(async () => undefined),
    }

    newSessionMock.mockResolvedValue(session)

    await runWithSession({}, async () => undefined, { closeOnComplete: false })

    firstPageClosed = true
    firstPage.emit('close')
    await vi.runAllTimersAsync()

    expect(session.close).not.toHaveBeenCalled()
  })

  it('does not close the session when the automation connection drops in keep-open mode', async () => {
    const browser = new FakeBrowser()
    const context = new FakeContext()
    const page = createPage(() => false)
    const session = {
      browser,
      context: Object.assign(context, {
        pages: vi.fn(() => [page]),
      }),
      page,
      harPath: 'C:/tmp/browser.har',
      close: vi.fn(async () => undefined),
    }

    newSessionMock.mockResolvedValue(session)

    await runWithSession({}, async () => 'ok', { closeOnComplete: false })

    browser.emit('disconnected')
    await vi.runAllTimersAsync()

    expect(session.close).not.toHaveBeenCalled()
  })

  it('does not close the session when the browser context closes unexpectedly', async () => {
    const browser = new FakeBrowser()
    const context = new FakeContext()
    const page = createPage(() => false)
    const session = {
      browser,
      context: Object.assign(context, {
        pages: vi.fn(() => [page]),
      }),
      page,
      harPath: undefined,
      close: vi.fn(async () => undefined),
    }

    newSessionMock.mockResolvedValue(session)

    await runWithSession({}, async () => undefined, { closeOnComplete: false })

    context.emit('close')
    await vi.runAllTimersAsync()

    expect(session.close).not.toHaveBeenCalled()
  })

  it('closes the session immediately when the flow is aborted in keep-open mode', async () => {
    const browser = new FakeBrowser()
    const context = new FakeContext()
    const page = createPage(() => false)
    const session = {
      browser,
      context: Object.assign(context, {
        pages: vi.fn(() => [page]),
      }),
      page,
      harPath: undefined,
      close: vi.fn(async () => undefined),
    }
    const abortController = new AbortController()
    const initialSigintListeners = process.listenerCount('SIGINT')
    const initialSigtermListeners = process.listenerCount('SIGTERM')

    newSessionMock.mockResolvedValue(session)

    const result = runWithSession(
      {},
      async () => new Promise<never>(() => undefined),
      {
        closeOnComplete: false,
        abortSignal: abortController.signal,
      },
    )

    abortController.abort(new Error('Flow stopped by operator.'))

    await expect(result).rejects.toThrow('Flow stopped by operator.')
    expect(session.close).toHaveBeenCalledOnce()
    expect(process.listenerCount('SIGINT')).toBe(initialSigintListeners)
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermListeners)
  })

  it('detaches keep-open signal listeners when the runner fails', async () => {
    const browser = new FakeBrowser()
    const context = new FakeContext()
    const page = createPage(() => false)
    const session = {
      browser,
      context: Object.assign(context, {
        pages: vi.fn(() => [page]),
      }),
      page,
      harPath: undefined,
      close: vi.fn(async () => undefined),
    }
    const initialSigintListeners = process.listenerCount('SIGINT')
    const initialSigtermListeners = process.listenerCount('SIGTERM')

    newSessionMock.mockResolvedValue(session)

    await expect(
      runWithSession(
        {},
        async () => {
          throw new Error('runner failed')
        },
        { closeOnComplete: false },
      ),
    ).rejects.toThrow('runner failed')

    expect(session.close).toHaveBeenCalledOnce()
    expect(process.listenerCount('SIGINT')).toBe(initialSigintListeners)
    expect(process.listenerCount('SIGTERM')).toBe(initialSigtermListeners)
  })
})
