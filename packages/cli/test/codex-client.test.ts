import { describe, expect, it } from 'vitest'
import { startCodexAuthorization } from '../src/modules/authorization/codex-client'

describe('startCodexAuthorization', () => {
  it('includes the simplified Codex CLI flow param by default', () => {
    const started = startCodexAuthorization({
      authorizeUrl: 'https://auth.openai.com/oauth/authorize',
      clientId: 'codex-client-id',
      scope: 'openid profile email offline_access',
      redirectHost: 'localhost',
      redirectPort: 1455,
      redirectPath: '/auth/callback',
      openBrowserWindow: false,
    })

    const authorizationUrl = new URL(started.authorizationUrl)

    expect(authorizationUrl.searchParams.get('codex_cli_simplified_flow')).toBe(
      'true',
    )
    expect(authorizationUrl.searchParams.get('allowed_workspace_id')).toBeNull()
  })

  it('only includes allowed_workspace_id when a workspace id is provided', () => {
    const started = startCodexAuthorization({
      authorizeUrl: 'https://auth.openai.com/oauth/authorize',
      clientId: 'codex-client-id',
      scope: 'openid profile email offline_access',
      redirectHost: 'localhost',
      redirectPort: 1455,
      redirectPath: '/auth/callback',
      openBrowserWindow: false,
      allowedWorkspaceId: 'ws-associated',
    })

    const authorizationUrl = new URL(started.authorizationUrl)

    expect(authorizationUrl.searchParams.get('codex_cli_simplified_flow')).toBe(
      'true',
    )
    expect(authorizationUrl.searchParams.get('allowed_workspace_id')).toBe(
      'ws-associated',
    )
  })
})
