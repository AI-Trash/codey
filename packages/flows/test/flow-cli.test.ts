import { describe, expect, it } from 'vitest'
import { noopFlow } from '../src/flows/noop'
import {
  applyFlowOptionDefaults,
  formatFlowProgressUpdate,
  formatFlowCompletionSummary,
  shouldKeepFlowOpen,
  type FlowOptions,
} from '../src/modules/flow-cli/helpers'

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

  it('treats record as the keep-open switch', () => {
    expect(shouldKeepFlowOpen({})).toBe(false)
    expect(shouldKeepFlowOpen({ record: true })).toBe(true)
    expect(shouldKeepFlowOpen({ record: 'true' })).toBe(true)
    expect(shouldKeepFlowOpen({ record: 'false' })).toBe(false)
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
      passkeyCreated: true,
      passkeyStore: {
        credentials: [{ id: 'cred-1' }],
      },
      storedIdentity: {
        id: 'identity-123',
        email: 'person@example.com',
        storePath: 'C:/tmp/identity.json',
      },
      sameSessionPasskeyCheck: {
        authenticated: true,
      },
      machine: {
        state: 'completed',
      },
    })

    expect(summary).toContain('flow:chatgpt-register completed')
    expect(summary).toContain('email: person@example.com')
    expect(summary).toContain('verified: yes')
    expect(summary).toContain('passkey: created')
    expect(summary).toContain('passkey check: passed')
    expect(summary).toContain('identity: identity-123')
    expect(summary).not.toContain('machine')
    expect(summary).not.toContain('passkeyStore')
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
      storedIdentity: {
        id: 'identity-123',
        email: 'person@example.com',
      },
    })
    const inviteSummary = formatFlowCompletionSummary('flow:chatgpt-login-invite', {
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
    })

    const oauthSummary = formatFlowCompletionSummary('flow:codex-oauth', {
      pageName: 'codex-oauth',
      url: 'https://app.example.com/callback?access_token=secret',
      redirectUri: 'http://localhost:3000/callback?code=secret',
      tokenStorePath: 'C:/tmp/token.json',
      token: {
        accessToken: 'secret',
      },
      axonHub: {
        projectId: 'project-42',
        channel: {
          id: 'channel-1',
          name: 'Codey',
          credentials: {
            oauth: {
              accessToken: 'secret',
            },
          },
        },
      },
    })

    expect(loginSummary).toContain('flow:chatgpt-login completed')
    expect(loginSummary).toContain('email: person@example.com')
    expect(loginSummary).toContain('authenticated: yes')
    expect(loginSummary).toContain('method: password')
    expect(loginSummary).toContain('identity: identity-123')
    expect(loginSummary).not.toContain('token=secret')

    expect(inviteSummary).toContain('strategy: api')
    expect(inviteSummary).toContain('invites: requested 2, invited 1, skipped 1, errored 0')
    expect(inviteSummary).not.toContain('inviteFilePath')
    expect(inviteSummary).not.toContain('token=secret')

    expect(oauthSummary).toContain('channel: Codey')
    expect(oauthSummary).toContain('project: project-42')
    expect(oauthSummary).toContain('token: stored locally')
    expect(oauthSummary).not.toContain('tokenStorePath')
    expect(oauthSummary).not.toContain('accessToken')
    expect(oauthSummary).not.toContain('code=secret')
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
})
