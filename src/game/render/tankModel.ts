// NEXUS ARMOR — procedural tank models built from primitives (no external assets).
// Model faces +X; parent group uses rotation.y = -angle (see docs/ARCHITECTURE.md §4).
import * as THREE from 'three'
import type { TankDef } from '../core/types'

export interface TankView {
  group: THREE.Group
  turretPivot: THREE.Group
  barrel: THREE.Mesh
  barrelBaseX: number
  hullMat: THREE.MeshStandardMaterial
  turretMat: THREE.MeshStandardMaterial
  accentMat: THREE.MeshStandardMaterial
  flash: THREE.Sprite
  hpGroup: THREE.Group | null
  hpFg: THREE.Mesh | null
}

const geoCache: Record<string, THREE.BufferGeometry> = {}
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geoCache[key]) geoCache[key] = make()
  return geoCache[key]
}

const matCache = new Map<string, THREE.MeshStandardMaterial>()
export function sharedMat(color: number, opts?: { emissive?: number; roughness?: number; metalness?: number }): THREE.MeshStandardMaterial {
  const key = `${color}-${opts?.emissive ?? 0}-${opts?.roughness ?? 0.8}-${opts?.metalness ?? 0.25}`
  let m = matCache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts?.roughness ?? 0.8,
      metalness: opts?.metalness ?? 0.25,
      emissive: opts?.emissive ?? 0x000000,
    })
    matCache.set(key, m)
  }
  return m
}

export function buildTankView(def: {
  colors: { hull: number; turret: number; accent: number }
  scale: number
  radius: number
  isBoss?: boolean
}, textures: { flash: THREE.Texture; hpBg: THREE.Texture; hpFg: THREE.Texture }): TankView {
  const s = def.scale
  const group = new THREE.Group()

  const hullMat = new THREE.MeshStandardMaterial({ color: def.colors.hull, roughness: 0.82, metalness: 0.3 })
  const turretMat = new THREE.MeshStandardMaterial({ color: def.colors.turret, roughness: 0.85, metalness: 0.28 })
  const accentMat = new THREE.MeshStandardMaterial({ color: def.colors.accent, roughness: 0.6, metalness: 0.35 })
  const treadMat = sharedMat(0x24241f, { roughness: 0.95, metalness: 0.1 })

  // hull (faces +X): length along X
  const hull = new THREE.Mesh(geo('hull', () => new THREE.BoxGeometry(3.6, 0.85, 2.3)), hullMat)
  hull.position.y = 0.62
  hull.castShadow = true
  hull.receiveShadow = true
  group.add(hull)

  // sloped glacis (front +X)
  const glacis = new THREE.Mesh(geo('glacis', () => new THREE.BoxGeometry(0.9, 0.5, 2.0)), hullMat)
  glacis.position.set(1.85, 0.78, 0)
  glacis.rotation.z = -0.5
  glacis.castShadow = true
  group.add(glacis)

  // treads
  for (const side of [-1, 1]) {
    const tread = new THREE.Mesh(geo('tread', () => new THREE.BoxGeometry(3.9, 0.62, 0.62)), treadMat)
    tread.position.set(0, 0.31, side * 1.28)
    tread.castShadow = true
    tread.receiveShadow = true
    group.add(tread)
  }

  // turret pivot
  const turretPivot = new THREE.Group()
  turretPivot.position.set(-0.15, 1.12, 0)
  group.add(turretPivot)

  const turret = new THREE.Mesh(geo('turret', () => new THREE.BoxGeometry(1.9, 0.6, 1.55)), turretMat)
  turret.position.set(0.2, 0.3, 0)
  turret.castShadow = true
  turretPivot.add(turret)

  const bustle = new THREE.Mesh(geo('bustle', () => new THREE.BoxGeometry(0.7, 0.45, 1.2)), turretMat)
  bustle.position.set(-0.75, 0.28, 0)
  bustle.castShadow = true
  turretPivot.add(bustle)

  const hatch = new THREE.Mesh(geo('hatch', () => new THREE.CylinderGeometry(0.22, 0.24, 0.16, 12)), accentMat)
  hatch.position.set(-0.1, 0.66, -0.35)
  turretPivot.add(hatch)

  // barrel (points +X), slides back on recoil
  const barrelLen = def.isBoss ? 3.0 : 2.3
  const barrel = new THREE.Mesh(
    geo('barrel', () => new THREE.CylinderGeometry(0.09, 0.11, 1, 10)),
    sharedMat(0x2e2e2a, { roughness: 0.6, metalness: 0.5 }),
  )
  barrel.scale.set(1, barrelLen, 1)
  barrel.rotation.z = -Math.PI / 2
  barrel.position.set(1.0 + barrelLen / 2, 0.32, 0)
  barrel.castShadow = true
  turretPivot.add(barrel)

  const muzzleBrake = new THREE.Mesh(
    geo('brake', () => new THREE.BoxGeometry(0.3, 0.2, 0.2)),
    accentMat,
  )
  muzzleBrake.position.set(1.0 + barrelLen - 0.1, 0.32, 0)
  turretPivot.add(muzzleBrake)

  // muzzle flash sprite (hidden by default)
  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: textures.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  )
  flash.scale.setScalar(0.001)
  flash.position.set(1.0 + barrelLen + 0.2, 0.32, 0)
  turretPivot.add(flash)

  // health bar (enemies only; shown when damaged)
  let hpGroup: THREE.Group | null = null
  let hpFg: THREE.Mesh | null = null
  if (def.isBoss || def.scale < 1.6) {
    hpGroup = new THREE.Group()
    hpGroup.position.y = 2.6 * s
    const bg = new THREE.Mesh(geo('hpbg', () => new THREE.PlaneGeometry(1, 0.14)), new THREE.MeshBasicMaterial({ map: textures.hpBg, transparent: true, depthWrite: false }))
    hpGroup.add(bg)
    hpFg = new THREE.Mesh(geo('hpfg', () => new THREE.PlaneGeometry(1, 0.14)), new THREE.MeshBasicMaterial({ map: textures.hpFg, transparent: true, depthWrite: false }))
    hpFg.position.z = 0.001
    hpGroup.add(hpFg)
    hpGroup.visible = false
    group.add(hpGroup)
  }

  group.scale.setScalar(s)
  return { group, turretPivot, barrel, barrelBaseX: 1.0 + barrelLen / 2, hullMat, turretMat, accentMat, flash, hpGroup, hpFg }
}
