/**
 * Main-process side of the host channel (#64 / ADR 0001): implements the
 * host capabilities against Electron (powerMonitor, Notification, shell)
 * and answers the service's host-call / host-subscribe messages arriving
 * on the utilityProcess parentPort.
 */

import { app, Notification, powerMonitor, shell } from 'electron'
import type { HostMethodName, HostSubscription, MainMessage, ServiceMessage } from '@service/host'

export interface ElectronHostCallbacks {
  /** Fired when the service reports a locale change (tray rebuild in #69). */
  onLocaleChanged?(locale: string): void
}

export class ElectronHostBridge {
  private readonly subscriptions = new Map<string, { name: HostSubscription; unsubscribe: () => void }>()
  private seq = 0

  constructor(
    private readonly send: (msg: MainMessage) => void,
    private readonly callbacks: ElectronHostCallbacks = {}
  ) {}

  /** Feed every ServiceMessage that arrives on the parentPort. */
  handleServiceMessage(msg: ServiceMessage): void {
    switch (msg.kind) {
      case 'host-call':
        void this.handleCall(msg.id, msg.name, msg.input)
        return
      case 'host-subscribe':
        this.subscribe(msg.id, msg.name)
        return
      case 'host-unsubscribe':
        this.unsubscribe(msg.id)
        return
      default:
        return // ready / startup-error / v1-result are the launcher's business.
    }
  }

  private async handleCall(id: string, name: HostMethodName, input: unknown): Promise<void> {
    try {
      const result = await this.invoke(name, input)
      this.send({ kind: 'host-result', id, ok: true, result })
    } catch (e) {
      this.send({ kind: 'host-result', id, ok: false, error: { code: 'host.failed' } })
      console.error(`[host] call "${name}" failed`, e)
    }
  }

  private async invoke(name: HostMethodName, input: unknown): Promise<unknown> {
    switch (name) {
      case 'preferredSystemLanguages':
        return app.getPreferredSystemLanguages()
      case 'notify': {
        const n = input as { title: string; body: string }
        const notification = new Notification({ title: n.title, body: n.body })
        notification.show()
        return { shown: true }
      }
      case 'openPath':
        await shell.openPath((input as { path: string }).path)
        return undefined
      case 'localeChanged':
        this.callbacks.onLocaleChanged?.((input as { locale: string }).locale)
        return undefined
      default:
        throw new Error(`unknown host method: ${name satisfies never}`)
    }
  }

  private subscribe(id: string, name: HostSubscription): void {
    this.unsubscribe(id)
    const eventName = name === 'onSuspend' ? 'suspend' : 'resume'
    const listener = (): void => {
      this.send({ kind: 'host-event', name })
    }
    // powerMonitor's on() overloads defeat literal-union inference; use a
    // minimal structural handle.
    const monitor = powerMonitor as unknown as {
      on(event: string, listener: () => void): void
      off(event: string, listener: () => void): void
    }
    monitor.on(eventName, listener)
    this.subscriptions.set(id, {
      name,
      unsubscribe: () => {
        monitor.off(eventName, listener)
      }
    })
  }

  private unsubscribe(id: string): void {
    const sub = this.subscriptions.get(id)
    if (sub) {
      sub.unsubscribe()
      this.subscriptions.delete(id)
    }
  }

  dispose(): void {
    for (const sub of this.subscriptions.values()) sub.unsubscribe()
    this.subscriptions.clear()
    this.send({ kind: 'shutdown' })
  }

  /** Unique ids for e2e/debugging diagnostics. */
  nextId(): string {
    return `main${++this.seq}`
  }
}
