// NEXUS ARMOR — BattleSim: fixed-step deterministic battle simulation.
// Pure logic (no THREE, no DOM). The render layer reads snapshots; UI reads GameEvents.
import type {
  EnemyArchetypeId,
  GameEvent,
  HudSnapshot,
  MissionDef,
  MissionResult,
  PlayerInput,
  UpgradeLevels,
} from '../core/types'
import { RNG } from '../core/rng'
import {
  ABILITY,
  difficultyMod,
  DEFEAT_XP,
  LOSS_CREDIT_FRACTION,
  FIRST_CLEAR_CREDIT_MULT,
  WIN_XP_BONUS,
  MAX_ENEMIES,
  MAX_SHELLS,
  PAR_SECS_BASE,
  SHELL_HIT_RADIUS,
  SHELL_MAX_LIFE,
  STAR_HP_FRACTION,
  STAR_TIME_FRACTION,
  TANK_SEPARATION,
  ARENA_MARGIN,
} from '../config/balance'
import { TANK_BY_ID, ABILITIES } from '../config/tanks'
import { ENEMY_BY_ID } from '../config/enemies'
import { WEAPONS } from '../config/weapons'
import { MAP_BY_ID } from '../config/maps'
import type { PropKind } from './entities'
import type { Shell, TargetStructure, Tank } from './entities'
import { SimWorld, type AABB } from './world'
import { resolveShellHit, splashDamageAt, type ArmorZone } from './combat'
import { updateAI } from './ai'
import { clamp, dist, rotateToward } from './vec'

export interface BattleOpts {
  mission: MissionDef
  tankId: string
  upgrades: UpgradeLevels
  firstClear: boolean
  emit: (e: GameEvent) => void
}

export const EMPTY_INPUT: PlayerInput = {
  throttle: 0,
  steer: 0,
  aimX: 0,
  aimZ: 0,
  fire: false,
  brake: false,
  ability: false,
}

interface EnemyParams {
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

let nextId = 1
const _hitCircle = { x: 0, z: 0, r: 0 } // scratch (no per-frame allocation)

export class BattleSim {
  map = MAP_BY_ID.dry_docks
  world: SimWorld
  rng: RNG
  mission: MissionDef
  diff = difficultyMod(1)
  player!: Tank
  enemies: Tank[] = []
  shells: Shell[] = []
  targets: TargetStructure[] = []
  propTypes: PropKind[] = []
  fxQueue: import('./entities').FXEvent[] = []
  time = 0
  state: 'running' | 'victory' | 'defeat' = 'running'
  input: PlayerInput = { ...EMPTY_INPUT }

  // mission bookkeeping
  private waveIdx = 0
  private clearedAt = 0
  private spawnedAll = false
  totalToSpawn = 0
  spawnedCount = 0
  killedCount = 0
  private destroyedTargets = 0
  private hintIdx = 0
  private nextHintAt = 1.5
  private firstClear: boolean
  private emit: (e: GameEvent) => void

  // player battle stats
  stats = { shotsFired: 0, hits: 0, damageDealt: 0, damageTaken: 0, kills: 0 }
  creditsEarned = 0
  xpEarned = 0

  private shellPool: Shell[] = []
  private treadTimer = 0
  private aiCtx!: import('./ai').AICtx

  constructor(opts: BattleOpts) {
    this.mission = opts.mission
    this.firstClear = opts.firstClear
    this.emit = opts.emit
    this.map = MAP_BY_ID[opts.mission.mapId] ?? this.map
    this.diff = difficultyMod(opts.mission.difficulty)
    this.rng = new RNG(opts.mission.seed)
    this.world = new SimWorld(this.map.size)

    if (this.mission.objective.type === 'destroy') this.spawnTargets(this.mission.objective.count ?? 3)
    this.generateCover()
    this.spawnPlayer(opts.tankId, opts.upgrades)

    for (const w of this.mission.waves) for (const s of w.spawns) this.totalToSpawn += s.count

    this.aiCtx = {
      world: this.world,
      player: this.player,
      rng: this.rng,
      diff: this.diff,
      time: 0,
      fire: (t, ax, az) => this.fireWeapon(t, ax, az),
    }
  }

