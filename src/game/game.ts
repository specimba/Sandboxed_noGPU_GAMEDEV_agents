// NEXUS ARMOR — Game orchestrator: rAF loop, fixed-step accumulator, hit-stop,
// fx routing, adaptive quality, idle showcase mode. The single object React talks to.
import * as THREE from 'three'
import type { GameEvent, HudSnapshot, PlayerInput, QualityTier, UpgradeLevels } from './core/types'
import { MAX_STEPS_PER_FRAME, STEP } from './config/balance'
import { MISSION_BY_ID } from './config/missions'
import { BattleSim } from './sim/battle'
import { SceneManager } from './render/scene'
import { Effects } from './render/effects'
import { BattleView } from './render/battleView'
import { Minimap } from './render/minimap'
import { InputSystem } from './systems/input'
import { AudioSystem } from './systems/audio'
import { CameraRig } from './systems/cameraRig'
import { QualityManager } from './systems/quality'
import { buildTankView, type TankView } from './render/tankModel'
import { makeFlashTexture, makeHealthBarTexture } from './render/textures'
import { TANK_BY_ID } from './config/tanks'
import { QUALITY } from './config/balance'

export interface GameStats {
  fps: number
  ms: number
  calls: number
  tris: number
  enemies: number
  shells: number
  particles: number
  tier: QualityTier
}

export interface GameOpts {
  canvas: HTMLCanvasElement
  minimapCanvas: HTMLCanvasElement
  fxLayer: HTMLElement
  onEvent: (e: GameEvent) => void
}

export class Game {
  scene: SceneManager
  effects: Effects
  audio = new AudioSystem()
  input = new InputSystem()
  minimap: Minimap
  quality: QualityManager
  private cam: CameraRig
  private onEvent: (e: GameEvent) => void
  private fxLayer: HTMLElement
  private canvas: HTMLCanvasElement

  sim: BattleSim | null = null
  private view: BattleView | null = null
  private idleSim: BattleSim | null = null
  private idleTankView: TankView | null = null
  mode: 'idle' | 'battle' = 'idle'
  paused = false
  battleOver = false

  private raf = 0
  private lastT = 0
  private acc = 0
  private hitstop = 0
  private hudTimer = 0
  private fpsEma = 60
  private frameMs = 16
  private settings = { shake: true, damageNumbers: true, reducedMotion: false }
  private running = true
  private resizeHandler: () => void

  constructor(opts: GameOpts) {
    this.canvas = opts.canvas
    this.onEvent = opts.onEvent
    this.fxLayer = opts.fxLayer
    this.scene = new SceneManager(opts.canvas)
    this.effects = new Effects(this.scene.scene)
    this.cam = new CameraRig(this.scene.camera)
    this.minimap = new Minimap(opts.minimapCanvas)
    this.quality = new QualityManager('auto', (tier) => this.applyTier(tier))
    this.applyTier(this.quality.tier)

    this.input.attach(opts.canvas)
    this.resizeHandler = () => this.resize()
    window.addEventListener('resize', this.resizeHandler)
    this.resize()

    // idle showcase world (menu background)
    this.buildIdle()
    this.lastT = performance.now() / 1000
    this.raf = requestAnimationFrame(this.frame)
  }

  private buildIdle(): void {
    const m = MISSION_BY_ID.m01
    this.idleSim = new BattleSim({
      mission: m,
      tankId: 'medium',
      upgrades: { firepower: 0, mobility: 0, protection: 0 },
      firstClear: false,
      emit: () => {},
    })
    this.scene.setMap(this.idleSim.map, this.idleSim.world.props, this.idleSim.propTypes)
    this.setIdleTank('medium')
  }

  /** swap the showcased tank in the menu hangar */
  setIdleTank(tankId: string): void {
    if (this.idleTankView) {
      this.scene.scene.remove(this.idleTankView.group)
      this.idleTankView = null
    }
    const def = TANK_BY_ID[tankId] ?? TANK_BY_ID.scout
    const flashTex = makeFlashTexture()
    const hp = makeHealthBarTexture()
    const view = buildTankView({ colors: def.colors, scale: def.scale * 1.35, radius: def.radius }, {
      flash: flashTex,
      hpBg: hp.bg,
      hpFg: hp.fg,
    })
    view.group.position.set(0, 0, 0)
    this.scene.scene.add(view.group)
    this.idleTankView = view
  }

