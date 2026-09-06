import * as THREE from 'three';
import { ARENA_RADIUS } from './constants';

/**
 * AFTERGLOW camera: high-angle (≈60° looking down) follow with velocity lead,
 * trauma² shake, dash FOV kicks, and a title→play dive.
 * Pattern carried over from the house rig (src/game/cameraRig.ts).
 */

const BASE_FOV = 52;
const HEIGHT = 26;
const BACK = 4.5;
/** pull the focus inward when the player nears the rim so the frame keeps
 *  the arena inside — the void beyond stays a sliver, never half the screen */
const RIM_BIAS_FROM = ARENA_RADIUS - 9.5;

function rimBias(x: number, z: number): { x: number; z: number } {
  const d = Math.hypot(x, z);
  if (d <= RIM_BIAS_FROM) return { x, z };
  const excess = d - RIM_BIAS_FROM;
  const k = Math.min(1, excess / 7);
  const pull = excess * k * 0.72;
  return { x: x - (x / d) * pull, z: z - (z / d) * pull };
}

export class CameraRig {
  private mode: 'title' | 'fly' | 'follow' = 'title';
  private shake = 0;
  private fovKick = 0;
  private pos = new THREE.Vector3(0, 20, 24);
  private look = new THREE.Vector3(0, 1, 0);
  private flyT = 0;
  private flyDur = 1.05;
  private flyFromPos = new THREE.Vector3();
  private flyFromLook = new THREE.Vector3();
  private titleAngle = 0.6;

  addShake(v: number): void {
    this.shake = Math.min(0.8, this.shake + v);
  }

  addFovKick(v: number): void {
    this.fovKick = Math.min(8, this.fovKick + v);
  }

  setTitleMode(): void {
    this.mode = 'title';
  }

  /** attract → play: dive from wherever we are to the follow frame */
  engage(targetX: number, targetZ: number): void {
    void targetX;
    void targetZ;
    this.flyFromPos.copy(this.pos);
    this.flyFromLook.copy(this.look);
    this.flyT = 0;
    this.mode = 'fly';
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    targetX: number,
    targetZ: number,
    velX: number,
    velZ: number,
    reduceFx: boolean,
  ): void {
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.fovKick = Math.max(0, this.fovKick - dt * 13);

    if (this.mode === 'title') {
      this.titleAngle += dt * 0.07;
      tmpA.set(Math.sin(this.titleAngle) * 26, 19, Math.cos(this.titleAngle) * 26);
      const damp = 1 - Math.exp(-4 * dt);
      this.pos.lerp(tmpA, damp);
      this.look.lerp(tmpB.set(0, 1.2, 0), damp);
    } else if (this.mode === 'fly') {
      this.flyT += dt;
      const k = THREE.MathUtils.clamp(this.flyT / this.flyDur, 0, 1);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.pos.lerpVectors(this.flyFromPos, this.followPos(tmpA, targetX, targetZ, velX, velZ), e);
      this.look.lerpVectors(this.flyFromLook, this.followLook(tmpB, targetX, targetZ, velX, velZ), e);
      if (k >= 1) this.mode = 'follow';
    } else {
      const bias = rimBias(targetX, targetZ);
      const damp = 1 - Math.exp(-8 * dt);
      this.pos.lerp(this.followPos(tmpA, bias.x, bias.z, velX, velZ), damp);
      this.look.lerp(this.followLook(tmpB, bias.x, bias.z, velX, velZ), damp);
    }

    if (!reduceFx && this.shake > 0.001) {
      const s = this.shake * this.shake * 0.55;
      this.pos.x += (Math.random() * 2 - 1) * s;
      this.pos.y += (Math.random() * 2 - 1) * s * 0.6;
      this.pos.z += (Math.random() * 2 - 1) * s;
    }

    camera.position.copy(this.pos);
    camera.lookAt(this.look);

    const targetFov = BASE_FOV + this.fovKick;
    if (Math.abs(camera.fov - targetFov) > 0.02) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(1, dt * 8));
      camera.updateProjectionMatrix();
    }
  }

  private followPos(out: THREE.Vector3, tx: number, tz: number, vx: number, vz: number): THREE.Vector3 {
    return out.set(tx + vx * 0.1, HEIGHT, tz + vz * 0.1 + BACK);
  }

  private followLook(out: THREE.Vector3, tx: number, tz: number, vx: number, vz: number): THREE.Vector3 {
    return out.set(tx + vx * 0.13, 0.6, tz + vz * 0.13);
  }
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