  // ---------------------------------------------------------------- cover gen
  private generateCover(): void {
    const half = this.world.half
    const rng = this.rng
    const placed: AABB[] = []
    const kinds: PropKind[] = []
    const budget = this.map.coverBudget

    const candidateOk = (b: AABB): boolean => {
      // keep player spawn + center clear
      if (dist(b.x, b.z, 0, half * 0.55) < 11) return false
      if (dist(b.x, b.z, 0, 0) < 7) return false
      for (const p of placed) {
        if (Math.abs(p.x - b.x) < p.hx + b.hx + 4.5 && Math.abs(p.z - b.z) < p.hz + b.hz + 4.5) return false
      }
      return true
    }

    let guard = 0
    let made = 0
    while (made < budget && guard < budget * 30) {
      guard++
      const kind: PropKind = rng.next() < 0.42 ? 'wall' : rng.next() < 0.55 ? 'crate' : 'rock'
      let hx: number, hz: number
      if (kind === 'crate') {
        hx = rng.range(1.3, 1.9)
        hz = rng.range(1.3, 1.9)
      } else if (kind === 'wall') {
        const along = rng.range(2.8, 4.6)
        const thin = rng.range(0.9, 1.3)
        if (rng.next() < 0.5) {
          hx = along
          hz = thin
        } else {
          hx = thin
          hz = along
        }
      } else {
        hx = rng.range(2.0, 3.2)
        hz = rng.range(1.7, 2.8)
      }
      const x = rng.range(-half * 0.74, half * 0.74)
      const z = rng.range(-half * 0.74, half * 0.74)
      const box: AABB = { x, z, hx, hz }
      if (!candidateOk(box)) continue
      // mirrored twin for fair map symmetry
      const mirror: AABB = { x: -x, z: -z, hx, hz }
      if (!candidateOk(mirror)) continue
      placed.push(box, mirror)
      kinds.push(kind, kind)
      made += 2
    }
    for (let i = 0; i < placed.length; i++) {
      this.world.addProp(placed[i])
      this.propTypes.push(kinds[i])
    }
    // bunker targets are registered as props too (cover until demolished)
    for (const t of this.targets) {
      this.world.addProp({ x: t.x, z: t.z, hx: t.hx, hz: t.hz })
    }
  }

  private spawnTargets(count: number): void {
    const half = this.world.half
    const baseA = this.rng.range(0, Math.PI * 2)
    for (let i = 0; i < count; i++) {
      const a = baseA + (i / count) * Math.PI * 2 + this.rng.range(-0.3, 0.3)
      const r = half * this.rng.range(0.42, 0.6)
      this.targets.push({
        id: nextId++,
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        hx: 2.4,
        hz: 2.4,
        hp: 140,
        maxHp: 140,
        alive: true,
        hitFlash: 0,
      })
    }
  }

  // ---------------------------------------------------------------- spawning
  private spawnPlayer(tankId: string, upgrades: UpgradeLevels): void {
    const def = TANK_BY_ID[tankId] ?? TANK_BY_ID.scout
    const u = upgrades
    const hp = Math.round(def.hp * (1 + u.protection * 0.1))
    const z = this.world.half * 0.55
    this.player = {
      id: nextId++,
      team: 'player',
      kindId: def.id,
      x: 0,
      z,
      angle: -Math.PI / 2,
      turretAngle: -Math.PI / 2,
      speed: 0,
      hp,
      maxHp: hp,
      reloadT: 0.6,
      weapon: WEAPONS[def.weaponId],
      armor: {
        front: Math.max(0.35, def.armor.front - u.protection * 0.03),
        side: Math.max(0.6, def.armor.side - u.protection * 0.03),
        rear: Math.max(1.1, def.armor.rear - u.protection * 0.02),
      },
      radius: def.radius,
      scale: def.scale,
      alive: true,
      vx: 0,
      vz: 0,
      hitFlash: 0,
      muzzleT: 0,
      recoilT: 0,
      telegraphT: 0,
      aimX: 0,
      aimZ: z - 10,
      ability: { id: def.abilityId, cd: 0, activeT: 0 },
      status: { speedMult: 1, reloadMult: 1, takenMult: 1, nextShotMult: 1, pierceBonus: 0, healPerSec: 0 },
      prevX: 0,
      prevZ: z,
      prevAngle: -Math.PI / 2,
      prevTurret: -Math.PI / 2,
    }
    // movement profile stored for update (upgrades applied)
    ;(this.player as Tank & { moveProf?: { speed: number; accel: number; turnRate: number; turretRate: number } }).moveProf = {
      speed: def.speed * (1 + u.mobility * 0.07),
      accel: def.accel,
      turnRate: def.turnRate,
      turretRate: def.turretRate * (1 + u.mobility * 0.08),
    }
    ;(this.player as Tank & { dmgMult?: number }).dmgMult = 1 + u.firepower * 0.08
  }

