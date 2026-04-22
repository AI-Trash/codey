export interface CliNotificationCursor {
  createdAt: Date
  id?: string | null
}

interface CliNotificationCursorComparable {
  createdAt: Date
  id?: string | null
}

function normalizeCursorId(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }

  const normalized = value.trim()
  return normalized || ''
}

export function compareCliNotificationCursor(
  left: CliNotificationCursorComparable,
  right: CliNotificationCursorComparable,
): number {
  const leftTime = left.createdAt.getTime()
  const rightTime = right.createdAt.getTime()

  if (leftTime < rightTime) {
    return -1
  }

  if (leftTime > rightTime) {
    return 1
  }

  return normalizeCursorId(left.id).localeCompare(normalizeCursorId(right.id))
}

export function isCliNotificationAfterCursor(
  notification: CliNotificationCursorComparable,
  cursor: CliNotificationCursor,
): boolean {
  return compareCliNotificationCursor(notification, cursor) > 0
}

export function toCliNotificationCursor(
  notification: CliNotificationCursorComparable,
): CliNotificationCursor {
  return {
    createdAt: notification.createdAt,
    id: notification.id,
  }
}
