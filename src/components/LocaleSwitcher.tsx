// Locale switcher refs:
// - Paraglide docs: https://inlang.com/m/gerre34r/library-inlang-paraglideJs
// - Router example: https://github.com/TanStack/router/tree/main/examples/react/i18n-paraglide#switching-locale
import { Languages } from 'lucide-react'

import { getLocale, locales, setLocale } from '#/paraglide/runtime'
import { m } from '#/paraglide/messages'

import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

export default function ParaglideLocaleSwitcher() {
  const currentLocale = getLocale()
  const label = `${m.language_label()}. ${m.current_locale({ locale: currentLocale })}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={label}
          title={label}
          className="rounded-full border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)] hover:-translate-y-0.5 hover:bg-[var(--chip-bg)]"
        >
          <Languages aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onSelect={() => setLocale(locale)}
            className={locale === currentLocale ? 'font-semibold' : undefined}
          >
            {locale.toUpperCase()}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
