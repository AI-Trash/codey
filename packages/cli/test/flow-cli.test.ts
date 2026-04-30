import { describe, expect, it, vi } from 'vitest'
import { noopFlow } from '../src/flows/noop'
import {
  attachStateMachineProgressReporter,
  applyFlowOptionDefaults,
  createConsoleFlowProgressReporter,
  formatFlowProgressUpdate,
  formatFlowCompletionSummary,
  keepBrowserOpenForHarWhenUnspecified,
  printFlowCompletionSummary,
  reportError,
  shouldRecordPageContent,
  shouldKeepFlowOpen,
  type FlowOptions,
} from '../src/modules/flow-cli/helpers'
import { parseFlowCliArgsForCommand } from '../src/modules/flow-cli/parse-argv'
import { assignContext, createStateMachine } from '../src/state-machine'
import { withCliOutput } from '../src/utils/cli-output'

describe('flow cli helpers', () => {
  it('applies flow defaults without overriding explicit values', () => {
    const defaults = applyFlowOptionDefaults<FlowOptions>(
      {},
      {
        har: true,
        record: true,
      },
    )
    expect(defaults.har).toBe(true)
    expect(defaults.record).toBe(true)

    const explicit = applyFlowOptionDefaults<FlowOptions>(
      { har: false, record: false },
      { har: true, record: true },
    )
    expect(explicit.har).toBe(false)
    expect(explicit.record).toBe(false)
  })

  it('defaults record to true when chromeDefaultProfile is enabled', () => {
    expect(
      applyFlowOptionDefaults<FlowOptions>({
        chromeDefaultProfile: true,
      }),
    ).toMatchObject({
      chromeDefaultProfile: true,
      record: true,
    })

    expect(
      applyFlowOptionDefaults<FlowOptions>({
        chromeDefaultProfile: true,
        record: false,
      }),
    ).toMatchObject({
      chromeDefaultProfile: true,
      record: false,
    })
  })

  it('treats record as the keep-open switch', () => {
    expect(shouldKeepFlowOpen({})).toBe(false)
    expect(shouldKeepFlowOpen({ record: true })).toBe(true)
    expect(shouldKeepFlowOpen({ record: 'true' })).toBe(true)
    expect(shouldKeepFlowOpen({ record: 'false' })).toBe(false)
  })

  it('treats recordPageContent as the stable HTML capture switch', () => {
    expect(shouldRecordPageContent({})).toBe(false)
    expect(shouldRecordPageContent({ recordPageContent: true })).toBe(true)
    expect(shouldRecordPageContent({ recordPageContent: 'true' })).toBe(true)
    expect(shouldRecordPageContent({ recordPageContent: 'false' })).toBe(false)
  })

  it('parses restoreStorageState for ChatGPT login flows', () => {
    expect(
      parseFlowCliArgsForCommand('chatgpt-login', [
        '--email',
        'person@example.com',
        '--restoreStorageState',
        'true',
      ]),
    ).toMatchObject({
      email: 'person@example.com',
      restoreStorageState: true,
    })
  })

  it('parses the register trial continuation switch', () => {
    expect(
      parseFlowCliArgsForCommand('chatgpt-register', [
        '--claimTrial',
        'true',
        '--billingCountry',
        'NL',
      ]),
    ).toMatchObject({
      claimTrial: 'paypal',
      billingCountry: 'NL',
    })
  })

  it('parses Android healthcheck options', () => {
    expect(
      parseFlowCliArgsForCommand('android-healthcheck', [
        '--appiumServerUrl',
        'http://127.0.0.1:4723',
        '--androidUdid',
        'emulator-5554',
        '--androidNoReset',
        'false',
      ]),
    ).toMatchObject({
      appiumServerUrl: 'http://127.0.0.1:4723',
      androidUdid: 'emulator-5554',
      androidNoReset: false,
    })
  })

  it('defaults record to true when HAR is enabled and record is unspecified', () => {
    expect(keepBrowserOpenForHarWhenUnspecified({ har: true })).toMatchObject({
      har: true,
      record: true,
    })
    expect(
      keepBrowserOpenForHarWhenUnspecified({ har: true, record: false }),
    ).toMatchObject({
      har: true,
      record: false,
    })
    expect(keepBrowserOpenForHarWhenUnspecified({ har: false })).toMatchObject({
      har: false,
    })
  })

  it('defaults noop flow to har and record enabled', () => {
    expect(noopFlow.defaultOptions).toMatchObject({
      har: true,
      record: true,
    })
  })

  it('renders a compact register flow summary without machine or artifact details', () => {
    const summary = formatFlowCompletionSummary('flow:chatgpt-register', {
      pageName: 'chatgpt-register',
      url: 'https://chatgpt.com/?mfa_token=secret',
      title: 'ChatGPT',
      email: 'person@example.com',
      verified: true,
      harPath: 'C:/tmp/flow-chatgpt-register.har',
      pageContentPath: 'C:/tmp/flow-chatgpt-register-page-content.html',
      storedIdentity: {
        id: 'identity-123',
        email: 'person@example.com',
        storePath: 'C:/tmp/identity.json',
      },
      machine: {
        state: 'completed',
      },
    })

    expect(summary).toContain('flow:chatgpt-register completed')
    expect(summary).toContain('email: person@example.com')
    expect(summary).toContain('verified: yes')
    expect(summary).toContain('identity: identity-123')
    expect(summary).toContain('har: C:/tmp/flow-chatgpt-register.har')
    expect(summary).toContain(
      'page content: C:/tmp/flow-chatgpt-register-page-content.html',
    )
    expect(summary).not.toContain('machine')
    expect(summary).not.toContain('storePath')
    expect(summary).not.toContain('mfa_token')
    expect(summary).not.toContain('?')
  })

  it('prints the captured PayPal URL for register-to-trial runs', () => {
    const paypalUrl =
      'https://www.paypal.com/pay?ssrt=1777211592082&token=BA-5YL10191GX878080G&ul=1'
    const summary = formatFlowCompletionSummary('flow:chatgpt-register', {
      pageName: 'chatgpt-register',
      url: 'https://www.paypal.com/pay?token=BA-5YL10191GX878080G',
      email: 'person@example.com',
      verified: true,
      storedIdentity: {
        id: 'identity-123',
        email: 'person@example.com',
      },
      trial: {
        coupon: 'team-1-month-free',
        plan: 'team',
        paypalApprovalUrl: paypalUrl,
        paypalApprovalUrlPath: 'C:/tmp/paypal-link.txt',
      },
    })

    expect(summary).toContain('flow:chatgpt-register completed')
    expect(summary).toContain('email: person@example.com')
    expect(summary).toContain('trial: team')
    expect(summary).toContain(`payment url: ${paypalUrl}`)
    expect(summary).toContain('payment url file: C:/tmp/paypal-link.txt')
    expect(summary).not.toContain('machine')
  })

  it('renders compact invite and oauth summaries without artifact payloads', () => {
    const loginSummary = formatFlowCompletionSummary('flow:chatgpt-login', {
      pageName: 'chatgpt-login',
      url: 'https://chatgpt.com/?token=secret',
      email: 'person@example.com',
      authenticated: true,
      method: 'password',
      harPath: 'C:/tmp/flow-chatgpt-login.har',
      storedIdentity: {
        id: 'identity-123',
        email: 'person@example.com',
      },
    })
    const inviteSummary = formatFlowCompletionSummary('flow:chatgpt-invite', {
      pageName: 'chatgpt-invite',
      url: 'https://chatgpt.com/admin?token=secret',
      email: 'person@example.com',
      workspaceId: 'workspace-123',
      authenticated: true,
      invites: {
        strategy: 'api',
        requestedEmails: ['a@example.com', 'b@example.com'],
        invitedEmails: ['a@example.com'],
        skippedEmails: ['b@example.com'],
        erroredEmails: [],
      },
      inviteInputs: {
        inviteFilePath: 'C:/tmp/members.csv',
      },
    })

    const oauthSummary = formatFlowCompletionSummary('flow:codex-oauth', {
      pageName: 'codex-oauth',
      url: 'https://app.example.com/callback?access_token=secret',
      email: 'person@example.com',
      redirectUri: 'http://localhost:3000/callback?code=secret',
      harPath: 'C:/tmp/flow-codex-oauth.har',
      tokenStorePath: 'C:/tmp/token.json',
      apiHarPath: 'C:/tmp/flow-codex-oauth-api.har',
      token: {
        accessToken: 'secret',
      },
      codeyApp: {
        identityId: 'identity-123',
        sessionRecordId: 'managed-session-1',
      },
    })

    expect(loginSummary).toContain('flow:chatgpt-login completed')
    expect(loginSummary).toContain('email: person@example.com')
    expect(loginSummary).toContain('authenticated: yes')
    expect(loginSummary).toContain('method: password')
    expect(loginSummary).toContain('identity: identity-123')
    expect(loginSummary).toContain('har: C:/tmp/flow-chatgpt-login.har')
    expect(loginSummary).not.toContain('token=secret')

    expect(inviteSummary).toContain('strategy: api')
    expect(inviteSummary).toContain('workspace: workspace-123')
    expect(inviteSummary).toContain(
      'invites: requested 2, invited 1, skipped 1, errored 0',
    )
    expect(inviteSummary).not.toContain('inviteFilePath')
    expect(inviteSummary).not.toContain('token=secret')

    expect(oauthSummary).toContain('email: person@example.com')
    expect(oauthSummary).toContain('shared identity: identity-123')
    expect(oauthSummary).toContain('shared session: managed-session-1')
    expect(oauthSummary).toContain('token: stored in Codey app')
    expect(oauthSummary).toContain('har: C:/tmp/flow-codex-oauth.har')
    expect(oauthSummary).toContain('api har: C:/tmp/flow-codex-oauth-api.har')
    expect(oauthSummary).not.toContain('tokenStorePath')
    expect(oauthSummary).not.toContain('accessToken')
    expect(oauthSummary).not.toContain('apiHarPath')
    expect(oauthSummary).not.toContain('code=secret')
  })

  it('prints the full oauth url when codex oauth exits in authorize-url-only mode', () => {
    const summary = formatFlowCompletionSummary('flow:codex-oauth', {
      pageName: 'codex-oauth-authorize-url',
      url: 'https://auth.openai.com/oauth/authorize',
      redirectUri: 'http://localhost:1455/auth/callback',
      harPath: 'C:/tmp/flow-codex-oauth.har',
      oauthUrl:
        'https://auth.openai.com/oauth/authorize?client_id=codex-client-id&state=manual-debug',
    })

    expect(summary).toContain('flow:codex-oauth completed')
    expect(summary).toContain('redirect: http://localhost:1455/auth/callback')
    expect(summary).toContain('har: C:/tmp/flow-codex-oauth.har')
    expect(summary).toContain(
      'oauth url: https://auth.openai.com/oauth/authorize?client_id=codex-client-id&state=manual-debug',
    )
  })

  it('prints the captured PayPal URL for ChatGPT trial', () => {
    const paypalUrl =
      'https://www.paypal.com/pay?ssrt=1777211592082&token=BA-5YL10191GX878080G&ul=1'
    const summary = formatFlowCompletionSummary('flow:chatgpt-team-trial', {
      pageName: 'chatgpt-team-trial',
      url: 'https://www.paypal.com/pay?token=BA-5YL10191GX878080G',
      email: 'person@example.com',
      authenticated: true,
      checkoutUrl: 'https://chatgpt.com/checkout/openai_ie/cs_live_123',
      paypalApprovalUrl: paypalUrl,
      paypalApprovalUrlPath: 'C:/tmp/paypal-link.txt',
    })

    expect(summary).toContain('flow:chatgpt-team-trial completed')
    expect(summary).toContain('email: person@example.com')
    expect(summary).toContain(
      'checkout: https://chatgpt.com/checkout/openai_ie/cs_live_123',
    )
    expect(summary).toContain(`payment url: ${paypalUrl}`)
    expect(summary).toContain('payment url file: C:/tmp/paypal-link.txt')
  })

  it('renders Android healthcheck summaries', () => {
    const summary = formatFlowCompletionSummary('flow:android-healthcheck', {
      pageName: 'android-healthcheck',
      connected: true,
      appiumSessionId: 'appium-session-1',
      device: {
        deviceName: 'Pixel 8',
        udid: 'emulator-5554',
        automationName: 'UiAutomator2',
        currentPackage: 'com.example.app',
      },
    })

    expect(summary).toContain('flow:android-healthcheck completed')
    expect(summary).toContain('connected: yes')
    expect(summary).toContain('appium session: appium-session-1')
    expect(summary).toContain('device: Pixel 8')
    expect(summary).toContain('udid: emulator-5554')
    expect(summary).toContain('automation: UiAutomator2')
    expect(summary).toContain('current package: com.example.app')
  })

  it('formats live flow progress updates with state-machine transitions', () => {
    const progress = formatFlowProgressUpdate('flow:chatgpt-register', {
      status: 'running',
      fromState: 'email-step',
      toState: 'verification-polling',
      state: 'verification-polling',
      event: 'chatgpt.password.submitted',
      message: 'Polling verification provider for verification code',
      attempt: 3,
    })

    const failure = formatFlowProgressUpdate('flow:chatgpt-register', {
      status: 'failed',
      message: 'ChatGPT registration failed',
      error: 'Verification code=secret was rejected',
    })

    expect(progress).toBe(
      '[flow:chatgpt-register] email-step --chatgpt.password.submitted--> verification-polling | Polling verification provider for verification code (attempt 3)',
    )
    expect(failure).toContain('ChatGPT registration failed')
    expect(failure).toContain('Verification code=***redacted*** was rejected')
  })

  it('reports state-machine transition snapshots to the progress reporter', async () => {
    const machine = createStateMachine<
      'idle' | 'done',
      {
        lastMessage?: string
      },
      'finish'
    >({
      id: 'test.flow.progress',
      initialState: 'idle',
      initialContext: {},
      states: {
        idle: {
          on: {
            finish: {
              target: 'done',
              actions: assignContext(() => ({
                lastMessage: 'Flow finished',
              })),
            },
          },
        },
        done: {},
      },
    })

    const updates: Array<Record<string, unknown>> = []
    const detach = attachStateMachineProgressReporter(machine, (update) => {
      updates.push(update as Record<string, unknown>)
    })

    machine.start({
      lastMessage: 'Flow started',
    })
    await machine.send('finish')
    detach()

    expect(updates[0]).toMatchObject({
      state: 'idle',
      event: 'machine.started',
      fromState: 'idle',
      toState: 'idle',
      message: 'Flow started',
    })
    expect(updates.at(-1)).toMatchObject({
      state: 'done',
      event: 'finish',
      fromState: 'idle',
      toState: 'done',
      message: 'Flow finished',
    })
  })

  it('routes flow output through the configured cli sink', async () => {
    const stdout: string[] = []
    const stderr: string[] = []

    await withCliOutput(
      {
        stdoutLine: (line) => {
          stdout.push(line)
        },
        stderrLine: (line) => {
          stderr.push(line)
        },
      },
      async () => {
        printFlowCompletionSummary('flow:chatgpt-login', {
          pageName: 'chatgpt-login',
          email: 'person@example.com',
          authenticated: true,
        })

        const reportProgress =
          createConsoleFlowProgressReporter('flow:chatgpt-login')
        reportProgress({
          status: 'running',
          message: 'Opening ChatGPT login entry',
        })
        reportProgress({
          status: 'running',
          message: 'Opening ChatGPT login entry',
        })
      },
    )

    expect(stdout).toHaveLength(1)
    expect(stdout[0]).toContain('flow:chatgpt-login completed')
    expect(stdout[0]).toContain('email: person@example.com')
    expect(stderr).toEqual(['[flow:chatgpt-login] Opening ChatGPT login entry'])
  })

  it('reports top-level errors without forcing an immediate process exit', async () => {
    const previousExitCode = process.exitCode
    process.exitCode = undefined
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: string | number | null | undefined,
    ) => {
      throw new Error(`unexpected process.exit(${String(code)})`)
    }) as typeof process.exit)

    const stderr: string[] = []

    try {
      await withCliOutput(
        {
          stdoutLine: () => {},
          stderrLine: (line) => {
            stderr.push(line)
          },
        },
        async () => {
          reportError(new Error('runner failed'))
        },
      )

      expect(exitSpy).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
      expect(stderr.join('\n')).toContain('"status": "failed"')
      expect(stderr.join('\n')).toContain('"error": "runner failed"')
    } finally {
      process.exitCode = previousExitCode
      exitSpy.mockRestore()
    }
  })
})
