import { describe, expect, it } from 'vitest'
import { RpcErrorBody } from '@shared/protocol'
import { ServiceError } from '@shared/protocol/errors'
import { createService, type Service, type ServiceModule } from '@service/index'
import { openDatabase } from '@service/db/driver'
import type { Host, Unsubscribe } from '@service/host'
import type { RpcPush } from '@shared/protocol'

/**
 * Service-boundary tests (#64 D4): real service, real SQLite (:memory:),
 * fake host — no mocks of repositories or router internals.
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

function makeService(overrides: { extraModules?: ServiceModule[]; validateOutput?: boolean } = {}): Service {
  const db = openDatabase(':memory:')
  return createService({
    db,
    clock: { now: () => 1_700_000_000_000, monotonicMillis: () => 0 },
    host: fakeHost,
    validateOutput: overrides.validateOutput ?? true,
    extraModules: overrides.extraModules
  })
}

const REQ = (id: string, kind: 'command' | 'query', name: string, input?: unknown): unknown => ({
  id,
  kind,
  name,
  input
})

describe('service rpc boundary', () => {
  it('app.info query returns service metadata', async () => {
    const service = makeService()
    const res = (await service.handleRequest(REQ('1', 'query', 'app.info'))) as {
      id: string
      ok: boolean
      result: Record<string, unknown>
    }
    expect(res.id).toBe('1')
    expect(res.ok).toBe(true)
    expect(res.result['name']).toBe('AimThread')
    expect(res.result['schemaVersion']).toBe(1)
    expect(typeof res.result['pid']).toBe('number')
    expect(typeof res.result['startedAt']).toBe('number')
    service.close()
  })

  it('unknown command/query returns rpc.unknownCommand', async () => {
    const service = makeService()
    const res = (await service.handleRequest(REQ('2', 'query', 'no.suchQuery'))) as {
      ok: boolean
      error: { code: string }
    }
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('rpc.unknownCommand')
    service.close()
  })

  it('a malformed envelope returns rpc.invalidInput', async () => {
    const service = makeService()
    const res = (await service.handleRequest({ no: 'shape at all' })) as { ok: boolean; error: { code: string } }
    expect(res.ok).toBe(false)
    expect(RpcErrorBody.safeParse(res.error).success).toBe(true)
    service.close()
  })

  it('invalid input fails zod validation with rpc.invalidInput', async () => {
    const service = makeService()
    const res = (await service.handleRequest(REQ('3', 'command', 'debug.emitChange', { topics: [] }))) as {
      ok: boolean
      error: { code: string; params: Record<string, unknown> }
    }
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('rpc.invalidInput')
    expect(res.error.params['name']).toBe('debug.emitChange')
    service.close()
  })

  it('debug.emitChange emits a changed push to subscribers and echoes the topics', async () => {
    const service = makeService()
    const received: RpcPush[] = []
    service.hub.subscribe({ send: (push) => received.push(push) })

    const res = (await service.handleRequest(REQ('4', 'command', 'debug.emitChange', { topics: ['app'] }))) as {
      ok: boolean
      result: { topics: string[] }
    }
    expect(res.ok).toBe(true)
    expect(res.result.topics).toEqual(['app'])
    expect(received).toEqual([{ kind: 'event', name: 'changed', payload: { topics: ['app'] } }])
    service.close()
  })

  it('ServiceError from a handler crosses as { code, params }', async () => {
    const service = makeService({
      extraModules: [
        {
          queries: {
            'app.info': async () => {
              throw new ServiceError('db.cannotOpen', { detail: 'from test' })
            }
          }
        }
      ]
    })
    const res = (await service.handleRequest(REQ('5', 'query', 'app.info'))) as {
      ok: boolean
      error: { code: string; params: Record<string, unknown> }
    }
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('db.cannotOpen')
    expect(res.error.params['detail']).toBe('from test')
    service.close()
  })

  it('output validation (dev/test) turns a bad handler into rpc.internal', async () => {
    const service = makeService({
      extraModules: [
        {
          queries: {
            'app.info': async () => ({ wrong: true }) // violates the app.info output schema
          }
        }
      ]
    })
    const res = (await service.handleRequest(REQ('6', 'query', 'app.info'))) as { ok: boolean; error: { code: string } }
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('rpc.internal')
    service.close()
  })

  it('a non-ServiceError handler crash becomes rpc.internal, not a transport error', async () => {
    const service = makeService({
      extraModules: [
        {
          queries: {
            'app.info': async () => {
              throw new Error('plain bug')
            }
          }
        }
      ]
    })
    const res = (await service.handleRequest(REQ('7', 'query', 'app.info'))) as { ok: boolean; error: { code: string } }
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('rpc.internal')
    service.close()
  })
})
