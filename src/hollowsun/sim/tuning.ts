/**
 * HOLLOW SUN — sim tuning. EVERY gameplay number from DESIGN_C.md §4–§11 + §18
 * as a named constant. The §18 quick table is mirrored 1:1 here (binding).
 */
import { CAPS } from "../types";

/* ---------- clock ---------- */
export const SIM_HZ = 60;

/* ---------- arena (§8) ---------- */
export const ARENA_R = 33; // player soft clamp radius
export const STAR_R = 7.2; // sun-heart keep-out (soft push, player + enemies)
export const CELL = 4; // spatial hash cell size
export const HASH_EXTENT = 44; // spatial hash half-extent (covers loose bullets)
export const BULLET_OUT_R = 44; // bullets die beyond this radius

/* ---------- player — THE EMBER (§4) ---------- */
export const ACCEL = 90; // u/s²
export const MAX_SPD = 16; // u/s
export const FRIC = 6; // exponential friction λ (1/s), stop ≈ 0.25s
export const STOP_EPS = 0.35; // snap-to-zero below this speed
export const DASH_SPEED = 38; // impulse u/s
export const DASH_TIME = 0.14; // s
export const DASH_CD = 1.1; // s
export const DASH_IFRAMES = 0.22; // s
export const HEARTS_MAX = 3;
export const HURT_INVULN = 1.2; // s after hurt
export const HIT_R = 0.55; // hitbox (visual 0.8)
export const GRAZE_R = 1.65; // graze radius (~3× hitbox)

/* ---------- shards (§5) ---------- */
export const SHARD_START = 3;
export const SHARD_MAX = 6; // hard cap via Warden kills
export const SHARD_OD_BONUS = 2; // temp orbit shards during Overdrive
export const ORBIT_R = 1.6;
export const ORBIT_BREATH = 0.15; // ±0.15 @0.5Hz
export const ORBIT_BREATH_HZ = 0.5;
export const ORBIT_SPD = 2.4; // rad/s
export const FIRE_INT = 0.28; // LMB interval while held
export const SHARD_SPEED = 26; // fly u/s
export const SHARD_RETURN_SPEED = 34; // homing return u/s
export const SHARD_RANGE = 30; // max travel before return
export const BOUNCE_R = 18; // ricochet retarget radius
export const MAX_BOUNCE = 4;
export const ALL_OUT_RETURN = 1.6; // all-out auto-return after s
export const SHARD_DMG = 1; // ×2 while odActive
export const SHARD_HIT_R = 0.45; // shard collision radius
export const SHARD_HIT_CD = 0.15; // min seconds between hits of one shard
export const CATCH_R = 1.3; // return-catch distance to player

/* ---------- enemies (§6 table) ---------- */
// kind ids: 0 MOTE, 1 LANCER, 2 WEAVER, 3 BULWARK, 4 WARDEN (types.ts EK)
export const EHP = [1, 2, 3, 12, 90];
export const ESPD = [4.2, 3, 3.4, 1.6, 2.2]; // base move speeds (lancer walk)
export const SCORE = [10, 25, 40, 60, 400];
export const ENEMY_R = [0.5, 0.6, 0.7, 1.4, 2.6]; // collision radii
export const CONTACT_DMG = 1; // every enemy deals 1 heart on touch
export const MOTE_SEP_R = 1.3; // swarm separation distance

export const LANCER_TELE = 0.6; // telegraph (eTele 0→1)
export const LANCER_DASH_SPD = 26;
export const LANCER_DASH_T = 0.5;
export const LANCER_RECOVER = 0.8; // post-dash drift
export const LANCER_DASH_CD = 1.6; // min time between dashes
export const LANCER_TRIG_R = 14; // start telegraph inside this range

export const WEAVER_FIRE_EVERY = 2.2;
export const WEAVER_BULLET_SPD = 7.5;
export const WEAVER_FAN_DEG = 24; // total fan spread
export const WEAVER_FAN_HALF_RAD = (WEAVER_FAN_DEG * Math.PI) / 360;
export const WEAVER_BAND_IN = 9; // preferred distance band
export const WEAVER_BAND_OUT = 13;
export const WEAVER_FIRE_R = 21; // only fires inside this range

export const BULWARK_RING_N = 8; // death ring bullets
export const BULWARK_RING_SPD = 7;

export const WARDEN_SPIRAL_T = 2; // spiral phase length
export const WARDEN_SPIRAL_INT = 0.09; // bullet every
export const WARDEN_SPIRAL_STEP = 0.35; // angle += rad per bullet
export const WARDEN_SPIRAL_SPD = 6;
export const WARDEN_SUMMON_N = 6; // motes per summon
export const WARDEN_SUMMON_EVERY = 7; // s between summons
export const WARDEN_SWEEP_T = 1.5; // sweep phase length
export const WARDEN_SWEEP_VOLLEYS = 3;
export const WARDEN_SWEEP_GAP = 0.5; // s between volleys
export const WARDEN_SWEEP_WINDUP = 0.4; // telegraph before first volley
export const WARDEN_SWEEP_N = 5; // bullets per fan volley
export const WARDEN_SWEEP_SPD = 7;
export const WARDEN_SWEEP_HALF_RAD = (40 * Math.PI) / 360; // ±20° fan
export const WARDEN_BAND_IN = 11; // preferred distance band
export const WARDEN_BAND_OUT = 16;

/* ---------- enemy bullets (§6) ---------- */
export const BULLET_SPD = 7.5; // cap (weaver); ring 7, spiral 6, sweep 7
export const BULLET_LIFE = 6; // s
export const BULLET_R = 0.35; // (visual 0.5)
export const BULLET_CAP = CAPS.bullet; // 640 — recycle oldest

/* ---------- wave director (§7) ---------- */
export const WAVE_FIRST_DELAY = 1.5; // wave 1 after reset
export const WAVE_CALM = 4; // s between waves
export const BUDGET_BASE = 8;
export const BUDGET_PER_WAVE = 5; // budget(n) = 8 + 5n
export const COST = [1, 2, 3, 4, 14]; // mote/lancer/weaver/bulwark/warden
export const CLUSTER_MIN = 2;
export const CLUSTER_MAX = 5;
export const CLUSTER_GAP_MIN = 1.2; // s between clusters
export const CLUSTER_GAP_MAX = 2.4;
export const RIFT_LEAD = 0.8; // rift telegraph before spawn
export const SPAWN_RADIUS = 28; // rift ring
export const SPAWN_JITTER = 2; // ±u around rift
export const PEND_CAP = 16; // max pending rift clusters

/* ---------- charge pickups (§6 bulwark) ---------- */
export const PICKUP_MAGNET_R = 6; // magnet range
export const PICKUP_COLLECT_R = 1.2;
export const PICKUP_MAGNET_SPD = 9; // pull speed at zero range
export const PICKUP_SCORE = 50; // when nothing to refill

/* ---------- graze → overdrive (§9) ---------- */
export const GRAZE_SCORE = 2;
export const OD_GAIN = 0.07; // per graze (full ≈ 14 grazes)
export const OD_DUR = 4; // s
export const OD_TIME_SCALE = 0.55; // Juice writes it; sim unscales the player

/* ---------- score / sun (§8, §10) ---------- */
export const COMBO_CAP = 30;
export const COMBO_DECAY = 2.5; // s
export const SUN_K = 0.00020; // sun += points · sunK
export const SUN_GRAZE_K = 0.0004; // sun += graze · sunGrazeK
export const SUN_MAX = 1;
export const SUN_RANK_STEP = 0.2; // SUNRANK event each 0.2 crossed
