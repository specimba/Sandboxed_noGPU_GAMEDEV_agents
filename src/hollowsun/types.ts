/**
 * HOLLOW SUN — shared byte-stable contracts (owned by LEAD; read-only for agents).
 * C1 sim/core, C2 world, C3 fx, C4 ui build against these types ONLY.
 */

/** Event type ids (DESIGN_C.md §16) */
export const EV = {
  KILL: 0,
  GRAZE: 1,
  HURT: 2,
  DASH: 3,
  LAUNCH: 4,
  RICOCHET: 5,
  SPAWN: 6,
  WAVE: 7,
  OVERDRIVE: 8,
  BOSSDIE: 9,
  PICKUP: 10,
  SUNRANK: 11,
  RIFT: 12,
  DIE: 13,
} as const;

export type EventTypeId = (typeof EV)[keyof typeof EV];

/** Sim → View/FX/Audio event. a = enemy kind or chain count, b = extra. */
export interface SimEvent {
  type: EventTypeId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  b: number;
}

/** Shared mutable FX state. C3 Juice WRITES it; Loop & CameraRig & Post READ it. */
export interface FXState {
  /** seconds of remaining freeze (sim halts) */
  hitstop: number;
  /** world time scale (1 normal, 0.55 overdrive, 0.35 boss slow-mo) */
  timeScale: number;
  /** 0..1 trauma; shake = trauma² */
  trauma: number;
  /** 0..1 white screen flash */
  flash: number;
  /** chromatic aberration amount 0..0.006 */
  chroma: number;
  /** golden grade ramp 0..1 (overdrive / sunrank) */
  golden: number;
}

export function createFXState(): FXState {
  return { hitstop: 0, timeScale: 1, trauma: 0, flash: 0, chroma: 0, golden: 0 };
}

/** Capability caps (binding) */
export const CAPS = {
  enemy: 128,
  bullet: 640,
  shard: 8,
  pickup: 16,
} as const;

/** Enemy kind ids */
export const EK = {
  MOTE: 0,
  LANCER: 1,
  WEAVER: 2,
  BULWARK: 3,
  WARDEN: 4,
} as const;

/** Per-frame interpolated snapshot produced by Sim.snap() (C2/C4 read only). */
export interface Snap {
  time: number;
  /* player */
  px: number;
  py: number;
  pvx: number;
  pvy: number;
  aimX: number;
  aimY: number;
  invuln: number; // remaining invuln seconds (0 = none)
  dashCd: number; // 0..1 ready fraction
  hearts: number;
  maxHearts: number;
  /* economy */
  score: number;
  combo: number;
  comboT: number; // 1→0 decay
  sun: number; // 0..1
  od: number; // 0..1 meter
  odActive: boolean;
  odT: number; // remaining seconds
  wave: number;
  /* run stats */
  alive: boolean;
  runOver: boolean;
  grazes: number;
  kills: number;
  maxCombo: number;
  runTime: number;
  /* enemies (SoA) */
  eCount: number;
  ePos: Float32Array; // 2 * CAPS.enemy
  eRot: Float32Array; // CAPS.enemy
  eType: Uint8Array; // CAPS.enemy
  eHp: Float32Array; // CAPS.enemy hp fraction 0..1
  eTele: Float32Array; // CAPS.enemy telegraph 0..1
  /* enemy bullets (SoA) */
  bCount: number;
  bPos: Float32Array; // 2 * CAPS.bullet
  bSize: Float32Array; // CAPS.bullet
  bKind: Uint8Array; // CAPS.bullet (0 normal, 1 warden)
  /* shards */
  sCount: number;
  sPos: Float32Array; // 2 * CAPS.shard
  sState: Uint8Array; // CAPS.shard 0 orbit 1 fly 2 return
  /* pickups */
  pCount: number;
  pPos: Float32Array; // 2 * CAPS.pickup
  pKind: Uint8Array; // CAPS.pickup
  /* shard orbit state */
  shardsMax: number;
  shardsOrbit: number;
}

export function createSnap(): Snap {
  return {
    time: 0,
    px: 0,
    py: 0,
    pvx: 0,
    pvy: 0,
    aimX: 1,
    aimY: 0,
    invuln: 0,
    dashCd: 1,
    hearts: 3,
    maxHearts: 3,
    score: 0,
    combo: 0,
    comboT: 0,
    sun: 0,
    od: 0,
    odActive: false,
    odT: 0,
    wave: 0,
    alive: true,
    runOver: false,
    grazes: 0,
    kills: 0,
    maxCombo: 0,
    runTime: 0,
    eCount: 0,
    ePos: new Float32Array(CAPS.enemy * 2),
    eRot: new Float32Array(CAPS.enemy),
    eType: new Uint8Array(CAPS.enemy),
    eHp: new Float32Array(CAPS.enemy),
    eTele: new Float32Array(CAPS.enemy),
    bCount: 0,
    bPos: new Float32Array(CAPS.bullet * 2),
    bSize: new Float32Array(CAPS.bullet),
    bKind: new Uint8Array(CAPS.bullet),
    sCount: 0,
    sPos: new Float32Array(CAPS.shard * 2),
    sState: new Uint8Array(CAPS.shard),
    pCount: 0,
    pPos: new Float32Array(CAPS.pickup * 2),
    pKind: new Uint8Array(CAPS.pickup),
    shardsMax: 3,
    shardsOrbit: 3,
  };
}

/** Raw input produced by core/Input, consumed by Sim.step (aim already world-space). */
export interface SimInput {
  mvx: number; // -1..1
  mvy: number; // -1..1
  aimX: number; // world space
  aimY: number;
  fireHeld: boolean;
  fireEdge: boolean;
  dashEdge: boolean;
  odEdge: boolean;
}

/** UI-facing state (C4 read only). Game assembles it from Snap + env. */
export type UIPhase = 'title' | 'run' | 'pause' | 'over';

export interface UIState {
  phase: UIPhase;
  hearts: number;
  maxHearts: number;
  score: number;
  best: number;
  combo: number;
  comboT: number;
  sun: number;
  od: number;
  odActive: boolean;
  dash: number; // ready fraction
  wave: number;
  muted: boolean;
  fps: number;
  stats: {
    score: number;
    wave: number;
    maxCombo: number;
    grazes: number;
    kills: number;
    time: number;
    newBest: boolean;
  };
}
