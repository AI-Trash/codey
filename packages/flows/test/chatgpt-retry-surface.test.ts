import { describe, expect, it } from 'vitest'
import { CHATGPT_LOGIN_URL } from '../src/modules/chatgpt/common'
import { recoverLoginEmailSubmissionSurface } from '../src/modules/chatgpt/mutations'
import { waitForLoginEmailSubmissionOutcome } from '../src/modules/chatgpt/queries'

interface FakeLocatorState {
  visible?: boolean
  visibleSequence?: boolean[]
  editable?: boolean
  enabled?: boolean
  onClick?: () => void
}

class FakeLocator {
  visibleChecks = 0
  clickCount = 0

  constructor(readonly state: FakeLocatorState = {}) {}

  first(): FakeLocator {
    return this
  }

  async waitFor(options: {
    state: 'visible' | 'hidden' | 'attached' | 'detached'
    timeout?: number
  }): Promise<void> {
    const visible = await this.isVisible()
    if (options.state === 'visible' && visible) return
    if (options.state === 'hidden' && !visible) return
    throw new Error(`State ${options.state} not reached`)
  }

  async isVisible(): Promise<boolean> {
    const visible = this.currentVisible()
    this.visibleChecks += 1
    return visible
  }

  async evaluate(): Promise<boolean> {
    return this.state.editable ?? this.state.enabled ?? this.currentVisible()
  }

  async isEditable(): Promise<boolean> {
    return this.state.editable ?? false
  }

  async isEnabled(): Promise<boolean> {
    return this.state.enabled ?? false
  }

  async scrollIntoViewIfNeeded(): Promise<void> {}

  async click(): Promise<void> {
    if (!this.currentVisible()) {
      throw new Error('Locator is not visible')
    }
    this.clickCount += 1
    this.state.onClick?.()
  }

  private currentVisible(): boolean {
    const sequence = this.state.visibleSequence
    if (sequence?.length) {
      return sequence[Math.min(this.visibleChecks, sequence.length - 1)]
    }

    return this.state.visible ?? false
  }
}

class FakePage {
  currentTitle = 'ChatGPT'
  currentUrl = CHATGPT_LOGIN_URL
  readonly cssLocators: Record<string, FakeLocator> = {}
  readonly roleLocators: Array<{
    role: string
    name: string
    locator: FakeLocator
  }> = []
  readonly textLocators: Array<{
    text: string
    locator: FakeLocator
  }> = []

  private readonly hiddenLocator = new FakeLocator({
    visible: false,
    editable: false,
    enabled: false,
  })

  url(): string {
    return this.currentUrl
  }

  async title(): Promise<string> {
    return this.currentTitle
  }

  locator(selector: string): FakeLocator {
    return this.cssLocators[selector] ?? this.hiddenLocator
  }

  getByRole(
    role: string,
    options?: {
      name?: RegExp | string
    },
  ): FakeLocator {
    return (
      this.roleLocators.find(
        (entry) =>
          entry.role === role &&
          matchesAccessibleName(entry.name, options?.name),
      )?.locator ?? this.hiddenLocator
    )
  }

  getByText(text: RegExp | string): FakeLocator {
    return (
      this.textLocators.find((entry) => matchesAccessibleName(entry.text, text))
        ?.locator ?? this.hiddenLocator
    )
  }

  getByLabel(): FakeLocator {
    return this.hiddenLocator
  }

  getByPlaceholder(): FakeLocator {
    return this.hiddenLocator
  }

  getByTestId(): FakeLocator {
    return this.hiddenLocator
  }

  async evaluate(): Promise<boolean> {
    return false
  }
}

function matchesAccessibleName(
  actual: string,
  expected?: RegExp | string,
): boolean {
  if (expected == null) return true
  return expected instanceof RegExp
    ? expected.test(actual)
    : actual.includes(expected)
}

describe('chatgpt retry surfaces', () => {
  it('treats the OpenAI inline error page title as a retry outcome', async () => {
    const page = new FakePage()
    page.currentTitle = '糟糕，出错了！ - OpenAI'

    await expect(
      waitForLoginEmailSubmissionOutcome(page as never, 250),
    ).resolves.toBe('retry')
  })

  it('waits for and clicks a delayed 再次提交 button before restoring the email form', async () => {
    const page = new FakePage()
    page.currentTitle = '糟糕，出错了！ - OpenAI'

    const emailField = new FakeLocator({
      visible: false,
      editable: true,
      enabled: true,
    })
    const retryButton = new FakeLocator({
      visibleSequence: [false, false, true],
      enabled: true,
      onClick: () => {
        page.currentTitle = '登录 - OpenAI'
        emailField.state.visible = true
      },
    })

    page.cssLocators['input#email'] = emailField
    page.cssLocators['input[name="email"]'] = emailField
    page.cssLocators['input[type="email"]'] = emailField
    page.roleLocators.push({
      role: 'button',
      name: '再次提交',
      locator: retryButton,
    })
    page.textLocators.push({
      text: '再次提交',
      locator: retryButton,
    })

    await expect(
      recoverLoginEmailSubmissionSurface(page as never),
    ).resolves.toBe(true)
    expect(retryButton.clickCount).toBe(1)
  })
})
