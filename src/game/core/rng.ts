// NEXUS ARMOR — deterministic seeded RNG (mulberry32).
// Sim decisions use this; FX randomness uses Math.random so it can never desync gameplay.

export class RNG {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** integer [min, max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length]
  }

  /** cheap pseudo-gaussian in [-1,1] via 3-sample average (bell-ish) */
  bell(): number {
    return (this.next() + this.next() + this.next()) / 1.5 - 1
  }
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