  private edgePoint(edge: 'n' | 's' | 'e' | 'w' | 'any'): { x: number; z: number } {
    const half = this.world.half - ARENA_MARGIN - 3
    let e = edge
    if (e === 'any') e = this.rng.pick(['n', 's', 'e', 'w'] as const)
    for (let i = 0; i < 12; i++) {
      const t = this.rng.range(-0.66, 0.66)
      let x = 0
      let z = 0
      if (e === 'n') {
        x = half * t
        z = -half
      } else if (e === 's') {
        x = half * t
        z = half
      } else if (e === 'w') {
        x = -half
        z = half * t
      } else {
        x = half
        z = half * t
      }
      if (dist(x, z, this.player.x, this.player.z) > 22) return { x, z }
    }
    return { x: 0, z: -half }
  }

  private spawnEnemy(archetype: EnemyArchetypeId, edge: 'n' | 's' | 'e' | 'w' | 'any'): void {
    if (this.enemies.length >= MAX_ENEMIES) return
    const def = ENEMY_BY_ID[archetype]
    const p = this.edgePoint(edge)
    // nudge out of props
    const c = { x: p.x, z: p.z, r: def.radius + 0.4 }
    this.world.resolveCircle(c)
    const hp = Math.round(
      def.hp * (archetype === 'boss' ? 1 + (this.mission.difficulty - 1) * 0.12 : this.diff.hpMult),
    )
    const angle = Math.atan2(-p.z, -p.x) // face map center
    const tank: Tank = {
      id: nextId++,
      team: 'enemy',
      kindId: def.id,
      x: c.x,
      z: c.z,
      angle,
      turretAngle: angle,
      speed: 0,
      hp,
      maxHp: hp,
      reloadT: this.rng.range(0.8, 1.6),
      weapon: WEAPONS[def.weaponId],
      armor: { front: 0.7, side: 1.0, rear: 1.5 },
      radius: def.radius,
      scale: def.scale,
      alive: true,
      vx: 0,
      vz: 0,
      hitFlash: 0,
      muzzleT: 0,
      recoilT: 0,
      telegraphT: 0,
      aimX: p.x,
      aimZ: p.z,
      name: def.label,
      status: { speedMult: 1, reloadMult: 1, takenMult: 1, nextShotMult: 1, pierceBonus: 0, healPerSec: 0 },
      ai: {
        mode: 'hunt',
        thinkT: this.rng.range(0, 0.3),
        reactionT: def.ai.reactionTime * this.diff.reactMult,
        wpX: c.x,
        wpZ: c.z,
        lastSeenX: this.player.x,
        lastSeenZ: this.player.z,
        lastSeenT: -10,
        telegraphT: 0,
        strafeSign: this.rng.next() < 0.5 ? 1 : -1,
        hadLOS: false,
      },
      prevX: c.x,
      prevZ: c.z,
      prevAngle: angle,
      prevTurret: angle,
      enemyParams: {
        preferredRange: def.ai.preferredRange,
        aimError: def.ai.aimError,
        reactionTime: def.ai.reactionTime,
        telegraph: def.ai.telegraph,
        flankChance: def.ai.flankChance,
        retreatHpFraction: def.ai.retreatHpFraction,
        thinkInterval: def.ai.thinkInterval,
        turnRate: def.turnRate,
        accel: def.accel,
        maxSpeed: def.speed,
      },
    }
    this.enemies.push(tank)
    this.spawnedCount++
    this.fxQueue.push({ kind: 'spawn', x: c.x, z: c.z })
  }

  private updateWaves(dt: number): void {
    void dt
    const waves = this.mission.waves
    if (this.waveIdx >= waves.length) {
      this.spawnedAll = true
      return
    }
    const wave = waves[this.waveIdx]
    let due = false
    if (this.mission.objective.type === 'eliminate') {
      const enemiesAlive = this.enemies.length
      if (this.waveIdx === 0) due = this.time >= wave.delay
      else due = enemiesAlive === 0 && this.time - this.clearedAt >= Math.max(0.8, wave.delay)
    } else {
      due = this.time >= wave.delay
    }
    if (!due) return

    let pending = wave.spawns.reduce((n, s) => n + s.count, 0)
    if (this.enemies.length + pending > MAX_ENEMIES) pending = Math.max(0, MAX_ENEMIES - this.enemies.length)
    let left = pending
    for (const s of wave.spawns) {
      for (let i = 0; i < s.count && left > 0; i++) {
        this.spawnEnemy(s.archetype, s.edge)
        left--
      }
      if (left <= 0) break
    }
    this.waveIdx++
    if (this.waveIdx >= waves.length) this.spawnedAll = true
    this.emit({ type: 'waveIncoming', wave: this.waveIdx })
  }

