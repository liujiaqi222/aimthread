/**
 * ServiceClient (#64 D3): the UI's only dependency. Two implementations —
 * MessagePort (production Electron) and dev HTTP — and the rest of the UI
 * never knows which one is in play.
 */

import type {
  CommandInput,
  CommandName,
  CommandOutput,
  EventName,
  EventPayload,
  QueryInput,
  QueryName,
  QueryOutput
} from '@shared/protocol'

export type ClientStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed'

export interface Unsubscribe {
  (): void
}

export interface ServiceClient {
  query<N extends QueryName>(name: N, input: QueryInput<N>): Promise<QueryOutput<N>>
  command<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>>
  onEvent<N extends EventName>(name: N, handler: (payload: EventPayload<N>) => void): Unsubscribe
  onStatus(handler: (status: ClientStatus) => void): Unsubscribe
  dispose(): void
}

/** A service-side error surfaced to the UI as `{ code, params }` (#62). */
export class RpcClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly params: Record<string, string | number | null>
  ) {
    super(`${code}${Object.keys(params).length > 0 ? ` ${JSON.stringify(params)}` : ''}`)
    this.name = 'RpcClientError'
  }
}

export const UNAVAILABLE = new RpcClientError('rpc.unavailable', {})
