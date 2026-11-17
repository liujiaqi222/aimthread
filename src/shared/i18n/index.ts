/**
 * Locale detection (#62): zh* (incl. traditional) → zh-CN, else en.
 * Used at first run and by repair pages when the database (and thus the
 * stored ui_locale) is unreachable.
 */

import type { Locale } from './en'
import { zhCN } from './zh-cn'
import { en } from './en'

export type { Locale } from './en'
export type { Messages } from './en'
export { en, zhCN }

export function resolveLocale(preferred: readonly string[]): Locale {
  const first = preferred.find((l) => l && l.trim() !== '')
  if (first && first.toLowerCase().startsWith('zh')) return 'zh-CN'
  return 'en'
}

export function messages(locale: Locale) {
  return locale === 'zh-CN' ? zhCN : en
}
