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
  slowMax: 2.0, // sprint 17 WOKE this state — herald veils apply it
  failsafeFactor: 2,
  rootRim: 0x8a7f72, // player-hull rim desat target while ROOTED (warm ash)
  rootEmisK: 0.03, // hull emissive floor while rooted (base 0.12)
  struggleShake: 0.012, // per-frame rig shake while rooted + holding movement
  // — sprint 17 kit: deterministic triggers only (hit COUNTERS, never rng).
  //   Every state carries a hard cap; nothing locks a target (foe OR player)
  //   past its designed window. —
  stunEvery: 3, // every Nth direct shard hit stuns the survivor
  stunTime: 0.7, // s — bosses take ×0.4
  rootTime: 1.2, // dash-strike roots the struck foe — bosses take ×0.4
  foeSlowEvery: 5, // every Nth direct shard hit chills the survivor
  foeSlowTime: 1.2, // s — foes move/act at ×0.45 while chilled
  foeSlowK: 0.45,
  veilTime: 1.4, // herald veil slow applied to the player (rime aura reuses it)
  veilCap: 1.6, // HARD CAP on the player-slow state (failsafe law)
  veilSpeedK: 0.55, // player speed multiplier while veiled
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
  /** herald veil volley — slow, big, READABLE chimes that chill instead of
   *  wounding: the threat is your speed, dodge through the gaps */
  veilSpeed: 7.2,
  veilRadius: 0.6,
  veilLife: 6.5,
  veilFan: 5, // bullets per volley
  veilSpread: 0.66, // total fan width (rad)
  heraldWindup: 0.75, // ring telegraph before the volley
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
  /** per-biome boss hp (room 3 of each biome) — +13 per biome law → 73 */
  bossHp: [34, 47, 60, 73],
};

export const RUN = {
  biomes: ['ASHFALL VESTIBULE', 'GLASS HOLLOW', 'THE HEART', 'THE PALE CHOIR'] as const,
  bossNames: ['WARDEN OF ASH', 'WARDEN OF GLASS', 'THE HOLLOW CHOIR', 'THE FIRST VOICE'] as const,
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
  { grid: 0x37302a, hot: 0xe8d8b0, fog: 0x120e0b, sun: 0xf2e6cf }, // the pale choir (18-a MUST-2 — bone/ash-glass cathedral, zero blue/indigo)
] as const;

export type Elite = '' | 'swift' | 'shield' | 'split' | 'rime' | 'cinder';

/* ------------------------------------------------------------------ */
/* ELITE CROWNS (sprint 18) — Godot-Resource style affix records.      */
/* RoR2 law: a number-only affix is REJECTED — every crown must force  */
/* repositioning. Crowns extend the existing elite system: the branch  */
/* reinterprets the EXISTING rollElite draws (zero new rng), the TYPE  */
/* pick is wave parity (even → rime, odd → cinder), hosts are          */
/* whitelisted (drifter/striker/hound/caster/bulwark), ≤1 per wave,    */
/* never in biome 1 (waves < 5) and never in boss rooms.               */
/* ------------------------------------------------------------------ */

/** RIMEBOUND — icy crown: a chill aura re-applies the player veil on the
 *  entry edge (reuses sim.veilT + the onVeil pipeline — zero new player CC
 *  state). Counterplay: keep your distance; dash still cleanses. */
export const RIME = {
  radius: 5.5, // aura radius (u)
  hpMult: 1.4, // hp ×1.4 (Math.ceil) beside the existing elite hp mods
  rim: 0x9adfff, // halo rim color — SPRINT18-3: view.ts halo color row
} as const;

/** CINDERBOUND — ember crown: while the crowned foe MOVES it drops burning
 *  wake patches on a beat (move-gated; stun/root halts the wake by
 *  construction). Patches wound on their own beat — dash i-frames make the
 *  wake dash-through-able. Inverse-hex floor denial. */
export const CINDER = {
  maxPatches: 3, // live-patch cap (perf guard) — oldest expires first
  life: 2.6, // patch lifetime (enemy seconds)
  radius: 1.5, // patch wound radius (u)
  tick: 0.55, // patch wound beat (enemy seconds)
  interval: 0.8, // moving enemy-time between drops
  moveGate: 0.5, // speed (u/s) above which the wake accumulates
  hpMult: 1.4, // hp ×1.4 (Math.ceil) beside the existing elite hp mods
  rim: 0xff7a3d, // halo rim color — SPRINT18-3: view.ts halo color row
} as const;

/** crown density per biome index — the share of the EXISTING elite type
 *  roll claimed by the crown branch (biome 0 / boss rooms: structurally 0) */
export const CROWN_DENSITY = [0, 0.22, 0.4, 0.55] as const;

