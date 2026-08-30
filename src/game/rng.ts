/** Seeded PRNG (mulberry32) — deterministic level generation. */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function rngInt(rng: Rng, minInclusive: number, maxExclusive: number): number {
  return Math.floor(rngRange(rng, minInclusive, maxExclusive));
}

export function rngChance(rng: Rng, p: number): boolean {
  return rng() < p;
}

export function rngPick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}
