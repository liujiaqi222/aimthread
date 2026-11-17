import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { APP_ID, DB_FILE_NAME } from '@shared/app'
import { ServiceError } from '@shared/protocol/errors'
import { openDatabase } from '@service/db/driver'
import { openAndMigrate, type DbStartup } from '@service/db/migrate'
import { pruneSnapshots } from '@service/db/snapshot'
import type { Migration } from '@service/db/migrations'

/**
 * The #67 acceptance battery for the DB layer: stepwise migration, failure
 * injection (file unchanged + snapshot exists), foreign_key_check
 * interception, too-new, quick_check failure, unwritable directory — and
 * never an accidental empty database.
 */

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aimthread-db-'))
  dirs.push(dir)
  return dir
}

function dbPath(dir: string): string {
  return join(dir, DB_FILE_NAME)
}

/** Captures the startup error instead of throwing it. */
function attempt(path: string, opts?: { migrations?: readonly Migration[] }): { result?: DbStartup; error?: ServiceError } {
  try {
    return { result: openAndMigrate(path, opts) }
  } catch (e) {
    return { error: e as ServiceError }
  }
}

/** Logical equality check: every table's rows + both header versions. */
function dump(dir: string): string {
  const db = openDatabase(dbPath(dir))
  try {
    const parts: string[] = [
      JSON.stringify(db.get('PRAGMA user_version')),
      JSON.stringify(db.get('PRAGMA application_id'))
    ]
    const tables = db.all(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    ) as Array<{ name: string }>
    for (const t of tables) {
      parts.push(JSON.stringify(db.all(`SELECT * FROM ${t.name} ORDER BY 1`)))
    }
    return parts.join('\n')
  } finally {
    db.close()
  }
}

// Test registries -----------------------------------------------------------

const m1: Migration = {
  version: 1,
  name: 'm1',
  up(db) {
    db.exec('CREATE TABLE t_a (id INTEGER PRIMARY KEY, v TEXT NOT NULL)')
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)')
  }
}
const m2: Migration = {
  version: 2,
  name: 'm2',
  up(db) {
    db.exec('CREATE TABLE t_b (id INTEGER PRIMARY KEY, v TEXT NOT NULL)')
  }
}
const m3: Migration = {
  version: 3,
  name: 'm3',
  up(db) {
    db.exec('CREATE TABLE t_c (id INTEGER PRIMARY KEY, v TEXT NOT NULL)')
  }
}
const m2throws: Migration = {
  version: 2,
  name: 'm2throws',
  up() {
    throw new Error('injected migration failure')
  }
}
const m1parentChild: Migration = {
  version: 1,
  name: 'm1parentChild',
  up(db) {
    db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY)')
    db.exec('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id))')
  }
}
const m2orphan: Migration = {
  version: 2,
  name: 'm2orphan',
  up(db) {
    // Insert with FKs deliberately off (as during any migration); the
    // runner's foreign_key_check must catch it and roll everything back.
    db.exec('INSERT INTO child (id, parent_id) VALUES (1, 999)')
  }
}

// ---------------------------------------------------------------------------

