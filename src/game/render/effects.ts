// NEXUS ARMOR — pooled GPU-friendly VFX: two particle systems (additive + smoke),
// instanced shells/decals/treadmarks, explosion rings, muzzle flashes, telegraph lines.
// Zero per-frame allocation (typed arrays + ring buffers).
import * as THREE from 'three'
import { DECAL_RING, MAX_SHELLS, TREADMARK_RING } from '../config/balance'

const MAX_SPARKS = 1400
const MAX_SMOKE = 500

class ParticleSystem {
  geo: THREE.BufferGeometry
  points: THREE.Points
  private pos: Float32Array
  private col: Float32Array
  private size: Float32Array
  private alpha: Float32Array
  private vel: Float32Array
  private life: Float32Array
  private maxLife: Float32Array
  private drag: Float32Array
  private grav: Float32Array
  private n = 0
  private cap: number

  constructor(cap: number, additive: boolean) {
    this.cap = cap
    this.pos = new Float32Array(cap * 3)
    this.col = new Float32Array(cap * 3)
    this.size = new Float32Array(cap)
    this.alpha = new Float32Array(cap)
    this.vel = new Float32Array(cap * 3)
    this.life = new Float32Array(cap)
    this.maxLife = new Float32Array(cap)
    this.drag = new Float32Array(cap)
    this.grav = new Float32Array(cap)

    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3))
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1))
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1))
    this.geo.setDrawRange(0, 0)

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uGlobalAlpha: { value: additive ? 1 : 0.85 } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (240.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha; uniform float uGlobalAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float a = smoothstep(0.5, 0.08, d) * vAlpha * uGlobalAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
    })
    this.points = new THREE.Points(this.geo, mat)
    this.points.frustumCulled = false
  }

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    r: number, g: number, b: number,
    size: number, life: number, drag: number, grav: number, alpha: number,
  ): void {
    let i: number
    if (this.n < this.cap) i = this.n++
    else i = (Math.random() * this.cap) | 0 // overwrite random when saturated
    const i3 = i * 3
    this.pos[i3] = x
    this.pos[i3 + 1] = y
    this.pos[i3 + 2] = z
    this.vel[i3] = vx
    this.vel[i3 + 1] = vy
    this.vel[i3 + 2] = vz
    this.col[i3] = r
    this.col[i3 + 1] = g
    this.col[i3 + 2] = b
    this.size[i] = size
    this.alpha[i] = alpha
    this.life[i] = life
    this.maxLife[i] = life
    this.drag[i] = drag
    this.grav[i] = grav
  }

  update(dt: number): void {
    for (let i = this.n - 1; i >= 0; i--) {
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        const last = --this.n
        if (i !== last) this.copy(last, i)
        continue
      }
      const i3 = i * 3
      const dr = Math.max(0, 1 - this.drag[i] * dt)
      this.vel[i3] *= dr
      this.vel[i3 + 1] = this.vel[i3 + 1] * dr + this.grav[i] * dt
      this.vel[i3 + 2] *= dr
      this.pos[i3] += this.vel[i3] * dt
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt
      if (this.pos[i3 + 1] < 0.03) {
        this.pos[i3 + 1] = 0.03
        this.vel[i3 + 1] *= -0.35
      }
      this.alpha[i] = Math.min(1, (this.life[i] / this.maxLife[i]) * 1.6)
    }
    this.geo.setDrawRange(0, this.n)
    ;(this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true
  }

  private copy(from: number, to: number): void {
    const f3 = from * 3
    const t3 = to * 3
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k]
      this.vel[t3 + k] = this.vel[f3 + k]
      this.col[t3 + k] = this.col[f3 + k]
    }
    this.size[to] = this.size[from]
    this.alpha[to] = this.alpha[from]
    this.life[to] = this.life[from]
    this.maxLife[to] = this.maxLife[from]
    this.drag[to] = this.drag[from]
    this.grav[to] = this.grav[from]
  }

  get count(): number {
    return this.n
  }

  clear(): void {
    this.n = 0
    this.geo.setDrawRange(0, 0)
  }
}

