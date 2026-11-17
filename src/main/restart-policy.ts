/**
 * Crash-restart throttling (#64): at most `maxRestarts` service restarts in
 * any rolling `windowMs` window ("1 minute 3 times"). Pure logic, no
 * Electron — unit tested; the orchestrator applies it.
 */

export interface RestartPolicyOptions {
  maxRestarts: number
  windowMs: number
  now?(): number
}
export class RestartPolicy {
  private readonly timestamps: number[] = []
  private readonly now: () => number

  constructor(private readonly opts: RestartPolicyOptions) {
    this.now = opts.now ?? Date.now
  }
  /** Attempts to record a restart; false (unrecorded) when out of budget. */
  tryRecordRestart(): boolean {
    const t = this.now()
    while (this.timestamps.length > 0 && t - this.timestamps[0] >= this.opts.windowMs) {
      this.timestamps.shift()
    }
    if (this.timestamps.length >= this.opts.maxRestarts) return false
    this.timestamps.push(t)
    return true
  }
}
