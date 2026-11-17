/**
 * Dev-only service entry (#64 D3 / ADR 0001): runs the service as a plain
 * Node process so the renderer can be developed in a browser against the
 * loopback HTTP transport. Never shipped: not an electron-vite entry, and
 * nothing in the production graph imports it (scripts/check-build.mjs).
 *
 * Responsibilities here mirror what Electron's main process does for the
 * utilityProcess entry: data-dir lock, open + migrate, then serve.
 */

import { join } from 'node:path'
import os from 'node:os'
import { DB_FILE_NAME } from '@shared/app'
import { acquireDirLock, LockFailedError, type DirLock } from '@shared/fs/dir-lock'
import { resolveDataDir } from '@shared/fs/data-dir'
import { createService, type Service } from './index'
import { RealClock } from './clock'
import type { Host, Unsubscribe } from './host'
import { openAndMigrate } from './db/migrate'
import { startDevHttpServer } from './http/dev-server'

const dataDir = resolveDataDir({
  env: process.env,
  isPackaged: false,
  homedir: os.homedir(),
  platform: process.platform
})

let lock: DirLock | null = null
try {
  lock = acquireDirLock(dataDir)
} catch (e) {
  if (e instanceof LockFailedError) {
    console.error(`[dev] data directory is in use: ${dataDir} (held by pid ${e.heldByPid ?? 'unknown'})`)
    process.exit(1)
  }
  throw e
}

// Dev host skeleton (#67): concrete abilities land with the feature tickets
// that need them (#68 language detection, #69 notifications & suspend).
const devHost: Host = {
  onSuspend(_cb): Unsubscribe {
    return () => {}
  },
  onResume(_cb): Unsubscribe {
    return () => {}
  },
  async preferredSystemLanguages(): Promise<string[]> {
    const fromEnv = process.env['AIMTHREAD_DEV_LANGUAGES']
    return fromEnv ? fromEnv.split(',').map((s) => s.trim()).filter(Boolean) : ['en']
  },
  async notify(n): Promise<{ shown: boolean }> {
    console.log(`[dev:notify] ${n.title} — ${n.body}`)
    return { shown: true }
  },
  async openPath(p): Promise<void> {
    console.log(`[dev:openPath] ${p}`)
  },
  localeChanged(locale): void {
    console.log(`[dev:localeChanged] ${locale}`)
  }
}

let service: Service | null = null
let schemaVersion = 0
try {
  const start = openAndMigrate(join(dataDir, DB_FILE_NAME))
  schemaVersion = start.toVersion
  service = createService({
    db: start.db,
    clock: new RealClock(),
    host: devHost,
    version: process.env['AIMTHREAD_APP_VERSION'] ?? 'dev',
    validateOutput: true // dev transport always validates (D3)
  })
} catch (e) {
  console.error(`[dev] service startup failed: ${e instanceof Error ? e.message : e}`)
  lock.release()
  process.exit(1)
}

const server = await startDevHttpServer({ service })
console.log(`[dev] AimThread service: http://127.0.0.1:${server.port}`)
console.log(`[dev] data directory: ${dataDir}`)
console.log(`[dev] schema: v${schemaVersion}`)

function shutdown(signal: string): void {
  console.log(`[dev] ${signal}, shutting down`)
  void server.close().then(() => {
    service?.close()
    lock?.release()
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