interface Ring {
  mesh: THREE.Mesh
  life: number
  maxLife: number
  growTo: number
}

interface SmokeSource {
  x: number
  z: number
  ttl: number
  next: number
}

export class Effects {
  sparks = new ParticleSystem(MAX_SPARKS, true)
  smoke = new ParticleSystem(MAX_SMOKE, false)
  private scene: THREE.Scene
  private ringPool: Ring[] = []
  private flashLight: THREE.PointLight
  private flashLife = 0
  private decalMesh: THREE.InstancedMesh
  private decalIdx = 0
  private treadMesh: THREE.InstancedMesh
  private treadIdx = 0
  private telegraphs: THREE.Mesh[] = []
  private smokeSources: SmokeSource[] = []
  private dummy = new THREE.Object3D()
  private color = new THREE.Color()
  particleCap = MAX_SPARKS

  constructor(scene: THREE.Scene) {
    this.scene = scene
    scene.add(this.sparks.points)
    scene.add(this.smoke.points)

    // explosion shockwave rings (pooled)
    const ringGeo = new THREE.RingGeometry(0.42, 0.55, 40)
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffc080,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(ringGeo, mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.visible = false
      scene.add(mesh)
      this.ringPool.push({ mesh, life: 0, maxLife: 1, growTo: 6 })
    }

    // shared explosion/muzzle light (1 dynamic light total)
    this.flashLight = new THREE.PointLight(0xffc070, 0, 26, 1.8)
    this.flashLight.position.y = 2.2
    scene.add(this.flashLight)

    // scorch decals (ring buffer)
    const decalGeo = new THREE.CircleGeometry(1, 20)
    const decalMat = new THREE.MeshBasicMaterial({
      map: this.makeDecalTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    })
    this.decalMesh = new THREE.InstancedMesh(decalGeo, decalMat, DECAL_RING)
    this.decalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.decalMesh.frustumCulled = false
    this.initFlat(this.decalMesh, DECAL_RING)
    scene.add(this.decalMesh)

    // tread marks (ring buffer)
    const treadGeo = new THREE.PlaneGeometry(0.42, 1.15)
    const treadMat = new THREE.MeshBasicMaterial({ color: 0x14120e, transparent: true, opacity: 0.34, depthWrite: false })
    this.treadMesh = new THREE.InstancedMesh(treadGeo, treadMat, TREADMARK_RING)
    this.treadMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.treadMesh.frustumCulled = false
    this.initFlat(this.treadMesh, TREADMARK_RING)
    scene.add(this.treadMesh)

    // telegraph lines (thin glowing boxes, pooled)
    const teleGeo = new THREE.BoxGeometry(1, 0.03, 0.1)
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff4040,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const m = new THREE.Mesh(teleGeo, mat)
      m.visible = false
      scene.add(m)
      this.telegraphs.push(m)
    }
  }

  private decalTex: THREE.Texture | null = null
  private makeDecalTexture(): THREE.Texture {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30)
    grad.addColorStop(0, 'rgba(8,7,5,0.95)')
    grad.addColorStop(0.6, 'rgba(10,9,7,0.5)')
    grad.addColorStop(1, 'rgba(12,10,8,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    const t = new THREE.CanvasTexture(c)
    this.decalTex = t
    return t
  }

  private initFlat(mesh: THREE.InstancedMesh, count: number): void {
    this.dummy.position.set(0, -50, 0)
    this.dummy.rotation.set(-Math.PI / 2, 0, 0)
    this.dummy.scale.setScalar(0.001)
    this.dummy.updateMatrix()
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, this.dummy.matrix)
    mesh.instanceMatrix.needsUpdate = true
  }

  // ------------------------------------------------------------ emitters
  muzzle(x: number, z: number, angle: number, big: boolean): void {
    const scale = big ? 2.6 : 1.5
    for (let i = 0; i < (big ? 10 : 5); i++) {
      const a = angle + (Math.random() - 0.5) * 0.7
      const sp = 6 + Math.random() * 10
      this.sparks.spawn(
        x, 1.2 * scale * 0.6, z,
        Math.cos(a) * sp, Math.random() * 3, Math.sin(a) * sp,
        1, 0.75 + Math.random() * 0.25, 0.35,
        0.28 + Math.random() * 0.2, 0.12 + Math.random() * 0.15, 4, -4, 1,
      )
    }
    this.flashLight.position.set(x, 2.2, z)
    this.flashLight.intensity = big ? 260 : 120
    this.flashLife = 0.07
  }

  explosion(x: number, z: number, big: boolean): void {
    const n = big ? 46 : 26
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = (big ? 7 : 4.5) + Math.random() * (big ? 14 : 8)
      const hot = Math.random()
      this.sparks.spawn(
        x, 0.5 + Math.random() * 0.8, z,
        Math.cos(a) * sp, 3 + Math.random() * (big ? 9 : 6), Math.sin(a) * sp,
        1, 0.35 + hot * 0.5, 0.08 + hot * 0.2,
        0.3 + Math.random() * 0.45, 0.35 + Math.random() * 0.6, 2.4, -9, 1,
      )
    }
    for (let i = 0; i < (big ? 16 : 9); i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 1 + Math.random() * 3
      const g = 0.16 + Math.random() * 0.14
      this.smoke.spawn(
        x, 0.6 + Math.random(), z,
        Math.cos(a) * sp, 1.4 + Math.random() * 2.4, Math.sin(a) * sp,
        g, g, g,
        (big ? 2.4 : 1.6) + Math.random() * 1.8, 1.2 + Math.random() * 1.4, 1.2, 1.1, 0.8,
      )
    }
    this.ring(x, z, big ? 9 : 6, big ? 0.5 : 0.38)
    this.flashLight.position.set(x, 2.6, z)
    this.flashLight.intensity = big ? 420 : 220
    this.flashLife = big ? 0.22 : 0.14
    this.decal(x, z, big ? 4.6 : 3.2)
    this.smokeSources.push({ x, z, ttl: big ? 7 : 4.5, next: 0 })
  }

  impact(x: number, z: number): void {
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 3 + Math.random() * 7
      this.sparks.spawn(
        x, 0.5, z,
        Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp,
        1, 0.8, 0.45,
        0.16 + Math.random() * 0.14, 0.2 + Math.random() * 0.2, 3, -9, 1,
      )
    }
    const g = 0.4
    this.smoke.spawn(x, 0.5, z, 0, 1.2, 0, g, g, g, 0.9 + Math.random() * 0.5, 0.6, 2, 0.9, 0.6)
  }

  ricochet(x: number, z: number): void {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 5 + Math.random() * 10
      this.sparks.spawn(
        x, 0.9, z,
        Math.cos(a) * sp, 3 + Math.random() * 6, Math.sin(a) * sp,
        1, 0.95, 0.7,
        0.14 + Math.random() * 0.12, 0.25 + Math.random() * 0.25, 2, -9, 1,
      )
    }
  }

  spawnFlash(x: number, z: number): void {
    this.ring(x, z, 5, 0.45, 0xff6050)
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2
      this.sparks.spawn(
        x, 0.4, z,
        Math.cos(a) * 4, 2 + Math.random() * 3, Math.sin(a) * 4,
        1, 0.4, 0.3,
        0.22, 0.4, 3, -2, 1,
      )
    }
  }

  private ring(x: number, z: number, growTo: number, life: number, color = 0xffc080): void {
    const r = this.ringPool.find((rr) => rr.life <= 0) ?? this.ringPool[0]
    r.life = life
    r.maxLife = life
    r.growTo = growTo
    r.mesh.position.set(x, 0.08, z)
    r.mesh.scale.setScalar(0.4)
    r.mesh.visible = true
    ;(r.mesh.material as THREE.MeshBasicMaterial).color.setHex(color)
  }

  decal(x: number, z: number, size: number): void {
    const i = this.decalIdx++ % DECAL_RING
    this.dummy.position.set(x, 0.02 + (i % 7) * 0.004, z)
    this.dummy.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2)
    this.dummy.scale.set(size, size, 1)
    this.dummy.updateMatrix()
    this.decalMesh.setMatrixAt(i, this.dummy.matrix)
    this.decalMesh.instanceMatrix.needsUpdate = true
  }

  treadmark(x: number, z: number, angle: number): void {
    const i = this.treadIdx++ % TREADMARK_RING
    this.dummy.position.set(x, 0.015 + (i % 5) * 0.003, z)
    this.dummy.rotation.set(-Math.PI / 2, 0, -angle)
    this.dummy.scale.set(1, 1, 1)
    this.dummy.updateMatrix()
    this.treadMesh.setMatrixAt(i, this.dummy.matrix)
    this.treadMesh.instanceMatrix.needsUpdate = true
  }

  setTelegraph(index: number, visible: boolean, x0: number, z0: number, x1: number, z1: number): void {
    const m = this.telegraphs[index % this.telegraphs.length]
    if (!m) return
    m.visible = visible
    if (!visible) return
    const dx = x1 - x0
    const dz = z1 - z0
    const len = Math.hypot(dx, dz)
    m.position.set(x0 + dx / 2, 1.15, z0 + dz / 2)
    m.rotation.set(0, -Math.atan2(dz, dx), 0)
    m.scale.set(len, 1, 1)
    const pulse = 0.55 + Math.sin(performance.now() * 0.02) * 0.25
    ;(m.material as THREE.MeshBasicMaterial).opacity = pulse
  }

  // ------------------------------------------------------------ update
  update(dt: number): void {
    this.sparks.update(dt)
    this.smoke.update(dt)
    // clamp active smoke sources
    for (let i = this.smokeSources.length - 1; i >= 0; i--) {
      const s = this.smokeSources[i]
      s.ttl -= dt
      s.next -= dt
      if (s.next <= 0) {
        s.next = 0.3 + Math.random() * 0.3
        const g = 0.14 + Math.random() * 0.1
        this.smoke.spawn(
          s.x + (Math.random() - 0.5) * 1.4, 0.5, s.z + (Math.random() - 0.5) * 1.4,
          (Math.random() - 0.5) * 0.6, 1 + Math.random() * 1.2, (Math.random() - 0.5) * 0.6,
          g, g, g, 1.6 + Math.random() * 1.6, 1.6 + Math.random() * 1.4, 0.8, 1.0, 0.7,
        )
      }
      if (s.ttl <= 0) this.smokeSources.splice(i, 1)
    }
    if (this.smokeSources.length > 10) this.smokeSources.splice(0, this.smokeSources.length - 10)

    if (this.flashLife > 0) {
      this.flashLife -= dt
      if (this.flashLife <= 0) this.flashLight.intensity = 0
      else this.flashLight.intensity *= Math.max(0, 1 - dt * 14)
    }
    for (const r of this.ringPool) {
      if (r.life <= 0) continue
      r.life -= dt
      const t = 1 - r.life / r.maxLife
      r.mesh.scale.setScalar(0.4 + t * r.growTo)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t) * 0.8
      if (r.life <= 0) r.mesh.visible = false
    }
  }

  clearTransient(): void {
    this.sparks.clear()
    this.smoke.clear()
    this.smokeSources.length = 0
    for (const r of this.ringPool) {
      r.life = 0
      r.mesh.visible = false
    }
    for (const t of this.telegraphs) t.visible = false
    this.initFlat(this.decalMesh, DECAL_RING)
    this.initFlat(this.treadMesh, TREADMARK_RING)
    this.decalIdx = 0
    this.treadIdx = 0
  }

  setColor(c: THREE.Color): void {
    this.color.copy(c)
  }
}
