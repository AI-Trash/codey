import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  waitForAnySelectorState,
  waitUntilChatGPTHomeReady,
} from '../src/modules/chatgpt/queries'

class FakeLocator {
  constructor(
    private readonly page: FakePage,
    private readonly selector: string,
  ) {}

  first(): FakeLocator {
    return this
  }

  async count(): Promise<number> {
    return (await this.isVisible()) ? 1 : 0
  }

  async isVisible(): Promise<boolean> {
    return this.page.isVisible(this.selector)
  }

  async waitFor(options: {
    state: 'visible' | 'hidden' | 'attached' | 'detached'
    timeout?: number
  }): Promise<void> {
    const visible = await this.isVisible()
    if (options.state === 'visible' && visible) return
    if (options.state === 'hidden' && !visible) return
    throw new Error(`State ${options.state} not reached for ${this.selector}`)
  }

  async evaluate(): Promise<boolean> {
    return this.isVisible()
  }
}

class FakePage {
  private phase = 0

  constructor(
    private readonly phases: Array<Record<string, boolean>>,
    private readonly currentUrl = 'https://chatgpt.com/',
    private readonly pendingOnboardingAnnouncementKeys: string[][] = [],
  ) {}

  url(): string {
    return this.currentUrl
  }

  nextPhase(): void {
    this.phase = Math.min(this.phase + 1, this.phases.length - 1)
  }

  isVisible(selector: string): boolean {
    return this.phases[this.phase]?.[selector] ?? false
  }

  locator(selector: string): FakeLocator {
    return new FakeLocator(this, selector)
  }

  getByRole(): FakeLocator {
    return new FakeLocator(this, '__hidden__')
  }

  getByText(): FakeLocator {
    return new FakeLocator(this, '__hidden__')
  }

  getByLabel(): FakeLocator {
    return new FakeLocator(this, '__hidden__')
  }

  getByPlaceholder(): FakeLocator {
    return new FakeLocator(this, '__hidden__')
  }

  getByTestId(): FakeLocator {
    return new FakeLocator(this, '__hidden__')
  }

  async evaluate(fn?: unknown, arg?: unknown): Promise<boolean | string[]> {
    const source = typeof fn === 'function' ? String(fn) : ''
    if (source.includes('/backend-api/settings/user')) {
      const keys = this.pendingOnboardingAnnouncementKeys[this.phase] ?? []
      const allowedKeys = Array.isArray(arg)
        ? arg.filter((value): value is string => typeof value === 'string')
        : []
      return keys.filter((value) => allowedKeys.includes(value))
    }

    return this.isVisible('[data-testid="accounts-profile-button"]')
  }

  async waitForURL(
    predicate: (url: URL) => boolean,
    _options?: { timeout?: number },
  ): Promise<void> {
    if (!predicate(new URL(this.currentUrl))) {
      throw new Error('URL did not match')
    }
  }

  async waitForFunction(
    _fn: unknown,
    _arg?: unknown,
    _options?: { timeout?: number },
  ): Promise<void> {
    if (!this.isVisible('[data-testid="accounts-profile-button"]')) {
      throw new Error('Function condition not reached')
    }
  }
}

