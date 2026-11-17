/**
 * Repair / fatal page (#67 / #53): loaded by the main process whenever the
 * service cannot start. Text comes from shared/i18n (#62); the locale is
 * chosen by main from the system languages (the database — and thus the
 * stored ui_locale — is unreachable by definition here).
 */

import { messages, type Locale } from '@shared/i18n'

interface RepairBridge {
  repair: {
    retry(): void
    openDataDir(): void
    quit(): void
  }
}

const bridge = (window as unknown as { aimthread?: RepairBridge }).aimthread?.repair
const qs = new URLSearchParams(location.search)
const code = qs.get('code') ?? 'unknown'
const localeParam = qs.get('locale')
const locale: Locale = localeParam === 'zh-CN' ? 'zh-CN' : 'en'
let params: Record<string, unknown> = {}
try {
  params = JSON.parse(qs.get('params') ?? '{}') as Record<string, unknown>
} catch {
  params = {}
}
const dataDir = qs.get('dataDir') ?? ''

const m = messages(locale)
const reasonFn = (m.repair.reasons as Record<string, ((p: Record<string, unknown>) => string) | undefined>)[code]

const title = document.querySelector<HTMLHeadingElement>('[data-testid="repair-title"]')
const reason = document.querySelector<HTMLParagraphElement>('[data-testid="repair-reason"]')
const dataDirEl = document.querySelector<HTMLParagraphElement>('[data-testid="repair-data-dir"]')
const retry = document.querySelector<HTMLButtonElement>('[data-testid="repair-retry"]')
const openDir = document.querySelector<HTMLButtonElement>('[data-testid="repair-open-data-dir"]')
const quit = document.querySelector<HTMLButtonElement>('[data-testid="repair-quit"]')

if (title) title.textContent = m.repair.title()
if (reason) reason.textContent = reasonFn ? reasonFn(params) : `${code}`
if (dataDirEl) {
  dataDirEl.textContent = `${m.repair.dataDirLabel()}: ${dataDir}`
  dataDirEl.hidden = dataDir === ''
}

// Fatal (restart budget exhausted): M1 offers quit only (#64).
const isFatal = code === 'app.serviceCrashed'
if (retry) {
  retry.textContent = m.repair.actions.retry()
  retry.hidden = isFatal || !bridge
  retry.addEventListener('click', () => bridge?.retry())
}
if (openDir) {
  openDir.textContent = m.repair.actions.openDataDir()
  openDir.hidden = !bridge
  openDir.addEventListener('click', () => bridge?.openDataDir())
}
if (quit) {
  quit.textContent = m.repair.actions.quit()
  quit.hidden = !bridge
  quit.addEventListener('click', () => bridge?.quit())
}
