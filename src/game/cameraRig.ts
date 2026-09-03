import * as THREE from 'three';
import { FEEL } from './constants';

/**
 * HOLLOW SUN camera: angled twin-stick follow with velocity lead,
 * trauma² shake, FOV kicks, Overdrive pull-back, and a title→play dive.
 */

const BASE_FOV = 55;
const HEIGHT = 24;
const BACK = 14.5;

export class CameraRig {
  private mode: 'title' | 'fly' | 'follow' = 'title';
  private shake = 0;
  private fovKick = 0;
  private zoomOut = 0; // eased 0..1 overdrive pull-back
  private pos = new THREE.Vector3(0, 17, 30);
  private look = new THREE.Vector3(0, 2, 0);
  private flyT = 0;
  private flyDur = 1.15;
  private flyFromPos = new THREE.Vector3();
  private flyFromLook = new THREE.Vector3();
  private titleAngle = 0.6;
  private targetX = 0;
  private targetZ = 0;

  addShake(v: number): void {
    this.shake = Math.min(FEEL.shakeMax, this.shake + v);
  }

  addFovKick(v: number): void {
    this.fovKick = Math.min(9, this.fovKick + v);
  }

  setTitleMode(): void {
    this.mode = 'title';
  }

  /** attract → play: dive from wherever we are to the follow frame */
  engage(targetX: number, targetZ: number): void {
    this.targetX = targetX;
    this.targetZ = targetZ;
    this.flyFromPos.copy(this.pos);
    this.flyFromLook.copy(this.look);
    this.flyT = 0;
    this.mode = 'fly';
  }

  /** restart / respawn: snap directly to the follow frame */
  snap(targetX: number, targetZ: number): void {
    this.mode = 'follow';
    this.targetX = targetX;
    this.targetZ = targetZ;
    this.followPos(this.pos);
    this.followLook(this.look);
  }

  get currentPos(): THREE.Vector3 {
    return this.pos;
  }

  get currentLook(): THREE.Vector3 {
    return this.look;
  }

  get flying(): boolean {
    return this.mode === 'fly';
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    targetX: number,
    targetZ: number,
    velX: number,
    velZ: number,
    overdriveActive: boolean,
    reduceFx: boolean,
  ): void {
    this.shake = Math.max(0, this.shake - dt * 1.5);
    this.fovKick = Math.max(0, this.fovKick - dt * 13);
    this.zoomOut += ((overdriveActive ? 1 : 0) - this.zoomOut) * Math.min(1, dt * 5);
    this.targetX = targetX;
    this.targetZ = targetZ;

    if (this.mode === 'title') {
      this.titleAngle += dt * 0.07;
      tmpA.set(Math.sin(this.titleAngle) * 30, 17, Math.cos(this.titleAngle) * 30);
      const damp = 1 - Math.exp(-4 * dt);
      this.pos.lerp(tmpA, damp);
      this.look.lerp(tmpB.set(0, 2.2, 0), damp);
    } else if (this.mode === 'fly') {
      this.flyT += dt;
      const k = THREE.MathUtils.clamp(this.flyT / this.flyDur, 0, 1);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.pos.lerpVectors(this.flyFromPos, this.followPos(tmpA), e);
      this.look.lerpVectors(this.flyFromLook, this.followLook(tmpB), e);
      if (k >= 1) this.mode = 'follow';
    } else {
      const damp = 1 - Math.exp(-8 * dt);
      this.pos.lerp(this.followPos(tmpA), damp);
      this.look.lerp(this.followLook(tmpB), damp);
    }

    if (!reduceFx && this.shake > 0.001) {
      const s = this.shake * this.shake * 0.55;
      this.pos.x += (Math.random() * 2 - 1) * s;
      this.pos.y += (Math.random() * 2 - 1) * s * 0.6;
      this.pos.z += (Math.random() * 2 - 1) * s;
    }

    camera.position.copy(this.pos);
    camera.lookAt(this.look);

    const targetFov = BASE_FOV + this.fovKick + this.zoomOut * 4;
    if (Math.abs(camera.fov - targetFov) > 0.02) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(1, dt * 8));
      camera.updateProjectionMatrix();
    }
  }

  private followPos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(
      this.targetX + this.velX * 0.14,
      HEIGHT + this.zoomOut * 2.2,
      this.targetZ + this.velZ * 0.14 + BACK + this.zoomOut * 1.5,
    );
  }

  private followLook(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.targetX + this.velX * 0.18, 0.6, this.targetZ + this.velZ * 0.18);
  }

  private velX = 0;
  private velZ = 0;

  setVelocity(x: number, z: number): void {
    this.velX = x;
    this.velZ = z;
  }
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
