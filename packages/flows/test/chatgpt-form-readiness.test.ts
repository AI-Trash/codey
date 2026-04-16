import { describe, expect, it } from 'vitest'
import { waitForEditableSelector } from '../src/modules/chatgpt/queries'

class FakeLocator {
  editableChecks = 0

  constructor(
    private readonly options: {
      visible?: boolean
      editableSequence?: boolean[]
    } = {},
  ) {}

  first(): FakeLocator {
    return this
  }

  async waitFor(options: {
    state: 'visible' | 'hidden' | 'attached' | 'detached'
    timeout?: number
  }): Promise<void> {
    const visible = this.options.visible ?? false
    if (options.state === 'visible' && visible) return
    if (options.state === 'hidden' && !visible) return
    throw new Error(`State ${options.state} not reached`)
  }

  async isVisible(): Promise<boolean> {
    return this.options.visible ?? false
  }

  async evaluate(): Promise<boolean> {
    this.editableChecks += 1
    const sequence = this.options.editableSequence ?? [false]
    return sequence[Math.min(this.editableChecks - 1, sequence.length - 1)]
  }

  async isEditable(): Promise<boolean> {
    return this.evaluate()
  }
}

class FakePage {
  private readonly hiddenLocator = new FakeLocator({
    visible: false,
    editableSequence: [false],
  })

  constructor(private readonly locators: Record<string, FakeLocator>) {}

  locator(selector: string): FakeLocator {
    return this.locators[selector] ?? this.hiddenLocator
  }

  getByRole(): FakeLocator {
    return this.hiddenLocator
  }

  getByText(): FakeLocator {
    return this.hiddenLocator
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
}

describe('waitForEditableSelector', () => {
  it('waits until a visible field becomes editable', async () => {
    const emailLocator = new FakeLocator({
      visible: true,
      editableSequence: [false, false, true],
    })
    const page = new FakePage({
      'input#email': emailLocator,
    })

    await expect(
      waitForEditableSelector(page as never, ['input#email'], 800),
    ).resolves.toBe(true)
    expect(emailLocator.editableChecks).toBeGreaterThanOrEqual(3)
  })

  it('times out when a field stays visible but never becomes editable', async () => {
    const emailLocator = new FakeLocator({
      visible: true,
      editableSequence: [false, false, false],
    })
    const page = new FakePage({
      'input#email': emailLocator,
    })

    await expect(
      waitForEditableSelector(page as never, ['input#email'], 150),
    ).resolves.toBe(false)
  })
})