/** THE FIRST VOICE — biome-4 boss (sprint 18). NO new FoeKind: a biome-3
 *  warden script composed ONLY from shipped telegraph primitives — the
 *  warden ring, the weaver hex, the herald chime fan, the hound dash named
 *  through the heavy direction-line pool. Single-voice law: never two
 *  telegraphs at once (phases are exclusive; the dash holds the ring). */
export const FIRST_VOICE = {
  dashCd: 12, // one locked dash per 12 s in phase 3
  telegraph: 0.7, // line telegraph (hound wind-up law — facing locks NOW)
  dashSpeed: 30, // hound-commit straight dash (HOUND.dashSpeed)
  dashTime: 0.45, // ≈13.5u covered per dash (HOUND.dashTime)
  exposedTime: 1.2, // exposed drift after the dash — the punish window
  dashRange: 20, // telegraph line length (u) — hound's named line
} as const;

export const SCORE = {
  drifter: 50,
  striker: 80,
  weaver: 120,
  caster: 140,
  hound: HOUND.score,
  bulwark: 220,
  herald: 160,
  graze: 5,
  multPerBounce: 0.5, // chain multiplier: 1 + bounces * 0.5
  multDecay: 3.2, // seconds without a ricochet resets the chain
};

/* ------------------------------------------------------------------ */
/* RITES OF THE MANY SUNS (sprint 19-a) — tuning for the run-warping   */
/* laws in src/game/rites.ts. All behavior is counters + enemy-time    */
/* timers: ZERO new rng (determinism law). Timers tick on ENEMY time   */
/* (Overdrive slows the rites too — same law as BURN/HEX/CINDER).      */
/*                                                                     */
/* SPRINT19-C anchors (felt layer — 19-c consumes these):              */
/*  - LONG NIGHT grade: fog density +0.005, sun dim ×0.85, drone       */
/*    pitch −1 semitone while the rite is active.                      */
/*  - SUNFALL meteors flow through sim.hexes with kind:'meteor' +      */
/*    radius:4.5 — the view's hex pool must size/scale per-zone radius */
/*    (current pool renders HEX.radius shapes; upgrade = view-only).   */
/*  - MIRROR CHOIR phantom bolts ride the shard pool (sim.shards with  */
/*    bolt:true) — widen the 6-seat shard view pool to cover forks +   */
/*    bolts (shard identity keyed, not index keyed).                   */
/* ------------------------------------------------------------------ */
export const RITE = {
  /** EMBER TIDE — corpse detonations (zero rng: pure delay queue) */
  TIDE: {
    fuse: 0.35, // enemy-time from death to burst
    radius: 3, // burst radius (u)
    dmg: 3,
    burnStacks: 2, // applied to survivors (EMBER ROT stack pool)
    chainCap: 8, // max detonation depth per chain event
  },
  /** TWIN SUN — fork shards on every 2nd throw (sim throw counter) */
  TWIN: {
    forkAngle: 0.42, // rad off the aim line, ±
    forkDmg: 0.5, // × shard damage per fork
    maxForks: 8, // live-fork ceiling — deterministic skip past the cap
  },
  /** SUNFALL — telegraphed meteors via the HexZone pipe (kind:'meteor') */
  SUNFALL: {
    every: 7, // enemy-time between volleys
    volley: 3, // meteors per volley: 2 heaviest foes + 1 player-offset
    telegraph: 0.9, // enemy-time ring before impact
    radius: 4.5, // blast radius (u) — carries on the zone for the view
    dmg: 4, // hits foes AND the ember
    maxLive: 3, // live-meteor cap (perf + fairness guard)
    playerOffset: 3, // u off the player's cast-time position (golden angle)
    scoreMult: 1.5, // × score for meteor kills
  },
  /** IRON ORCHARD — wall-impact harvest (law numbers live in the rite) */
  ORCHARD: {
    slamDmg: 1,
    slamStun: 0.5, // s — hard-capped at CC.stunTime
    slamCd: 0.35, // enemy-time between slams on the same foe
  },
  /** MIRROR CHOIR — phantom allies (kill counter, deterministic orbit) */
  CHOIR: {
    everyKills: 5,
    maxPhantoms: 2,
    life: 6, // enemy-time
    orbitR: 2.5,
    orbitSpeed: 1.4, // rad/s, enemy time
    goldenAngle: 2.399963, // spawn-angle spacing per kill index (no rng)
    fireCd: 1.2, // enemy-time between bolts
    boltDmg: 2,
    boltTtl: 1.5, // enemy-time; bolts die at the wall — no ricochet
    boltSpeed: 47, // raw SHARD.speed — phantoms carry no shard mods
  },
} as const;


