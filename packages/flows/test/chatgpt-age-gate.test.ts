import { describe, expect, it } from 'vitest'
import {
  ADULT_BIRTHDAY,
  ADULT_BIRTH_DAY,
  ADULT_BIRTH_MONTH,
  ADULT_BIRTH_YEAR,
} from '../src/modules/chatgpt/common'
import { fillAgeGateBirthday } from '../src/modules/chatgpt/mutations'

class FakePage {
  hiddenBirthdayValue = ''
  supportsHiddenBirthdayInput = true
  readonly locators: Record<string, FakeLocator> = {}
  lastBoundingBoxTarget: FakeLocator | null = null

  private readonly hiddenLocator = new FakeLocator(this, {
    visible: false,
    editable: false,
  })

  readonly mouse = {
    move: async (_x: number, _y: number): Promise<void> => {},
    down: async (): Promise<void> => {
      this.lastBoundingBoxTarget?.state.onMouseDown?.()
    },
    up: async (): Promise<void> => {
      this.lastBoundingBoxTarget?.notifyMouseUp()
    },
  }

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

  async evaluate(_fn: unknown, arg?: unknown): Promise<boolean> {
    if (
      arg &&
      typeof arg === 'object' &&
      'selector' in arg &&
      'value' in arg &&
      (arg as { selector: string }).selector === 'input[name="birthday"]'
    ) {
      if (!this.supportsHiddenBirthdayInput) return false
      this.hiddenBirthdayValue = String((arg as { value: string }).value)
      return true
    }

    if (typeof arg === 'string') {
      return this.hiddenBirthdayValue === arg
    }

    return false
  }
}

class FakeLocator {
  text = ''
  clickCount = 0
  mouseUpCount = 0

  constructor(
    private readonly page: FakePage,
    readonly state: {
      visible?: boolean
      editable?: boolean
      onClick?: () => void
      onMouseDown?: () => void
      onMouseUp?: () => void
    } = {},
  ) {}

  first(): FakeLocator {
    return this
  }

  async isVisible(): Promise<boolean> {
    return this.state.visible ?? true
  }

  async waitFor(options: {
    state: 'visible' | 'hidden' | 'attached' | 'detached'
    timeout?: number
  }): Promise<void> {
    const visible = this.state.visible ?? true
    if (options.state === 'visible' && visible) return
    if (options.state === 'hidden' && !visible) return
    throw new Error(`State ${options.state} not reached`)
  }

  async evaluate(_fn: unknown, expected?: string): Promise<boolean> {
    if (typeof expected === 'string') {
      return this.text === expected
    }
    return this.state.editable ?? true
  }

  async isEditable(): Promise<boolean> {
    return this.state.editable ?? true
  }

  async click(): Promise<void> {
    this.clickCount += 1
    this.state.onClick?.()
  }

  async scrollIntoViewIfNeeded(): Promise<void> {}

  async boundingBox(): Promise<{
    x: number
    y: number
    width: number
    height: number
  } | null> {
    this.page.lastBoundingBoxTarget = this
    if (!(this.state.visible ?? true)) return null
    return { x: 10, y: 20, width: 120, height: 36 }
  }

  notifyMouseUp(): void {
    this.mouseUpCount += 1
    this.state.onMouseUp?.()
  }

  async fill(value: string): Promise<void> {
    this.text = value
    this.syncBirthday()
  }

  async blur(): Promise<void> {}

  async pressSequentially(value: string): Promise<void> {
    this.text += value
    this.syncBirthday()
  }

  private syncBirthday(): void {
    const year =
      this.page.locators['[role="spinbutton"][data-type="year"]']?.text ?? ''
    const month =
      this.page.locators['[role="spinbutton"][data-type="month"]']?.text ?? ''
    const day =
      this.page.locators['[role="spinbutton"][data-type="day"]']?.text ?? ''

    if (
      year === ADULT_BIRTH_YEAR &&
      month === ADULT_BIRTH_MONTH &&
      day === ADULT_BIRTH_DAY
    ) {
      this.page.hiddenBirthdayValue = ADULT_BIRTHDAY
    }
  }
}

describe('fillAgeGateBirthday', () => {
  it('clicks the birthday trigger before typing into date segments', async () => {
    const page = new FakePage()
    const yearSegment = new FakeLocator(page, {
      visible: false,
      editable: true,
    })
    const monthSegment = new FakeLocator(page, {
      visible: false,
      editable: true,
    })
    const daySegment = new FakeLocator(page, {
      visible: false,
      editable: true,
    })
    const birthdayGroup = new FakeLocator(page, {
      visible: true,
      editable: false,
      onMouseUp: () => {
        yearSegment.state.visible = true
        monthSegment.state.visible = true
        daySegment.state.visible = true
      },
    })

    page.locators['[role="group"][id$="-birthday"]'] = birthdayGroup
    page.locators['[role="spinbutton"][data-type="year"]'] = yearSegment
    page.locators['[role="spinbutton"][data-type="month"]'] = monthSegment
    page.locators['[role="spinbutton"][data-type="day"]'] = daySegment

    await expect(fillAgeGateBirthday(page as never)).resolves.toBe(true)
    expect(birthdayGroup.clickCount).toBeGreaterThan(0)
    expect(birthdayGroup.mouseUpCount).toBeGreaterThan(0)
    expect(yearSegment.text).toBe(ADULT_BIRTH_YEAR)
    expect(monthSegment.text).toBe(ADULT_BIRTH_MONTH)
    expect(daySegment.text).toBe(ADULT_BIRTH_DAY)
    expect(page.hiddenBirthdayValue).toBe(ADULT_BIRTHDAY)
  })

  it('falls back to the hidden birthday input if segments never reveal', async () => {
    const page = new FakePage()
    const birthdayGroup = new FakeLocator(page, {
      visible: true,
      editable: false,
    })

    page.locators['[role="group"][id$="-birthday"]'] = birthdayGroup

    await expect(fillAgeGateBirthday(page as never)).resolves.toBe(true)
    expect(birthdayGroup.clickCount).toBeGreaterThan(0)
    expect(birthdayGroup.mouseUpCount).toBeGreaterThan(0)
    expect(page.hiddenBirthdayValue).toBe(ADULT_BIRTHDAY)
  })
})