  // ---------------------------------------------------------------- firing
  fireWeapon(tank: Tank, aimX: number, aimZ: number): void {
    if (!tank.alive || tank.reloadT > 0) return
    const w = tank.weapon
    const isPlayer = tank.team === 'player'
    const spread = w.spread
    const fireAngle = tank.turretAngle + this.rng.bell() * spread
    const muzzleDist = tank.radius + 1.9 * tank.scale
    const mx = tank.x + Math.cos(fireAngle) * muzzleDist
    const mz = tank.z + Math.sin(fireAngle) * muzzleDist

    let dmg = w.damage
    let pierce = w.pierce
    if (isPlayer) {
      dmg *= (tank as Tank & { dmgMult?: number }).dmgMult ?? 1
      if (tank.status.nextShotMult !== 1) {
        dmg *= tank.status.nextShotMult
        pierce += tank.status.pierceBonus
        tank.status.nextShotMult = 1
        tank.status.pierceBonus = 0
      }
    } else {
      dmg *= this.diff.dmgMult
    }

    tank.reloadT = w.reloadTime * tank.status.reloadMult
    tank.muzzleT = 0.07
    tank.recoilT = 0.28
    tank.aimX = aimX
    tank.aimZ = aimZ

    const shell = this.acquireShell()
    shell.x = mx
    shell.z = mz
    shell.px = mx
    shell.pz = mz
    shell.vx = Math.cos(fireAngle) * w.projectileSpeed
    shell.vz = Math.sin(fireAngle) * w.projectileSpeed
    shell.dmg = dmg
    shell.team = tank.team
    shell.splash = w.splashRadius
    shell.falloff = w.splashFalloff
    shell.pierce = pierce
    shell.life = SHELL_MAX_LIFE
    shell.weaponId = w.id
    shell.tracerColor = w.tracerColor
    shell.ownerId = tank.id
    shell.hitIds.length = 0

    const big = tank.kindId === 'heavy' || tank.kindId === 'boss' || tank.kindId === 'brute'
    this.fxQueue.push({
      kind: 'muzzle',
      x: mx,
      z: mz,
      angle: fireAngle,
      sound: w.sound,
      color: w.tracerColor,
      big,
    })
    if (isPlayer) {
      this.stats.shotsFired++
      this.fxQueue.push({ kind: 'shake', amp: big ? 0.35 : 0.12 })
    }
  }

  private acquireShell(): Shell {
    const pooled = this.shellPool.pop()
    if (pooled) {
      this.shells.push(pooled)
      return pooled
    }
    if (this.shells.length >= MAX_SHELLS) {
      // recycle the oldest under pressure (never allocates beyond cap)
      const oldest = this.shells.shift()
      if (oldest) {
        this.shells.push(oldest)
        return oldest
      }
    }
    const s: Shell = {
      id: nextId++,
      x: 0,
      z: 0,
      px: 0,
      pz: 0,
      vx: 0,
      vz: 0,
      dmg: 0,
      team: 'enemy',
      splash: 0,
      falloff: 0,
      pierce: 0,
      life: 0,
      weaponId: '',
      tracerColor: 0xffffff,
      ownerId: 0,
      hitIds: [],
    }
    this.shells.push(s)
    return s
  }

  private recycleShell(index: number): void {
    const s = this.shells[index]
    this.shells[index] = this.shells[this.shells.length - 1]
    this.shells.pop()
    if (this.shellPool.length < MAX_SHELLS) this.shellPool.push(s)
  }

