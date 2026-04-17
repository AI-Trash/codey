import { describe, expect, it } from 'vitest'
import { waitUntilChatGPTHomeReady } from '../src/modules/chatgpt/queries'

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

  async evaluate(): Promise<boolean> {
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
  it('treats the authenticated home as ready when onboarding never appears', async () => {
    const page = new FakePage([
      {
        '[data-testid="composer-root"]': true,
      },
    ])

    await expect(
      waitUntilChatGPTHomeReady(page as never, async () => null, 3),
    ).resolves.toBe(true)
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

    await expect(
      waitUntilChatGPTHomeReady(page as never, async () => null, 3),
    ).resolves.toBe(true)
  })

  it('waits for onboarding dismissal before reporting the home as ready', async () => {
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

    await expect(
      waitUntilChatGPTHomeReady(page as never, clickOnboardingAction, 4),
    ).resolves.toBe(true)
    expect(clicks).toBe(1)
  })
})
