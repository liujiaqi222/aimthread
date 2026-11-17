/**
 * Migration 0001 (#67): the settings table only. Business tables are added by
 * the feature tickets that need them (#68 goals/settings, #69 timer, #70
 * records) with their own numbered migrations.
 *
 * Deliberately minimal: this proves the migration machinery; `user_version`
 * is set to 1 and `application_id` is stamped by the migration runner
 * (service/db/migrate.ts), not by migrations.
 */

import type { Migration } from './index'

export const migration0001: Migration = {
  version: 1,
  name: 'init',
  up(db) {
    db.exec(`
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )
    `)
  }
}
