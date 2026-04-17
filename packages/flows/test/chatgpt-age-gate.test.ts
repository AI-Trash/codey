import { describe, expect, it } from 'vitest'
import {
  ADULT_BIRTHDAY,
  ADULT_BIRTH_DAY,
  ADULT_BIRTH_MONTH,
  ADULT_BIRTH_YEAR,
  ADULT_AGE,
  PROFILE_NAME,
} from '../src/modules/chatgpt/common'
import {
  fillAgeGateAge,
  fillAgeGateBirthday,
  fillAgeGateName,
} from '../src/modules/chatgpt/mutations'
import { waitForAgeGateFieldCandidates } from '../src/modules/chatgpt/queries'

class FakePage {
  hiddenBirthdayValue = ''
  supportsHiddenBirthdayInput = true
  readonly locators: Record<string, FakeLocator> = {}
  lastBoundingBoxTarget: FakeLocator | null = null

  private readonly hiddenLocator = new FakeLocator(this, {
    visible: false,
    editable: false,
    attached: false,
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
      attached?: boolean
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
    const attached = this.state.attached ?? this.state.visible ?? true
    const visible = this.state.visible ?? true
    if (options.state === 'visible' && visible) return
    if (options.state === 'hidden' && !visible) return
    if (options.state === 'attached' && attached) return
    if (options.state === 'detached' && !attached) return
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

  it('returns false when the birthday control is visible but cannot be revealed', async () => {
    const page = new FakePage()
    const birthdayGroup = new FakeLocator(page, {
      visible: true,
      editable: false,
    })

    page.locators['[role="group"][id$="-birthday"]'] = birthdayGroup

    await expect(fillAgeGateBirthday(page as never)).resolves.toBe(false)
    expect(birthdayGroup.clickCount).toBeGreaterThan(0)
    expect(birthdayGroup.mouseUpCount).toBeGreaterThan(0)
    expect(page.hiddenBirthdayValue).toBe('')
  })

  it('falls back to the hidden birthday input when the visible birthday control is absent', async () => {
    const page = new FakePage()

    await expect(fillAgeGateBirthday(page as never)).resolves.toBe(true)
    expect(page.hiddenBirthdayValue).toBe(ADULT_BIRTHDAY)
  })
})

describe('age gate text inputs', () => {
  it('prefers the visible age input over the hidden birthday fallback', async () => {
    const page = new FakePage()
    page.locators['input[id*="age"]'] = new FakeLocator(page, {
      visible: true,
      editable: true,
      attached: true,
    })
    page.locators['input[name="birthday"]'] = new FakeLocator(page, {
      visible: false,
      editable: false,
      attached: true,
    })

    await expect(
      waitForAgeGateFieldCandidates(page as never, 200),
    ).resolves.toEqual(['age', 'birthday'])
  })

  it('types the visible name field using the generic name selector fallback', async () => {
    const page = new FakePage()
    const nameInput = new FakeLocator(page, {
      visible: true,
      editable: true,
    })
    nameInput.text = 'stale'
    page.locators['input[id*="name"]'] = nameInput

    await expect(fillAgeGateName(page as never)).resolves.toBe(true)
    expect(nameInput.text).toBe(PROFILE_NAME)
  })

  it('types the visible age field so the value is present in the input', async () => {
    const page = new FakePage()
    const ageInput = new FakeLocator(page, {
      visible: true,
      editable: true,
    })
    ageInput.text = '1'
    page.locators['input[id*="age"]'] = ageInput

    await expect(fillAgeGateAge(page as never)).resolves.toBe(true)
    expect(ageInput.text).toBe(ADULT_AGE)
  })
})
