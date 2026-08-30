// NEXUS ARMOR — BattleView: syncs BattleSim state to Three.js objects with
// interpolation, pooled tank views, floating damage numbers (pooled DOM), health bars.
import * as THREE from 'three'
import type { BattleSim } from '../sim/battle'
import type { Tank } from '../sim/entities'
import { TANK_BY_ID } from '../config/tanks'
import { ENEMY_BY_ID } from '../config/enemies'
import { buildTankView, type TankView } from './tankModel'
import { makeFlashTexture, makeHealthBarTexture } from './textures'
import { MAX_FLOATING_TEXT } from '../config/balance'
import type { TargetStructure } from '../sim/entities'

interface FloatText {
  el: HTMLDivElement
  x: number
  y: number
  z: number
  life: number
  vy: number
  active: boolean
}

export class BattleView {
  private sim: BattleSim
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private fxLayer: HTMLElement
  private views = new Map<number, TankView>()
  private tankPool: TankView[] = []
  private structureViews: { group: THREE.Group; core: THREE.Mesh }[] = []
  private floats: FloatText[] = []
  private hpTex: { bg: THREE.Texture; fg: THREE.Texture }
  private flashTex: THREE.Texture
  private showDamage = true
  private tmpColor = new THREE.Color()

  constructor(sim: BattleSim, scene: THREE.Scene, camera: THREE.PerspectiveCamera, fxLayer: HTMLElement) {
    this.sim = sim
    this.scene = scene
    this.camera = camera
    this.fxLayer = fxLayer
    this.flashTex = makeFlashTexture()
    this.hpTex = makeHealthBarTexture()

    for (let i = 0; i < MAX_FLOATING_TEXT; i++) {
      const el = document.createElement('div')
      el.className = 'na-dmg'
      el.style.display = 'none'
      fxLayer.appendChild(el)
      this.floats.push({ el, x: 0, y: 0, z: 0, life: 0, vy: 0, active: false })
    }
    this.buildStructures()
  }

  setDamageNumbers(v: boolean): void {
    this.showDamage = v
  }