  private applyTier(tier: QualityTier): void {
    this.scene.setQuality(tier)
    const dpr = Math.min(window.devicePixelRatio || 1, QUALITY[tier].dprCap)
    this.scene.setPixelRatio(dpr)
    this.effects.particleCap = QUALITY[tier].particles
    this.resize()
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.scene.resize(w, h)
    this.minimap.resize()
    if (this.sim) this.minimap.prerenderStatic(this.sim)
  }

  // ------------------------------------------------------------ battle control
  startMission(missionId: string, tankId: string, upgrades: UpgradeLevels, firstClear: boolean): boolean {
    const mission = MISSION_BY_ID[missionId]
    if (!mission) return false
    this.teardownBattle()

    this.sim = new BattleSim({
      mission,
      tankId,
      upgrades,
      firstClear,
      emit: (e) => this.onEvent(e),
    })
    this.scene.setMap(this.sim.map, this.sim.world.props, this.sim.propTypes)
    this.effects.clearTransient()
    this.view = new BattleView(this.sim, this.scene.scene, this.scene.camera, this.fxLayer)
    this.view.telegraphFn = (i, v, x0, z0, x1, z1) => this.effects.setTelegraph(i, v, x0, z0, x1, z1)
    this.view.setDamageNumbers(this.settings.damageNumbers)
    this.minimap.prerenderStatic(this.sim)

    this.mode = 'battle'
    this.paused = false
    this.battleOver = false
    this.acc = 0
    this.hitstop = 0
    this.input.enabled = true
    this.input.releaseAll()
    this.cam.snap(this.sim.player.x, this.sim.player.z)
    this.scene.setReticle(true, this.sim.player.x, this.sim.player.z - 8)
    this.emitHud()
    return true
  }

  private teardownBattle(): void {
    if (this.view) {
      this.view.dispose()
      this.view = null
    }
    this.sim = null
    this.scene.setReticle(false)
    this.input.enabled = false
    this.input.releaseAll()
  }

  quitToMenu(): void {
    this.teardownBattle()
    this.mode = 'idle'
    this.paused = false
    this.battleOver = false
    this.effects.clearTransient()
    this.audio.setEngine(0, false)
  }

  pause(): void {
    if (this.mode !== 'battle' || this.battleOver) return
    this.paused = true
    this.input.releaseAll()
    this.audio.setEngine(0, false)
  }

  resume(): void {
    if (this.mode !== 'battle') return
    this.paused = false
    this.lastT = performance.now() / 1000
  }

  // ------------------------------------------------------------ settings
  applySettings(s: { shake: boolean; damageNumbers: boolean; reducedMotion: boolean; volume: number; quality: 'auto' | QualityTier }): void {
    this.settings.shake = s.shake
    this.settings.damageNumbers = s.damageNumbers
    this.settings.reducedMotion = s.reducedMotion
    this.cam.shakeEnabled = s.shake && !s.reducedMotion
    this.audio.setVolume(s.volume)
    this.quality.setSetting(s.quality)
    this.view?.setDamageNumbers(s.damageNumbers)
  }

