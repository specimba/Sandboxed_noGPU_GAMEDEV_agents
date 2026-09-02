/**
 * HOLLOW SUN — shared tuning constants (the design bible numbers).
 * You are the last ember inside a dead star. Your shards of light ricochet
 * between enemies and return like boomerangs. Every point you score rekindles
 * the cracked star at the arena's heart.
 */

export const COLORS = {
  bg: 0x02030a,
  /** player ember + shards of light */
  ember: 0xffe6b0,
  emberHot: 0xfff8e8,
  gold: 0xffc766,
  /** enemies + their fire */
  foe: 0xff2d4e,
  foeDeep: 0xb3122e,
  foeBullet: 0xff5a3c,
  /** arena grid — cold teal that ignites to gold as the star rekindles */
  gridCold: 0x0f3a3c,
  gridHot: 0xffb35c,
  warden: 0xff7a2d,
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

export const FOE = {
  bulletSpeed: 11.5,
  bulletRadius: 0.34,
  bulletLife: 7,
  contactRadius: 1.05,
};

export const WAVES = {
  intermission: 2.6,
  spawnIntervalBase: 1.5,
  spawnIntervalPerWave: 0.055,
  spawnIntervalMin: 0.62,
  /** wave N budget = base + perWave * N; drifter=1 striker=2 weaver=3 pts */
  budgetBase: 4,
  budgetPerWave: 2.6,
  wardenEvery: 5,
  wardenHpBase: 34,
  wardenHpPerKill: 13,
  wardenScore: 500,
};

export const SCORE = {
  drifter: 50,
  striker: 80,
  weaver: 120,
  graze: 5,
  multPerBounce: 0.5, // chain multiplier: 1 + bounces * 0.5
  multDecay: 3.2, // seconds without a ricochet resets the chain
};

export const FEEL = {
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
