/**
 * Host capability interface (#64 / ADR 0001): the only way the service
 * touches main-process abilities (powerMonitor, notifications, opening
 * paths). Types for the parentPort channel live here too, per D3.
 */

import type { ErrorParams } from '@shared/protocol/errors'

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

// ---------------------------------------------------------------------------
// parentPort channel: service ↔ main (typed here; main imports types only)
// ---------------------------------------------------------------------------

export type HostMethodName = 'preferredSystemLanguages' | 'notify' | 'openPath' | 'localeChanged'
export type HostSubscription = 'onSuspend' | 'onResume'

/** service → main */
export type ServiceMessage =
  | { kind: 'ready'; info: { schemaVersion: number; fromVersion: number; toVersion: number } }
  | { kind: 'startup-error'; error: { code: string; params: ErrorParams } }
  | { kind: 'host-call'; id: string; name: HostMethodName; input?: unknown }
  | { kind: 'host-subscribe'; id: string; name: HostSubscription }
  | { kind: 'host-unsubscribe'; id: string }
  | { kind: 'v1-result'; result: unknown }

/** main → service (MessagePorts travel in the event's `ports` array) */
export type MainMessage =
  | { kind: 'connect' }
  | { kind: 'host-result'; id: string; ok: true; result: unknown }
  | { kind: 'host-result'; id: string; ok: false; error: { code: string } }
  | { kind: 'host-event'; name: HostSubscription }
  | { kind: 'shutdown' }

// ---------------------------------------------------------------------------
// Service-side host bridge: implements Host by calling main over parentPort
// ---------------------------------------------------------------------------

export interface ParentPortLike {
  postMessage(message: ServiceMessage): void
  onMessage(cb: (msg: MainMessage) => void): void
}

interface PendingCall {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

/**
 * Implements Host against the parentPort channel. `onMessage` must be fed
 * every MainMessage the utilityProcess receives.
 */
export function createParentPortHost(port: ParentPortLike): Host {
  const pending = new Map<string, PendingCall>()
  const subscriptions = new Map<string, { name: HostSubscription; cb: () => void }>()
  let seq = 0

  port.onMessage((msg) => {
    switch (msg.kind) {
      case 'host-result': {
        const call = pending.get(msg.id)
        if (!call) return
        pending.delete(msg.id)
        if (msg.ok) call.resolve(msg.result)
        else call.reject(new Error(msg.error.code))
        return
      }
      case 'host-event': {
        for (const sub of subscriptions.values()) {
          if (sub.name === msg.name) sub.cb()
        }
        return
      }
      default:
        return
    }
  })

  function callMain(name: HostMethodName, input?: unknown): Promise<unknown> {
    const id = `hc${++seq}`
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      port.postMessage({ kind: 'host-call', id, name, input })
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error('host.callTimeout'))
        }
      }, 10_000).unref?.()
    })
  }

  return {
    onSuspend(cb) {
      const id = `hs${++seq}`
      subscriptions.set(id, { name: 'onSuspend', cb })
      port.postMessage({ kind: 'host-subscribe', id, name: 'onSuspend' })
      return () => {
        subscriptions.delete(id)
        port.postMessage({ kind: 'host-unsubscribe', id })
      }
    },
    onResume(cb) {
      const id = `hs${++seq}`
      subscriptions.set(id, { name: 'onResume', cb })
      port.postMessage({ kind: 'host-subscribe', id, name: 'onResume' })
      return () => {
        subscriptions.delete(id)
        port.postMessage({ kind: 'host-unsubscribe', id })
      }
    },
    async preferredSystemLanguages() {
      return (await callMain('preferredSystemLanguages')) as string[]
    },
    async notify(n) {
      return (await callMain('notify', n)) as { shown: boolean }
    },
    async openPath(path) {
      await callMain('openPath', { path })
    },
    localeChanged(locale) {
      void callMain('localeChanged', { locale }).catch(() => {})
    }
  }
}
