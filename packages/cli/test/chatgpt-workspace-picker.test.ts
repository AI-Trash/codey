import { describe, expect, it } from 'vitest'
import { continueOpenAIWorkspaceSelection } from '../src/modules/chatgpt/mutations'

class FakeLocator {
  clicks = 0

  constructor(private readonly visible = true) {}

  first(): FakeLocator {
    return this
  }

  async waitFor(options: {
    state: 'visible' | 'hidden' | 'attached' | 'detached'
    timeout?: number
  }): Promise<void> {
    if (options.state === 'visible' && this.visible) return
    if (options.state === 'hidden' && !this.visible) return
    throw new Error(`State ${options.state} not reached`)
  }

  async isVisible(): Promise<boolean> {
    return this.visible
  }

  async count(): Promise<number> {
    return this.visible ? 1 : 0
  }

  async evaluate(): Promise<boolean> {
    return this.visible
  }

  async isEnabled(): Promise<boolean> {
    return this.visible
  }

  async click(): Promise<void> {
    this.clicks += 1
  }
}

interface WorkspaceButton {
  value: string
  locator: FakeLocator
}

class FakePage {
  private readonly hiddenLocator = new FakeLocator(false)

  constructor(private readonly workspaceButtons: WorkspaceButton[]) {}

  locator(selector: string): FakeLocator {
    const button = this.workspaceButtons.find(
      (candidate) =>
        selector === `button[name="workspace_id"][value="${candidate.value}"]`,
    )
    return button?.locator ?? this.hiddenLocator
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
    fn?: unknown,
    arg?: { requestedIndex?: number; preferredWorkspaceId?: string },
  ): Promise<unknown> {
    const source = typeof fn === 'function' ? String(fn) : ''
    if (
      source.includes('document.querySelectorAll') &&
      source.includes('button[name="workspace_id"][value]')
    ) {
      const requestedIndex = Math.max(1, arg?.requestedIndex ?? 1)
      const preferredWorkspaceId = arg?.preferredWorkspaceId?.trim() || ''
      const matchedIndex = preferredWorkspaceId
        ? this.workspaceButtons.findIndex(
            (button) => button.value === preferredWorkspaceId,
          ) + 1
        : 0
      const selectedIndex = matchedIndex || requestedIndex

      if (selectedIndex > this.workspaceButtons.length) {
        return {
          availableWorkspaces: this.workspaceButtons.length,
          selectedWorkspaceIndex: 0,
          selectionStrategy: 'index',
          status: 'out_of_range',
        }
      }

      const button = this.workspaceButtons[selectedIndex - 1]
      return {
        availableWorkspaces: this.workspaceButtons.length,
        selectedWorkspaceIndex: selectedIndex,
        selectedWorkspaceId: button?.value,
        selectionStrategy: matchedIndex ? 'workspace_id' : 'index',
        status: 'selected',
        submitKind: 'selected-button',
      }
    }

    if (
      source.includes('document.querySelector(') &&
      source.includes('button[name="workspace_id"][value]')
    ) {
      return this.workspaceButtons.length > 0
    }

    return false
  }
}

describe('continueOpenAIWorkspaceSelection', () => {
  it('clicks a workspace button when the picker uses submit buttons', async () => {
    const firstWorkspace = new FakeLocator()
    const personalWorkspace = new FakeLocator()
    const page = new FakePage([
      { value: 'workspace-team', locator: firstWorkspace },
      { value: 'workspace-personal', locator: personalWorkspace },
    ])

    const result = await continueOpenAIWorkspaceSelection(page as never, 1)

    expect(result).toMatchObject({
      availableWorkspaces: 2,
      selectedWorkspaceIndex: 1,
      selectedWorkspaceId: 'workspace-team',
      selectionStrategy: 'index',
    })
    expect(firstWorkspace.clicks).toBe(1)
    expect(personalWorkspace.clicks).toBe(0)
  })
})
