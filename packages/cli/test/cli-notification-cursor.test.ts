import { describe, expect, it } from 'vitest'

import {
  compareCliNotificationCursor,
  isCliNotificationAfterCursor,
  toCliNotificationCursor,
} from '../../../src/lib/server/cli-notification-cursor'

describe('cli notification cursor helpers', () => {
  it('orders same-timestamp notifications by id', () => {
    const createdAt = new Date('2026-04-22T03:11:19.123Z')

    expect(
      compareCliNotificationCursor(
        {
          createdAt,
          id: 'notification-a',
        },
        {
          createdAt,
          id: 'notification-b',
        },
      ),
    ).toBeLessThan(0)
  })

  it('advances past notifications created in the same millisecond', () => {
    const createdAt = new Date('2026-04-22T03:11:19.123Z')
    const cursor = toCliNotificationCursor({
      createdAt,
      id: 'notification-a',
    })

    expect(
      isCliNotificationAfterCursor(
        {
          createdAt,
          id: 'notification-a',
        },
        cursor,
      ),
    ).toBe(false)
    expect(
      isCliNotificationAfterCursor(
        {
          createdAt,
          id: 'notification-b',
        },
        cursor,
      ),
    ).toBe(true)
  })
})
