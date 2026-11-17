/**
 * Error codes and the wire error shape (#64 D3).
 *
 * All errors crossing the UI boundary are `{ code, params }`; human text is
 * rendered by the UI from shared/i18n (#62). Repair pages in the main
 * process use the same codes.
 */

/** Errors raised inside RPC handling (service side). */
export const RPC_ERROR_CODES = {
  unknownCommand: 'rpc.unknownCommand',
  invalidInput: 'rpc.invalidInput',
  internal: 'rpc.internal'
} as const

/** Database / startup errors reported by the service before or during a session. */
export const DB_ERROR_CODES = {
  cannotOpen: 'db.cannotOpen',
  directoryNotWritable: 'db.directoryNotWritable',
  corrupt: 'db.corrupt',
  tooNew: 'db.tooNew',
  notAimThread: 'db.notAimThread',
  snapshotFailed: 'db.snapshotFailed',
  migrationFailed: 'db.migrationFailed'
} as const

/** App-shell errors raised by the main process. */
export const APP_ERROR_CODES = {
  lockFailed: 'app.lockFailed',
  serviceTimeout: 'app.serviceTimeout',
  serviceCrashed: 'app.serviceCrashed'
} as const

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[keyof typeof RPC_ERROR_CODES]
export type DbErrorCode = (typeof DB_ERROR_CODES)[keyof typeof DB_ERROR_CODES]
export type AppErrorCode = (typeof APP_ERROR_CODES)[keyof typeof APP_ERROR_CODES]
/** Any code that can end up on a repair/fatal page. */
export type StartupErrorCode = DbErrorCode | AppErrorCode

export const STARTUP_ERROR_CODES: readonly string[] = [
  ...Object.values(DB_ERROR_CODES),
  ...Object.values(APP_ERROR_CODES)
]

/** Error parameter values cross the wire for i18n interpolation (#62). */
export type ErrorParams = Record<string, string | number | null>

/** Service-thrown error with a machine-readable code. */
export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly params: ErrorParams = {}
  ) {
    super(`${code}${Object.keys(params).length > 0 ? ` ${JSON.stringify(params)}` : ''}`)
    this.name = 'ServiceError'
  }
}
