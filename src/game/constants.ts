/**
 * HOLLOW SUN — shared tuning constants (the design bible numbers).
 * You are the last ember inside a dead star. Your shards of light ricochet
 * between enemies and return like boomerangs. Every point you score rekindles
 * the cracked star at the arena's heart.
 */

export const COLORS = {
  bg: 0x0a0708,
  /** player ember + shards of light */
  ember: 0xffe6b0,
  emberHot: 0xfff8e8,
  gold: 0xffc766,
  /** enemies + their fire */
  foe: 0xff3b52,
  foeDeep: 0x8f1230,
  foeBullet: 0xff6a4a,
  /** light-bullet hot core (normal-blended so it never washes out into the
   *  warm biomes the way the additive ember color did) */
  foeBulletCore: 0xffd8b0,
  /** arena grid — cold obsidian umber that ignites to gold as the star rekindles */
  gridCold: 0x241a12,
  gridHot: 0xffab52,
  warden: 0xff5a2d,
  /** EMBER RITE shells — dark chiseled obsidian + bone highlights */
  obsidian: 0x191009,
  obsidianLit: 0x3a2a1a,
  bone: 0xf2e6cf,
};

export const ARENA = {
  radius: 34, // playable disc
  wallGlow: 38, // visual ring where the shell walls sit
};

export const PLAYER = {
  radius: 0.55,
  accel: 130,
  maxSpeed: 17,
  drag: 7.5,
  embers: 3, // hit points
  invulnTime: 1.2,
  dashSpeed: 36,
  dashTime: 0.14,
  dashCooldown: 1.05,
  grazeRadius: 2.3, // bullets inside this charge Overdrive
};

export const SHARD = {
  startCount: 3,
  maxCount: 6,
  speed: 47,
  turnRate: 26, // rad/s steering while chaining/returning
  damage: 1,
  hitCooldown: 0.2, // per shard-per-enemy re-hit delay
  maxBounces: 5, // enemy-to-enemy ricochets per throw
  chainRadius: 27, // search radius for next ricochet target
  catchRadius: 1.6,
  throwCooldown: 0.5,
  aimMagnet: 9, // snap start of flight to an enemy near the aim point
};

export const OVERDRIVE = {
  max: 100,
  duration: 5,
  enemyTimeScale: 0.55, // the world slows…
  damageMult: 2, // …and you hit twice as hard
  grazeCharge: 8,
  catchCharge: 2,
  killCharge: 5,
  extendPerGraze: 0.35,
};

/** EMBER ROT burn — direct hits stack burning light on a foe; every beat the
 *  stack count deals that much damage and consumes one stack. Lives on enemy
 *  time (Overdrive slows it) and never consumes rng — determinism-safe. */
export const BURN = {
  tick: 0.75,
  maxStacks: 6,
};

/** HEX LOOM — the reworked weaver: it periodically anchors a hex zone at
 *  the ember's CURRENT position; 0.9s telegraph, then detonation. Caught
 *  inside the radius = ROOTED (movement zeroed, dash blocked, throwing
 *  free). Counterplay: leave the zone during the telegraph (walking covers
 *  ~4.5u in 0.9s, a dash far more) or kill the weaver. All zone timers run
 *  on ENEMY time (Overdrive slows the trap — player-favorable, same law as
 *  BURN). Consumes ZERO rng — determinism law intact. */
export const HEX = {
  radius: 2.6, // detonation catch radius (u)
  /** must exceed the weaver hold band's OUTER edge (21u) — the weaver parks
   *  at pd≈21.1, and a castRange below that meant the hex could NEVER fire
   *  (caught by harness block G1 before this ever reached a player) */
  castRange: 22,
  telegraph: 0.9, // anchor → detonation (enemy seconds)
  rootDur: 0.8, // root duration on catch
  cooldown: 3.5, // per-weaver hex cooldown (enemy seconds)
  maxZones: 2, // global live-zone cap (perf guard)
};

/** CC feedback kit + failsafe law — timers live on the sim (public), the
 *  kit values are VIEW/AUDIO-only (the sim never reads these). The engine
 *  watchdog clamps any CC timer above max × failsafeFactor: the player is
 *  never locked longer than that, ever. */
export const CC = {
  rootMax: 0.8, // == HEX.rootDur (design assert in simdrive-controls)
  slowMax: 2.0, // slow states are dormant this sprint
  failsafeFactor: 2,
  rootRim: 0x8a7f72, // player-hull rim desat target while ROOTED (warm ash)
  rootEmisK: 0.03, // hull emissive floor while rooted (base 0.12)
  struggleShake: 0.012, // per-frame rig shake while rooted + holding movement
};

