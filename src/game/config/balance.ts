// NEXUS ARMOR — global balance tunables. Systems read from here; never hard-code.
import type { QualityTier } from '../core/types'

export const STEP = 1 / 60 // fixed simulation step (seconds)
export const MAX_STEPS_PER_FRAME = 5 // spiral-of-death clamp
export const ARENA_MARGIN = 4 // wall inset from map edge

// --- combat ---
export const RICOCHET_CHANCE = 0.5 // chance a steep front hit bounces (if weapon doesn't normalize)
export const RICOCHET_ASPECT = 0.62 // |cos| impact aspect above which a front hit is "steep"
export const ENEMY_ARMOR = { front: 0.7, side: 1.0, rear: 1.5 } // damage-taken multipliers (enemies)
export const SHELL_MAX_LIFE = 3.2 // seconds before despawn
export const TANK_SEPARATION = 1.05 // tank-vs-tank soft push factor
export const SHELL_HIT_RADIUS = 0.55 // arcade-forgiving extra hit radius added to tank radius

// --- economy ---
export const LOSS_CREDIT_FRACTION = 0.4
export const FIRST_CLEAR_CREDIT_MULT = 2
export const WIN_XP_BONUS = 40
export const DEFEAT_XP = 15 // participation XP — every run earns something
export const LEVEL_XP_BASE = 100
export const LEVEL_XP_EXP = 1.4
export const PAR_SECS_BASE = { eliminate: 35, survive: 0, destroy: 50, boss: 200 } // + per wave/count
export const STAR_TIME_FRACTION = 1.25 // finish under par * this for star 2
export const STAR_HP_FRACTION = 0.35 // finish with hp >= 35% of max for star 3

// --- difficulty table (mission difficulty 1..10) ---
export interface DifficultyMod {
  hpMult: number
  dmgMult: number
  aimMult: number // multiplies enemy aim error (lower = deadlier)
  reactMult: number // multiplies enemy reaction time (lower = faster)
}

const DIFF_MIN = { hpMult: 0.8, dmgMult: 0.5, aimMult: 1.85, reactMult: 2.3 }
const DIFF_MAX = { hpMult: 2.3, dmgMult: 1.65, aimMult: 0.5, reactMult: 0.55 }

export function difficultyMod(difficulty: number): DifficultyMod {
  const t = Math.min(1, Math.max(0, (difficulty - 1) / 9))
  return {
    hpMult: DIFF_MIN.hpMult + (DIFF_MAX.hpMult - DIFF_MIN.hpMult) * t,
    dmgMult: DIFF_MIN.dmgMult + (DIFF_MAX.dmgMult - DIFF_MIN.dmgMult) * t,
    aimMult: DIFF_MIN.aimMult + (DIFF_MAX.aimMult - DIFF_MIN.aimMult) * t,
    reactMult: DIFF_MIN.reactMult + (DIFF_MAX.reactMult - DIFF_MIN.reactMult) * t,
  }
}

// --- quality tiers (research: <100 draw calls; DPR/shadow/particle ladders) ---
export const QUALITY: Record<
  QualityTier,
  { dprCap: number; shadows: boolean; shadowMap: number; particles: number; shadowType: 'basic' | 'soft' }
> = {
  low: { dprCap: 1.0, shadows: false, shadowMap: 512, particles: 320, shadowType: 'basic' },
  medium: { dprCap: 1.5, shadows: true, shadowMap: 1024, particles: 700, shadowType: 'basic' },
  high: { dprCap: 2.0, shadows: true, shadowMap: 2048, particles: 1200, shadowType: 'soft' },
}

// adaptive quality (auto) hysteresis
export const AUTO_DOWN_MS = 19.5 // avg frame ms above which we step down
export const AUTO_UP_MS = 13.5 // below which we step up
export const AUTO_DOWN_SECS = 3
export const AUTO_UP_SECS = 10

// --- caps ---
export const MAX_SHELLS = 80
export const MAX_ENEMIES = 24
export const MAX_FLOATING_TEXT = 24
export const DECAL_RING = 90
export const TREADMARK_RING = 220

// --- abilities ---
export const ABILITY = {
  overdrive: { speedMult: 1.6, reloadMult: 0.5 },
  repair: { healFraction: 0.3 },
  focus: { damageMult: 2.2 },
  aegis: { takenMult: 0.5 },
} as const

// --- camera ---
export const CAM_HEIGHT = 26
export const CAM_BACK = 17
export const CAM_LERP = 4.2 // 1/s
export const CAM_AIM_LEAN = 0.22 // fraction camera leans toward aim point
export const SHAKE_DECAY = 7 // 1/s

// --- player XP curve ---
export function xpForLevel(level: number): number {
  // XP needed to advance FROM `level` to level+1
  return Math.round(LEVEL_XP_BASE * Math.pow(level, LEVEL_XP_EXP))
}
