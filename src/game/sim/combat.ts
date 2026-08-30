// NEXUS ARMOR — combat resolution: armor zones, ricochet, splash. Pure functions.
import { RNG } from '../core/rng'
import { RICOCHET_ASPECT, RICOCHET_CHANCE } from '../config/balance'
import { angleDiff } from './vec'

export type ArmorZone = 'front' | 'side' | 'rear'

export interface ZoneArmor {
  front: number
  side: number
  rear: number
}

export interface HitResolution {
  damage: number
  zone: ArmorZone
  ricochet: boolean
}

/**
 * Resolve a shell impact against an armored target.
 * @param shellDirX/Z direction of shell travel at impact
 * @param targetAngle hull facing of the target
 * @param armor damage-taken multipliers per zone
 */
export function resolveShellHit(
  baseDamage: number,
  shellDirX: number,
  shellDirZ: number,
  targetAngle: number,
  armor: ZoneArmor,
  normalizes: boolean,
  rng: RNG,
): HitResolution {
  // Direction the shot came FROM (opposite of travel):
  const fromX = -shellDirX
  const fromZ = -shellDirZ
  const fromAngle = Math.atan2(fromZ, fromX)
  const rel = Math.abs(angleDiff(targetAngle, fromAngle)) // 0 = shot from directly ahead

  let zone: ArmorZone
  if (rel < Math.PI / 3) zone = 'front' // <60°
  else if (rel < (2 * Math.PI) / 3) zone = 'side' // 60..120°
  else zone = 'rear'

  // Ricochet: steep, near-perfect frontal impacts can bounce (unless the shell normalizes)
  if (zone === 'front' && !normalizes) {
    // aspect: how square-on the hit is; 1 = perfectly frontal
    const facingX = Math.cos(targetAngle)
    const facingZ = Math.sin(targetAngle)
    const aspect = Math.abs(facingX * fromX + facingZ * fromZ)
    if (aspect > RICOCHET_ASPECT && rng.next() < RICOCHET_CHANCE) {
      return { damage: 0, zone, ricochet: true }
    }
  }

  return { damage: baseDamage * armor[zone], zone, ricochet: false }
}

/** splash damage with linear falloff to `falloff` fraction at radius edge */
export function splashDamageAt(distance: number, radius: number, base: number, falloff: number): number {
  if (distance >= radius) return 0
  const t = 1 - distance / radius
  return base * (falloff + (1 - falloff) * t)
}
