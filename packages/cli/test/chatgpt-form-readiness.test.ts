import { describe, expect, it } from 'vitest'
import {
  getCodexOAuthSurfaceCandidates,
  getLoginEntryCandidates,
  isOpenAIWorkspacePickerReady,
  waitForEnabledSelector,
  waitForEditableSelector,
  waitForLoginEmailFormReady,
  waitForLoginSurfaceCandidates,
  waitForRegistrationEntryCandidates,
} from '../src/modules/chatgpt/queries'
import { OpenAIBrowserChallengeError } from '../src/modules/chatgpt/errors'

class FakeLocator {
  editableChecks = 0

  constructor(
    private readonly options: {
      count?: number
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

  async count(): Promise<number> {
    return this.options.count ?? ((this.options.visible ?? false) ? 1 : 0)
  }

  configuredVisible(): boolean {
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

  async isEnabled(): Promise<boolean> {
    return this.evaluate()
  }
}

class FakePage {
  private readonly hiddenLocator = new FakeLocator({
    visible: false,
    editableSequence: [false],
  })

  constructor(
    private readonly locators: Record<string, FakeLocator>,
    private readonly currentUrl = 'https://auth.openai.com/log-in-or-create-account',
    private readonly semanticLocators: {
      role?: FakeLocator
      text?: FakeLocator
      label?: FakeLocator
      placeholder?: FakeLocator
      testId?: FakeLocator
    } = {},
    private readonly pageTitle = '',
  ) {}

  locator(selector: string): FakeLocator {
    return this.locators[selector] ?? this.hiddenLocator
  }

  url(): string {
    return this.currentUrl
  }

  async title(): Promise<string> {
    return this.pageTitle
  }

  getByRole(): FakeLocator {
    return this.semanticLocators.role ?? this.hiddenLocator
  }

  getByText(): FakeLocator {
    return this.semanticLocators.text ?? this.hiddenLocator
  }

  getByLabel(): FakeLocator {
    return this.semanticLocators.label ?? this.hiddenLocator
  }

  getByPlaceholder(): FakeLocator {
    return this.semanticLocators.placeholder ?? this.hiddenLocator
  }

  getByTestId(): FakeLocator {
    return this.semanticLocators.testId ?? this.hiddenLocator
  }

  async evaluate(fn?: unknown): Promise<boolean> {
    const source = typeof fn === 'function' ? String(fn) : ''
    if (source.includes('button[name="workspace_id"][value]')) {
      return (
        this.locators[
          'button[name="workspace_id"][value]'
        ]?.configuredVisible() ?? false
      )
    }

    return false
  }
}

describe('waitForEditableSelector', () => {
  it('waits until a visible button becomes enabled', async () => {
    const submitLocator = new FakeLocator({
      visible: true,
      editableSequence: [false, false, true],
    })
    const page = new FakePage({
      'button[type="submit"]': submitLocator,
    })

    await expect(
      waitForEnabledSelector(page as never, ['button[type="submit"]'], 800),
    ).resolves.toBe(true)
    expect(submitLocator.editableChecks).toBeGreaterThanOrEqual(3)
  })

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

  it('treats the new /log-in page as a valid email login surface', async () => {
    const emailLocator = new FakeLocator({
      visible: true,
      editableSequence: [true],
    })
    const page = new FakePage(
      {
        'input#email': emailLocator,
      },
      'https://auth.openai.com/log-in',
    )

    await expect(waitForLoginEmailFormReady(page as never, 300)).resolves.toBe(
      true,
    )
  })

  it('detects an email login candidate from DOM signals even when the URL is unrelated', async () => {
    const emailLocator = new FakeLocator({
      visible: true,
      editableSequence: [true],
    })
    const continueLocator = new FakeLocator({
      visible: true,
    })
    const page = new FakePage(
      {
        'input#email': emailLocator,
        'button[type="submit"]': continueLocator,
      },
      'https://example.com/not-a-login-url',
    )

    await expect(getLoginEntryCandidates(page as never)).resolves.toContain(
      'email',
    )
  })

  it('detects the codex organization picker from the organization route', async () => {
    const organizationLocator = new FakeLocator({
      visible: true,
    })
    const submitLocator = new FakeLocator({
      visible: true,
      editableSequence: [true],
    })
    const page = new FakePage(
      {
        'select[name="organization_id"]': organizationLocator,
        'button[type="submit"]': submitLocator,
      },
      'https://auth.openai.com/sign-in-with-chatgpt/codex/organization',
    )

    await expect(
      getCodexOAuthSurfaceCandidates(page as never),
    ).resolves.toContain('organization')
  })

  it('detects the OpenAI workspace picker when workspaces are submit buttons', async () => {
    const workspaceButton = new FakeLocator({
      visible: true,
      editableSequence: [true],
    })
    const page = new FakePage(
      {
        'button[name="workspace_id"][value]': workspaceButton,
      },
      'https://auth.openai.com/workspace',
    )

    await expect(isOpenAIWorkspacePickerReady(page as never)).resolves.toBe(
      true,
    )
  })

  it('fails fast when registration entry is blocked by a browser challenge', async () => {
    const challengeMarker = new FakeLocator({
      count: 1,
      visible: false,
    })
    const page = new FakePage(
      {
        'input[name="cf-turnstile-response"]': challengeMarker,
      },
      'https://chatgpt.com/auth/login',
      {},
      '请稍候…',
    )

    await expect(
      waitForRegistrationEntryCandidates(page as never, 1000),
    ).rejects.toBeInstanceOf(OpenAIBrowserChallengeError)
  })

  it('fails fast when login entry is blocked by a browser challenge', async () => {
    const challengeMarker = new FakeLocator({
      count: 1,
      visible: false,
    })
    const page = new FakePage(
      {
        'input[name="cf-turnstile-response"]': challengeMarker,
      },
      'https://chatgpt.com/auth/login',
      {},
      'Just a moment...',
    )

    await expect(
      waitForLoginSurfaceCandidates(page as never, 1000),
    ).rejects.toBeInstanceOf(OpenAIBrowserChallengeError)
  })
})