describe('waitUntilChatGPTHomeReady', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits up to 10 seconds before reporting the authenticated home as ready when onboarding never appears', async () => {
    const page = new FakePage([
      {
        '[data-testid="composer-root"]': true,
      },
    ])

    const readyPromise = waitUntilChatGPTHomeReady(
      page as never,
      async () => null,
      3,
    )
    const tracker = trackPromise(readyPromise)

    await vi.advanceTimersByTimeAsync(9500)
    expect(tracker.status()).toBe('pending')

    await vi.advanceTimersByTimeAsync(500)
    await expect(readyPromise).resolves.toBe(true)
  })

  it('treats authenticated DOM signals as ready even when the URL is not the ChatGPT home URL', async () => {
    const page = new FakePage(
      [
        {
          '[data-testid="composer-root"]': true,
        },
      ],
      'https://example.com/not-home',
    )

    const readyPromise = waitUntilChatGPTHomeReady(
      page as never,
      async () => null,
      3,
    )

    await vi.advanceTimersByTimeAsync(10000)
    await expect(readyPromise).resolves.toBe(true)
  })

  it('waits up to 10 seconds when fewer than four onboarding actions were dismissed', async () => {
    const page = new FakePage([
      {
        '[data-testid="getting-started-button"]': true,
      },
      {
        '[data-testid="composer-root"]': true,
      },
    ])

    let clicks = 0
    const clickOnboardingAction = async () => {
      if (clicks > 0) return null
      clicks += 1
      page.nextPhase()
      return 'getting-started'
    }

    const readyPromise = waitUntilChatGPTHomeReady(
      page as never,
      clickOnboardingAction,
      4,
    )
    const tracker = trackPromise(readyPromise)

    await vi.advanceTimersByTimeAsync(10000)
    expect(tracker.status()).toBe('pending')

    await vi.advanceTimersByTimeAsync(500)
    await expect(readyPromise).resolves.toBe(true)
    expect(clicks).toBe(1)
  })

  it('does not treat the authenticated home as ready while onboarding announcements are still pending', async () => {
    const page = new FakePage(
      [
        {
          '[data-testid="composer-root"]': true,
        },
      ],
      'https://chatgpt.com/',
      [['oai/apps/hasSeenOnboardingFlow']],
    )

    const readyPromise = waitUntilChatGPTHomeReady(
      page as never,
      async () => null,
      3,
    )

    await vi.advanceTimersByTimeAsync(15000)
    await expect(readyPromise).resolves.toBe(false)
  })

  it('waits for onboarding announcements to clear after dismissal before reporting the home as ready', async () => {
    const page = new FakePage(
      [
        {
          '[data-testid="getting-started-button"]': true,
        },
        {
          '[data-testid="composer-root"]': true,
        },
      ],
      'https://chatgpt.com/',
      [['oai/apps/hasSeenOnboardingFlow'], []],
    )

    let clicks = 0
    const clickOnboardingAction = async () => {
      if (clicks > 0) return null
      clicks += 1
      page.nextPhase()
      return 'getting-started'
    }

    const readyPromise = waitUntilChatGPTHomeReady(
      page as never,
      clickOnboardingAction,
      4,
    )

    await vi.advanceTimersByTimeAsync(10500)
    await expect(readyPromise).resolves.toBe(true)
    expect(clicks).toBe(1)
  })

  it('waits only 3 seconds after dismissing at least four onboarding actions', async () => {
    const page = new FakePage([
      {
        '[data-testid="getting-started-button"]': true,
      },
      {
        '[data-testid="getting-started-button"]': true,
      },
      {
        '[data-testid="getting-started-button"]': true,
      },
      {
        '[data-testid="getting-started-button"]': true,
      },
      {
        '[data-testid="composer-root"]': true,
      },
    ])

    let clicks = 0
    const clickOnboardingAction = async () => {
      if (clicks >= 4) return null
      clicks += 1
      page.nextPhase()
      return 'getting-started'
    }

    const readyPromise = waitUntilChatGPTHomeReady(
      page as never,
      clickOnboardingAction,
      4,
    )
    const tracker = trackPromise(readyPromise)

    await vi.advanceTimersByTimeAsync(4500)
    expect(tracker.status()).toBe('pending')

    await vi.advanceTimersByTimeAsync(500)
    await expect(readyPromise).resolves.toBe(true)
    expect(clicks).toBe(4)
  })

  it('keeps polling after a transient stale browser context selector error', async () => {
    const page = new TransientStaleContextPage('[data-testid="composer-root"]')

    const readyPromise = waitForAnySelectorState(
      page as never,
      ['[data-testid="composer-root"]'],
      'visible',
      500,
    )

    await vi.advanceTimersByTimeAsync(100)
    await expect(readyPromise).resolves.toBe(true)
    expect(page.visibleChecks).toBeGreaterThanOrEqual(2)
  })
})

class TransientStaleContextLocator {
  constructor(private readonly page: TransientStaleContextPage) {}

  first(): TransientStaleContextLocator {
    return this
  }

  async isVisible(): Promise<boolean> {
    this.page.visibleChecks += 1
    if (this.page.visibleChecks === 1) {
      throw new Error(
        'Protocol error (DOM.describeNode): Cannot find context with specified id',
      )
    }
    return true
  }

  async count(): Promise<number> {
    return (await this.isVisible()) ? 1 : 0
  }

  async waitFor(): Promise<void> {
    if (!(await this.isVisible())) {
      throw new Error('State visible not reached')
    }
  }
}

class TransientStaleContextPage {
  visibleChecks = 0

  constructor(private readonly selector: string) {}

  locator(selector: string): TransientStaleContextLocator {
    if (selector !== this.selector) {
      throw new Error(`Unexpected selector: ${selector}`)
    }
    return new TransientStaleContextLocator(this)
  }
}

function trackPromise<T>(promise: Promise<T>): {
  status: () => 'pending' | 'fulfilled' | 'rejected'
} {
  let status: 'pending' | 'fulfilled' | 'rejected' = 'pending'

  promise.then(
    () => {
      status = 'fulfilled'
    },
    () => {
      status = 'rejected'
    },
  )

  return {
    status: () => status,
  }
}
