/**
 * The ordered migration registry (#53): hand-written, numbered, up-only.
 * Versions must be contiguous starting at 1; validated at module load so a
 * registry mistake fails fast in dev/tests rather than at user startup.
 */

import type { Database } from '../driver'
import { migration0001 } from './0001-init'

export interface Migration {
  version: number
  name: string
  up(db: Database): void
}

export const migrations: readonly Migration[] = [migration0001]

/** Throws if versions are not exactly 1..N without gaps or duplicates. */
export function validateMigrations(list: readonly Migration[]): void {
  list.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(
        `migration registry invalid: expected version ${i + 1} at index ${i}, found ${m.version} ("${m.name}")`
      )
    }
  })
}

validateMigrations(migrations)

export const LATEST_SCHEMA_VERSION: number =
  migrations.length > 0 ? migrations[migrations.length - 1].version : 0