describe('openAndMigrate', () => {
  it('first run initializes deliberately: settings table + app id + user_version', () => {
    const dir = freshDir()
    const started = openAndMigrate(dbPath(dir))
    expect(started.fromVersion).toBe(0)
    expect(started.toVersion).toBe(1)
    expect(started.snapshotPath).toBeNull()

    const db = started.db
    expect(db.get('PRAGMA application_id')).toMatchObject({ application_id: APP_ID })
    expect(db.get('PRAGMA user_version')).toMatchObject({ user_version: 1 })
    expect(db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)).toEqual([
      { name: 'settings' }
    ])
    db.close()
  })

  it('reopening at the current version is a no-op without a snapshot', () => {
    const dir = freshDir()
    const first = openAndMigrate(dbPath(dir))
    first.db.close()
    const second = openAndMigrate(dbPath(dir))
    expect(second.fromVersion).toBe(1)
    expect(second.toVersion).toBe(1)
    expect(second.snapshotPath).toBeNull()
    second.db.close()
  })

  it('migrates stepwise through every version', () => {
    const dir = freshDir()
    // Fixture at v1 with only the first migration…
    const atV1 = openAndMigrate(dbPath(dir), { migrations: [m1] })
    expect(atV1.toVersion).toBe(1)
    atV1.db.close()

    // …then upgrade through the full registry to v3.
    const atV3 = openAndMigrate(dbPath(dir), { migrations: [m1, m2, m3] })
    expect(atV3.fromVersion).toBe(1)
    expect(atV3.toVersion).toBe(3)
    for (const table of ['t_a', 't_b', 't_c', 'settings']) {
      expect(atV3.db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`)).toHaveLength(1)
    }
    expect(atV3.db.get('PRAGMA user_version')).toMatchObject({ user_version: 3 })
    atV3.db.close()
  })

  it('migration failure: database logically unchanged and a pre-migration snapshot exists', () => {
    const dir = freshDir()
    const atV1 = openAndMigrate(dbPath(dir), { migrations: [m1] })
    atV1.db.close()
    const before = dump(dir)

    const { error } = attempt(dbPath(dir), { migrations: [m1, m2throws] })
    expect(error?.code).toBe('db.migrationFailed')
    expect(String(error?.params['detail'])).toContain('injected migration failure')

    expect(dump(dir)).toBe(before) // unchanged, no half-applied schema
    expect(readdirSync(join(dir, 'snapshots')).filter((n) => n.startsWith('pre-migration-v1-'))).toHaveLength(1)
  })

  it('foreign_key_check intercepts violations and rolls the migration back', () => {
    const dir = freshDir()
    const atV1 = openAndMigrate(dbPath(dir), { migrations: [m1parentChild] })
    atV1.db.close()
    const before = dump(dir)

    const { error } = attempt(dbPath(dir), { migrations: [m1parentChild, m2orphan] })
    expect(error?.code).toBe('db.migrationFailed')
    expect(String(error?.params['detail'])).toContain('foreign_key_check')

    // No orphan row, still at v1, everything else unchanged.
    const db = openDatabase(dbPath(dir))
    expect(db.get('SELECT COUNT(*) AS n FROM child')).toMatchObject({ n: 0 })
    expect(db.get('PRAGMA user_version')).toMatchObject({ user_version: 1 })
    db.close()
    expect(dump(dir)).toBe(before)
    expect(readdirSync(join(dir, 'snapshots')).filter((n) => n.startsWith('pre-migration-v1-'))).toHaveLength(1)
  })

  it('version too high: reports db.tooNew and leaves the file untouched', () => {
    const dir = freshDir()
    const started = openAndMigrate(dbPath(dir))
    started.db.close()

    // Forge a future version by hand.
    const db = openDatabase(dbPath(dir))
    db.exec('PRAGMA user_version = 999')
    db.close()
    const before = dump(dir)

    const { error } = attempt(dbPath(dir))
    expect(error?.code).toBe('db.tooNew')
    expect(error?.params).toMatchObject({ found: 999, supported: 1 })
    expect(dump(dir)).toBe(before) // untouched
  })

  it('garbage file: db.corrupt, and the file bytes are untouched', () => {
    const dir = freshDir()
    const garbage = Buffer.from('this is definitely not a sqlite database file, nope')
    writeFileSync(dbPath(dir), garbage)

    const { error } = attempt(dbPath(dir))
    expect(error?.code).toBe('db.corrupt')
    expect(readFileSync(dbPath(dir)).equals(garbage)).toBe(true) // no empty DB, no rewrite
  })

  it('quick_check failure on a page-corrupted database: db.corrupt', () => {
    const dir = freshDir()
    const started = openAndMigrate(dbPath(dir))
    // Enough rows to span several pages, then checkpoint via close.
    started.db.exec('CREATE TABLE filler (id INTEGER PRIMARY KEY, v TEXT NOT NULL)')
    const ins = started.db.prepare('INSERT INTO filler (v) VALUES (?)')
    for (let i = 0; i < 500; i++) ins.run(`${'x'.repeat(60)}-${i}`)
    started.db.close()

    // Corrupt body bytes well past the 100-byte header and first pages.
    const path = dbPath(dir)
    const raw = readFileSync(path)
    const from = Math.min(4096, Math.max(200, raw.length >> 1))
    raw.fill(0xff, from, Math.min(from + 900, raw.length))
    writeFileSync(path, raw)

    const { error } = attempt(dbPath(dir))
    expect(error?.code).toBe('db.corrupt')
  })

  it('foreign SQLite file: db.notAimThread, never adopted', () => {
    const dir = freshDir()
    const db = openDatabase(dbPath(dir))
    db.exec('CREATE TABLE their_table (id INTEGER PRIMARY KEY)')
    db.close() // application_id stays 0 with user content → not ours

    const { error } = attempt(dbPath(dir))
    expect(error?.code).toBe('db.notAimThread')
  })

  it('wrong application_id: db.notAimThread', () => {
    const dir = freshDir()
    const db = openDatabase(dbPath(dir))
    db.exec('PRAGMA application_id = 12345')
    db.close()

    const { error } = attempt(dbPath(dir))
    expect(error?.code).toBe('db.notAimThread')
  })

  it('unwritable directory: db.directoryNotWritable and no database created', () => {
    const dir = freshDir()
    chmodSync(dir, 0o500)
    try {
      const { error } = attempt(dbPath(dir))
      if (process.getuid?.() === 0) return // root ignores mode bits; skip on such CI
      expect(error?.code).toBe('db.directoryNotWritable')
      expect(readdirSync(dir)).toEqual([]) // nothing was created
    } finally {
      chmodSync(dir, 0o700)
    }
  })

  it('rejects non-contiguous migration registries loudly', () => {
    const dir = freshDir()
    expect(() => openAndMigrate(dbPath(dir), { migrations: [m1, m3] })).toThrowError(/registry invalid/)
  })

  it('snapshot retention keeps only the newest 3 per kind', () => {
    const dir = freshDir()
    const snapshotDir = join(dir, 'snapshots')
    mkdirSync(snapshotDir, { recursive: true })
    const names = [
      'pre-migration-v1-1.db',
      'pre-migration-v1-2.db',
      'pre-migration-v1-3.db',
      'pre-migration-v1-4.db',
      'pre-migration-v1-5.db',
      'pre-restore-v1-9.db'
    ]
    const base = Date.now() / 1000
    names.forEach((n, i) => {
      const path = join(snapshotDir, n)
      writeFileSync(path, 'x')
      utimesSync(path, base + i * 60, base + i * 60)
    })
    pruneSnapshots(dir, 'pre-migration')
    expect(readdirSync(snapshotDir).sort()).toEqual([
      'pre-migration-v1-3.db',
      'pre-migration-v1-4.db',
      'pre-migration-v1-5.db',
      'pre-restore-v1-9.db' // other kinds untouched
    ])
  })
})
