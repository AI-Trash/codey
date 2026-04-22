import { describe, expect, it, vi } from 'vitest'

import { applyDashboardAppUpdate } from '../src/modules/tui/dashboard-render'

describe('tui dashboard render helper', () => {
  it('skips app updates before the dashboard has started', () => {
    const update = vi.fn()

    expect(
      applyDashboardAppUpdate({
        app: { update },
        state: { phase: 'starting' },
        appStarted: false,
        appSuspended: false,
      }),
    ).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('skips app updates while the dashboard is suspended', () => {
    const update = vi.fn()

    expect(
      applyDashboardAppUpdate({
        app: { update },
        state: { phase: 'starting' },
        appStarted: true,
        appSuspended: true,
      }),
    ).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('flushes the latest dashboard state once rendering is active', () => {
    const update = vi.fn()
    const state = { phase: 'listening' }

    expect(
      applyDashboardAppUpdate({
        app: { update },
        state,
        appStarted: true,
        appSuspended: false,
      }),
    ).toBe(true)
    expect(update).toHaveBeenCalledWith(state)
  })
})
