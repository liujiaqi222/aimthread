/**
 * Typed message module (#62): `en` is the base, `zh-CN` must `satisfies
 * Messages`, so missing/extra keys are compile errors. Message values are
 * functions taking interpolation params. Locale detection per #62: `zh*` →
 * `zh-CN`, everything else → `en`.
 */

export type Locale = 'en' | 'zh-CN'

import type { ErrorParams } from '../protocol/errors'

export const en = {
  locale: 'en' as Locale,
  repair: {
    title: () => 'AimThread cannot start',
    dataDirLabel: () => 'Data directory',
    reasons: {
      'db.cannotOpen': (p: ErrorParams) => `The database could not be opened (${p.detail ?? 'unknown error'}).`,
      'db.directoryNotWritable': () =>
        'The data directory is not writable. Check permissions on the directory and try again.',
      'db.corrupt': () =>
        'The database appears to be damaged (integrity check failed). It was left unchanged.',
      'db.tooNew': (p: ErrorParams) =>
        `This data was created by a newer version of AimThread (schema ${p.found}, this app supports ${p.supported}). Nothing was changed.`,
      'db.notAimThread': () =>
        'The file in the data directory is not an AimThread database. Nothing was changed.',
      'db.snapshotFailed': (p: ErrorParams) =>
        `A safety snapshot could not be created before upgrading (${p.detail ?? 'unknown error'}). Nothing was changed.`,
      'db.migrationFailed': (p: ErrorParams) =>
        `Upgrading the database failed (${p.detail ?? 'unknown error'}). The database was left unchanged. A pre-upgrade snapshot exists in the data directory.`,
      'app.lockFailed': () =>
        'Another AimThread instance is using this data directory. Only one instance can use it at a time.',
      'app.serviceTimeout': () => 'The background service did not start in time.',
      'app.serviceCrashed': () =>
        'The background service crashed repeatedly and stopped being restarted. Your data is safe on disk.'
    },
    actions: {
      retry: () => 'Try again',
      openDataDir: () => 'Open data directory',
      quit: () => 'Quit'
    }
  }
}

export type Messages = typeof en
