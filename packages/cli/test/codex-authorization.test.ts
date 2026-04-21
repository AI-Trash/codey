import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { createAuthorizationCallbackCapture } from '../src/modules/authorization/codex-authorization'

class FakeBrowser extends EventEmitter {}

class FakeContext extends EventEmitter {
  constructor(private readonly browserInstance: FakeBrowser) {
    super()
  }

  browser(): FakeBrowser {
    return this.browserInstance
  }
}

class FakePage extends EventEmitter {
  public readonly contextInstance: FakeContext
  public routeHandler:
    | ((route: {
        request: () => { url: () => string }
        fulfill: (_options?: unknown) => Promise<void>
      }) => Promise<void>)
    | undefined
  public readonly route = vi.fn(
    async (
      _pattern: RegExp,
      handler: (route: {
        request: () => { url: () => string }
        fulfill: (_options?: unknown) => Promise<void>
      }) => Promise<void>,
    ) => {
      this.routeHandler = handler
    },
  )
  public readonly unroute = vi.fn(async () => {})

  constructor(browser: FakeBrowser) {
    super()
    this.contextInstance = new FakeContext(browser)
  }

  context(): FakeContext {
    return this.contextInstance
  }
}

describe('createAuthorizationCallbackCapture', () => {
  it('aborts immediately when the browser page is closed', async () => {
    const browser = new FakeBrowser()
    const page = new FakePage(browser)

    const capture = await createAuthorizationCallbackCapture(page as never, {
      timeoutMs: 180000,
    })

    page.emit('close')

    await expect(capture.result).rejects.toThrow(
      'Authorization callback wait aborted because the browser page was closed.',
    )
  })

  it('resolves as soon as the localhost callback is intercepted', async () => {
    const browser = new FakeBrowser()
    const page = new FakePage(browser)

    const capture = await createAuthorizationCallbackCapture(page as never, {
      timeoutMs: 180000,
    })

    let releaseFulfill!: () => void
    const fulfillStarted = new Promise<void>((resolve) => {
      releaseFulfill = resolve
    })

    const route = {
      request: () => ({
        url: () =>
          'http://localhost:1455/auth/callback?code=oauth-code&state=oauth-state',
      }),
      fulfill: vi.fn(async (_options?: unknown) => {
        releaseFulfill()
        await new Promise((resolve) => setTimeout(resolve, 50))
      }),
    }

    const handlerPromise = page.routeHandler?.(route)
    await fulfillStarted

    await expect(capture.result).resolves.toMatchObject({
      code: 'oauth-code',
      state: 'oauth-state',
      rawQuery: '/auth/callback?code=oauth-code&state=oauth-state',
    })

    await handlerPromise
  })
})
