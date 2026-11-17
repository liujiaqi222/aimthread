/**
 * Application-wide constants shared by main, service, and UI.
 * Kept in shared/ because all three runtimes need the same values
 * (ESLint rules forbid cross-directory imports).
 */

/** AimThread database identity, stored in the SQLite header. ASCII "AIMT". */
export const APP_ID = 0x41494d54

export const APP_NAME = 'AimThread'

/** Main database file inside the data directory (#53). */
export const DB_FILE_NAME = 'aimthread.db'

/** Automatic snapshots directory inside the data directory (#53). */
export const SNAPSHOTS_DIR_NAME = 'snapshots'
