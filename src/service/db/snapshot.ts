/**
 * Automatic snapshots (#53 / ADR 0002): before every schema upgrade the runner
 * stores a `VACUUM INTO` copy under `<dataDir>/snapshots/`. M1 creates
 * snapshots only (no restore UI); each kind keeps the most recent 3.
 */

import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { SNAPSHOTS_DIR_NAME } from '@shared/app'
import type { Database } from './driver'

export const SNAPSHOT_KEEP = 3

/** Escapes a JS string into a single-quoted SQL string literal. */
export function sqlStringLiteral(s: string): string {
  return `'${s.replaceAll("'", "''")}'`
}

export function snapshotsDir(dataDir: string): string {
  return join(dataDir, SNAPSHOTS_DIR_NAME)
}

/**
 * Creates `pre-migration-v<from>-<timestamp>.db` and returns its path.
 * Throws on any failure (disk full included); the caller must treat that as
 * "do not migrate" (#53).
 */
export function createPreMigrationSnapshot(
  db: Database,
  dataDir: string,
  fromVersion: number,
  now: () => number = Date.now
): string {
  const dir = snapshotsDir(dataDir)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `pre-migration-v${fromVersion}-${now()}.db`)
  db.exec(`VACUUM INTO ${sqlStringLiteral(path)}`)
  return path
}

/** Keeps the newest `keep` snapshots of one kind; removes the rest. */
export function pruneSnapshots(dataDir: string, kind: 'pre-migration', keep = SNAPSHOT_KEEP): void {
  const dir = snapshotsDir(dataDir)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return // no snapshots at all
  }
  const ofKind = entries
    .filter((n) => n.startsWith(`${kind}-`) && n.endsWith('.db'))
    .map((n) => {
      const full = join(dir, n)
      return { full, mtimeMs: statSync(full).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const stale of ofKind.slice(keep)) {
    try {
      unlinkSync(stale.full)
    } catch {
      // Best effort; an un-pruned snapshot is harmless.
    }
  }
}
