import { afterEach, describe, expect, it, vi } from 'vitest'
import { continueCodexOrganizationSelection } from '../src/modules/chatgpt/mutations'

class FakeLocator {
  clickCount = 0

  constructor(
    readonly state: {
      visible?: boolean
      enabled?: boolean
    } = {},
  ) {}

  first(): FakeLocator {
    return this
  }

  async isVisible(): Promise<boolean> {
    return this.state.visible ?? false
  }

  async waitFor(options: {
    state: 'visible' | 'hidden' | 'attached' | 'detached'
    timeout?: number
  }): Promise<void> {
    const visible = this.state.visible ?? false
    if (options.state === 'visible' && visible) return
    if (options.state === 'hidden' && !visible) return
    throw new Error(`State ${options.state} not reached`)
  }

  async evaluate(): Promise<boolean> {
    return this.state.enabled ?? this.state.visible ?? false
  }

  async isEnabled(): Promise<boolean> {
    return this.state.enabled ?? false
  }

  async click(): Promise<void> {
    if (!(this.state.visible ?? false)) {
      throw new Error('Locator is not visible')
    }
    this.clickCount += 1
  }

  async elementHandle(): Promise<{
    locator: FakeLocator
    dispose: () => Promise<void>
  }> {
    return {
      locator: this,
      dispose: async (): Promise<void> => {},
    }
  }
}

class FakePage {
  readonly currentUrl =
    'https://auth.openai.com/sign-in-with-chatgpt/codex/organization'
  readonly organizationLocator = new FakeLocator({
    visible: true,
  })
  readonly submitLocator = new FakeLocator({
    visible: true,
    enabled: true,
  })
  readonly hiddenLocator = new FakeLocator({
    visible: false,
    enabled: false,
  })

  url(): string {
    return this.currentUrl
  }

  locator(selector: string): FakeLocator {
    switch (selector) {
      case 'select[name="organization_id"]':
        return this.organizationLocator
      case 'form button[type="submit"]':
      case 'button[type="submit"]':
        return this.submitLocator
      default:
        return this.hiddenLocator
    }
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

  async evaluate(
    _fn: unknown,
    arg?: {
      fieldName?: 'organization_id' | 'project_id'
      requestedIndex?: number
    },
  ): Promise<
    | {
        availableOptions: number
        selectedOptionIndex: number
        status: 'selected' | 'out_of_range' | 'missing'
      }
    | boolean
  > {
    if (arg?.fieldName === 'organization_id') {
      return {
        availableOptions: 1,
        selectedOptionIndex: 1,
        status: 'selected',
      }
    }

    if (arg?.fieldName === 'project_id') {
      return {
        availableOptions: 0,
        selectedOptionIndex: 0,
        status: 'missing',
      }
    }

    return false
  }

  async waitForFunction(
    _fn: unknown,
    handle: {
      locator: FakeLocator
    },
  ): Promise<void> {
    if (
      (await handle.locator.isVisible()) &&
      (await handle.locator.isEnabled())
    ) {
      return
    }

    throw new Error('Element did not become enabled')
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('continueCodexOrganizationSelection', () => {
  it('falls back to the default project when the picker does not expose project_id', async () => {
    vi.useFakeTimers()
    const page = new FakePage()

    const selectionPromise = continueCodexOrganizationSelection(page as never)

    await vi.runAllTimersAsync()

    await expect(selectionPromise).resolves.toEqual({
      availableOrganizations: 1,
      selectedOrganizationIndex: 1,
      availableProjects: 1,
      selectedProjectIndex: 1,
    })
    expect(page.submitLocator.clickCount).toBe(1)
  })
})
