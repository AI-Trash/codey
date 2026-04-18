import { EventEmitter } from 'events'
import { describe, expect, it } from 'vitest'
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
  public readonly route = async () => {}
  public readonly unroute = async () => {}

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
})
