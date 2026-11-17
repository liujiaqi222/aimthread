/**
 * The single assembly point (#64 D1): `createService({ db, clock, host })`.
 * Domain modules register their handlers here; later tickets (goals, timer,
 * records, footprint, settings) plug in the same way.
 */

import type { z } from 'zod'
import type { Clock } from './clock'
import type { Host } from './host'
import type { Database } from './db/driver'
import { LATEST_SCHEMA_VERSION } from './db/migrations'
import { RpcRouter, type CommandHandlers, type QueryHandlers } from './rpc/router'
import { PushHub } from './rpc/push'
import { attachConnection, type PortLike } from './rpc/connection'
import { commands, queries, type CommandName, type CommandOutput, type QueryName, type QueryOutput, type RpcResponse } from '@shared/protocol'
import { appModule } from './app'

export interface ServiceInfo {
  version: string
  schemaVersion: number
  startedAt: number
}

/** Everything a handler may touch; the boundary of the service's world. */
export interface ServiceContext {
  db: Database
  clock: Clock
  host: Host
  hub: PushHub
  info: ServiceInfo
}

type CommandParsed<N extends CommandName> = z.output<(typeof commands)[N]['input']>
type QueryParsed<N extends QueryName> = z.output<(typeof queries)[N]['input']>

export type ServiceModule = {
  commands?: {
    [N in CommandName]?: (input: CommandParsed<N>, ctx: ServiceContext) => Promise<CommandOutput<N>> | CommandOutput<N>
  }
  queries?: {
    [N in QueryName]?: (input: QueryParsed<N>, ctx: ServiceContext) => Promise<QueryOutput<N>> | QueryOutput<N>
  }
}

export interface CreateServiceOptions {
  db: Database
  clock: Clock
  host: Host
  /** App version reported by app.info; entries pass it from the environment. */
  version?: string
  /** Output validation in dev builds and tests (D3). */
  validateOutput?: boolean
  /** Test-only: extra modules appended to the registry (output-validation tests). */
  extraModules?: ServiceModule[]
}

export interface Service {
  hub: PushHub
  router: RpcRouter
  handleRequest(req: unknown): Promise<RpcResponse>
  /** Attach one UI-side channel; returns the detach function. */
  attach(port: PortLike): () => void
  close(): void
}

export function createService(opts: CreateServiceOptions): Service {
  const hub = new PushHub()
  const ctx: ServiceContext = {
    db: opts.db,
    clock: opts.clock,
    host: opts.host,
    hub,
    info: {
      version: opts.version ?? 'dev',
      schemaVersion: LATEST_SCHEMA_VERSION,
      startedAt: opts.clock.now()
    }
  }

  const modules: ServiceModule[] = [appModule, ...(opts.extraModules ?? [])]

  const commandHandlers: CommandHandlers = {}
  const queryHandlers: QueryHandlers = {}
  for (const m of modules) {
    for (const [name, handler] of Object.entries(m.commands ?? {})) {
      commandHandlers[name as CommandName] = ((input: unknown) =>
        (handler as (input: unknown, ctx: ServiceContext) => unknown)(input, ctx)) as CommandHandlers[CommandName]
    }
    for (const [name, handler] of Object.entries(m.queries ?? {})) {
      queryHandlers[name as QueryName] = ((input: unknown) =>
        (handler as (input: unknown, ctx: ServiceContext) => unknown)(input, ctx)) as QueryHandlers[QueryName]
    }
  }

  const router = new RpcRouter({
    commandHandlers,
    queryHandlers,
    validateOutput: opts.validateOutput,
    onError: (message, err) => console.error(`[service] ${message}`, err)
  })
  // Compile-time-complete modules make this a dev-time invariant check.
  router.assertComplete()

  return {
    hub,
    router,
    handleRequest: (req) => router.handle(req),
    attach: (port) => attachConnection(port, router, hub),
    close: () => {
      try {
        opts.db.close()
      } catch {
        // Nothing meaningful left to do.
      }
    }
  }
}
