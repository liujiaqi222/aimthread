import type { Clock } from './clock'
import type { Host } from './host'

export interface ServiceContext {
  clock: Clock
  host: Host
}

export interface Service {
  /** Handle a request envelope coming from the UI side. */
  handleRequest(req: unknown): Promise<unknown>
}

/**
 * The single assembly point. Real domain modules (goals, timer, records,
 * footprint, settings, db) get plugged in here in later tickets. M1-1 only
 * needs the minimal ping path to prove the transport works end-to-end.
 */
export function createService(_ctx: ServiceContext): Service {
  return {
    async handleRequest(req) {
      const r = req as { id?: string; name?: string }
      if (r?.name === 'ping') {
        return { id: r.id, ok: true, result: { message: 'pong' } }
      }
      return {
        id: r.id,
        ok: false,
        error: { code: 'rpc.unknownCommand', params: { name: r?.name } }
      }
    }
  }
}