  // ------------------------------------------------------------ loop
  private frame = (tMs: number): void => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.frame)
    const now = tMs / 1000
    const dtReal = Math.min(0.25, Math.max(0.0001, now - this.lastT))
    this.lastT = now
    const t0 = performance.now()

    if (this.mode === 'battle' && this.sim) {
      if (!this.paused) {
        if (this.hitstop > 0 && !this.settings.reducedMotion) {
          this.hitstop -= dtReal
        } else {
          this.updateAim()
          this.acc += dtReal
          let steps = 0
          while (this.acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
            this.sim.update(STEP)
            this.acc -= STEP
            steps++
            if (this.sim.state !== 'running') break
          }
          if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0 // panic resync after stall
        }
        const alpha = Math.max(0, Math.min(1, this.acc / STEP))
        const p = this.sim.player
        const px = p.prevX + (p.x - p.prevX) * alpha
        const pz = p.prevZ + (p.z - p.prevZ) * alpha
        this.cam.update(dtReal, px, pz, p.aimX, p.aimZ)
        this.scene.followSun(px, pz)
        this.scene.setReticle(true, p.aimX, p.aimZ)
        this.view?.sync(alpha)
        this.view?.updateFloats(dtReal, false)
        this.effects.update(dtReal)
        this.drainFx()
        this.minimap.draw(this.sim)
        this.audio.setEngine(Math.min(1, Math.abs(p.speed) / 14), Math.abs(p.speed) > 0.5)

        this.hudTimer -= dtReal
        if (this.hudTimer <= 0) {
          this.hudTimer = 0.1
          this.emitHud()
        }
        if (this.sim.state !== 'running' && !this.battleOver) this.endBattle()
      } else {
        this.view?.updateFloats(dtReal, true)
      }
    } else {
      // idle showcase
      this.cam.idle(now)
      if (this.idleTankView) this.idleTankView.group.rotation.y = -now * 0.35
      this.effects.update(dtReal)
      this.audio.setEngine(0, false)
    }

    this.scene.renderer.render(this.scene.scene, this.scene.camera)
    this.frameMs = performance.now() - t0
    this.fpsEma += (1 / dtReal - this.fpsEma) * 0.05
    this.quality.update(dtReal, this.frameMs)
  }

  private updateAim(): void {
    const sim = this.sim
    if (!sim) return
    const inp: PlayerInput = sim.input
    const keys = this.input.collect()
    inp.throttle = keys.throttle
    inp.steer = keys.steer
    inp.fire = keys.fire
    inp.brake = keys.brake
    inp.ability = keys.ability

    const dir = this.input.touchAimDir()
    if (dir) {
      inp.aimX = sim.player.x + dir.x * 16
      inp.aimZ = sim.player.z + dir.z * 16
    } else {
      // mouse: raycast onto ground plane y=0
      const ndc = this.input.aimNDC
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.scene.camera)
      const o = ray.ray.origin
      const d = ray.ray.direction
      if (Math.abs(d.y) > 1e-5) {
        const t = -o.y / d.y
        if (t > 0) {
          inp.aimX = o.x + d.x * t
          inp.aimZ = o.z + d.z * t
        }
      }
    }
  }

  private drainFx(): void {
    const sim = this.sim
    if (!sim) return
    const q = sim.fxQueue
    for (let i = 0; i < q.length; i++) {
      const fx = q[i]
      switch (fx.kind) {
        case 'muzzle':
          this.audio.playWeapon(fx.sound, fx.big)
          this.effects.muzzle(fx.x, fx.z, fx.angle, fx.big)
          break
        case 'explosion':
          this.effects.explosion(fx.x, fx.z, fx.big)
          this.audio.explosion(fx.big)
          break
        case 'impact':
          this.effects.impact(fx.x, fx.z)
          this.audio.impact()
          break
        case 'ricochet':
          this.effects.ricochet(fx.x, fx.z)
          this.audio.ping()
          break
        case 'dmgnum':
          if (fx.ricochet) this.view?.spawnFloat(fx.x, fx.z, 'RICOCHET', 'na-dmg-rico')
          else this.view?.spawnFloat(fx.x, fx.z, String(fx.value), fx.value >= 45 ? 'na-dmg-big' : 'na-dmg-norm')
          break
        case 'decal':
          this.effects.decal(fx.x, fx.z, fx.size)
          break
        case 'treadmark':
          this.effects.treadmark(fx.x, fx.z, fx.angle)
          break
        case 'spawn':
          this.effects.spawnFlash(fx.x, fx.z)
          break
        case 'structureDown':
          this.audio.explosion(true)
          break
        case 'kill':
          if (!this.settings.reducedMotion) this.hitstop = fx.big ? 0.09 : 0.055
          this.cam.kick(fx.big ? 0.4 : 0.22)
          break
        case 'shake':
          this.cam.kick(fx.amp)
          break
      }
    }
    q.length = 0
  }

  private emitHud(): void {
    if (!this.sim) return
    const snap: HudSnapshot = this.sim.getHud()
    this.onEvent({ type: 'hud', snapshot: snap })
  }

  private endBattle(): void {
    if (!this.sim) return
    this.battleOver = true
    const result = this.sim.getResult()
    this.input.enabled = false
    this.audio.setEngine(0, false)
    if (result.victory) this.audio.victory()
    else this.audio.defeat()
    this.onEvent({ type: 'battleEnd', payload: result })
  }

  getStats(): GameStats {
    return {
      fps: Math.round(this.fpsEma),
      ms: Math.round(this.frameMs * 10) / 10,
      calls: this.scene.drawCalls,
      tris: this.scene.triangles,
      enemies: this.sim ? this.sim.enemies.length : 0,
      shells: this.sim ? this.sim.shells.length : 0,
      particles: this.effects.sparks.count + this.effects.smoke.count,
      tier: this.quality.tier,
    }
  }

  dispose(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.resizeHandler)
    this.input.detach()
    this.teardownBattle()
    if (this.idleTankView) this.scene.scene.remove(this.idleTankView.group)
    this.audio.dispose()
    this.scene.dispose()
  }
}
