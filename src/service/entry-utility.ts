/**
 * utilityProcess entry. Started by main via `utilityProcess.fork(modulePath)`;
 * main has already resolved the data directory, taken the single-instance and
 * data-dir locks, and exported the resolved path via AIMTHREAD_DATA_DIR.
 *
 * Startup (#64 / #67):
 *   open + classify + migrate (service/db/migrate.ts) →
 *     success: report { kind: 'ready' } and serve
 *     failure: report { kind: 'startup-error', error: { code, params } }
 *              and wait for main to kill us (never serve on a broken DB).
 *
 * Channel notes (verified, see scripts/verify/v1-results.md):
 *   - `process.parentPort` 'message' callbacks receive `{ data, ports }`.
 *   - MessagePorts forwarded via MessageChannelMain arrive as MessagePortMain:
 *     EventEmitter style `.on('message', ev => ev.data)` + explicit `start()`.
 */
import { join } from 'node:path'
import os from 'node:os'
import { DB_FILE_NAME } from '@shared/app'
import { resolveDataDir } from '@shared/fs/data-dir'
import { ServiceError } from '@shared/protocol/errors'
import { createService, type Service } from './index'
import { RealClock } from './clock'
import { createParentPortHost, type MainMessage, type ServiceMessage } from './host'
import type { PortLike } from './rpc/connection'
import { openAndMigrate } from './db/migrate'
import { openDatabase } from './db/driver'

// Log hygiene (#67, V1 follow-up): node:sqlite is experimental in Node 24 and
// prints an ExperimentalWarning on every start. Filter exactly that one; keep
// every other warning visible.
const originalEmitWarning = process.emitWarning.bind(process)
process.emitWarning = ((warning: string, arg2?: unknown, arg3?: unknown) => {
  if (typeof warning === 'string' && warning.includes('node:sqlite') && warning.includes('experimental')) {
    return
  }
  // Delegates both overloads (code-first and options-first) untouched.
  return originalEmitWarning(warning as never, arg2 as never, arg3 as never)
}) as typeof process.emitWarning

const parentPort = process.parentPort as unknown as {
  on(event: 'message', cb: (ev: { data: unknown; ports: unknown[] }) => void): void
  postMessage(msg: ServiceMessage): void
}

const dataDir = resolveDataDir({
  env: process.env,
  isPackaged: false,
  homedir: os.homedir(),
  platform: process.platform
})

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

const startup = (() => {
  try {
    const result = openAndMigrate(join(dataDir, DB_FILE_NAME))
    return { ok: true as const, result }
  } catch (e) {
    if (e instanceof ServiceError) return { ok: false as const, error: { code: e.code, params: e.params } }
    return { ok: false as const, error: { code: 'rpc.internal', params: { detail: String((e as Error).message) } } }
  }
})()

if (!startup.ok) {
  parentPort.postMessage({ kind: 'startup-error', error: startup.error })
  // Wait for main to kill this process; do not serve anything meanwhile.
} else {
  const start = startup.result

  const host = createParentPortHost({
    postMessage: (m) => parentPort.postMessage(m),
    onMessage: (cb) => {
      parentPort.on('message', (ev) => {
        const msg = ev.data as MainMessage | { kind: 'host-call' } | null
        if (msg && (msg.kind === 'host-result' || msg.kind === 'host-event')) cb(msg)
      })
    }
  })

  const service: Service = createService({
    db: start.db,
    clock: new RealClock(),
    host,
    version: process.env['AIMTHREAD_APP_VERSION'] ?? 'dev',
    validateOutput: process.env['AIMTHREAD_VALIDATE_OUTPUT'] === '1' || process.env['NODE_ENV'] === 'development'
  })

  parentPort.on('message', (ev) => {
    const msg = ev.data as MainMessage | null
    if (!msg) return
    switch (msg.kind) {
      case 'connect': {
        const port = ev.ports[0] as PortLike | undefined
        if (port) service.attach(port)
        return
      }
      case 'shutdown': {
        service.close()
        process.exit(0)
        return
      }
      default:
        return // host-result / host-event handled by the host bridge.
    }
  })

  parentPort.postMessage({
    kind: 'ready',
    info: { schemaVersion: start.toVersion, fromVersion: start.fromVersion, toVersion: start.toVersion }
  })

  // V1 self-check hook (#65, kept for the verify script; not part of startup).
  if (process.env['AIMTHREAD_V1_CHECK'] === '1') {
    const dir = process.env['AIMTHREAD_V1_DIR'] ?? '.'
    const result = v1Check(`${dir}/v1-app.sqlite`, `${dir}/v1-backup.sqlite`)
    parentPort.postMessage({ kind: 'v1-result', result })
  }
}

/**
 * V1 self-check (#65): run the #64 V1 checklist through the real driver in
 * this process (dev build or packaged app). Verification-only.
 */
function v1Check(dbPath: string, backupPath: string): unknown {
  try {
    const APP_ID = 0x41494d54
    const db = openDatabase(dbPath)
    db.exec(`PRAGMA application_id = ${APP_ID}`)
    db.exec('PRAGMA user_version = 1')
    db.exec('CREATE TABLE v1 (id INTEGER PRIMARY KEY, v TEXT NOT NULL)')
    const ins = db.prepare('INSERT INTO v1 (v) VALUES (?)')
    for (const v of ['a', 'b', 'c']) ins.run(v)
    db.exec('PRAGMA wal_autocheckpoint = 0')
    ins.run('d')
    ins.run('e')
    db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`)
    const journal = db.get('PRAGMA journal_mode')
    const sync = db.get('PRAGMA synchronous')
    const fk = db.get('PRAGMA foreign_keys')
    const busy = db.get('PRAGMA busy_timeout')
    db.close()
    const ro = openDatabase(backupPath, { readOnly: true })
    const count = ro.get('SELECT COUNT(*) AS n FROM v1')
    const appId = ro.get('PRAGMA application_id')
    const ver = ro.get('PRAGMA user_version')
    ro.close()
    return {
      ok: true,
      journal: (journal as { journal_mode?: string })?.journal_mode,
      sync: (sync as { synchronous?: number })?.synchronous,
      fk: (fk as { foreign_keys?: number })?.foreign_keys,
      busy: (busy as { timeout?: number })?.timeout,
      rowCount: (count as { n?: number })?.n,
      appId: (appId as { application_id?: number })?.application_id,
      userVersion: (ver as { user_version?: number })?.user_version,
      node: process.versions.node,
      electron: process.versions.electron
    }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
