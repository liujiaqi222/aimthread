/**
 * UI ↔ service protocol (#64 D3): one table each for commands, queries, and
 * events; zod schemas are the single source of truth for wire validation.
 *
 * Wire format:
 *   request   { id, kind: 'command' | 'query', name, input }
 *   response  { id, ok: true, result } | { id, ok: false, error: { code, params } }
 *   push      { kind: 'event', name, payload }
 *
 * Both transports (MessagePort and dev HTTP) use exactly these envelopes.
 */

import { z } from 'zod'
import { ErrorParams, ServiceError } from './errors'

/**
 * A "changed" topic. Base topic names are stable identifiers ('goals',
 * 'session', ...); later tickets add parameterized forms like 'tasks:<id>'
 * where the id scopes the change. Kept as a plain string so the set can grow
 * without touching the wire format.
 */
export const Topic = z.string().min(1)

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

export const RpcErrorBody = z.object({
  code: z.string(),
  params: z.record(z.union([z.string(), z.number(), z.null()])).optional()
})

export const RpcRequest = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    kind: z.literal('command'),
    name: z.string().min(1),
    input: z.unknown().optional()
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('query'),
    name: z.string().min(1),
    input: z.unknown().optional()
  })
])

export const RpcResponse = z.discriminatedUnion('ok', [
  z.object({ id: z.string().min(1), ok: z.literal(true), result: z.unknown() }),
  z.object({ id: z.string().min(1), ok: z.literal(false), error: RpcErrorBody })
])

export const RpcPush = z.object({
  kind: z.literal('event'),
  name: z.string().min(1),
  payload: z.unknown()
})

export type RpcRequest = z.infer<typeof RpcRequest>
export type RpcResponse = z.infer<typeof RpcResponse>
export type RpcPush = z.infer<typeof RpcPush>
export type RpcMessage = RpcResponse | RpcPush

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export interface CommandDef {
  input: z.ZodTypeAny
  output: z.ZodTypeAny
}
export interface QueryDef {
  input: z.ZodTypeAny
  output: z.ZodTypeAny
}
export interface EventDef {
  payload: z.ZodTypeAny
}

function def(input: z.ZodTypeAny, output: z.ZodTypeAny): { input: z.ZodTypeAny; output: z.ZodTypeAny } {
  return { input, output }
}
function event(payload: z.ZodTypeAny): { payload: z.ZodTypeAny } {
  return { payload }
}

/** No-input marker: the caller passes `undefined`. */
export const none = z.void()

export const commands = {
  /**
   * Test hook (#67 acceptance): emits a `changed` push with the given topics
   * and echoes them back. Lets both transports demonstrate end-to-end push
   * without domain features; harmless by design.
   */
  'debug.emitChange': def(
    z.object({ topics: z.array(Topic).min(1).max(20) }).strict(),
    z.object({ topics: z.array(Topic) })
  )
} as const satisfies Record<string, CommandDef>

export const queries = {
  /** Basic service info; the minimal sample query for #67. */
  'app.info': def(
    none,
    z.object({
      name: z.string(),
      version: z.string(),
      schemaVersion: z.number().int().nonnegative(),
      nodeVersion: z.string(),
      platform: z.string(),
      pid: z.number().int(),
      startedAt: z.number().int()
    })
  )
} as const satisfies Record<string, QueryDef>

export const events = {
  /** Something changed; the UI invalidates queries matching the topics. */
  changed: event(z.object({ topics: z.array(Topic) }))
} as const satisfies Record<string, EventDef>

// ---------------------------------------------------------------------------
// Derived types
// ---------------------------------------------------------------------------

export type CommandName = keyof typeof commands
export type CommandInput<N extends CommandName> = z.input<(typeof commands)[N]['input']>
export type CommandOutput<N extends CommandName> = z.output<(typeof commands)[N]['output']>

export type QueryName = keyof typeof queries
export type QueryInput<N extends QueryName> = z.input<(typeof queries)[N]['input']>
export type QueryOutput<N extends QueryName> = z.output<(typeof queries)[N]['output']>

export type EventName = keyof typeof events
export type EventPayload<N extends EventName> = z.output<(typeof events)[N]['payload']>

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export function okResponse(id: string, result: unknown): RpcResponse {
  return { id, ok: true, result }
}

export function errorResponse(id: string, error: { code: string; params?: ErrorParams }): RpcResponse {
  return { id, ok: false, error: { code: error.code, params: error.params ?? {} } }
}

export { ServiceError }
