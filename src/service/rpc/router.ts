/**
 * RPC router (#64 D3): zod-validates every request against the protocol
 * tables, dispatches to handlers, maps failures to `{ code, params }`
 * responses. Output schemas are validated only in dev/test (per D3).
 *
 * Handlers are registered **pre-bound to their context** (see
 * service/index.ts createService): each takes only the parsed input.
 */

import type { z } from 'zod'
import {
  RpcRequest,
  commands,
  errorResponse,
  okResponse,
  queries,
  type CommandName,
  type CommandOutput,
  type QueryName,
  type QueryOutput,
  type RpcResponse
} from '@shared/protocol'
import { RPC_ERROR_CODES, ServiceError } from '@shared/protocol/errors'

type InputOf<T> = T extends z.ZodTypeAny ? z.output<T> : never

/** Per-module handler maps are partial; createService merges and completeness-checks. */
export type CommandHandlers = {
  [N in CommandName]?: (input: InputOf<(typeof commands)[N]['input']>) => Promise<CommandOutput<N>> | CommandOutput<N>
}
export type QueryHandlers = {
  [N in QueryName]?: (input: InputOf<(typeof queries)[N]['input']>) => Promise<QueryOutput<N>> | QueryOutput<N>
}

export interface RouterOptions {
  commandHandlers: CommandHandlers
  queryHandlers: QueryHandlers
  /** Validate outputs (dev builds and tests only, per D3). */
  validateOutput?: boolean
  onError?(message: string, err: unknown): void
}

export class RpcRouter {
  private readonly commandHandlers: Record<string, (input: unknown) => Promise<unknown> | unknown>
  private readonly queryHandlers: Record<string, (input: unknown) => Promise<unknown> | unknown>
  private readonly validateOutput: boolean
  private readonly onError: (message: string, err: unknown) => void

  constructor(opts: RouterOptions) {
    this.commandHandlers = opts.commandHandlers as Record<string, (input: unknown) => Promise<unknown> | unknown>
    this.queryHandlers = opts.queryHandlers as Record<string, (input: unknown) => Promise<unknown> | unknown>
    this.validateOutput = opts.validateOutput ?? false
    this.onError = opts.onError ?? ((m, e) => console.error(`[rpc] ${m}`, e))
  }

  /** Fails fast in dev/tests when a protocol entry has no handler. */
  assertComplete(): void {
    for (const name of Object.keys(commands)) {
      if (!this.commandHandlers[name]) throw new Error(`no handler registered for command "${name}"`)
    }
    for (const name of Object.keys(queries)) {
      if (!this.queryHandlers[name]) throw new Error(`no handler registered for query "${name}"`)
    }
  }

  async handle(raw: unknown): Promise<RpcResponse> {
    let id = ''
    try {
      const parsed = RpcRequest.safeParse(raw)
      if (!parsed.success) {
        const rawId = (raw as { id?: unknown } | null)?.id
        id = typeof rawId === 'string' ? rawId : ''
        return errorResponse(id, {
          code: RPC_ERROR_CODES.invalidInput,
          params: { detail: parsed.error.issues[0]?.message ?? 'invalid envelope' }
        })
      }
      const req = parsed.data
      id = req.id

      const table = req.kind === 'command' ? commands : queries
      const def = (table as unknown as Record<string, { input: z.ZodTypeAny; output: z.ZodTypeAny } | undefined>)[req.name]
      if (!def) {
        return errorResponse(id, { code: RPC_ERROR_CODES.unknownCommand, params: { name: req.name } })
      }

      const parsedInput = def.input.safeParse(req.input)
      if (!parsedInput.success) {
        return errorResponse(id, {
          code: RPC_ERROR_CODES.invalidInput,
          params: {
            name: req.name,
            path: parsedInput.error.issues[0]?.path.join('.') ?? '',
            detail: parsedInput.error.issues[0]?.message ?? 'invalid input'
          }
        })
      }

      const handler = (req.kind === 'command' ? this.commandHandlers : this.queryHandlers)[req.name]
      // assertComplete() guarantees presence in dev/test; guard anyway.
      if (!handler) {
        return errorResponse(id, { code: RPC_ERROR_CODES.unknownCommand, params: { name: req.name } })
      }

      const result = await handler(parsedInput.data)
      if (this.validateOutput) {
        const parsedOutput = def.output.safeParse(result)
        if (!parsedOutput.success) {
          this.onError(`handler output failed validation for "${req.name}"`, parsedOutput.error)
          return errorResponse(id, { code: RPC_ERROR_CODES.internal, params: {} })
        }
      }
      return okResponse(id, result)
    } catch (e) {
      if (e instanceof ServiceError) {
        return errorResponse(id, { code: e.code, params: e.params })
      }
      this.onError('unhandled error in rpc', e)
      return errorResponse(id, { code: RPC_ERROR_CODES.internal, params: {} })
    }
  }
}
