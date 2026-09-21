// NEXUS ARMOR — simulation entity shapes (pure data, no engine imports).
import type { Team, WeaponDef } from '../core/types'
import type { ZoneArmor } from './combat'

export interface TankStatus {
  speedMult: number
  reloadMult: number
  takenMult: number
  nextShotMult: number
  pierceBonus: number
  healPerSec: number
}

export type AIMode = 'hunt' | 'combat' | 'flank' | 'retreat'

/** flattened per-enemy AI/movement params (composed at spawn with difficulty) */
export interface EnemyParams {
  preferredRange: number
  aimError: number
  reactionTime: number
  telegraph: number
  flankChance: number
  retreatHpFraction: number
  thinkInterval: number
  turnRate: number
  accel: number
  maxSpeed: number
}

export interface AIState {
  mode: AIMode
  thinkT: number
  reactionT: number
  wpX: number
  wpZ: number
  lastSeenX: number
  lastSeenZ: number
  lastSeenT: number
  telegraphT: number
  strafeSign: 1 | -1
  hadLOS: boolean
}

export interface Tank {
  id: number
  team: Team
  kindId: string
  x: number
  z: number
  angle: number
  turretAngle: number
  speed: number
  hp: number
  maxHp: number
  reloadT: number
  weapon: WeaponDef
  armor: ZoneArmor
  radius: number
  scale: number
  alive: boolean
  vx: number
  vz: number
  hitFlash: number
  muzzleT: number
  recoilT: number
  telegraphT: number
  aimX: number
  aimZ: number
  name?: string
  ability?: { id: string; cd: number; activeT: number }
  status: TankStatus
  ai?: AIState
  enemyParams?: EnemyParams
  // render interpolation ghosts
  prevX: number
  prevZ: number
  prevAngle: number
  prevTurret: number
}

export interface Shell {
  id: number
  x: number
  z: number
  px: number
  pz: number
  vx: number
  vz: number
  dmg: number
  team: Team
  splash: number
  falloff: number
  pierce: number
  life: number
  weaponId: string
  tracerColor: number
  ownerId: number
  hitIds: number[] // tanks already hit (pierce bookkeeping; pool-recycled)
}

export interface TargetStructure {
  id: number
  x: number
  z: number
  hx: number
  hz: number
  hp: number
  maxHp: number
  alive: boolean
  hitFlash: number
}

export type PropKind = 'crate' | 'wall' | 'rock'

export type FXEvent =
  | { kind: 'muzzle'; x: number; z: number; angle: number; sound: string; color: number; big: boolean }
  | { kind: 'explosion'; x: number; z: number; big: boolean }
  | { kind: 'impact'; x: number; z: number }
  | { kind: 'ricochet'; x: number; z: number; byPlayer: boolean }
  | { kind: 'dmgnum'; x: number; z: number; value: number; zone: 'front' | 'side' | 'rear'; ricochet: boolean }
  | { kind: 'decal'; x: number; z: number; size: number }
  | { kind: 'treadmark'; x: number; z: number; angle: number }
  | { kind: 'spawn'; x: number; z: number }
  | { kind: 'structureDown'; x: number; z: number }
  | { kind: 'kill'; big: boolean }
  | { kind: 'shake'; amp: number }
