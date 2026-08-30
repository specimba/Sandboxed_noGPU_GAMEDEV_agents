// NEXUS ARMOR — shared types. Pure data; no engine imports here.

export type Team = 'player' | 'enemy'

export type TankRoleId = 'scout' | 'medium' | 'td' | 'heavy'

export type EnemyArchetypeId = 'grunt' | 'rusher' | 'sniper' | 'brute' | 'boss'

export type AbilityId = 'overdrive' | 'repair' | 'focus' | 'aegis'

export type ObjectiveType = 'eliminate' | 'survive' | 'destroy' | 'boss'

export type QualityTier = 'low' | 'medium' | 'high'

export type AutoQuality = 'auto' | QualityTier

// ---------- config shapes ----------

export interface WeaponDef {
  id: string
  name: string
  damage: number
  reloadTime: number // seconds
  projectileSpeed: number // units/s
  splashRadius: number // 0 = none
  splashFalloff: number // fraction of damage at edge
  pierce: number // extra bodies penetrated
  spread: number // radians
  normalizes: boolean // ignores ricochet (APFSDS-style)
  tracerColor: number
  sound: 'cannon' | 'autocannon' | 'railgun' | 'howitzer' | 'rockets' | 'sniper' | 'brute'
}

export interface AbilityDef {
  id: AbilityId
  name: string
  description: string
  cooldown: number
  duration: number
}

export interface TankDef {
  id: TankRoleId
  name: string
  role: string
  description: string
  price: number
  hp: number
  speed: number // max units/s
  accel: number
  turnRate: number // rad/s hull
  turretRate: number // rad/s turret
  radius: number
  weaponId: string
  abilityId: AbilityId
  scale: number
  colors: { hull: number; turret: number; accent: number }
  // armor: fraction of damage taken per zone
  armor: { front: number; side: number; rear: number }
}

export interface AIParams {
  preferredRange: number
  strafeDir: 1 | -1
  aimError: number // radians base
  reactionTime: number // seconds before first shot after acquiring
  telegraph: number // seconds aim-line shown before firing (0 = none)
  flankChance: number
  retreatHpFraction: number
  thinkInterval: number
}

export interface EnemyDef {
  id: EnemyArchetypeId
  name: string
  hp: number
  speed: number
  accel: number
  turnRate: number
  turretRate: number
  radius: number
  scale: number
  weaponId: string
  ai: AIParams
  colors: { hull: number; turret: number; accent: number }
  xpReward: number
  creditReward: number
  label?: string
}

export interface MapDef {
  id: string
  name: string
  size: number // square arena edge length
  seed: number
  theme: {
    ground: number
    groundAlt: number
    grid: number
    fog: number
    fogDensity: number
    skyTop: number
    skyBottom: number
    sun: number
    sunIntensity: number
    ambient: number
    ambientIntensity: number
    props: { crate: number; wall: number; rock: number }
  }
  coverBudget: number // number of cover props
}

export interface WaveSpawn {
  archetype: EnemyArchetypeId
  count: number
  edge: 'n' | 's' | 'e' | 'w' | 'any'
}

export interface WaveDef {
  delay: number // seconds after previous wave cleared OR timer for survive missions
  spawns: WaveSpawn[]
}

export interface MissionDef {
  id: string
  name: string
  mapId: string
  briefing: string
  objective: { type: ObjectiveType; count?: number; duration?: number }
  waves: WaveDef[]
  difficulty: number // 1..10
  rewards: { credits: number; xp: number }
  unlockAfter: string | null
  seed: number
  hints?: string[]
}

export interface UpgradeTrackDef {
  id: 'firepower' | 'mobility' | 'protection'
  name: string
  description: string
  tierCosts: [number, number, number]
}

// ---------- runtime shapes ----------

export interface PlayerInput {
  throttle: number // -1..1
  steer: number // -1..1
  aimX: number // world x
  aimZ: number // world z
  fire: boolean
  brake: boolean
  ability: boolean
}

export interface UpgradeLevels {
  firepower: number
  mobility: number
  protection: number
}

export type UpgradesByTank = Record<string, UpgradeLevels>

export interface MissionResult {
  missionId: string
  victory: boolean
  timeSec: number
  kills: number
  shotsFired: number
  shotsHit: number
  damageDealt: number
  damageTaken: number
  creditsEarned: number
  xpEarned: number
  firstClear: boolean
  stars: number // 0..3
  objectiveProgress: number // 0..1
}

// HUD snapshot published by the engine (throttled)
export interface HudSnapshot {
  hp: number
  maxHp: number
  reload: number // 0..1 (1 = ready)
  weapon: string
  abilityCd: number // 0..1 remaining fraction (0 = ready)
  abilityActive: boolean
  abilityName: string
  kills: number
  credits: number
  wave: number
  waveTotal: number
  enemiesLeft: number
  objectiveText: string
  objectiveProgress: number // 0..1
  timeSec: number
  score: number
}

export type GameEvent =
  | { type: 'hud'; snapshot: HudSnapshot }
  | { type: 'battleEnd'; payload: MissionResult }
  | { type: 'kill'; archetype: EnemyArchetypeId; credits: number }
  | { type: 'playerHit'; damage: number; zone: 'front' | 'side' | 'rear' }
  | { type: 'ricochet'; byPlayer: boolean }
  | { type: 'hint'; text: string }
  | { type: 'waveIncoming'; wave: number }
  | { type: 'toast'; text: string; kind?: 'info' | 'good' | 'bad' }
