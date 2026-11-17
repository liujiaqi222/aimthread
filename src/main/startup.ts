/**
 * Startup orchestrator (#64 startup order / #67): single-instance lock →
 * data-dir lock → fork service → ready ⇒ UI / startup-error ⇒ repair page;
 * crash ⇒ throttled restart, exhausted ⇒ fatal page. Pure of Electron — the
 * glue in main/index.ts implements the deps — so the whole state machine is
 * unit-testable (#64 D4).
 *
 * State machine:
 *   idle ──start()──► starting ──ready──► ready
 *     │                  │
 *     │                  ├─startup-error──► repair ──retry()──► starting
 *     │                  └─exit(crash)───► starting (restart) | fatal
 *     └──lock fail──────► repair
 *   any ──shutdown()──► stopped
 */

import { APP_ERROR_CODES, type ErrorParams } from '@shared/protocol/errors'
import type { DirLock } from '@shared/fs/dir-lock'
import { RestartPolicy } from './restart-policy'

export interface ServiceReadyInfo {
  schemaVersion: number
  fromVersion: number
  toVersion: number
}

export interface StartupErrorInfo {
  code: string
  params: ErrorParams
}

export interface ServiceProcess {
  kill(): void
  readonly pid: number | null
}

export interface ServiceHandlers {
  onReady(info: ServiceReadyInfo): void
  onStartupError(error: StartupErrorInfo): void
  onExit(code: number | null): void
}

export interface StartupDeps {
  requestSingleInstanceLock(): boolean
  readonly dataDir: string
  /** Throws LockFailedError when the directory is in use. */
  acquireLock(dataDir: string): DirLock
  forkService(dataDir: string, handlers: ServiceHandlers): ServiceProcess
  /** Service became ready: (re)create the app window / re-issue ports. */
  onUiReady(info: ServiceReadyInfo): void
  /** Show the repair/fatal page for this error. */
  onRepairPage(error: StartupErrorInfo): void
  log?(message: string): void
  now?(): number
  readyTimeoutMs?: number
  restartOptions?: { maxRestarts: number; windowMs: number }
}

export type StartupState = 'idle' | 'starting' | 'ready' | 'repair' | 'fatal' | 'stopped'

export class Startup {
  private readonly deps: StartupDeps
  private readonly policy: RestartPolicy
  private readonly readyTimeoutMs: number

  private lock: DirLock | null = null
  private proc: ServiceProcess | null = null
  private readyTimer: ReturnType<typeof setTimeout> | null = null
  private _state: StartupState = 'idle'
  private _lastError: StartupErrorInfo | null = null

  constructor(deps: StartupDeps) {
    this.deps = deps
    this.readyTimeoutMs = deps.readyTimeoutMs ?? 30_000
    this.policy = new RestartPolicy({
      ...(deps.restartOptions ?? {
        maxRestarts: 3,
        windowMs: 60_000
      }),
      now: deps.now
    })
  }

  get state(): StartupState {
    return this._state
  }

  get lastError(): StartupErrorInfo | null {
    return this._lastError
  }

  get servicePid(): number | null {
    return this.proc?.pid ?? null
  }

  /**
   * Runs the startup sequence. Returns false when another instance already
   * owns the single-instance lock (caller should quit).
   */
  start(): boolean {
    if (!this.deps.requestSingleInstanceLock()) {
      this._state = 'stopped'
      return false
    }

    try {
      this.lock = this.deps.acquireLock(this.deps.dataDir)
    } catch {
      // LockFailedError — another process holds this data directory.
      this._lastError = { code: APP_ERROR_CODES.lockFailed, params: {} }
      this._state = 'repair'
      this.deps.onRepairPage(this._lastError)
      return true
    }

    this.startService()
    return true
  }

  /** Repair-page "Try again": re-fork the service (lock is still held). */
  retry(): void {
    if (this._state !== 'repair' && this._state !== 'fatal') return
    this.startService()
  }

  shutdown(): void {
    if (this._state === 'stopped') return
    this._state = 'stopped'
    if (this.readyTimer) clearTimeout(this.readyTimer)
    this.readyTimer = null
    this.proc?.kill()
    this.proc = null
    this.lock?.release()
    this.lock = null
  }

  private startService(): void {
    this._state = 'starting'
    const proc = this.deps.forkService(this.deps.dataDir, {
      onReady: (info) => {
        if (this._state !== 'starting') return
        this.clearReadyTimer()
        // NB: the restart budget is NOT reset here — a crash-looping service
        // must not re-arm it by briefly reporting ready (#64: “1 分钟内最多
        // 3 次”). The rolling window itself relaxes over time.
        this._state = 'ready'
        this.deps.onUiReady(info)
      },
      onStartupError: (error) => {
        if (this._state !== 'starting') return
        this.clearReadyTimer()
        proc.kill() // service waits for us; never serve on a broken DB
        this.enterRepair(error)
      },
      onExit: (code) => {
        if (this._state === 'stopped' || this._state === 'repair' || this._state === 'fatal') return
        // Unexpected exit: crash while ready or during startup.
        if (this.proc === proc) this.proc = null
        this.clearReadyTimer()
        this.deps.log?.(`service exited unexpectedly (code ${code}); state=${this._state}`)
        if (this.policy.tryRecordRestart()) {
          this.deps.log?.('restarting service')
          this.startService()
        } else {
          this._lastError = { code: APP_ERROR_CODES.serviceCrashed, params: {} }
          this._state = 'fatal'
          this.deps.onRepairPage(this._lastError)
        }
      }
    })
    this.proc = proc

    this.readyTimer = setTimeout(() => {
      if (this._state === 'starting') {
        this.deps.log?.('service ready timeout')
        proc.kill()
        this.proc = null
        this.enterRepair({ code: APP_ERROR_CODES.serviceTimeout, params: {} })
      }
    }, this.readyTimeoutMs)
  }

  private enterRepair(error: StartupErrorInfo): void {
    this._lastError = error
    this._state = 'repair'
    this.deps.onRepairPage(error)
  }

  private clearReadyTimer(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer)
    this.readyTimer = null
  }
}
