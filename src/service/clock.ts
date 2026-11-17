/**
 * Clock abstraction. Services depend on this, not on Date.now / hrtime directly,
 * so tests can drive a FakeClock (#57).
 */
export interface Clock {
  now(): number
  monotonicMillis(): number
}

export class RealClock implements Clock {
  now(): number {
    return Date.now()
  }
  monotonicMillis(): number {
    const [s, ns] = process.hrtime()
    return s * 1000 + ns / 1e6
  }
}
