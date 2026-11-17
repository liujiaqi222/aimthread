/**
 * Transport-agnostic connection (#64 D3): attaches one port-like channel to
 * the router and the push hub. Used by the utilityProcess entry for
 * MessagePortMain-shaped ports and by the dev HTTP server for SSE-wrapped
 * sinks.
 *
 * `PortLike` matches both MessagePortMain (EventEmitter style: `on('message',
 * ev => ev.data)` + explicit `start()`) and worker_threads' MessagePort.
 */

import type { RpcPush } from '@shared/protocol'
import type { RpcRouter } from './router'
import type { PushHub, PushSink } from './push'

export interface PortLike {
  on(event: 'message', cb: (ev: { data: unknown }) => void): void
  postMessage(message: unknown): void
  start?(): void
}

/**
 * Wires one port. Pushes arriving while the channel is gone are dropped by
 * the hub. Returns a detach function (no port closing — the owner decides).
 */
export function attachConnection(port: PortLike, router: RpcRouter, hub: PushHub): () => void {
  const sink: PushSink = {
    send: (push: RpcPush) => {
      port.postMessage(push)
    }
  }
  const unsubscribe = hub.subscribe(sink)

  port.on('message', (ev) => {
    void router
      .handle(ev.data)
      .then((response) => {
        port.postMessage(response)
      })
      .catch(() => {
        // router.handle never rejects; this is pure paranoia.
      })
  })
  port.start?.()

  return unsubscribe
}
