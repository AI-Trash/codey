import { format } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import en from '../locales/en.json'
import zh from '../locales/zh.json'

export type Locale = 'en' | 'zh'

type Translations = Record<string, string>

const translations: Record<Locale, Translations> = {
  en,
  zh,
}

export function t(key: string, locale: Locale): string {
  return translations[locale][key] ?? key
}

export function getDateFnsLocale(locale: Locale) {
  return locale === 'zh' ? zhCN : enUS
}

export function formatDateValue(value: Date, locale: Locale) {
  return format(value, locale === 'zh' ? 'PPP' : 'MMM d, yyyy', {
    locale: getDateFnsLocale(locale),
  })
}

export function formatDateRangeValue(
  start: Date,
  end: Date,
  locale: Locale,
) {
  return `${formatDateValue(start, locale)} - ${formatDateValue(end, locale)}`
}

export function formatSelectedCountLabel(count: number, locale: Locale) {
  return locale === 'zh' ? `已选 ${count} 项` : `${count} selected`
}
