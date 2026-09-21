/**
 * HOLLOW SUN — deterministic seeded RNG (mulberry32).
 * Contract: class Rng { constructor(seed); f(); range(a,b); int(n) }
 * All sim randomness flows through this so runs are reproducible per seed.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Next float in [0, 1). */
  f(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [a, b). */
  range(a: number, b: number): number {
    return a + this.f() * (b - a);
  }

  /** Int in [0, n). */
  int(n: number): number {
    return Math.floor(this.f() * n);
  }
}