/* ------------------------------------------------------------------ */
/* BOUNTY CONTRACTS (sprint 20-4a) — the data table for the 3 seeded    */
/* auto-active contracts rolled every run (pure module: src/game/bounty.ts). */
/* LAW: every stat is an ENGINE-side observable only — existing SimEvents */
/* (onKill/onGraze/onBounce/onThrow/onFoeRoot/onFoeStun/onHurt) or engine  */
/* timers. ZERO sim reads beyond public counters, ZERO sim writes.        */
/* Scope semantics:                                                      */
/*   'run'  — progress accumulates all run; completes at a room settle.  */
/*   'room' — progress resets at each room start; the room's final value */
/*            is judged at its clear (chain = max reached that room).    */
export type BountyStat =
  | 'kills' // onKill count
  | 'strike' // onKill while the dash burns (mid-dash fells)
  | 'graze' // onGraze count (once per bullet)
  | 'throw' // onThrow count
  | 'elite' // crowned (rime/cinder) fells
  | 'root' // onFoeRoot — dash-strike roots
  | 'stun' // onFoeStun — 3rd-hit stuns
  | 'chain' // max sim.chain reached (onBounce index)
  | 'clean' // seconds without a wound in the room (engine timer)
  | 'swift'; // room cleared within target seconds (engine room clock)
export type BountyScope = 'run' | 'room';

export interface BountyDef {
  id: string;
  title: string;
  /** short chip title for the HUD row (mobile ≤420px law) */
  chip: string;
  desc: string;
  stat: BountyStat;
  target: number;
  /** dawn paid into the run ledger at the settling room clear */
  dawn: number;
  scope: BountyScope;
}

export const CONTRACTS: BountyDef[] = [
  { id: 'harvest', title: 'ASH HARVEST', chip: 'HARVEST', desc: 'Fell 14 foes in one room', stat: 'kills', target: 14, dawn: 15, scope: 'room' },
  { id: 'keeper', title: 'KEEPER OF THE CHAIN', chip: 'CHAIN', desc: 'Reach a chain of 10 in one room', stat: 'chain', target: 10, dawn: 15, scope: 'room' },
  { id: 'staredown', title: 'STARE DOWN', chip: 'GRAZE', desc: 'Graze 30 bullets this descent', stat: 'graze', target: 30, dawn: 10, scope: 'run' },
  { id: 'vengeance', title: 'VENGEANCE STRIKE', chip: 'STRIKE', desc: 'Fell 4 foes mid-dash this descent', stat: 'strike', target: 4, dawn: 15, scope: 'run' },
  { id: 'vigil', title: 'UNTOUCHED VIGIL', chip: 'VIGIL', desc: 'Hold 20 s unwounded in one room', stat: 'clean', target: 20, dawn: 10, scope: 'room' },
  { id: 'arsenal', title: 'RELENTLESS HAND', chip: 'THROW', desc: 'Throw 40 shards this descent', stat: 'throw', target: 40, dawn: 10, scope: 'run' },
  { id: 'crownward', title: 'CROWN TAKER', chip: 'CROWNS', desc: 'Fell 2 crowned foes this descent', stat: 'elite', target: 2, dawn: 20, scope: 'run' },
  { id: 'binder', title: 'ASH ROOTS', chip: 'ROOTS', desc: 'Root 6 foes with dash-strikes this descent', stat: 'root', target: 6, dawn: 15, scope: 'run' },
  { id: 'thirdlight', title: 'THIRD LIGHT', chip: 'STUNS', desc: 'Stun 8 foes (3rd-hit stun) this descent', stat: 'stun', target: 8, dawn: 10, scope: 'run' },
  { id: 'verdict', title: 'SWIFT VERDICT', chip: 'SWIFT', desc: 'Clear a room in under 25 s', stat: 'swift', target: 25, dawn: 15, scope: 'room' },
];

/** killer-kind display names for the run recap ("FELLED BY A CINDER HOUND")
 *  — article included so the recap line reads in one breath */
export const FOE_LABELS: Record<string, string> = {
  drifter: 'A HUSK DRIFTER',
  striker: 'A DART STRIKER',
  weaver: 'A HEX WEAVER',
  caster: 'AN OBELISK CASTER',
  herald: 'A VEIL HERALD',
  bulwark: 'AN ASH BULWARK',
  hound: 'A CINDER HOUND',
  warden: 'A WARDEN',
} as const;

export const FEEL = {
  dashBuffer: 0.12, // a dash pressed this close to ready fires the frame it readies
  hitstopKill: 0.055,
  hitstopWarden: 0.16, // sprint-17: was 0.22 — dead config, clamped by max anyway
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