  // ---------------------------------------------------------------- damage
  private applyDamage(
    tank: Tank,
    dmg: number,
    zone: ArmorZone,
    hitX: number,
    hitZ: number,
    byPlayer: boolean,
  ): void {
    if (!tank.alive || dmg <= 0) return
    const final = dmg * tank.status.takenMult
    tank.hp -= final
    tank.hitFlash = 0.12
    this.fxQueue.push({ kind: 'dmgnum', x: hitX, z: hitZ, value: Math.round(final), zone, ricochet: false })
    this.fxQueue.push({ kind: 'impact', x: hitX, z: hitZ })
    if (byPlayer) {
      this.stats.hits++
      this.stats.damageDealt += final
    } else {
      this.stats.damageTaken += final
      this.emit({ type: 'playerHit', damage: final, zone })
      this.fxQueue.push({ kind: 'shake', amp: Math.min(0.6, 0.2 + final / 60) })
    }
    if (tank.hp <= 0) {
      tank.hp = 0
      tank.alive = false
      const big = tank.radius > 1.9
      this.fxQueue.push({ kind: 'explosion', x: tank.x, z: tank.z, big })
      this.fxQueue.push({ kind: 'decal', x: tank.x, z: tank.z, size: big ? 4.5 : 3 })
      this.fxQueue.push({ kind: 'kill', big })
      if (tank.team === 'enemy') {
        const def = ENEMY_BY_ID[tank.kindId as EnemyArchetypeId]
        const mult = 1 + this.mission.difficulty * 0.05
        this.creditsEarned += Math.round(def.creditReward * mult)
        this.xpEarned += def.xpReward
        this.killedCount++
        this.stats.kills++
        this.emit({ type: 'kill', archetype: def.id, credits: Math.round(def.creditReward * mult) })
      } else {
        this.fxQueue.push({ kind: 'explosion', x: tank.x, z: tank.z, big: true })
      }
    }
  }

  private damageBunker(t: TargetStructure, dmg: number, hitX: number, hitZ: number): void {
    t.hp -= dmg
    t.hitFlash = 0.12
    this.fxQueue.push({ kind: 'dmgnum', x: hitX, z: hitZ, value: Math.round(dmg), zone: 'side', ricochet: false })
    this.fxQueue.push({ kind: 'impact', x: hitX, z: hitZ })
    if (t.hp <= 0 && t.alive) {
      t.alive = false
      this.destroyedTargets++
      // remove its collision box from the world
      const idx = this.world.props.findIndex((p) => p.x === t.x && p.z === t.z)
      if (idx >= 0) this.world.props.splice(idx, 1)
      this.fxQueue.push({ kind: 'explosion', x: t.x, z: t.z, big: true })
      this.fxQueue.push({ kind: 'structureDown', x: t.x, z: t.z })
      this.fxQueue.push({ kind: 'decal', x: t.x, z: t.z, size: 5 })
      this.fxQueue.push({ kind: 'kill', big: true })
      this.emit({ type: 'toast', text: 'Bunker demolished', kind: 'good' })
    }
  }

  // ---------------------------------------------------------------- update
  update(dt: number): void {
    if (this.state !== 'running') return
    this.time += dt
    this.aiCtx.time = this.time

    // hints (tutorial missions)
    const hints = this.mission.hints
    if (hints && this.hintIdx < hints.length && this.time >= this.nextHintAt) {
      this.emit({ type: 'hint', text: hints[this.hintIdx] })
      this.hintIdx++
      this.nextHintAt = this.time + 13
    }

    // record ghosts for render interpolation
    this.ghost(this.player)
    for (const e of this.enemies) this.ghost(e)

    this.updatePlayer(dt)
    this.updateEnemies(dt)
    this.updateShells(dt)
    this.updateWaves(dt)
    this.checkObjectives()
  }

  private ghost(t: Tank): void {
    t.prevX = t.x
    t.prevZ = t.z
    t.prevAngle = t.angle
    t.prevTurret = t.turretAngle
  }

