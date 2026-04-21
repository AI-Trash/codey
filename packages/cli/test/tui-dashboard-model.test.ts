import { describe, expect, it } from 'vitest'

import {
  appendDashboardEvent,
  createDashboardState,
  deriveTargetFromAuthState,
  handleDashboardNotification,
  isTuiAuthRecoveryError,
} from '../src/modules/tui/dashboard-model'

describe('tui dashboard model', () => {
  it('keeps recent events newest-first and capped', () => {
    let state = createDashboardState({ cliName: 'codey-test' })

    for (let index = 0; index < 10; index += 1) {
      state = appendDashboardEvent(state, `event-${index}`)
    }

    expect(state.recentEvents).toHaveLength(8)
    expect(state.recentEvents[0]?.message).toBe('event-9')
    expect(state.recentEvents[7]?.message).toBe('event-2')
  })

  it('formats notification title and body into a single event entry', () => {
    const state = handleDashboardNotification(
      createDashboardState({ cliName: 'codey-test' }),
      {
        id: 'notification-1',
        title: 'Task queued',
        body: 'chatgpt-login is ready',
        createdAt: '2026-04-21T00:00:00.000Z',
      },
    )

    expect(state.recentEvents[0]?.message).toBe(
      'Task queued: chatgpt-login is ready',
    )
  })

  it('recognizes recoverable TUI auth errors', () => {
    expect(
      isTuiAuthRecoveryError(
        new Error('No stored app session found. Run `codey auth login` first.'),
      ),
    ).toBe(true)
    expect(
      isTuiAuthRecoveryError(
        new Error(
          'Stored app session is missing the required notifications:read scope.',
        ),
      ),
    ).toBe(true)
    expect(isTuiAuthRecoveryError(new Error('Network request failed.'))).toBe(
      false,
    )
  })

  it('derives the preferred target from the auth session', () => {
    expect(
      deriveTargetFromAuthState({
        mode: 'device_session',
        accessToken: 'token',
        session: {
          version: 2,
          tokenSet: {
            accessToken: 'token',
            tokenType: 'Bearer',
            obtainedAt: '2026-04-21T00:00:00.000Z',
          },
          target: 'octocat',
          user: {
            id: 'user-1',
            githubLogin: 'fallback-login',
            email: 'fallback@example.com',
          },
          createdAt: '2026-04-21T00:00:00.000Z',
        },
      }),
    ).toBe('octocat')
  })
})
