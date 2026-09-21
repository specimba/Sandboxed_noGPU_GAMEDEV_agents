// NEXUS ARMOR — enemy AI: readable, telegraphed behaviors (see docs/DESIGN.md §5).
// States: hunt (close in), combat (strafe + trade), flank (rushers arc around cover),
// retreat (low HP). All aim/firing decisions consume the seeded sim RNG.
import type { Tank, EnemyParams } from './entities'
import type { RNG } from '../core/rng'
import type { DifficultyMod } from '../config/balance'
import { angleDiff, dist, rotateToward } from './vec'
import type { SimWorld } from './world'

export interface AICtx {
  world: SimWorld
  player: Tank
  rng: RNG
  diff: DifficultyMod
  time: number
  fire: (tank: Tank, aimX: number, aimZ: number) => void
}

function paramsOf(t: Tank): EnemyParams {
  return t.enemyParams as EnemyParams
}

function moveToward(t: Tank, wpX: number, wpZ: number, ctx: AICtx, throttle: number, dt: number): void {
  const p = paramsOf(t)
  const desired = Math.atan2(wpZ - t.z, wpX - t.x)

  // obstacle avoidance: probe ahead; if blocked, bias toward the clearer side
  const probeLen = 7
  const aheadX = t.x + Math.cos(t.angle) * probeLen
  const aheadZ = t.z + Math.sin(t.angle) * probeLen
  let frac = ctx.world.blockedFraction(t.x, t.z, aheadX, aheadZ)
  let steer = 0
  if (frac < 1) {
    const leftX = t.x + Math.cos(t.angle - 0.7) * probeLen
    const leftZ = t.z + Math.sin(t.angle - 0.7) * probeLen
    const rightX = t.x + Math.cos(t.angle + 0.7) * probeLen
    const rightZ = t.z + Math.sin(t.angle + 0.7) * probeLen
    const l = ctx.world.blockedFraction(t.x, t.z, leftX, leftZ)
    const r = ctx.world.blockedFraction(t.x, t.z, rightX, rightZ)
    steer = l > r ? -1 : 1
    frac = Math.max(l, r)
  }
  t.angle = rotateToward(t.angle, desired + steer * 1.2, p.turnRate * dt)
  // slow while turning hard into an obstacle
  const effThrottle = throttle * (frac < 1 ? 0.55 : 1) * (Math.abs(angleDiff(t.angle, desired)) > 1.4 ? 0.45 : 1)
  const target = effThrottle * p.maxSpeed
  const rate = p.accel * dt
  if (t.speed < target) t.speed = Math.min(target, t.speed + rate)
  else t.speed = Math.max(target, t.speed - rate)
}

