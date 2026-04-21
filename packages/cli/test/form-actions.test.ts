import { describe, expect, it } from 'vitest'
import { typeIfPresent } from '../src/modules/common/form-actions'

class FakeLocator {
  text = ''
  sequentialInputs: string[] = []

  constructor(
    private readonly options: {
      visible?: boolean
      editable?: boolean
      contentEditable?: boolean
    } = {},
  ) {}

  first(): FakeLocator {
    return this
  }

  async isVisible(): Promise<boolean> {
    return this.options.visible ?? true
  }

  async waitFor(options: {
    state: 'visible' | 'hidden' | 'attached' | 'detached'
  }): Promise<void> {
    if (options.state === 'visible' && (this.options.visible ?? true)) {
      return
    }
    throw new Error(`State ${options.state} not reached`)
  }

  async evaluate(_fn: unknown, expected?: string): Promise<boolean> {
    if (typeof expected === 'string') {
      return this.text === expected
    }
    return this.options.editable ?? true
  }

  async isEditable(): Promise<boolean> {
    return this.options.editable ?? true
  }

  async click(): Promise<void> {}

  async fill(value: string): Promise<void> {
    this.text = value
  }

  async blur(): Promise<void> {}

  async pressSequentially(value: string): Promise<void> {
    this.sequentialInputs.push(value)
    this.text += value
  }
}

class FakePage {
  private readonly hiddenLocator = new FakeLocator({
    visible: false,
    editable: false,
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

describe('typeIfPresent', () => {
  it('fills contenteditable date segments', async () => {
    const yearSegment = new FakeLocator({
      visible: true,
      editable: true,
      contentEditable: true,
    })
    const page = new FakePage({
      '[role="spinbutton"][data-type="year"]': yearSegment,
    })

    await expect(
      typeIfPresent(
        page as never,
        '[role="spinbutton"][data-type="year"]',
        '1999',
      ),
    ).resolves.toBe(true)
    expect(yearSegment.text).toBe('1999')
  })

  it('can type sequentially for auth-style inputs', async () => {
    const emailField = new FakeLocator({
      visible: true,
      editable: true,
    })
    const page = new FakePage({
      'input[type="email"]': emailField,
    })

    await expect(
      typeIfPresent(page as never, 'input[type="email"]', 'a@b.com', {
        settleMs: 500,
        strategy: 'sequential',
      }),
    ).resolves.toBe(true)
    expect(emailField.text).toBe('a@b.com')
    expect(emailField.sequentialInputs.join('')).toBe('a@b.com')
  })
})