  private buildStructures(): void {
    for (const t of this.sim.targets) {
      const group = new THREE.Group()
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(t.hx * 2, 2.1, t.hz * 2),
        new THREE.MeshStandardMaterial({ color: 0x4d4a44, roughness: 0.9, metalness: 0.2 }),
      )
      base.position.y = 1.05
      base.castShadow = true
      base.receiveShadow = true
      group.add(base)
      const core = new THREE.Mesh(
        new THREE.BoxGeometry(t.hx * 1.1, 0.55, t.hz * 1.1),
        new THREE.MeshStandardMaterial({ color: 0xff8c3a, emissive: 0xff5a1a, emissiveIntensity: 1.6, roughness: 0.5 }),
      )
      core.position.y = 2.35
      group.add(core)
      group.position.set(t.x, 0, t.z)
      this.scene.add(group)
      this.structureViews.push({ group, core })
    }
  }

  private acquireView(t: Tank): TankView {
    const pooled = this.tankPool.pop()
    if (pooled) {
      pooled.group.visible = true
      this.views.set(t.id, pooled)
      return pooled
    }
    let def: { colors: { hull: number; turret: number; accent: number }; scale: number; radius: number; isBoss?: boolean }
    if (t.team === 'player') {
      const d = TANK_BY_ID[t.kindId]
      def = { colors: d.colors, scale: d.scale, radius: d.radius }
    } else {
      const d = ENEMY_BY_ID[t.kindId as keyof typeof ENEMY_BY_ID]
      def = { colors: d.colors, scale: d.scale, radius: d.radius, isBoss: t.kindId === 'boss' }
    }
    const view = buildTankView(def, { flash: this.flashTex, hpBg: this.hpTex.bg, hpFg: this.hpTex.fg })
    this.scene.add(view.group)
    this.views.set(t.id, view)
    return view
  }

  private releaseView(id: number, _explode: boolean): void {
    const v = this.views.get(id)
    if (!v) return
    this.views.delete(id)
    v.group.visible = false
    if (v.hpGroup) v.hpGroup.visible = false
    this.tankPool.push(v)
  }

  /** called once per rendered frame with interpolation alpha in [0,1] */
  sync(alpha: number): void {
    const sim = this.sim

    // sync player + enemies
    const all: Tank[] = sim.player.alive || this.views.has(sim.player.id) ? [sim.player, ...sim.enemies] : sim.enemies
    for (const t of all) {
      if (!t.alive) {
        if (this.views.has(t.id)) this.releaseView(t.id, true)
        continue
      }
      let v = this.views.get(t.id)
      if (!v) v = this.acquireView(t)

      const x = t.prevX + (t.x - t.prevX) * alpha
      const z = t.prevZ + (t.z - t.prevZ) * alpha
      const g = v.group
      g.position.set(x, 0, z)
      // interpolate angles shortest-path
      let dA = t.angle - t.prevAngle
      if (dA > Math.PI) dA -= Math.PI * 2
      if (dA < -Math.PI) dA += Math.PI * 2
      g.rotation.y = -(t.prevAngle + dA * alpha)
      let dT = t.turretAngle - t.prevTurret
      if (dT > Math.PI) dT -= Math.PI * 2
      if (dT < -Math.PI) dT += Math.PI * 2
      const worldTurret = t.prevTurret + dT * alpha
      v.turretPivot.rotation.y = -(worldTurret - (t.prevAngle + dA * alpha))

      // barrel recoil
      const recoil = t.recoilT > 0 ? Math.sin((t.recoilT / 0.28) * Math.PI) * 0.22 : 0
      v.barrel.position.x = v.barrelBaseX - recoil

      // muzzle flash
      if (t.muzzleT > 0) {
        const s = (t.kindId === 'heavy' || t.kindId === 'boss' ? 3.2 : 1.8) * (t.muzzleT / 0.07)
        v.flash.scale.setScalar(s)
      } else {
        v.flash.scale.setScalar(0.001)
      }

      // hit flash
      const flash = t.hitFlash > 0
      const hullEmissive = flash ? 0x990000 : 0x000000
      if (v.hullMat.emissive.getHex() !== hullEmissive) {
        v.hullMat.emissive.setHex(hullEmissive)
        v.turretMat.emissive.setHex(hullEmissive)
      }

      // health bars (enemies)
      if (v.hpGroup && v.hpFg) {
        const damaged = t.hp < t.maxHp - 0.5
        v.hpGroup.visible = damaged
        if (damaged) {
          const frac = Math.max(0, t.hp / t.maxHp)
          v.hpFg.scale.x = frac
          v.hpFg.position.x = -(1 - frac) / 2
          // color shift green→red
          this.tmpColor.setHSL(0.33 * frac, 0.75, 0.5)
          ;(v.hpFg.material as THREE.MeshBasicMaterial).color.copy(this.tmpColor)
          v.hpGroup.rotation.y = -g.rotation.y // counter-rotate to face camera
        }
      }
    }

    // structures
    this.sim.targets.forEach((t: TargetStructure, i: number) => {
      const sv = this.structureViews[i]
      if (!sv) return
      if (!t.alive) {
        sv.group.visible = false
        return
      }
      const frac = Math.max(0.05, t.hp / t.maxHp)
      const mat = sv.core.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = 0.6 + frac * 1.4 + Math.sin(performance.now() * 0.004 + i) * 0.25
      sv.core.scale.setScalar(0.4 + frac * 0.6)
    })

    // enemy telegraph lines
    let teleIdx = 0
    for (const e of sim.enemies) {
      if (e.telegraphT > 0 && e.ai) {
        this.syncTelegraph(teleIdx++, e)
      }
    }
    while (teleIdx < 12) {
      this.hideTelegraph(teleIdx++)
    }
  }

  private syncTelegraph(idx: number, e: Tank): void {
    // find pooled telegraph from Effects is awkward from here; game.ts wires Effects.
    // We store a callback instead.
    if (this.telegraphFn) this.telegraphFn(idx, true, e.x, e.z, e.aimX, e.aimZ)
  }

  private hideTelegraph(idx: number): void {
    if (this.telegraphFn) this.telegraphFn(idx, false, 0, 0, 0, 0)
  }

  telegraphFn: ((idx: number, vis: boolean, x0: number, z0: number, x1: number, z1: number) => void) | null = null

  // ------------------------------------------------------------ floating text
  spawnFloat(x: number, z: number, text: string, cls: string): void {
    if (!this.showDamage) return
    const f = this.floats.find((ff) => !ff.active) ?? this.floats[0]
    f.active = true
    f.life = 0.9
    f.vy = 2.2
    f.x = x + (Math.random() - 0.5) * 0.8
    f.y = 2.4
    f.z = z + (Math.random() - 0.5) * 0.8
    f.el.textContent = text
    f.el.className = 'na-dmg ' + cls
    f.el.style.display = 'block'
  }

  updateFloats(dt: number, hideAll: boolean): void {
    const w = this.fxLayer.clientWidth
    const h = this.fxLayer.clientHeight
    for (const f of this.floats) {
      if (!f.active) continue
      f.life -= dt
      f.y += f.vy * dt
      f.vy *= 1 - dt * 1.5
      if (f.life <= 0 || hideAll) {
        f.active = false
        f.el.style.display = 'none'
        continue
      }
      // project world → screen
      const v = tmpV.set(f.x, f.y, f.z).project(this.camera)
      if (v.z > 1) {
        f.el.style.display = 'none'
        continue
      }
      const sx = (v.x * 0.5 + 0.5) * w
      const sy = (-v.y * 0.5 + 0.5) * h
      f.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%,-50%)`
      f.el.style.opacity = Math.min(1, f.life * 2).toFixed(2)
    }
  }

  clear(): void {
    for (const [id] of this.views) this.releaseView(id, false)
    this.views.clear()
    for (const f of this.floats) {
      f.active = false
      f.el.style.display = 'none'
    }
    for (const sv of this.structureViews) this.scene.remove(sv.group)
    this.structureViews = []
  }

  dispose(): void {
    this.clear()
    for (const v of this.tankPool) this.scene.remove(v.group)
    this.tankPool = []
    for (const f of this.floats) f.el.remove()
    this.flashTex.dispose()
  }
}

const tmpV = new THREE.Vector3()
