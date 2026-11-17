import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireDirLock, LockFailedError } from '@shared/fs/dir-lock'

const released: Array<() => void> = []

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'aimthread-lock-'))
}

afterEach(() => {
  for (const release of released.splice(0)) release()
})

/** Spawns a process that exits immediately; resolves its (now dead) pid. */
async function recentlyDeadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
  const pid = child.pid
  if (!pid) throw new Error('child has no pid')
  expect(pid).toBeTruthy()
  await new Promise<void>((resolve) => child.on('exit', () => resolve()))
  return pid
}

describe('acquireDirLock', () => {
  it('acquires, writes its pid, and releases cleanly', () => {
    const dir = freshDir()
    const lock = acquireDirLock(dir)
    released.push(lock.release)
    expect(existsSync(lock.lockPath)).toBe(true)
    const content = JSON.parse(readFileSync(lock.lockPath, 'utf-8')) as { pid: number }
    expect(content.pid).toBe(process.pid)
    lock.release()
    expect(existsSync(lock.lockPath)).toBe(false)
    lock.release() // idempotent
  })

  it('rejects a second acquisition while held', () => {
    const dir = freshDir()
    const lock = acquireDirLock(dir)
    released.push(lock.release)
    expect(() => acquireDirLock(dir)).toThrowError(LockFailedError)
  })

  it('reports the holder pid of a live process', () => {
    const dir = freshDir()
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    try {
      if (!child.pid) throw new Error('child has no pid')
      const lock = acquireDirLock(dir, { pid: child.pid })
      released.push(lock.release)
      let err: LockFailedError | null = null
      try {
        acquireDirLock(dir)
      } catch (e) {
        err = e as LockFailedError
      }
      expect(err).toBeInstanceOf(LockFailedError)
      expect(err?.reason).toBe('held')
      expect(err?.heldByPid).toBe(child.pid)
    } finally {
      child.kill()
    }
  })

  it('replaces a stale lock from a dead process', async () => {
    const dir = freshDir()
    const pid = await recentlyDeadPid()
    // Simulate a crashed holder.
    writeFileSync(join(dir, '.lock'), JSON.stringify({ pid, startedAt: Date.now() }))
    const lock = acquireDirLock(dir) // must treat as stale and replace
    released.push(lock.release)
    expect(existsSync(lock.lockPath)).toBe(true)
    const content = JSON.parse(readFileSync(lock.lockPath, 'utf-8')) as { pid: number }
    expect(content.pid).toBe(process.pid)
  })

  it('replaces an unreadable lock file', () => {
    const dir = freshDir()
    writeFileSync(join(dir, '.lock'), 'not json at all')
    const lock = acquireDirLock(dir)
    released.push(lock.release)
    expect(existsSync(lock.lockPath)).toBe(true)
  })

  it('treats a live foreign process as held', () => {
    const dir = freshDir()
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    try {
      const lock = acquireDirLock(dir, { pid: child.pid })
      released.push(lock.release)
      expect(() => acquireDirLock(dir)).toThrowError(LockFailedError)
    } finally {
      child.kill()
    }
  })
})
