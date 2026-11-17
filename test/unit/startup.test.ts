import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Startup, type ServiceHandlers, type StartupDeps, type StartupErrorInfo } from '@main/startup'
import { LockFailedError } from '@shared/fs/dir-lock'
import { APP_ERROR_CODES, DB_ERROR_CODES } from '@shared/protocol/errors'

/**
 * The startup state machine is pure (#67 / D4): the fork here is a fake whose
 * handlers the test fires by hand.
 */

interface Forked {
  handlers: ServiceHandlers
  killed: boolean
  pid: number
}

function makeHarness(overrides: Partial<StartupDeps> = {}) {
  const forks: Forked[] = []
  let pidSeq = 1000

  const uiReady: unknown[] = []
  const repairPages: StartupErrorInfo[] = []
  const logs: string[] = []
  const lockReleases: string[] = []
  const dir = mkdtempSync(join(tmpdir(), 'aimthread-startup-'))

  const deps: StartupDeps = {
    requestSingleInstanceLock: () => true,
    dataDir: dir,
    acquireLock(d: string) {
      return {
        lockPath: join(d, '.lock'),
        release: () => lockReleases.push(d)
      }
    },
    forkService(_d: string, handlers: ServiceHandlers) {
      const fork: Forked = { handlers, killed: false, pid: ++pidSeq }
      forks.push(fork)
      return {
        kill: () => {
          fork.killed = true
        },
        get pid() {
          return fork.pid
        }
      }
    },
    onUiReady: (info) => uiReady.push(info),
    onRepairPage: (error) => repairPages.push(error),
    log: (m) => logs.push(m),
    ...overrides
  }

  const startup = new Startup(deps)
  return { startup, deps, forks, uiReady, repairPages, logs, lockReleases, dir }
}

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Startup orchestrator', () => {
  it('happy path: lock → fork → ready → UI', () => {
    const h = makeHarness()
    cleanups.push(h.dir)
    expect(h.startup.start()).toBe(true)
    expect(h.forks).toHaveLength(1)
    expect(h.startup.state).toBe('starting')

    h.forks[0].handlers.onReady({ schemaVersion: 1, fromVersion: 0, toVersion: 1 })
    expect(h.startup.state).toBe('ready')
    expect(h.uiReady).toEqual([{ schemaVersion: 1, fromVersion: 0, toVersion: 1 }])
    expect(h.repairPages).toEqual([])
  })

  it('quits politely when the single-instance lock is taken', () => {
    const h = makeHarness({ requestSingleInstanceLock: () => false })
    cleanups.push(h.dir)
    expect(h.startup.start()).toBe(false)
    expect(h.startup.state).toBe('stopped')
    expect(h.forks).toHaveLength(0)
    expect(h.lockReleases).toEqual([]) // nothing to release
  })

  it('lock failure shows the repair page and retry() re-forks after acquireLock recovers', () => {
    let lockWorks = false
    const h = makeHarness({
      acquireLock() {
        if (!lockWorks) throw new LockFailedError('held', 1)
        return { lockPath: '/tmp/.lock', release: () => {} }
      }
    })
    cleanups.push(h.dir)
    h.startup.start()
    expect(h.startup.state).toBe('repair')
    expect(h.repairPages.map((e) => e.code)).toEqual([APP_ERROR_CODES.lockFailed])
    expect(h.forks).toHaveLength(0)

    lockWorks = true
    h.startup.retry()
    expect(h.forks).toHaveLength(1)
    h.forks[0].handlers.onReady({ schemaVersion: 1, fromVersion: 1, toVersion: 1 })
    expect(h.startup.state).toBe('ready')
  })

  it('startup error (e.g. db.tooNew) → repair page, service killed, retry works', () => {
    const h = makeHarness()
    cleanups.push(h.dir)
    h.startup.start()
    h.forks[0].handlers.onStartupError({ code: DB_ERROR_CODES.tooNew, params: { found: 999, supported: 1 } })
    expect(h.startup.state).toBe('repair')
    expect(h.forks[0].killed).toBe(true)
    expect(h.repairPages.map((e) => e.code)).toEqual([DB_ERROR_CODES.tooNew])

    h.startup.retry()
    expect(h.forks).toHaveLength(2)
    h.forks[1].handlers.onReady({ schemaVersion: 1, fromVersion: 1, toVersion: 1 })
    expect(h.startup.state).toBe('ready')
    expect(h.uiReady).toHaveLength(1)
  })

  it('crash while ready restarts and re-issues the UI (ports re-issued by main)', () => {
    const h = makeHarness()
    cleanups.push(h.dir)
    h.startup.start()
    h.forks[0].handlers.onReady({ schemaVersion: 1, fromVersion: 1, toVersion: 1 })
    h.forks[0].handlers.onExit(1) // crash
    expect(h.startup.state).toBe('starting')
    expect(h.forks).toHaveLength(2)
    h.forks[1].handlers.onReady({ schemaVersion: 1, fromVersion: 1, toVersion: 1 })
    expect(h.startup.state).toBe('ready')
    expect(h.uiReady).toHaveLength(2) // main re-issues ports on every ready
  })

  it('crash loop: 4 crashes in a minute exhaust the budget → fatal page', () => {
    const h = makeHarness()
    cleanups.push(h.dir)
    h.startup.start()
    // initial + 3 restarts = 4 forks; the 5th exit shows the fatal page.
    for (let i = 0; i < 4; i++) {
      h.forks[i].handlers.onReady({ schemaVersion: 1, fromVersion: 1, toVersion: 1 })
      h.forks[i].handlers.onExit(1)
    }
    expect(h.forks).toHaveLength(4) // no 5th fork
    expect(h.startup.state).toBe('fatal')
    expect(h.repairPages.map((e) => e.code)).toEqual([APP_ERROR_CODES.serviceCrashed])
  })

  it('ready timeout kills the service and shows the repair page', async () => {
    const h = makeHarness({ readyTimeoutMs: 20 })
    cleanups.push(h.dir)
    h.startup.start()
    await new Promise((r) => setTimeout(r, 60))
    expect(h.startup.state).toBe('repair')
    expect(h.forks[0].killed).toBe(true)
    expect(h.repairPages.map((e) => e.code)).toEqual([APP_ERROR_CODES.serviceTimeout])
  })

  it('shutdown kills the service and releases the lock', () => {
    const h = makeHarness()
    cleanups.push(h.dir)
    h.startup.start()
    h.startup.shutdown()
    expect(h.startup.state).toBe('stopped')
    expect(h.forks[0].killed).toBe(true)
    expect(h.lockReleases).toEqual([h.dir])
    // A late exit from the killed process is ignored.
    h.forks[0].handlers.onExit(0)
    expect(h.startup.state).toBe('stopped')
    expect(h.forks).toHaveLength(1)
  })

  it('retry() does nothing while running normally', () => {
    const h = makeHarness()
    cleanups.push(h.dir)
    h.startup.start()
    h.forks[0].handlers.onReady({ schemaVersion: 1, fromVersion: 1, toVersion: 1 })
    h.startup.retry()
    expect(h.forks).toHaveLength(1)
    expect(h.startup.state).toBe('ready')
  })
})
