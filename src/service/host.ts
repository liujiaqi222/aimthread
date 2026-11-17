export interface Unsubscribe {
  (): void
}

export interface HostNotifyInput {
  title: string
  body: string
}

export interface Host {
  onSuspend(cb: () => void): Unsubscribe
  onResume(cb: () => void): Unsubscribe
  preferredSystemLanguages(): Promise<string[]>
  notify(n: HostNotifyInput): Promise<{ shown: boolean }>
  openPath(path: string): Promise<void>
  localeChanged(locale: string): void
}

export type HostRequest =
  | { id: string; kind: 'host'; name: 'preferredSystemLanguages' }
  | { id: string; kind: 'host'; name: 'notify'; input: HostNotifyInput }
  | { id: string; kind: 'host'; name: 'openPath'; input: { path: string } }
  | { id: string; kind: 'host'; name: 'localeChanged'; input: { locale: string } }

export type HostResponse = { id: string; ok: true; result: unknown } | { id: string; ok: false; error: { code: string } }
