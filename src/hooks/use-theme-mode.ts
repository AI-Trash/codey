import { useEffect, useState } from 'react'

import { getNextThemeMode, type ThemeMode } from '#/lib/i18n'

const THEME_STORAGE_KEY = 'theme'
const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)'

function getStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'auto'
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    return stored
  }

  return 'auto'
}

export function applyThemeMode(mode: ThemeMode) {
  if (typeof window === 'undefined') {
    return
  }

  const prefersDark = window.matchMedia(THEME_MEDIA_QUERY).matches
  const resolved = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode

  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(resolved)

  if (mode === 'auto') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', mode)
  }

  document.documentElement.style.colorScheme = resolved
}

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>('auto')

  useEffect(() => {
    const initialMode = getStoredThemeMode()
    setMode(initialMode)
    applyThemeMode(initialMode)
  }, [])

  useEffect(() => {
    if (mode !== 'auto' || typeof window === 'undefined') {
      return
    }

    const media = window.matchMedia(THEME_MEDIA_QUERY)
    const handleChange = () => applyThemeMode('auto')

    media.addEventListener('change', handleChange)
    return () => {
      media.removeEventListener('change', handleChange)
    }
  }, [mode])

  function updateMode(nextMode: ThemeMode) {
    setMode(nextMode)
    applyThemeMode(nextMode)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextMode)
    }
  }

  function cycleMode() {
    updateMode(getNextThemeMode(mode))
  }

  return {
    mode,
    setMode: updateMode,
    cycleMode,
  }
}
