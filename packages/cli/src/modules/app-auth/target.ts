import type { CliNotificationsAuthState } from './device-login'

function normalizeOptionalText(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

export function deriveCliTargetFromAuthState(
  authState: CliNotificationsAuthState,
): string | undefined {
  return (
    normalizeOptionalText(authState.session?.target) ||
    normalizeOptionalText(authState.session?.user?.githubLogin) ||
    normalizeOptionalText(authState.session?.user?.email) ||
    normalizeOptionalText(authState.session?.subject)
  )
}
