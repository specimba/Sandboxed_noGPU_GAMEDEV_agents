import * as THREE from 'three';
import { CAMERA } from './constants';
import type { Collider } from './level';

/**
 * Damped third-person orbit camera with velocity auto-align, FOV kick,
 * shake, segment-vs-AABB collision so pillars never block the view, and an
 * intro "dive" fly used when leaving the title screen.
 */
export class CameraRig {
  yaw = Math.PI;
  pitch = 0.42;
  dist = CAMERA.dist;
  private manualTimer = 0;
  private shake = 0;
  private fovKick = 0;
  private curPos = new THREE.Vector3(0, 20, 26);
  private curLook = new THREE.Vector3();
  private flyT = -1; // >= 0 while flying
  private flyDur = 1;
  private flyFrom = new THREE.Vector3();
  private flyLookFrom = new THREE.Vector3();

  orbit(dx: number, dy: number): void {
    this.yaw -= dx * CAMERA.sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * CAMERA.sens, CAMERA.minPitch, CAMERA.maxPitch);
    if (Math.abs(dx) + Math.abs(dy) > 0.5) this.manualTimer = 1.4;
  }

  rotate(axis: number, dt: number): void {
    if (axis !== 0) {
      this.yaw -= axis * 2.2 * dt;
      this.manualTimer = 1.4;
    }
  }

  zoomBy(steps: number): void {
    this.dist = THREE.MathUtils.clamp(this.dist + steps * 1.1, CAMERA.minDist, CAMERA.maxDist);
  }

  addShake(v: number): void {
    this.shake = Math.min(0.8, this.shake + v);
  }

  addFovKick(v: number): void {
    this.fovKick = Math.min(10, this.fovKick + v);
  }

  startFly(fromPos: THREE.Vector3, fromLook: THREE.Vector3, dur: number): void {
    this.flyT = 0;
    this.flyDur = dur;
    this.flyFrom.copy(fromPos);
    this.flyLookFrom.copy(fromLook);
  }

  get flying(): boolean {
    return this.flyT >= 0;
  }

  get currentPos(): THREE.Vector3 {
    return this.curPos;
  }

  get currentLook(): THREE.Vector3 {
    return this.curLook;
  }

  /** attract-mode camera (title screen) */
  setOrbit(center: THREE.Vector3, angle: number, radius: number, height: number): void {
    this.curPos.set(center.x + Math.cos(angle) * radius, center.y + height, center.z + Math.sin(angle) * radius);
    this.curLook.copy(center);
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    target: THREE.Vector3,
    vel: THREE.Vector3,
    colliders: Collider[],
    reduceFx: boolean,
  ): void {
    this.manualTimer = Math.max(0, this.manualTimer - dt);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.fovKick = Math.max(0, this.fovKick - dt * 14);

    // gentle auto-align behind movement
    const speed = Math.hypot(vel.x, vel.z);
    if (this.manualTimer <= 0 && speed > 4) {
      const targetYaw = Math.atan2(-vel.x, -vel.z);
      let delta = targetYaw - this.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.yaw += delta * Math.min(1, dt * 0.9);
    }

    const cosP = Math.cos(this.pitch);
    const desired = tmpA.set(
      target.x + Math.sin(this.yaw) * cosP * this.dist,
      target.y + Math.sin(this.pitch) * this.dist + 1.2,
      target.z + Math.cos(this.yaw) * cosP * this.dist,
    );

    // camera collision: shorten along player->camera segment if a pillar blocks
    let tMin = 1;
    for (const c of colliders) {
      const t = segmentVsBox(target, desired, c, 0.4);
      if (t < tMin) tMin = t;
    }
    if (tMin < 1) desired.lerpVectors(target, desired, Math.max(0.2, tMin * 0.92));
    if (desired.y < target.y - 2.5) desired.y = target.y - 2.5;

    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.flyT >= 0) {
      this.flyT += dt;
      const k = THREE.MathUtils.clamp(this.flyT / this.flyDur, 0, 1);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.computeLook(target, vel, tmpLook);
      look = tmpB.copy(this.flyLookFrom).lerp(tmpLook, e);
      pos = tmpC.copy(this.flyFrom).lerp(desired, e);
      if (k >= 1) this.flyT = -1;
    } else {
      const damp = 1 - Math.exp(-9 * dt);
      pos = tmpB.copy(this.curPos).lerp(desired, damp);
      look = this.computeLook(target, vel, tmpLook).clone();
    }

    if (!reduceFx && this.shake > 0.001) {
      const s = this.shake * this.shake * 0.5;
      pos.x += (Math.random() * 2 - 1) * s;
      pos.y += (Math.random() * 2 - 1) * s;
    }

    this.curPos.copy(pos);
    this.curLook.copy(look);
    camera.position.copy(pos);
    camera.lookAt(look);

    const targetFov = CAMERA.fov + this.fovKick + speed * 0.22;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(1, dt * 8));
      camera.updateProjectionMatrix();
    }
  }

  private computeLook(target: THREE.Vector3, vel: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.set(target.x + vel.x * 0.22, target.y + 1.1 + vel.y * 0.05, target.z + vel.z * 0.22);
  }
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpLook = new THREE.Vector3();

/** 0..1 entry parameter of segment a->b vs expanded AABB, 1 when unobstructed */
function segmentVsBox(a: THREE.Vector3, b: THREE.Vector3, c: Collider, pad: number): number {
  const minX = c.x - c.hx - pad;
  const maxX = c.x + c.hx + pad;
  const minZ = c.z - c.hz - pad;
  const maxZ = c.z + c.hz + pad;
  const minY = c.top - 30;
  const maxY = c.top + pad;
  const d = tmpD.copy(b).sub(a);
  let tmin = 0;
  let tmax = 1;
  const bounds = [
    [minX, maxX, d.x, a.x],
    [minY, maxY, d.y, a.y],
    [minZ, maxZ, d.z, a.z],
  ] as const;
  for (const [lo, hi, dd, oo] of bounds) {
    if (Math.abs(dd) < 1e-8) {
      if (oo < lo || oo > hi) return 1;
    } else {
      let t1 = (lo - oo) / dd;
      let t2 = (hi - oo) / dd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return 1;
    }
  }
  return Math.max(0, tmin);
}

const tmpD = new THREE.Vector3();
