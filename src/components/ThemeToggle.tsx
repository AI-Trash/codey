import { SunMoon } from 'lucide-react'

import { useThemeMode } from '#/hooks/use-theme-mode'
import { getThemeToggleLabel } from '#/lib/i18n'
import { Button } from './ui/button'

export default function ThemeToggle() {
  const { mode, cycleMode } = useThemeMode()
  const label = getThemeToggleLabel(mode)

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={cycleMode}
      aria-label={label}
      title={label}
      className="size-8"
    >
      <SunMoon aria-hidden="true" />
    </Button>
  )
}
