// NEXUS ARMOR — SceneManager: renderer, sky dome, lights, ground, instanced props,
// aim reticle, arena border. Owns nothing simulation-related.
import * as THREE from 'three'
import type { MapDef, QualityTier } from '../core/types'
import { QUALITY } from '../config/balance'
import type { PropKind } from '../sim/entities'
import { makeGroundTexture, makeReticleTexture } from './textures'

export class SceneManager {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  private sun: THREE.DirectionalLight
  private hemi: THREE.HemisphereLight
  private ground: THREE.Mesh
  private groundMat: THREE.MeshStandardMaterial
  private skyMat: THREE.ShaderMaterial
  private propMeshes: Record<PropKind, THREE.InstancedMesh> | null = null
  private reticle: THREE.Mesh
  private fog: THREE.FogExp2
  private mapSize = 130
  private tier: QualityTier = 'high'
  private borderMats: THREE.MeshStandardMaterial[] = []

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap

    this.scene = new THREE.Scene()
    this.fog = new THREE.FogExp2(0xd8c39a, 0.0055)
    this.scene.fog = this.fog

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 700)

    // lights
    this.hemi = new THREE.HemisphereLight(0xcfd8e0, 0x8a7a5a, 0.8)
    this.scene.add(this.hemi)
    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.5)
    this.sun.position.set(40, 60, 20)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.near = 10
    this.sun.shadow.camera.far = 180
    const sc = this.sun.shadow.camera
    sc.left = -55
    sc.right = 55
    sc.top = 55
    sc.bottom = -55
    this.sun.shadow.bias = -0.0004
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    // sky dome
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x86a7b8) },
        uBottom: { value: new THREE.Color(0xe8d9b0) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vPos;
        uniform vec3 uTop; uniform vec3 uBottom;
        void main() {
          float t = clamp(vPos.y / 220.0 + 0.25, 0.0, 1.0);
          gl_FragColor = vec4(mix(uBottom, uTop, t), 1.0);
        }`,
    })
    const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 24, 12), this.skyMat)
    this.scene.add(sky)

    // ground
    this.groundMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.02 })
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.groundMat)
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.scene.add(this.ground)

    // aim reticle
    this.reticle = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({
        map: makeReticleTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.9,
      }),
    )
    this.reticle.rotation.x = -Math.PI / 2
    this.reticle.position.y = 0.06
    this.reticle.visible = false
    this.scene.add(this.reticle)
  }

  /** (re)build map-specific environment */
  setMap(map: MapDef, props: { x: number; z: number; hx: number; hz: number }[], kinds: PropKind[]): void {
    this.mapSize = map.size
    const t = map.theme

    // ground
    const tex = makeGroundTexture(map)
    tex.repeat.set(map.size / 17, map.size / 17)
    if (this.groundMat.map) this.groundMat.map.dispose()
    this.groundMat.map = tex
    this.groundMat.color.setHex(0xffffff)
    this.groundMat.needsUpdate = true
    this.ground.scale.set(map.size, map.size, 1)

    // sky + fog + lights
    ;(this.skyMat.uniforms.uTop.value as THREE.Color).setHex(t.skyTop)
    ;(this.skyMat.uniforms.uBottom.value as THREE.Color).setHex(t.skyBottom)
    this.fog.color.setHex(t.fog)
    this.fog.density = t.fogDensity
    this.sun.color.setHex(t.sun)
    this.sun.intensity = t.sunIntensity
    this.hemi.intensity = t.ambientIntensity

    // border walls (visual; sim clamps by bounds)
    for (const m of this.borderMats) m.dispose()
    this.borderMats = []
    const wallMat = new THREE.MeshStandardMaterial({ color: t.props.wall, roughness: 0.9 })
    const wallH = 2.6
    const half = map.size / 2
    const wallDefs = [
      { x: 0, z: -half, sx: map.size, sz: 2 },
      { x: 0, z: half, sx: map.size, sz: 2 },
      { x: -half, z: 0, sx: 2, sz: map.size },
      { x: half, z: 0, sx: 2, sz: map.size },
    ]
    for (const w of wallDefs) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w.sx, wallH, w.sz), wallMat)
      m.position.set(w.x, wallH / 2, w.z)
      m.castShadow = true
      m.receiveShadow = true
      this.scene.add(m)
      this.borderMats.push(wallMat)
    }

    // instanced props
    if (this.propMeshes) {
      for (const k of Object.keys(this.propMeshes) as PropKind[]) {
        this.scene.remove(this.propMeshes[k])
        this.propMeshes[k].dispose()
      }
    }
    const counts: Record<PropKind, number> = { crate: 0, wall: 0, rock: 0 }
    for (const k of kinds) counts[k]++
    const geoms: Record<PropKind, THREE.BufferGeometry> = {
      crate: new THREE.BoxGeometry(1, 1, 1),
      wall: new THREE.BoxGeometry(1, 1, 1),
      rock: new THREE.BoxGeometry(1, 1, 1),
    }
    const heights: Record<PropKind, number> = { crate: 1.7, wall: 2.5, rock: 2.0 }
    const meshes: Record<PropKind, THREE.InstancedMesh> = {
      crate: new THREE.InstancedMesh(geoms.crate, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), Math.max(1, counts.crate)),
      wall: new THREE.InstancedMesh(geoms.wall, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), Math.max(1, counts.wall)),
      rock: new THREE.InstancedMesh(geoms.rock, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.98 }), Math.max(1, counts.rock)),
    }
    const idx: Record<PropKind, number> = { crate: 0, wall: 0, rock: 0 }
    const dummy = new THREE.Object3D()
    const col = new THREE.Color()
    props.forEach((p, i) => {
      const kind = kinds[i]
      const h = heights[kind]
      dummy.position.set(p.x, h / 2, p.z)
      dummy.rotation.set(0, kind === 'rock' ? Math.random() * 0.35 - 0.17 : 0, 0)
      dummy.scale.set(p.hx * 2, h, p.hz * 2)
      dummy.updateMatrix()
      const base = new THREE.Color(t.props[kind])
      base.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08)
      col.copy(base)
      meshes[kind].setMatrixAt(idx[kind], dummy.matrix)
      meshes[kind].setColorAt(idx[kind], col)
      idx[kind]++
    })
    for (const k of ['crate', 'wall', 'rock'] as PropKind[]) {
      const m = meshes[k]
      m.count = counts[k]
      m.castShadow = true
      m.receiveShadow = true
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      this.scene.add(m)
    }
    this.propMeshes = meshes
  }

  setReticle(visible: boolean, x?: number, z?: number): void {
    this.reticle.visible = visible
    if (visible && x !== undefined && z !== undefined) this.reticle.position.set(x, 0.06, z)
  }

  setQuality(tier: QualityTier): void {
    this.tier = tier
    const q = QUALITY[tier]
    this.renderer.shadowMap.enabled = q.shadowMap > 0 && q.shadows
    this.sun.castShadow = q.shadows
    const size = q.shadowMap
    if (this.sun.shadow.map && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.map.dispose()
      this.sun.shadow.map = null
    }
    this.sun.shadow.mapSize.set(size, size)
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.shadowMap.needsUpdate = true
  }

  setPixelRatio(dpr: number): void {
    this.renderer.setPixelRatio(dpr)
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  /** shadow camera follows the player for crisp local shadows */
  followSun(x: number, z: number): void {
    this.sun.position.set(x + 40, 60, z + 20)
    this.sun.target.position.set(x, 0, z)
    this.sun.target.updateMatrixWorld()
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls
  }

  get triangles(): number {
    return this.renderer.info.render.triangles
  }

  get currentTier(): QualityTier {
    return this.tier
  }

  get mapHalf(): number {
    return this.mapSize / 2
  }

  dispose(): void {
    this.renderer.dispose()
  }
}
