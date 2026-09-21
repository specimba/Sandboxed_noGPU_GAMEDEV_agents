// NEXUS ARMOR — upgrade tracks (per hull). Effects applied in sim when composing stats.
import type { UpgradeTrackDef, UpgradeLevels } from '../core/types'

export const UPGRADE_TRACKS: UpgradeTrackDef[] = [
  {
    id: 'firepower',
    name: 'Firepower',
    description: '+8% weapon damage per tier',
    tierCosts: [200, 450, 900],
  },
  {
    id: 'mobility',
    name: 'Mobility',
    description: '+7% speed and +8% turret traverse per tier',
    tierCosts: [200, 450, 900],
  },
  {
    id: 'protection',
    name: 'Protection',
    description: '+10% max HP and tougher armor per tier',
    tierCosts: [200, 450, 900],
  },
]

export const MAX_UPGRADE_TIER = 3

export const NO_UPGRADES: UpgradeLevels = { firepower: 0, mobility: 0, protection: 0 }

export function upgradeCost(track: UpgradeTrackDef, currentTier: number): number | null {
  if (currentTier >= MAX_UPGRADE_TIER) return null
  return track.tierCosts[currentTier]
}
