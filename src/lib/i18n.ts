import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import type { Locale as DataTableFilterLocale } from '#/components/data-table-filter/lib/i18n'

export type ThemeMode = 'light' | 'dark' | 'auto'

export function getLocaleDisplayName(locale: string) {
  switch (locale) {
    case 'en':
      return m.locale_name_en()
    case 'zh':
      return m.locale_name_zh()
    default:
      return locale.toUpperCase()
  }
}

export function getCurrentLocaleDisplayName() {
  return getLocaleDisplayName(getLocale())
}

export function getThemeModeLabel(mode: ThemeMode) {
  switch (mode) {
    case 'light':
      return m.theme_mode_light()
    case 'dark':
      return m.theme_mode_dark()
    default:
      return m.theme_mode_auto()
  }
}

export function getNextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === 'light' ? 'dark' : mode === 'dark' ? 'auto' : 'light'
}

export function getThemeToggleLabel(mode: ThemeMode) {
  const nextMode = getNextThemeMode(mode)

  return m.theme_toggle_label({
    current_mode: getThemeModeLabel(mode),
    next_mode: getThemeModeLabel(nextMode),
  })
}

const statusLabelMap = {
  active: () => m.status_active(),
  approved: () => m.status_approved(),
  archived: () => m.status_archived(),
  banned: () => m.status_banned(),
  bootstrap: () => m.status_bootstrap(),
  complete: () => m.status_complete(),
  configured: () => m.status_configured(),
  connecting: () => m.status_connecting(),
  canceled: () => m.status_canceled(),
  consumed: () => m.status_consumed(),
  denied: () => m.status_denied(),
  disabled: () => m.status_disabled(),
  empty: () => m.status_empty(),
  enabled: () => m.status_enabled(),
  encrypted: () => m.status_encrypted(),
  expired: () => m.status_expired(),
  failed: () => m.status_failed(),
  general: () => m.status_general(),
  good: () => m.status_good(),
  idle: () => m.status_idle(),
  inactive: () => m.status_inactive(),
  leased: () => m.status_leased(),
  live: () => m.status_live(),
  locked: () => m.status_locked(),
  missing: () => m.status_missing(),
  offline: () => m.status_offline(),
  parsed: () => m.status_parsed(),
  passed: () => m.status_passed(),
  pending: () => m.status_pending(),
  queued: () => m.status_queued(),
  ready: () => m.status_ready(),
  received: () => m.status_received(),
  reconnecting: () => m.status_reconnecting(),
  refreshing: () => m.status_refreshing(),
  resolved: () => m.status_resolved(),
  revoked: () => m.status_revoked(),
  review: () => m.status_review(),
  running: () => m.status_running(),
  succeeded: () => m.status_succeeded(),
  success: () => m.status_success(),
  synced: () => m.status_synced(),
  unknown: () => m.status_unknown(),
  warning: () => m.status_warning(),
} satisfies Record<string, () => string>

export function translateStatusLabel(value?: string | null) {
  if (!value) {
    return m.status_unknown()
  }

  const normalized = value.replaceAll('_', ' ').trim().toLowerCase()
  const message = statusLabelMap[normalized]

  if (message) {
    return message()
  }

  return value
}

export function getLocalizedHtmlLang(locale?: string) {
  return locale || getLocale()
}

export function getDataTableFilterLocale(
  locale?: string,
): DataTableFilterLocale {
  return (locale || getLocale()) === 'zh' ? 'zh' : 'en'
}
