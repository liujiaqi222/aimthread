import { describe, expect, it } from 'vitest'
import { RestartPolicy } from '@main/restart-policy'

describe('RestartPolicy', () => {
  it('allows up to maxRestarts within the window', () => {
    const t = 0
    const policy = new RestartPolicy({ maxRestarts: 3, windowMs: 60_000, now: () => t })
    expect(policy.tryRecordRestart()).toBe(true)
    expect(policy.tryRecordRestart()).toBe(true)
    expect(policy.tryRecordRestart()).toBe(true)
    expect(policy.tryRecordRestart()).toBe(false)
  })

  it('grants budget again after the window slides', () => {
    let t = 0
    const policy = new RestartPolicy({ maxRestarts: 3, windowMs: 60_000, now: () => t })
    policy.tryRecordRestart()
    t = 30_000
    policy.tryRecordRestart()
    t = 61_000 // the first timestamp (t=0) has fallen out of the window
    expect(policy.tryRecordRestart()).toBe(true)
    expect(policy.tryRecordRestart()).toBe(true)
    expect(policy.tryRecordRestart()).toBe(false) // 30s, 61s, 61s(+1), 61s(+2) in window
    t = 91_000 // the 30s one fell out
    expect(policy.tryRecordRestart()).toBe(true)
  })

  it('uses real Date.now by default', () => {
    const policy = new RestartPolicy({ maxRestarts: 1, windowMs: 1_000 })
    expect(policy.tryRecordRestart()).toBe(true)
    expect(policy.tryRecordRestart()).toBe(false)
  })
})
