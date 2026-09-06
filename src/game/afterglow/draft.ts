import type { Rng } from '../rng';

/**
 * AFTERGLOW M0 draft pool — PURE TypeScript (no DOM, no three).
 * 12 items, each with a named tag (the M1 build-craft web starts here),
 * a rarity, a max stack count and a pure apply(mods) function.
 * All stacking resolves in ONE place: the Mods struct below.
 */

/* ------------------------------------------------------------------ */
/* Mods — the single struct every draft item writes into               */
/* ------------------------------------------------------------------ */

export interface Mods {
  /** weapon damage multiplier */
  damageMul: number;
  /** move speed multiplier */
  speedMul: number;
  /** weapon range multiplier */
  rangeMul: number;
  /** projectile speed multiplier */
  projSpeedMul: number;
  /** fire interval multiplier (< 1 = faster) */
  intervalMul: number;
  /** extra bolts per volley (twin_glimmer) */
  volleys: number;
  /** mote pickup radius multiplier */
  pickupMul: number;
  /** dash cooldown multiplier */
  dashCdMul: number;
  /** additive max hp delta (clamped so maxHp never drops below the floor) */
  bonusMaxHp: number;
  /** extra iframes seconds after every hurt */
  iframeBonus: number;
  /** ember tag: hits (bolts, chain, dash trail) apply burn */
  burnOnHit: boolean;
  /** chain_spark arcs per hit */
  chainCount: number;
  /** glimmer_ward max shield charges */
  wardMax: number;
  /** how many of each draft id the run has taken */
  takenCounts: Record<string, number>;
}

export function baseMods(): Mods {
  return {
    damageMul: 1,
    speedMul: 1,
    rangeMul: 1,
    projSpeedMul: 1,
    intervalMul: 1,
    volleys: 0,
    pickupMul: 1,
    dashCdMul: 1,
    bonusMaxHp: 0,
    iframeBonus: 0,
    burnOnHit: false,
    chainCount: 0,
    wardMax: 0,
    takenCounts: {},
  };
}

/* ------------------------------------------------------------------ */
/* Draft items — the M0 pool, exactly 12                               */
/* ------------------------------------------------------------------ */

export type Rarity = 'common' | 'rare';

export interface DraftDef {
  id: string;
  name: string;
  desc: string;
  tags: string[];
  rarity: Rarity;
  maxStacks: number;
  /** pure function: mutate the Mods struct, touch nothing else */
  apply(m: Mods): void;
}

export const COMMON_WEIGHT = 1.0;
export const RARE_WEIGHT = 0.35;

export const DRAFTS: DraftDef[] = [
  {
    id: 'twin_glimmer',
    name: 'TWIN GLIMMER',
    desc: '+1 bolt per volley',
    tags: ['projectile'],
    rarity: 'common',
    maxStacks: 3,
    apply: (m) => { m.volleys += 1; },
  },
  {
    id: 'keen_focus',
    name: 'KEEN FOCUS',
    desc: '+25% damage',
    tags: ['damage'],
    rarity: 'common',
    maxStacks: 1,
    apply: (m) => { m.damageMul *= 1.25; },
  },
  {
    id: 'swift_glass',
    name: 'SWIFT GLASS',
    desc: '+12% move speed',
    tags: ['speed'],
    rarity: 'common',
    maxStacks: 1,
    apply: (m) => { m.speedMul *= 1.12; },
  },
  {
    id: 'ember_coating',
    name: 'EMBER COATING',
    desc: 'Hits apply burn: 2 dps for 3s (reapplication refreshes)',
    tags: ['ember', 'damage'],
    rarity: 'rare',
    maxStacks: 1,
    apply: (m) => { m.burnOnHit = true; },
  },
  {
    id: 'chain_spark',
    name: 'CHAIN SPARK',
    desc: 'Bolts arc to 1 nearest other foe within 6 units for 60% damage',
    tags: ['chain'],
    rarity: 'rare',
    maxStacks: 1,
    apply: (m) => { m.chainCount += 1; },
  },
  {
    id: 'long_light',
    name: 'LONG LIGHT',
    desc: '+30% range, +10% projectile speed',
    tags: ['range'],
    rarity: 'common',
    maxStacks: 1,
    apply: (m) => { m.rangeMul *= 1.3; m.projSpeedMul *= 1.1; },
  },
  {
    id: 'quick_hand',
    name: 'QUICK HAND',
    desc: '+20% fire rate',
    tags: ['rate'],
    rarity: 'common',
    maxStacks: 1,
    apply: (m) => { m.intervalMul *= 0.8333; },
  },
  {
    id: 'glimmer_ward',
    name: 'GLIMMER WARD',
    desc: 'Every 12s gain a shield absorbing 1 hit',
    tags: ['ward', 'defense'],
    rarity: 'rare',
    maxStacks: 1,
    apply: (m) => { m.wardMax += 1; },
  },
  {
    id: 'dash_fresh',
    name: 'DASH FRESH',
    desc: 'Dash cooldown −30%; dash leaves an ember trail',
    tags: ['dash'],
    rarity: 'common',
    maxStacks: 1,
    apply: (m) => { m.dashCdMul *= 0.7; },
  },
  {
    id: 'mote_magnet',
    name: 'MOTE MAGNET',
    desc: '+60% pickup radius',
    tags: ['pickup'],
    rarity: 'common',
    maxStacks: 1,
    apply: (m) => { m.pickupMul *= 1.6; },
  },
  {
    id: 'glass_cannon',
    name: 'GLASS CANNON',
    desc: '+40% damage, max hp −15 (never below 30)',
    tags: ['damage', 'defense'],
    rarity: 'rare',
    maxStacks: 1,
    apply: (m) => { m.damageMul *= 1.4; m.bonusMaxHp -= 15; },
  },
  {
    id: 'steady_core',
    name: 'STEADY CORE',
    desc: '+25 max hp (and +25 current hp), hurt iframes +0.15s',
    tags: ['defense'],
    rarity: 'common',
    maxStacks: 1,
    apply: (m) => { m.bonusMaxHp += 25; m.iframeBonus += 0.15; },
  },
];

/* ------------------------------------------------------------------ */
/* rollDraft — seeded, weighted, distinct                              */
/* ------------------------------------------------------------------ */

/**
 * Offer 3 distinct draft ids. Common weight 1.0, rare weight 0.35.
 * Never offers an item already at maxStacks, never offers the same id twice.
 * Pure & seeded: same rng state + takenCounts → same offers.
 */
export function rollDraft(rng: Rng, takenCounts: Record<string, number>, mods: Mods): string[] {
  void mods; // reserved: future rarity gating by build (tag intersections)
  const offers: string[] = [];
  const pool = DRAFTS.filter((d) => (takenCounts[d.id] ?? 0) < d.maxStacks);
  for (let i = 0; i < 3 && pool.length > offers.length; i++) {
    const avail = pool.filter((d) => !offers.includes(d.id));
    if (avail.length === 0) break;
    let total = 0;
    for (const d of avail) total += d.rarity === 'rare' ? RARE_WEIGHT : COMMON_WEIGHT;
    let roll = rng() * total;
    let pick = avail[avail.length - 1];
    for (const d of avail) {
      roll -= d.rarity === 'rare' ? RARE_WEIGHT : COMMON_WEIGHT;
      if (roll <= 0) {
        pick = d;
        break;
      }
    }
    offers.push(pick.id);
  }
  return offers;
}

export function draftById(id: string): DraftDef | undefined {
  return DRAFTS.find((d) => d.id === id);
}
