// NEXUS ARMOR — player profile + progression rules (pure logic; storage in save.ts).
import type { AutoQuality, MissionResult, UpgradeLevels } from '../core/types'
import { xpForLevel } from '../config/balance'
import { MISSIONS } from '../config/missions'
import { MAX_UPGRADE_TIER, UPGRADE_TRACKS } from '../config/upgrades'
import { TANK_BY_ID } from '../config/tanks'
import { uuid } from '../core/rng'

export interface MissionRecord {
  cleared: boolean
  stars: number
  bestTimeSec: number
}

export interface PlayerSettings {
  volume: number
  quality: AutoQuality
  shake: boolean
  damageNumbers: boolean
  reducedMotion: boolean
}

export interface PlayerProfile {
  clientId: string
  credits: number
  xp: number
  ownedTanks: string[]
  selectedTank: string
  upgrades: Record<string, UpgradeLevels>
  missionProgress: Record<string, MissionRecord>
  stats: {
    battles: number
    wins: number
    kills: number
    deaths: number
    shots: number
    hits: number
    creditsEarned: number
    xpEarned: number
  }
  settings: PlayerSettings
  createdAt: number
  updatedAt: number
}

export function defaultProfile(): PlayerProfile {
  return {
    clientId: uuid(),
    credits: 0,
    xp: 0,
    ownedTanks: ['scout'],
    selectedTank: 'scout',
    upgrades: {},
    missionProgress: {},
    stats: {
      battles: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      shots: 0,
      hits: 0,
      creditsEarned: 0,
      xpEarned: 0,
    },
    settings: {
      volume: 0.8,
      quality: 'auto',
      shake: true,
      damageNumbers: true,
      reducedMotion: false,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export interface LevelInfo {
  level: number
  into: number // xp into current level
  need: number // xp needed to advance
}

export function levelFromXp(xp: number): LevelInfo {
  let level = 1
  let remaining = xp
  let need = xpForLevel(level)
  while (remaining >= need && level < 999) {
    remaining -= need
    level++
    need = xpForLevel(level)
  }
  return { level, into: remaining, need }
}

export function upgradesFor(profile: PlayerProfile, tankId: string): UpgradeLevels {
  return profile.upgrades[tankId] ?? { firepower: 0, mobility: 0, protection: 0 }
}

export function isMissionUnlocked(profile: PlayerProfile, missionId: string): boolean {
  const m = MISSIONS.find((mm) => mm.id === missionId)
  if (!m) return false
  if (!m.unlockAfter) return true
  return !!profile.missionProgress[m.unlockAfter]?.cleared
}

export function isMissionFirstClear(profile: PlayerProfile, missionId: string): boolean {
  return !profile.missionProgress[missionId]?.cleared
}

export function nextMissionAfter(missionId: string): string | null {
  const idx = MISSIONS.findIndex((m) => m.id === missionId)
  if (idx < 0 || idx >= MISSIONS.length - 1) return null
  return MISSIONS[idx + 1].id
}

export interface ApplyResultOutcome {
  leveledUp: boolean
  newLevel: number
  unlockedMission: string | null
}

export function applyResult(profile: PlayerProfile, result: MissionResult): ApplyResultOutcome {
  const before = levelFromXp(profile.xp).level
  profile.credits += result.creditsEarned
  profile.xp += result.xpEarned
  const s = profile.stats
  s.battles += 1
  if (result.victory) s.wins += 1
  else s.deaths += 1
  s.kills += result.kills
  s.shots += result.shotsFired
  s.hits += result.shotsHit
  s.creditsEarned += result.creditsEarned
  s.xpEarned += result.xpEarned

  const prev = profile.missionProgress[result.missionId]
  if (result.victory) {
    profile.missionProgress[result.missionId] = {
      cleared: true,
      stars: Math.max(prev?.stars ?? 0, result.stars),
      bestTimeSec: prev?.cleared ? Math.min(prev.bestTimeSec, result.timeSec) : result.timeSec,
    }
  }
  profile.updatedAt = Date.now()
  const after = levelFromXp(profile.xp).level
  return {
    leveledUp: after > before,
    newLevel: after,
    unlockedMission: result.victory ? nextMissionAfter(result.missionId) : null,
  }
}

export function purchaseTank(profile: PlayerProfile, tankId: string): boolean {
  const def = TANK_BY_ID[tankId]
  if (!def || profile.ownedTanks.includes(tankId) || profile.credits < def.price) return false
  profile.credits -= def.price
  profile.ownedTanks.push(tankId)
  profile.selectedTank = tankId
  profile.updatedAt = Date.now()
  return true
}

export function purchaseUpgrade(profile: PlayerProfile, tankId: string, trackId: string): boolean {
  if (!profile.ownedTanks.includes(tankId)) return false
  const track = UPGRADE_TRACKS.find((t) => t.id === trackId)
  if (!track) return false
  const lv = profile.upgrades[tankId] ?? { firepower: 0, mobility: 0, protection: 0 }
  if (lv[trackId as keyof UpgradeLevels] >= MAX_UPGRADE_TIER) return false
  const cost = track.tierCosts[lv[trackId as keyof UpgradeLevels]]
  if (profile.credits < cost) return false
  profile.credits -= cost
  lv[trackId as keyof UpgradeLevels] += 1
  profile.upgrades[tankId] = lv
  profile.updatedAt = Date.now()
  return true
}

export function accuracyOf(s: PlayerProfile['stats']): number {
  return s.shots > 0 ? Math.round((s.hits / s.shots) * 100) : 0
}