export function updateAI(t: Tank, ctx: AICtx, dt: number): void {
  const ai = t.ai
  if (!t.alive || !ai) return
  const p = paramsOf(t)
  const player = ctx.player

  if (!player.alive) {
    t.speed = Math.max(0, t.speed - p.accel * dt)
    return
  }

  const d = dist(t.x, t.z, player.x, player.z)
  const los = ctx.world.hasLOS(t.x, t.z, player.x, player.z)

  if (los) {
    ai.lastSeenX = player.x
    ai.lastSeenZ = player.z
    ai.lastSeenT = ctx.time
    if (!ai.hadLOS) {
      // reacquired: apply reaction delay scaled by difficulty
      ai.reactionT = p.reactionTime * ctx.diff.reactMult
      ai.telegraphT = 0
    }
  }
  ai.hadLOS = los
  if (ai.reactionT > 0) ai.reactionT -= dt

  // --- periodic decisions ---
  ai.thinkT -= dt
  if (ai.thinkT <= 0) {
    ai.thinkT = p.thinkInterval * ctx.rng.range(0.85, 1.25)
    const hpFrac = t.hp / t.maxHp
    const sinceSeen = ctx.time - ai.lastSeenT

    if (hpFrac < p.retreatHpFraction) {
      ai.mode = 'retreat'
      const away = Math.atan2(t.z - player.z, t.x - player.x)
      ai.wpX = t.x + Math.cos(away) * 34
      ai.wpZ = t.z + Math.sin(away) * 34
    } else if (los) {
      if (d <= p.preferredRange * 1.7) {
        ai.mode = 'combat'
        if (ctx.rng.next() < 0.3) ai.strafeSign = (ctx.rng.next() < 0.5 ? 1 : -1) as 1 | -1
      } else {
        ai.mode = 'hunt'
        ai.wpX = player.x
        ai.wpZ = player.z
      }
    } else if (sinceSeen < 6) {
      if (ctx.rng.next() < p.flankChance) {
        ai.mode = 'flank'
        const toT = Math.atan2(t.z - player.z, t.x - player.x)
        ai.wpX = player.x + Math.cos(toT + (Math.PI / 2) * ai.strafeSign) * 24
        ai.wpZ = player.z + Math.sin(toT + (Math.PI / 2) * ai.strafeSign) * 24
      } else {
        ai.mode = 'hunt'
        ai.wpX = ai.lastSeenX
        ai.wpZ = ai.lastSeenZ
      }
    } else {
      // lost for a while: patrol toward last known area
      ai.mode = 'hunt'
      ai.wpX = ai.lastSeenX + ctx.rng.range(-16, 16)
      ai.wpZ = ai.lastSeenZ + ctx.rng.range(-16, 16)
    }
  }

  // --- movement ---
  if (ai.mode === 'combat') {
    // strafe around the player at preferred range
    const toP = Math.atan2(player.z - t.z, player.x - t.x)
    const tangent = toP + (Math.PI / 2) * ai.strafeSign
    let radial = 0
    if (d > p.preferredRange * 1.15) radial = 0.85
    else if (d < p.preferredRange * 0.7) radial = -0.85
    const mx = Math.cos(tangent) * 1 + Math.cos(toP) * radial
    const mz = Math.sin(tangent) * 1 + Math.sin(toP) * radial
    moveToward(t, t.x + mx * 6, t.z + mz * 6, ctx, 0.8, dt)
  } else if (ai.mode === 'retreat') {
    moveToward(t, ai.wpX, ai.wpZ, ctx, 1, dt)
  } else {
    moveToward(t, ai.wpX, ai.wpZ, ctx, 1, dt)
    if (ai.mode === 'flank' && dist(t.x, t.z, ai.wpX, ai.wpZ) < 5) ai.mode = 'hunt'
  }

  // --- aiming & firing ---
  const canEngage = los || ai.telegraphT > 0
  if (canEngage) {
    // predictive intercept (one iteration is plenty at these speeds)
    const tof = d / t.weapon.projectileSpeed
    const tx = player.x + player.vx * tof * 0.9
    const tz = player.z + player.vz * tof * 0.9
    const errScale = p.aimError * ctx.diff.aimMult * (1 + d / 70)
    const desiredTrue = Math.atan2(tz - t.z, tx - t.x)
    const desired = desiredTrue + ctx.rng.bell() * errScale
    t.turretAngle = rotateToward(t.turretAngle, desired, p.turnRate * 1.8 * dt)
    t.aimX = player.x
    t.aimZ = player.z

    const aligned = Math.abs(angleDiff(t.turretAngle, desiredTrue)) < 0.06
    const ready = t.reloadT <= 0 && ai.reactionT <= 0 && aligned

    if (p.telegraph > 0) {
      // telegraphed shot: show the line, then fire (cancelled by breaking LOS)
      if (ready && ai.telegraphT <= 0) ai.telegraphT = p.telegraph
      if (ai.telegraphT > 0) {
        t.telegraphT = ai.telegraphT
        ai.telegraphT -= dt
        if (ai.telegraphT <= 0 && los) {
          ctx.fire(t, player.x, player.z)
        }
      }
    } else if (ready) {
      ctx.fire(t, tx, tz)
    }
  } else {
    // no LOS: aim turret along hull (ready to engage on sight)
    t.turretAngle = rotateToward(t.turretAngle, t.angle, p.turnRate * 1.2 * dt)
    if (ai.telegraphT > 0) {
      ai.telegraphT = 0
      t.telegraphT = 0
      ai.reactionT = 0.35
    }
  }
}
