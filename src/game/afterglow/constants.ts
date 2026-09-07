/**
 * AFTERGLOW — shared tuning constants (M0 sim core).
 *
 * You are the last light left after a dead sun. Every wave survived is
 * borrowed time, every choice is light spent. This file is the design bible
 * for the simulation layer: every number the headless sim reads lives here,
 * so balance passes are one-file diffs and the drive harness can assert
 * against the same truth the view will render.
 */

export const ARENA_RADIUS = 26;

/** 5 pillar obstacles, radius 1.1–1.4, positions derived from the run seed. */
export const PILLARS = {
  count: 5,
  rMin: 1.1,
  rMax: 1.4,
  /** min gap between pillar centers beyond their radii (passage stays walkable) */
  centerGap: 1.8,
  /** pillars never sit closer than this to the arena center (player spawn) */
  minSpawnDist: 5,
  /** pillar edge keeps this far from the arena wall */
  edgePad: 2,
  /** placement retries before accepting a candidate (seeded, deterministic) */
  attempts: 60,
};

export const PLAYER = {
  maxHp: 100,
  /** maxHp floor — glass_cannon can never push you below this */
  minMaxHp: 30,
  speed: 6.0,
  radius: 0.55,
  dashDuration: 0.22,
  dashSpeed: 18,
  dashCooldown: 2.5,
  /** iframes granted after every hurt (dash itself grants iframes for its duration) */
  hurtIframes: 0.6,
};

/** GLIMMER — the auto-firing light. Brotato-style: you position, it shoots. */
export const WEAPON = {
  fireInterval: 0.9,
  damage: 10,
  projectileSpeed: 26,
  range: 14,
  pierce: 0,
  volleys: 1,
  /** spread per extra volley (12° in radians), centered on the aim angle */
  spreadPerVolley: (12 * Math.PI) / 180,
  projectileRadius: 0.22,
  /** projectile lifetime = range / speed + this pad */
  lifetimePad: 0.1,
};

/** the M0 status seed — ember_coating / dash trail both feed it */
export const BURN = {
  dps: 2,
  duration: 3,
};

export const CHAIN = {
  /** chain_spark search radius from the hit foe */
  radius: 6,
  dmgMul: 0.6,
  arcLife: 0.15,
};

export const WARD = {
  /** glimmer_ward: one shield charge every N seconds, absorbs 1 hit */
  period: 12,
};

/** cosmetic ember trail left by dash_fresh; applies burn only when the
 *  ember tag (burnOnHit) is also present, otherwise pure view sugar */
export const TRAIL = {
  radius: 1.5,
  life: 0.5,
  spawnEvery: 0.06,
};

export type FoeKind = 'wisp' | 'husk' | 'cinder';

export interface FoeTuning {
  hpBase: number;
  hpPerWave: number;
  speed: number;
  touchDmg: number;
  touchCd: number;
  radius: number;
  /** wave budget points */
  cost: number;
}

export const FOES: Record<FoeKind, FoeTuning> = {
  // drifting light-eater — the bread and butter
  wisp: { hpBase: 18, hpPerWave: 6, speed: 2.2, touchDmg: 8, touchCd: 1.0, radius: 0.5, cost: 1 },
  // charger — walks, then SCREAMS (0.8s windup), then charges. Telegraph lives in state.
  husk: { hpBase: 45, hpPerWave: 10, speed: 1.4, touchDmg: 14, touchCd: 1.0, radius: 0.7, cost: 3 },
  // swarmer — fast, fragile, spawns in rings
  cinder: { hpBase: 8, hpPerWave: 2, speed: 4.2, touchDmg: 5, touchCd: 1.0, radius: 0.35, cost: 0.5 },
};

/** husk-only charger FSM numbers (readability law: the scream is the tell) */
export const HUSK = {
  windup: 0.8,
  windupRange: 6,
  chargeSpeed: 9,
  chargeTime: 0.5,
  chargeCd: 2.5,
  recover: 0.6,
};

export const WAVES = {
  duration: 60,
  /** duration never drops below this at high wave numbers (M0 keeps 60 flat) */
  minDuration: 45,
  /** spawn schedule spreads across the first fraction of the wave —
   *  0.32 puts every wave's spawns inside the first ~19s (the old 0.7
   *  spread 8 budget points across 42s = 30-40s dead-air stretches) */
  spawnWindowFrac: 0.45,
  introTime: 3,
  breatherTime: 3,
  /** spawn-state ramp: invulnerable + no-collide while > 0 */
  spawnRamp: 0.4,
  /** wave n budget points = budgetBase + budgetPerWave * n */
  budgetBase: 6,
  budgetPerWave: 2,
  /** composition weights (wisp / husk / cinder) — must sum to 1 */
  weights: { wisp: 0.55, husk: 0.15, cinder: 0.3 },
  /** cinder rings roll between these sizes (capped by remaining budget) */
  ringMin: 6,
  ringMax: 8,
};

/** LIGHT — the xp/meta seed dropped on death of foes */
export const LIGHT = {
  /** motes per kill: min..max inclusive, each worth `value` light */
  motesMin: 1,
  motesMax: 3,
  value: 1,
  pickupRadius: 2.5,
  driftSpeed: 9,
  /** collect distance once drifting */
  pickupDist: 0.9,
  despawn: 20,
};

/** hard entity ceilings — leak protection asserted by the drive harness */
export const CAPS = {
  foes: 40,
  projectiles: 60,
  motes: 120,
  arcs: 64,
  trails: 64,
};

/** spawn placement keeps this far from pillars and the wall */
export const SPAWN = {
  minDist: 8,
  wallPad: 3,
  pillarPad: 1.5,
  attempts: 30,
};
