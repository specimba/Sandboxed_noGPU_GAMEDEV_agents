// NEXUS ARMOR — chase camera with aim lean and spring-damped shake.
import * as THREE from 'three'
import { CAM_AIM_LEAN, CAM_BACK, CAM_HEIGHT, CAM_LERP, SHAKE_DECAY } from '../config/balance'

export class CameraRig {
  camera: THREE.PerspectiveCamera
  shakeEnabled = true
  private look = new THREE.Vector3(0, 0, 0)
  private shake = 0
  private tmp = new THREE.Vector3()

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
  }

  kick(amp: number): void {
    if (!this.shakeEnabled) return
    this.shake = Math.min(1.2, this.shake + amp)
  }

  snap(x: number, z: number): void {
    this.look.set(x, 0, z)
    this.shake = 0
    this.camera.position.set(x, CAM_HEIGHT, z + CAM_BACK)
    this.camera.lookAt(this.look)
  }

  /** menu idle: slow orbit around the showcase tank */
  idle(t: number, radius = 24, height = 12): void {
    const a = t * 0.12
    this.camera.position.set(Math.cos(a) * radius, height, Math.sin(a) * radius)
    this.camera.lookAt(0, 1.6, 0)
  }

  update(dt: number, px: number, pz: number, aimX: number, aimZ: number): void {
    const lx = px + (aimX - px) * CAM_AIM_LEAN
    const lz = pz + (aimZ - pz) * CAM_AIM_LEAN
    const k = 1 - Math.exp(-CAM_LERP * dt)
    this.look.x += (lx - this.look.x) * k
    this.look.z += (lz - this.look.z) * k

    this.shake = Math.max(0, this.shake - this.shake * SHAKE_DECAY * dt - 0.01 * dt)
    const s = this.shake * this.shake * 1.6
    const ox = (Math.random() - 0.5) * s
    const oy = (Math.random() - 0.5) * s * 0.6
    const oz = (Math.random() - 0.5) * s

    this.camera.position.set(this.look.x + ox, CAM_HEIGHT + oy, this.look.z + CAM_BACK + oz)
    this.tmp.set(this.look.x + ox * 0.5, 0.5, this.look.z + oz * 0.5)
    this.camera.lookAt(this.tmp)
  }
}
