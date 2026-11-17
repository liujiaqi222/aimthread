/**
 * Dev HTTP transport client (#64 D3): POST /rpc for requests, SSE /events
 * for pushes. Used in browser dev mode only; kept out of production bundles
 * via the DEV-guarded dynamic import in create.ts.
 */

import type { RpcPush, RpcResponse } from '@shared/protocol'
import type { ServiceClient, Unsubscribe } from './types'
import { RpcClientError } from './types'

interface EventSourceLike {
  onopen: (() => void) | null
  onerror: (() => void) | null
  onmessage: ((ev: { data: string }) => void) | null
  close(): void
}

export interface HttpClientOptions {
  baseUrl: string
  fetchImpl?: typeof fetch
  /** Injectable so Node-side contract tests can drive SSE without a browser. */
  EventSourceCtor?: new (url: string) => EventSourceLike
  newId?(): string
}

export function createHttpClient(opts: HttpClientOptions): ServiceClient {
  const baseUrl = opts.baseUrl.replace(/\/$/, '')
  const fetchImpl = opts.fetchImpl ?? fetch
  const EventSourceCtor = opts.EventSourceCtor ?? (globalThis.EventSource as unknown as new (url: string) => EventSourceLike)
  const newId = opts.newId ?? (() => crypto.randomUUID())

  const statusHandlers = new Set<(s: ReturnType<typeof currentStatus>) => void>()
  const eventHandlers = new Map<string, Set<(payload: unknown) => void>>()
  let status = 'connecting'
  const currentStatus = () => status as 'connecting' | 'connected' | 'reconnecting' | 'closed'

  function setStatus(s: 'connecting' | 'connected' | 'reconnecting' | 'closed'): void {
    status = s
    for (const h of [...statusHandlers]) h(s)
  }

  // EventSource reconnects on its own; onerror just informs the UI.
  const source = new EventSourceCtor(`${baseUrl}/events`)
  source.onopen = () => setStatus('connected')
  source.onerror = () => setStatus('reconnecting')
  source.onmessage = (ev) => {
    try {
      const push = JSON.parse(ev.data) as RpcPush
      const handlers = eventHandlers.get(push.name)
      if (handlers) for (const h of [...handlers]) h(push.payload)
    } catch {
      // Ignore malformed frames.
    }
  }

  async function request(kind: 'command' | 'query', name: string, input: unknown): Promise<unknown> {
    const response = await fetchImpl(`${baseUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: newId(), kind, name, input })
    })
    const body = (await response.json()) as RpcResponse
    if (body.ok) return body.result
    throw new RpcClientError(body.error.code, body.error.params ?? {})
  }

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
      handler(currentStatus())
      return () => {
        statusHandlers.delete(handler)
      }
    },
    dispose() {
      source.close()
      setStatus('closed')
    }
  }
}