  private updatePlayer(dt: number): void {
    const p = this.player
    if (!p.alive) return
    const prof = (p as Tank & { moveProf?: { speed: number; accel: number; turnRate: number; turretRate: number } })
      .moveProf!
    const inp = this.input

    // ability
    const ab = p.ability!
    ab.cd = Math.max(0, ab.cd - dt)
    if (ab.activeT > 0) {
      ab.activeT -= dt
      if (ab.id === 'repair') p.hp = Math.min(p.maxHp, p.hp + p.status.healPerSec * dt)
      if (ab.activeT <= 0) {
        p.status.speedMult = 1
        p.status.reloadMult = 1
        p.status.takenMult = 1
        p.status.healPerSec = 0
        if (p.status.nextShotMult !== 1) {
          p.status.nextShotMult = 1
          p.status.pierceBonus = 0
        }
      }
    }
    if (inp.ability && ab.cd <= 0 && ab.activeT <= 0) {
      const def = ABILITIES[ab.id]
      ab.cd = def.cooldown
      ab.activeT = def.duration
      switch (ab.id) {
        case 'overdrive':
          p.status.speedMult = ABILITY.overdrive.speedMult
          p.status.reloadMult = ABILITY.overdrive.reloadMult
          break
        case 'repair':
          p.status.healPerSec = (p.maxHp * ABILITY.repair.healFraction) / def.duration
          break
        case 'focus':
          p.status.nextShotMult = ABILITY.focus.damageMult
          p.status.pierceBonus = 10
          break
        case 'aegis':
          p.status.takenMult = ABILITY.aegis.takenMult
          break
      }
      this.emit({ type: 'toast', text: def.name + ' activated', kind: 'info' })
    }

    // hull movement
    const maxSpeed = prof.speed * p.status.speedMult
    let target = inp.throttle * maxSpeed
    if (inp.brake) target = 0
    const accel = prof.accel * (inp.brake ? 1.8 : 1)
    if (p.speed < target) p.speed = Math.min(target, p.speed + accel * dt)
    else p.speed = Math.max(target, p.speed - accel * dt)
    const turnEff = Math.abs(p.speed) < 0.5 ? 0.62 : 1
    p.angle += inp.steer * prof.turnRate * dt * turnEff

    p.x += Math.cos(p.angle) * p.speed * dt
    p.z += Math.sin(p.angle) * p.speed * dt
    const c = { x: p.x, z: p.z, r: p.radius }
    this.world.resolveCircle(c)
    p.x = c.x
    p.z = c.z

    // turret aim
    const desired = Math.atan2(inp.aimZ - p.z, inp.aimX - p.x)
    p.turretAngle = rotateToward(p.turretAngle, desired, prof.turretRate * dt)
    p.aimX = inp.aimX
    p.aimZ = inp.aimZ

    // fire
    p.reloadT = Math.max(0, p.reloadT - dt)
    if (inp.fire && p.reloadT <= 0) this.fireWeapon(p, inp.aimX, inp.aimZ)

    // velocity bookkeeping (AI lead + render)
    p.vx = (p.x - p.prevX) / dt
    p.vz = (p.z - p.prevZ) / dt
    p.hitFlash = Math.max(0, p.hitFlash - dt)
    p.muzzleT = Math.max(0, p.muzzleT - dt)
    p.recoilT = Math.max(0, p.recoilT - dt)
    p.telegraphT = 0

    // tread marks
    this.treadTimer -= dt
    if (Math.abs(p.speed) > 2 && this.treadTimer <= 0) {
      this.treadTimer = 0.3
      const bx = p.x - Math.cos(p.angle) * p.radius * 0.6
      const bz = p.z - Math.sin(p.angle) * p.radius * 0.6
      this.fxQueue.push({ kind: 'treadmark', x: bx, z: bz, angle: p.angle })
    }
  }

