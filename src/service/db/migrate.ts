/**
 * Database startup pipeline (#53 / #67): open, classify, and — only when
 * legitimate — initialize or migrate. Central rule: **never silently fall
 * back to an empty database.** A brand-new file is deliberately initialized
 * (first run); every other failure path leaves the file byte-for-byte alone
 * or logically unchanged.
 *
 * Steps for an existing AimThread database:
 *   connect pragmas → read application_id → quick_check →
 *   user_version: too new → error; current → done; older →
 *   pre-migration snapshot → single-transaction migration with
 *   foreign_keys OFF (outside the txn), foreign_key_check before commit,
 *   foreign_keys restored in `finally` → prune snapshots.
 */

import { accessSync, constants as fsConstants, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { APP_ID } from '@shared/app'
import { ServiceError, DB_ERROR_CODES } from '@shared/protocol/errors'
import { openDatabase, type Database } from './driver'
import { migrations as defaultMigrations, validateMigrations, type Migration } from './migrations'
import { createPreMigrationSnapshot, pruneSnapshots } from './snapshot'

export interface DbStartup {
  db: Database
  /** Schema version before this startup (0 = fresh file). */
  fromVersion: number
  toVersion: number
  /** Path of the snapshot taken before this run's migration, if any. */
  snapshotPath: string | null
  dataDir: string
}

interface PragmaRow {
  [key: string]: unknown
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : String(value)
}

function readPragmaNumber(db: Database, name: string): number {
  const row = db.get(`PRAGMA ${name}`) as PragmaRow | undefined
  const value = row?.[name]
  return typeof value === 'number' ? value : Number(value ?? 0)
}

function hasUserObjects(db: Database): boolean {
  const rows = db.all(
    `SELECT name FROM sqlite_master WHERE type IN ('table','view','index','trigger') AND name NOT LIKE 'sqlite_%'`
  )
  return rows.length > 0
}

function quickCheck(db: Database): void {
  let rows: Array<PragmaRow>
  try {
    rows = db.all('PRAGMA quick_check') as Array<PragmaRow>
  } catch (e) {
    // A corrupt database can make the pragma itself throw; that is
    // corruption too (#53).
    throw new ServiceError(DB_ERROR_CODES.corrupt, {
      detail: String((e as Error).message).slice(0, 200)
    })
  }
  const bad = rows.find((r) => str(r['quick_check']).toLowerCase() !== 'ok')
  if (bad) {
    throw new ServiceError(DB_ERROR_CODES.corrupt, { detail: str(bad['quick_check']).slice(0, 200) })
  }
}

function closeQuietly(db: Database | null): void {
  if (!db) return
  try {
    db.close()
  } catch {
    // Already unusable; nothing to clean up.
  }
}

/** Opens the database and runs the full startup classification/migration. */
export function openAndMigrate(dbFilePath: string, options: { migrations?: readonly Migration[] } = {}): DbStartup {
  const migrations = options.migrations ?? defaultMigrations
  validateMigrations(migrations as Migration[])
  const targetVersion = migrations.length > 0 ? migrations[migrations.length - 1].version : 0
  const dataDir = dirname(dbFilePath)

  try {
    mkdirSync(dataDir, { recursive: true })
    accessSync(dataDir, fsConstants.W_OK | fsConstants.X_OK)
  } catch {
    throw new ServiceError(DB_ERROR_CODES.directoryNotWritable, { path: dataDir })
  }

  let db: Database | null = null
  try {
    db = openDatabase(dbFilePath)
  } catch (e) {
    const message = String((e as Error).message)
    // A file that is not a database at all is corruption from the user's
    // perspective; other open failures (permissions, I/O) are cannotOpen.
    if (/not a database|malformed/i.test(message)) {
      throw new ServiceError(DB_ERROR_CODES.corrupt, { detail: message.slice(0, 200) })
    }
    throw new ServiceError(DB_ERROR_CODES.cannotOpen, { detail: message.slice(0, 200) })
  }

  try {
    // Classify by header. SQLite opens garbage lazily; the first pragma read
    // surfaces "file is not a database" → treat as corrupt (#53).
    let appId: number
    try {
      appId = readPragmaNumber(db, 'application_id')
    } catch (e) {
      throw new ServiceError(DB_ERROR_CODES.corrupt, {
        detail: String((e as Error).message).slice(0, 200)
      })
    }

    let fromVersion: number
    if (appId === 0) {
      const userVersion = readPragmaNumber(db, 'user_version')
      const pristine = userVersion === 0 && !hasUserObjects(db)
      if (!pristine) {
        // A foreign SQLite file. Reject; never adopt, never empty it.
        throw new ServiceError(DB_ERROR_CODES.notAimThread, {})
      }
      // Deliberate first-run initialization — the only path that writes a
      // non-AimThread file.
      fromVersion = 0
    } else if (appId !== APP_ID) {
      throw new ServiceError(DB_ERROR_CODES.notAimThread, { applicationId: appId })
    } else {
      quickCheck(db)
      fromVersion = readPragmaNumber(db, 'user_version')
      if (fromVersion > targetVersion) {
        throw new ServiceError(DB_ERROR_CODES.tooNew, { found: fromVersion, supported: targetVersion })
      }
    }

    if (fromVersion === targetVersion) {
      return { db, fromVersion, toVersion: targetVersion, snapshotPath: null, dataDir }
    }

    let snapshotPath: string | null = null
    if (fromVersion > 0) {
      // Safety net before upgrading an existing database (#53). Failure here
      // (e.g. disk full) aborts the migration — and this whole startup.
      try {
        snapshotPath = createPreMigrationSnapshot(db, dataDir, fromVersion)
      } catch (e) {
        throw new ServiceError(DB_ERROR_CODES.snapshotFailed, {
          detail: String((e as Error).message).slice(0, 200)
        })
      }
    }

    try {
      runMigrations(db, migrations as Migration[], fromVersion, targetVersion)
    } catch (e) {
      if (e instanceof ServiceError) throw e
      throw new ServiceError(DB_ERROR_CODES.migrationFailed, {
        detail: String((e as Error).message).slice(0, 200)
      })
    }

    if (snapshotPath) pruneSnapshots(dataDir, 'pre-migration')
    return { db, fromVersion, toVersion: targetVersion, snapshotPath, dataDir }
  } catch (e) {
    closeQuietly(db)
    throw e
  }
}

/**
 * All applicable migrations in one transaction (#53):
 *   - foreign_keys OFF *before* BEGIN (no-op inside a transaction)
 *   - foreign_key_check before commit; any row → rollback
 *   - user_version / application_id stamped inside the transaction
 *   - foreign_keys restored in `finally`, commit or rollback alike
 */
function runMigrations(db: Database, list: Migration[], fromVersion: number, targetVersion: number): void {
  const applicable = list.filter((m) => m.version > fromVersion && m.version <= targetVersion)
  if (applicable.length === 0 && fromVersion !== targetVersion) {
    throw new Error(`no migrations cover ${fromVersion} → ${targetVersion}`)
  }

  db.exec('PRAGMA foreign_keys = OFF')
  try {
    // The driver's transaction() does BEGIN / COMMIT, and ROLLBACK on throw.
    db.transaction(() => {
      for (const m of applicable) m.up(db)

      const violations = db.all('PRAGMA foreign_key_check')
      if (violations.length > 0) {
        throw new ServiceError(DB_ERROR_CODES.migrationFailed, {
          detail: `foreign_key_check found ${violations.length} violation(s): ${JSON.stringify(violations.slice(0, 5))}`
        })
      }

      db.exec(`PRAGMA application_id = ${APP_ID}`)
      db.exec(`PRAGMA user_version = ${targetVersion}`)
    })
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

