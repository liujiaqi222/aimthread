/**
 * MessagePort transport client (#64 D3 / ADR 0001). Works with both DOM
 * MessagePorts (Electron renderer) and worker_threads MessagePorts (used by
 * the transport contract tests), hence the small shape normalisation.
 */

import type { RpcPush, RpcResponse } from '@shared/protocol'
import type { ClientStatus, ServiceClient, Unsubscribe } from './types'
import { RpcClientError, UNAVAILABLE } from './types'

/** Minimal port shape covering DOM and Node/MessagePortMain-style ports. */
export interface PortLike {
  postMessage(message: unknown): void
  addEventListener?(type: 'message' | 'close', listener: (ev: never) => void): void
  on?(event: 'message' | 'close', listener: (arg: never) => void): void
  close?(): void
}

export interface MessagePortClientOptions {
  /** Resolves a fresh port (Electron: preload handoff; tests: direct). */
  acquirePort(): Promise<PortLike>
  /** Reconnect backoff; also caps how long a request waits for a port. */
  retryDelayMs?: number
  newId?(): string
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (e: Error) => void
}

export function createMessagePortClient(opts: MessagePortClientOptions): ServiceClient {
  const retryDelayMs = opts.retryDelayMs ?? 750
  const newId = opts.newId ?? (() => crypto.randomUUID())

  let port: PortLike | null = null
  let disposed = false
  let status: ClientStatus = 'connecting'
  let connectScheduled = false

  const pending = new Map<string, Pending>()
  const statusHandlers = new Set<(s: ClientStatus) => void>()
  const eventHandlers = new Map<string, Set<(payload: unknown) => void>>()
  const connectedWaiters = new Set<() => void>()

  function setStatus(s: ClientStatus): void {
    status = s
    for (const h of statusHandlers) h(s)
    if (s === 'connected') {
      for (const w of connectedWaiters) w()
      connectedWaiters.clear()
    }
  }

  function onPortMessage(data: unknown): void {
    const msg = data as RpcResponse | RpcPush
    if ((msg as { id?: unknown })?.id !== undefined && typeof (msg as { id?: unknown }).id === 'string') {
      const resp = msg as RpcResponse
      const entry = pending.get(resp.id)
      if (!entry) return
      pending.delete(resp.id)
      if (resp.ok) entry.resolve(resp.result)
      else entry.reject(new RpcClientError(resp.error.code, resp.error.params ?? {}))
      return
    }
    if ((msg as { kind?: unknown }).kind === 'event') {
      const push = msg as RpcPush
      const handlers = eventHandlers.get(push.name)
      if (handlers) for (const h of [...handlers]) h(push.payload)
    }
  }

  function wire(p: PortLike): void {
    if (p.addEventListener) {
      // DOM ports: onmessage (property) auto-starts the port; addEventListener
      // works in browsers but Electron's transferred ports only start on the
      // property assignment — so use the property explicitly.
      ;(p as unknown as { onmessage: ((ev: { data: unknown }) => void) | null }).onmessage = (ev) =>
        onPortMessage(ev.data)
      ;(p as unknown as { onclose: (() => void) | null }).onclose = () => onPortClosed()
    } else if (p.on) {
      p.on('message', (arg) => onPortMessage(arg as unknown))
      p.on('close', () => onPortClosed())
    }
  }

  function onPortClosed(): void {
    if (disposed) return
    port = null
    setStatus('reconnecting')
    failPending()
    scheduleConnect()
  }

  function failPending(): void {
    for (const entry of pending.values()) entry.reject(UNAVAILABLE)
    pending.clear()
  }

  function scheduleConnect(): void {
    if (disposed || port || connectScheduled) return
    connectScheduled = true
    setTimeout(
      () => {
        connectScheduled = false
        void connect()
      },
      status === 'reconnecting' ? retryDelayMs : 0
    )
  }

  async function connect(): Promise<void> {
    if (disposed || port) return
    try {
      const p = await opts.acquirePort()
      if (disposed || port) {
        p.close?.()
        return
      }
      wire(p)
      port = p
      setStatus('connected')
    } catch {
      if (!disposed) scheduleConnect()
    }
  }

  function ensureConnected(): Promise<void> {
    if (port) return Promise.resolve()
    if (status === 'closed') return Promise.reject(UNAVAILABLE)
    scheduleConnect()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        connectedWaiters.delete(waiter)
        reject(UNAVAILABLE)
      }, 10_000)
      const waiter = () => {
        clearTimeout(timer)
        connectedWaiters.delete(waiter)
        resolve()
      }
      connectedWaiters.add(waiter)
    })
  }

  async function request(kind: 'command' | 'query', name: string, input: unknown): Promise<unknown> {
    if (!port) await ensureConnected()
    if (!port) throw UNAVAILABLE
    const id = newId()
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      port!.postMessage({ id, kind, name, input })
    })
  }

  void connect()

  return {
    async query(name, input) {
      return (await request('query', name, input)) as never
    },
    async command(name, input) {
      return (await request('command', name, input)) as never
    },
    onEvent(name, handler) {
      let set = eventHandlers.get(name)
      if (!set) {
        set = new Set()
        eventHandlers.set(name, set)
      }
      set.add(handler as (payload: unknown) => void)
      return (() => {
        set?.delete(handler as (payload: unknown) => void)
      }) as Unsubscribe
    },
    onStatus(handler) {
      statusHandlers.add(handler)
      handler(status)
      return () => {
        statusHandlers.delete(handler)
      }
    },
    dispose() {
      disposed = true
      failPending()
      connectedWaiters.clear()
      port?.close?.()
      port = null
      setStatus('closed')
    }
  }
}
