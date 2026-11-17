import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import type { RpcPush } from '@shared/protocol'
import { createService, type Service } from '@service/index'
import { openDatabase } from '@service/db/driver'
import { attachConnection, type PortLike as ServicePortLike } from '@service/rpc/connection'
import { startDevHttpServer } from '@service/http/dev-server'
import type { Host, Unsubscribe } from '@service/host'
import { createMessagePortClient, type PortLike } from '@ui/client/port-client'
import { createHttpClient } from '@ui/client/http-client'
import type { ServiceClient } from '@ui/client/types'

/**
 * Protocol contract tests (#67 / #64 D4): the same assertions against both
 * transports — worker_threads MessageChannel (standing in for the
 * MessagePortMain production path) and the dev HTTP server (POST /rpc + SSE).
 */

const fakeHost: Host = {
  onSuspend(_cb): Unsubscribe {
    return () => {}
  },
  onResume(_cb): Unsubscribe {
    return () => {}
  },
  async preferredSystemLanguages() {
    return ['en']
  },
  async notify() {
    return { shown: true }
  },
  async openPath() {},
  localeChanged() {}
}

function makeService(): Service {
  return createService({
    db: openDatabase(':memory:'),
    clock: { now: () => 1_700_000_000_000, monotonicMillis: () => 0 },
    host: fakeHost,
    validateOutput: true
  })
}

interface Env {
  client: ServiceClient
  /** Hub subscribers on the server side; lets tests await subscription liveness. */
  hubCount(): number
  teardown(): Promise<void> | void
}

/** Node's MessagePort hands the raw message to `on('message')`; the service
 * adapter expects `{ data }` envelopes — this wrapper matches MessagePortMain. */
function toServicePort(port: MessagePort): ServicePortLike {
  return {
    on(event, cb) {
      if (event === 'message') port.on('message', (m) => cb({ data: m }))
    },
    postMessage: (m) => port.postMessage(m),
    start: () => port.start()
  }
}

async function setupPortEnv(): Promise<Env> {
  const service = makeService()
  const { port1, port2 } = new MessageChannel()
  const detach = attachConnection(toServicePort(port2), service.router, service.hub)
  const client = createMessagePortClient({
    acquirePort: async () => port1 as unknown as PortLike
  })
  return {
    client,
    hubCount: () => service.hub.subscriberCount,
    async teardown() {
      client.dispose()
      detach()
      port1.close()
      port2.close()
      service.close()
    }
  }
}

/** Minimal Node-side EventSource: streams SSE frames via fetch. */
class NodeEventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  private readonly controller = new AbortController()

  constructor(private readonly url: string) {
    void this.run()
  }

  private async run(): Promise<void> {
    try {
      const res = await fetch(this.url, {
        signal: this.controller.signal,
        headers: { accept: 'text/event-stream' }
      })
      if (!res.ok || !res.body) throw new Error(`sse status ${res.status}`)
      this.onopen?.()
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let frameEnd: number
        while ((frameEnd = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, frameEnd)
          buffer = buffer.slice(frameEnd + 2)
          const data = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('\n')
          if (data) this.onmessage?.({ data })
        }
      }
      this.onerror?.()
    } catch {
      this.onerror?.()
    }
  }

  close(): void {
    this.controller.abort()
  }
}

async function setupHttpEnv(): Promise<Env> {
  const service = makeService()
  const server = await startDevHttpServer({ service, port: 0 })
  const client = createHttpClient({
    baseUrl: `http://127.0.0.1:${server.port}`,
    EventSourceCtor: NodeEventSource as unknown as new (url: string) => never
  })
  return {
    client,
    hubCount: () => service.hub.subscriberCount,
    async teardown() {
      client.dispose()
      await server.close()
      service.close()
    }
  }
}

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('waitFor: condition not met in time')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe.each([
  ['MessagePort transport', setupPortEnv],
  ['dev HTTP transport', setupHttpEnv]
])('protocol contract — %s', (_name, setup) => {
  it('queries app.info over the real transport', async () => {
    const env = await setup()
    try {
      const info = await env.client.query('app.info', undefined)
      expect(info.name).toBe('AimThread')
      expect(info.schemaVersion).toBe(1)
      expect(typeof info.pid).toBe('number')
    } finally {
      await env.teardown()
    }
  })

  it('returns rpc.unknownCommand through the transport', async () => {
    const env = await setup()
    try {
      await expect(env.client.query('no.such' as never, undefined as never)).rejects.toMatchObject({
        code: 'rpc.unknownCommand'
      })
    } finally {
      await env.teardown()
    }
  })

  it('returns rpc.invalidInput for bad input through the transport', async () => {
    const env = await setup()
    try {
      await expect(env.client.command('debug.emitChange', { topics: [] })).rejects.toMatchObject({
        code: 'rpc.invalidInput'
      })
    } finally {
      await env.teardown()
    }
  })

  it('delivers the changed push and the command response', async () => {
    const env = await setup()
    try {
      const pushes: RpcPush[] = []
      env.client.onEvent('changed', (payload) => pushes.push({ kind: 'event', name: 'changed', payload }))

      // The server must have subscribed the client before anything is pushed.
      await waitFor(() => (env.hubCount() > 0 ? env.hubCount() : undefined))

      const result = await env.client.command('debug.emitChange', { topics: ['app'] })
      expect(result.topics).toEqual(['app'])
      await waitFor(() => (pushes.length > 0 ? pushes : undefined))
      expect(pushes[0].payload).toEqual({ topics: ['app'] })
    } finally {
      await env.teardown()
    }
  })

  it('reports the connection status as connected', async () => {
    const env = await setup()
    try {
      const statuses: string[] = []
      env.client.onStatus((s) => statuses.push(s))
      await waitFor(() => (statuses.includes('connected') ? statuses : undefined))
    } finally {
      await env.teardown()
    }
  })
})
