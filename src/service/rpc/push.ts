/**
 * Push fan-out (#64 D3): each connected client gets a sink; the hub sends
 * `{ kind: 'event', name, payload }` pushes to all of them. The `changed`
 * event carries topics ("what changed"), and the UI invalidates queries.
 */

import type { EventName, EventPayload, RpcPush } from '@shared/protocol'

export interface PushSink {
  send(push: RpcPush): void
}

export class PushHub {
  private readonly sinks = new Set<PushSink>()

  subscribe(sink: PushSink): () => void {
    this.sinks.add(sink)
    return () => {
      this.sinks.delete(sink)
    }
  }

  get subscriberCount(): number {
    return this.sinks.size
  }

  emit<N extends EventName>(name: N, payload: EventPayload<N>): void {
    this.emitRaw({ kind: 'event', name, payload })
  }

  /** Convenience for the ubiquitous `changed` push. */
  emitChanged(topics: readonly string[]): void {
    this.emit('changed', { topics: [...topics] })
  }

  private emitRaw(push: RpcPush): void {
    for (const sink of this.sinks) {
      try {
        sink.send(push)
      } catch {
        this.sinks.delete(sink)
      }
    }
  }
}