/** CINDER HOUND — a telegraphed charger: lurks at mid range, locks its
 *  facing through a 0.7s burn-line telegraph, then dashes the line it
 *  named. Its own recovery is the punish window (x1.5 dmg taken). */
export const HOUND = {
  hp: 3,
  radius: 0.85,
  points: 3, // wave-budget points (drifter=1 striker=2 weaver/caster/hound=3 bulwark=4)
  score: 160,
  triggerRange: 16, // pd threshold that begins the wind-up
  windupTime: 0.7, // telegraph; facing LOCKED at entry — sidestep the line
  dashSpeed: 30, // striker dashes 27; the hound commits harder
  dashTime: 0.45, // ≈13.5u covered per dash
  recoverTime: 0.8, // stationary after the dash
  recoverVuln: 1.5, // damage taken multiplier while recovering
  cooldown: 1.6, // lurk time before the next charge may begin
  lurkSpeed: 3.2, // slow hover while cooling down
};

/** CHAINSPARK — a slain foe arcs death-light to the nearest kindred. Target
 *  choice is nearest-first (no rng); sparks never re-spark. */
export const SPARK = {
  radius: 9, // first arc search radius
  chainRadius: 7, // subsequent arcs from the struck foe
  dmg: 2,
};

export const FOE = {
  bulletSpeed: 11.5,
  bulletRadius: 0.34,
  bulletLife: 7,
  contactRadius: 1.05,
  /** caster heavy shot — slower to dodge but huge and fast */
  heavySpeed: 21,
  heavyRadius: 0.52,
  heavyLife: 5,
  /** bulwark frontal-armor cone (half-angle, rad) */
  bulwarkCone: 1.05,
};

export const WAVES = {
  intermission: 2.6,
  spawnIntervalBase: 1.5,
  spawnIntervalPerWave: 0.055,
  spawnIntervalMin: 0.62,
  /** wave N budget = base + perWave * N; drifter=1 striker=2 weaver=3
   *  hound=3 caster=3 bulwark=4 pts */
  budgetBase: 4,
  budgetPerWave: 2.6,
  wardenEvery: 5,
  wardenHpBase: 34,
  wardenHpPerKill: 13,
  wardenScore: 500,
  /** per-biome boss hp (room 3 of each biome) */
  bossHp: [34, 47, 60],
};

export const RUN = {
  biomes: ['ASHFALL VESTIBULE', 'GLASS HOLLOW', 'THE HEART'] as const,
  bossNames: ['WARDEN OF ASH', 'WARDEN OF GLASS', 'THE HOLLOW CHOIR'] as const,
  roomsPerBiome: 3, // rooms 1-2 combat, room 3 = boss
  dawnPerRoom: 8,
  dawnPerBoss: 30,
  dawnPerScore: 0.01,
  dawnWinBonus: 100,
};

/** biome palettes — grid cold/hot, fog, sun tint (EMBER RITE grade; all ember/obsidian family) */
export const BIOMES = [
  { grid: 0x241a12, hot: 0xffab52, fog: 0x0a0708, sun: 0xffb454 }, // ashfall
  { grid: 0x2a1612, hot: 0xff5c8a, fog: 0x0d0508, sun: 0xff8a6a }, // glass hollow
  { grid: 0x3a3436, hot: 0xfff0d0, fog: 0x0d0b0e, sun: 0xfff0c8 }, // the heart
] as const;

export type Elite = '' | 'swift' | 'shield' | 'split';

export const SCORE = {
  drifter: 50,
  striker: 80,
  weaver: 120,
  caster: 140,
  hound: HOUND.score,
  bulwark: 220,
  graze: 5,
  multPerBounce: 0.5, // chain multiplier: 1 + bounces * 0.5
  multDecay: 3.2, // seconds without a ricochet resets the chain
};

export const FEEL = {
  dashBuffer: 0.12, // a dash pressed this close to ready fires the frame it readies
  hitstopKill: 0.055,
  hitstopWarden: 0.22,
  hitstopMax: 0.16,
  traumaKill: 0.16,
  traumaHurt: 0.55,
  traumaWarden: 0.7,
  traumaThrow: 0.04,
  fovKickKill: 2.2,
  fovKickDash: 3,
  fovKickOverdrive: 5,
  shakeMax: 0.85,
};

/** pentatonic ladder for ricochet chains — pitch climbs per bounce */
export const PENTATONIC = [
  261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.26, 783.99, 880.0,
];

export function starEnergy(score: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, score) / 5200));
}
