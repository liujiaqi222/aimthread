/**
 * Data directory file lock (#64: `<dataDir>/.lock`, acquired by the main
 * process before the service is forked; the dev service entry acquires it
 * itself when running standalone).
 *
 * Uses O_EXCL create + PID liveness check: a leftover lock from a crashed
 * process whose PID no longer exists is treated as stale and replaced.
 * PID reuse is theoretically possible; accepted for M1 (single user, local).
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'

export interface DirLock {
  readonly lockPath: string
  /** Removes the lock file. Safe to call more than once. */
  release(): void
}

export class LockFailedError extends Error {
  constructor(
    public readonly reason: 'held' | 'stale-unclearable',
    public readonly heldByPid: number | null
  ) {
    super(`data directory lock unavailable (${reason})`)
  }
}

interface LockFileContent {
  pid: number
  startedAt: number
}

function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 probes existence without delivering anything.
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM' // exists but not ours (macOS sandbox etc.)
  }
}

function writeLock(fd: number, pid: number): void {
  const content: LockFileContent = { pid, startedAt: Date.now() }
  writeSync(fd, JSON.stringify(content))
}

function tryCreate(lockPath: string, pid: number): number | null {
  try {
    const fd = openSync(lockPath, 'wx')
    try {
      writeLock(fd, pid)
    } finally {
      closeSync(fd)
    }
    return fd
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return null
    throw e
  }
}

/** Acquires `<dir>/.lock`. Throws LockFailedError if the directory is in use. */
export function acquireDirLock(dir: string, options: { pid?: number } = {}): DirLock {
  mkdirSync(dir, { recursive: true })
  const lockPath = join(dir, '.lock')
  const pid = options.pid ?? process.pid

  if (tryCreate(lockPath, pid) !== null) {
    return makeLock(lockPath)
  }

  // Lock exists: a live holder means failure; a dead one means stale.
  let holder: LockFileContent | null = null
  try {
    holder = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockFileContent
  } catch {
    holder = null
  }

  if (holder && Number.isInteger(holder.pid) && isPidAlive(holder.pid)) {
    throw new LockFailedError('held', holder.pid)
  }

  // Stale (or unreadable): remove and retry once. Between unlink and create
  // another process could win the race — that is a genuine "held" failure.
  try {
    unlinkSync(lockPath)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new LockFailedError('stale-unclearable', holder?.pid ?? null)
    }
  }
  if (tryCreate(lockPath, pid) === null) {
    throw new LockFailedError('held', null)
  }
  return makeLock(lockPath)
}

function makeLock(lockPath: string): DirLock {
  let released = false
  return {
    lockPath,
    release(): void {
      if (released) return
      released = true
      try {
        unlinkSync(lockPath)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && existsSync(lockPath)) {
          // Can't remove our own lock file: surface it rather than swallow.
          throw e
        }
      }
    }
  }
}
