import { describe, expect, it } from 'vitest'
import { noopFlow } from '../src/flows/noop'
import {
  applyFlowOptionDefaults,
  createConsoleFlowProgressReporter,
  formatFlowProgressUpdate,
  formatFlowCompletionSummary,
  keepBrowserOpenForHarWhenUnspecified,
  printFlowCompletionSummary,
  shouldKeepFlowOpen,
  type FlowOptions,
} from '../src/modules/flow-cli/helpers'
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
    expect(summary).not.toContain('machine')
    expect(summary).not.toContain('storePath')
    expect(summary).not.toContain('mfa_token')
    expect(summary).not.toContain('?')
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
    const inviteSummary = formatFlowCompletionSummary(
      'flow:chatgpt-login-invite',
      {
        pageName: 'chatgpt-login-invite',
        url: 'https://chatgpt.com/admin?token=secret',
        email: 'person@example.com',
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
      },
    )

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

  it('formats live flow progress updates as readable one-line messages', () => {
    const progress = formatFlowProgressUpdate('flow:chatgpt-register', {
      status: 'running',
      state: 'verification-polling',
      event: 'context.updated',
      message: 'Polling verification provider for verification code',
      attempt: 3,
    })

    const failure = formatFlowProgressUpdate('flow:chatgpt-register', {
      status: 'failed',
      message: 'ChatGPT registration failed',
      error: 'Verification code=secret was rejected',
    })

    expect(progress).toBe(
      '[flow:chatgpt-register] Polling verification provider for verification code (attempt 3)',
    )
    expect(failure).toContain('ChatGPT registration failed')
    expect(failure).toContain('Verification code=***redacted*** was rejected')
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
})