  private updateEnemies(dt: number): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      if (!e.alive) {
        this.enemies.splice(i, 1)
        continue
      }
      updateAI(e, this.aiCtx, dt)
      e.x += Math.cos(e.angle) * e.speed * dt
      e.z += Math.sin(e.angle) * e.speed * dt
      const c = { x: e.x, z: e.z, r: e.radius }
      this.world.resolveCircle(c)
      e.x = c.x
      e.z = c.z
      e.vx = (e.x - e.prevX) / dt
      e.vz = (e.z - e.prevZ) / dt
      e.reloadT = Math.max(0, e.reloadT - dt)
      e.hitFlash = Math.max(0, e.hitFlash - dt)
      e.muzzleT = Math.max(0, e.muzzleT - dt)
      e.recoilT = Math.max(0, e.recoilT - dt)
      e.telegraphT = Math.max(0, e.telegraphT - dt)
      if (e.telegraphT <= 0 && e.ai) e.ai.telegraphT = 0
    }
    this.separate()
    // wave-cleared timestamp for eliminate missions
    if (this.mission.objective.type === 'eliminate' && this.enemies.length === 0) {
      if (this.clearedAt === 0 || this.time - this.clearedAt > 1) this.clearedAt = this.time
    }
  }

  private separate(): void {
    const tanks = this.enemies
    for (let i = 0; i < tanks.length; i++) {
      const a = tanks[i]
      for (let j = i + 1; j < tanks.length; j++) {
        this.pushApart(a, tanks[j])
      }
      if (this.player.alive) this.pushApart(a, this.player)
    }
  }

  private pushApart(a: Tank, b: Tank): void {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const minD = (a.radius + b.radius) * TANK_SEPARATION
    const d2 = dx * dx + dz * dz
    if (d2 >= minD * minD || d2 < 1e-6) return
    const d = Math.sqrt(d2)
    const push = ((minD - d) / d) * 0.5
    a.x -= dx * push
    a.z -= dz * push
    b.x += dx * push
    b.z += dz * push
  }

  private updateShells(dt: number): void {
    const half = this.world.half
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]
      s.px = s.x
      s.pz = s.z
      s.x += s.vx * dt
      s.z += s.vz * dt
      s.life -= dt

      let dead = s.life <= 0
      // arena bounds
      if (!dead && (Math.abs(s.x) > half - 0.6 || Math.abs(s.z) > half - 0.6)) {
        this.impact(s, s.x, s.z, null)
        dead = true
      }
      // cover props
      if (!dead) {
        for (const p of this.world.props) {
          if (this.world.segmentHitsBox(s.px, s.pz, s.x, s.z, p)) {
            const bx = s.px + (s.x - s.px) * 0.5
            const bz = s.pz + (s.z - s.pz) * 0.5
            const bunker = this.targets.find((t) => t.alive && t.x === p.x && t.z === p.z)
            if (bunker && s.team === 'player') {
              this.damageBunker(bunker, s.dmg, bx, bz)
            } else {
              this.fxQueue.push({ kind: 'impact', x: bx, z: bz })
            }
            this.splash(s, bx, bz)
            dead = true
            break
          }
        }
      }
      // tanks
      if (!dead) {
        const victims: Tank[] = s.team === 'player' ? this.enemies : this.player.alive ? [this.player] : []
        let bestT = Infinity
        let bestTank: Tank | null = null
        for (const v of victims) {
          if (!v.alive || s.hitIds.indexOf(v.id) >= 0) continue
          _hitCircle.x = v.x
          _hitCircle.z = v.z
          _hitCircle.r = v.radius + SHELL_HIT_RADIUS
          const t = this.world.segmentHitsCircle(s.px, s.pz, s.x, s.z, _hitCircle)
          if (t >= 0 && t < bestT) {
            bestT = t
            bestTank = v
          }
        }
        if (bestTank) {
          const hx = s.px + (s.x - s.px) * bestT
          const hz = s.pz + (s.z - s.pz) * bestT
          const len = Math.max(0.001, Math.hypot(s.vx, s.vz))
          const norm = WEAPONS[s.weaponId]?.normalizes ?? false
          const res = resolveShellHit(s.dmg, s.vx / len, s.vz / len, bestTank.angle, bestTank.armor, norm, this.rng)
          if (res.ricochet) {
            this.fxQueue.push({
              kind: 'ricochet',
              x: hx,
              z: hz,
              byPlayer: s.team === 'player',
            })
            this.fxQueue.push({
              kind: 'dmgnum',
              x: hx,
              z: hz,
              value: 0,
              zone: res.zone,
              ricochet: true,
            })
            if (s.team === 'player') this.emit({ type: 'ricochet', byPlayer: true })
          } else {
            const byPlayer = s.team === 'player'
            this.applyDamage(bestTank, res.damage, res.zone, hx, hz, byPlayer)
          }
          s.hitIds.push(bestTank.id)
          this.splash(s, hx, hz)
          if (s.pierce > 0) {
            s.pierce--
          } else {
            dead = true
          }
        }
      }
      if (dead) this.recycleShell(i)
    }
  }

  private splash(s: Shell, x: number, z: number): void {
    if (s.splash <= 0) return
    const victims: Tank[] = s.team === 'player' ? this.enemies : this.player.alive ? [this.player] : []
    for (const v of victims) {
      if (!v.alive) continue
      const d = dist(x, z, v.x, v.z)
      const dmg = splashDamageAt(d, s.splash, s.dmg, s.falloff)
      if (dmg > 0) this.applyDamage(v, dmg * v.armor.side, 'side', v.x, v.z, s.team === 'player')
    }
  }

  private impact(_s: Shell, x: number, z: number, _t: null): void {
    this.fxQueue.push({ kind: 'impact', x, z })
  }

  // ---------------------------------------------------------------- objectives
  private checkObjectives(): void {
    if (!this.player.alive) {
      this.state = 'defeat'
      return
    }
    const obj = this.mission.objective
    if (obj.type === 'survive' && this.time >= (obj.duration ?? 60)) {
      this.state = 'victory'
      return
    }
    if (obj.type === 'destroy' && this.destroyedTargets >= (obj.count ?? 3)) {
      this.state = 'victory'
      return
    }
    if (obj.type === 'boss') {
      const boss = this.enemies.find((e) => e.kindId === 'boss')
      if (!boss && this.spawnedCount > 2) {
        this.state = 'victory'
        return
      }
    }
    if (obj.type === 'eliminate' && this.spawnedAll && this.enemies.length === 0) {
      this.state = 'victory'
      return
    }
  }

  objectiveProgress(): number {
    const obj = this.mission.objective
    if (obj.type === 'survive') return clamp(this.time / (obj.duration ?? 60), 0, 1)
    if (obj.type === 'destroy') return clamp(this.destroyedTargets / (obj.count ?? 3), 0, 1)
    if (obj.type === 'boss') {
      const boss = this.enemies.find((e) => e.kindId === 'boss')
      return boss ? clamp(1 - boss.hp / boss.maxHp, 0, 1) : 0
    }
    return this.totalToSpawn > 0 ? clamp(this.killedCount / this.totalToSpawn, 0, 1) : 0
  }

  objectiveText(): string {
    const obj = this.mission.objective
    if (obj.type === 'survive') {
      const left = Math.max(0, Math.ceil((obj.duration ?? 60) - this.time))
      return `Survive — hold out ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
    }
    if (obj.type === 'destroy') return `Demolish bunkers (${this.destroyedTargets}/${obj.count ?? 3})`
    if (obj.type === 'boss') {
      const boss = this.enemies.find((e) => e.kindId === 'boss')
      return boss ? `Destroy GOLIATH — ${Math.ceil((boss.hp / boss.maxHp) * 100)}%` : 'Destroy GOLIATH'
    }
    return `Eliminate raiders (${this.killedCount}/${this.totalToSpawn})`
  }

  getHud(): HudSnapshot {
    const p = this.player
    const ab = p.ability!
    const abDef = ABILITIES[ab.id]
    const waves = this.mission.waves.length
    return {
      hp: Math.max(0, Math.round(p.hp)),
      maxHp: p.maxHp,
      reload: Math.max(0, Math.min(1, 1 - p.reloadT / (p.weapon.reloadTime * p.status.reloadMult))),
      weapon: p.weapon.name,
      abilityCd: ab.cd > 0 ? ab.cd / abDef.cooldown : 0,
      abilityActive: ab.activeT > 0,
      abilityName: abDef.name,
      kills: this.stats.kills,
      credits: this.creditsEarned,
      wave: Math.min(this.waveIdx, waves),
      waveTotal: waves,
      enemiesLeft: this.enemies.length,
      objectiveText: this.objectiveText(),
      objectiveProgress: this.objectiveProgress(),
      timeSec: Math.floor(this.time),
      score: this.killedCount * 100 + Math.round(this.creditsEarned),
    }
  }

  getResult(): MissionResult {
    const victory = this.state === 'victory'
    const obj = this.mission.objective
    let par = PAR_SECS_BASE.eliminate + this.totalToSpawn * 12
    if (obj.type === 'survive') par = (obj.duration ?? 60) + 12
    else if (obj.type === 'destroy') par = PAR_SECS_BASE.destroy + (obj.count ?? 3) * 30
    else if (obj.type === 'boss') par = PAR_SECS_BASE.boss
    const parTime = par * STAR_TIME_FRACTION

    let credits = 0
    let xp = this.xpEarned
    if (victory) {
      credits = Math.round(this.creditsEarned + this.mission.rewards.credits * (this.firstClear ? FIRST_CLEAR_CREDIT_MULT : 1))
      xp += this.mission.rewards.xp + WIN_XP_BONUS
    } else {
      credits = Math.round(this.creditsEarned * LOSS_CREDIT_FRACTION)
      xp += DEFEAT_XP
    }

    let stars = 0
    if (victory) {
      stars = 1
      if (this.time <= parTime) stars++
      if (this.player.hp >= this.player.maxHp * STAR_HP_FRACTION) stars++
    }

    return {
      missionId: this.mission.id,
      victory,
      timeSec: Math.round(this.time),
      kills: this.stats.kills,
      shotsFired: this.stats.shotsFired,
      shotsHit: this.stats.hits,
      damageDealt: Math.round(this.stats.damageDealt),
      damageTaken: Math.round(this.stats.damageTaken),
      creditsEarned: credits,
      xpEarned: xp,
      firstClear: this.firstClear,
      stars,
      objectiveProgress: this.objectiveProgress(),
    }
  }

  parTimeSec(): number {
    const obj = this.mission.objective
    let par = PAR_SECS_BASE.eliminate + this.totalToSpawn * 12
    if (obj.type === 'survive') par = (obj.duration ?? 60) + 12
    else if (obj.type === 'destroy') par = PAR_SECS_BASE.destroy + (obj.count ?? 3) * 30
    else if (obj.type === 'boss') par = PAR_SECS_BASE.boss
    return Math.round(par * STAR_TIME_FRACTION)
  }
}
