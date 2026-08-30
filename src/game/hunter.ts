import * as THREE from 'three';
import { COLORS, HUNTER } from './constants';
import { createRimMaterial } from './shaders';
import { makeGlowSprite } from './textures';

/**
 * Listeners — blind anglers of the abyss. They hear your pulses:
 *  - pulse emitted very close  → stunned
 *  - pulse emitted near        → alerted, they swarm the pulse origin
 *  - you moving within earshot → they track you directly
 * They are only truly *visible* when a wavefront washes over them.
 */

export type HunterState = 'dormant' | 'revealed' | 'alert' | 'stunned' | 'scatter';

export class Hunter {
  state: HunterState = 'dormant';
  pos: THREE.Vector3;
  reveal = 0;
  private home: THREE.Vector3;
  private target = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private linger = 0;
  private stunT = 0;
  private scatterT = 0;
  private phase = Math.random() * Math.PI * 2;
  private speed: number;

  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private eyeMats: THREE.SpriteMaterial[] = [];
  private tail: THREE.Mesh;

  constructor(parent: THREE.Object3D, home: THREE.Vector3, depth: number) {
    this.home = home.clone();
    this.pos = home.clone();
    this.speed = HUNTER.speedBase + (depth - 1) * HUNTER.speedPerDepth;

    this.mat = createRimMaterial(COLORS.hazard);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 14), this.mat);
    body.scale.set(1, 0.72, 1.25);
    // lure stalk
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5),
      new THREE.MeshBasicMaterial({ color: COLORS.hazard }),
    );
    stalk.position.set(0, 0.55, 0.55);
    stalk.rotation.x = 0.7;
    this.tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.9, 6),
      new THREE.MeshBasicMaterial({ color: 0x220a0d, transparent: true, opacity: 0.85 }),
    );
    this.tail.position.set(0, 0, -0.95);
    this.tail.rotation.x = -Math.PI / 2;
    this.group.add(body, stalk, this.tail);

    for (let i = 0; i < 2; i++) {
      const eyeMat = new THREE.SpriteMaterial({
        map: makeGlowSprite(COLORS.hazard, 0.6).material.map,
        color: COLORS.hazard,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: true,
      });
      const eye = new THREE.Sprite(eyeMat);
      eye.scale.setScalar(0.5);
      eye.position.set(i === 0 ? -0.26 : 0.26, 0.18, 0.62);
      this.group.add(eye);
      this.eyeMats.push(eyeMat);
    }

    parent.add(this.group);
  }

  onPulse(origin: THREE.Vector3, kind: 'stun' | 'alert' | 'reveal'): void {
    switch (kind) {
      case 'stun':
        this.state = 'stunned';
        this.stunT = HUNTER.stunTime;
        break;
      case 'alert':
        if (this.state === 'stunned') return;
        this.state = 'alert';
        this.target.copy(origin);
        this.linger = HUNTER.lingerTime;
        break;
      case 'reveal':
        this.reveal = Math.max(this.reveal, 1);
        if (this.state === 'dormant') this.state = 'revealed';
        break;
    }
  }

  scatter(): void {
    if (this.state === 'stunned') return;
    this.state = 'scatter';
    this.scatterT = HUNTER.scatterTime;
  }

  reset(): void {
    this.state = 'dormant';
    this.pos.copy(this.home);
    this.vel.set(0, 0, 0);
    this.reveal = 0;
    this.stunT = 0;
    this.linger = 0;
  }

  /** returns true when it damaged the player this frame (engine checks radius) */
  update(dt: number, t: number, playerPos: THREE.Vector3, depthScale: number): boolean {
    this.reveal = Math.max(0, this.reveal - dt * 0.85);
    let stateGlow = 0;
    let damaged = false;

    switch (this.state) {
      case 'dormant':
      case 'revealed': {
        // lazy drift around home
        const wander = new THREE.Vector3(
          Math.sin(t * 0.35 + this.phase) * 2.2,
          Math.sin(t * 0.5 + this.phase * 2.0) * 0.8,
          Math.cos(t * 0.3 + this.phase) * 2.2,
        );
        const goal = wander.add(this.home);
        this.vel.lerp(goal.sub(this.pos).multiplyScalar(0.4), Math.min(1, 2 * dt));
        if (this.state === 'revealed' && Math.random() < dt * 0.5) this.state = 'dormant';
        break;
      }
      case 'alert': {
        // hears your movement up close
        if (this.pos.distanceTo(playerPos) < HUNTER.senseRadius) {
          this.target.copy(playerPos);
          this.linger = HUNTER.lingerTime;
        }
        const to = tmpA.copy(this.target).sub(this.pos);
        const d = to.length();
        if (d > 1.2) {
          to.normalize().multiplyScalar(this.speed * depthScale);
          this.vel.lerp(to, Math.min(1, 3 * dt));
        } else {
          this.vel.multiplyScalar(0.9);
          this.linger -= dt;
          if (this.linger <= 0) this.state = 'dormant';
        }
        // bob around the target height
        this.vel.y += Math.sin(t * 3 + this.phase) * 0.4;
        stateGlow = 1;
        damaged = this.pos.distanceTo(playerPos) < HUNTER.damageRadius;
        break;
      }
      case 'stunned': {
        this.stunT -= dt;
        this.vel.multiplyScalar(0.85);
        this.vel.y -= 1.6 * dt;
        if (this.stunT <= 0) this.state = 'dormant';
        break;
      }
      case 'scatter': {
        this.scatterT -= dt;
        const away = tmpA.copy(this.pos).sub(playerPos).normalize().multiplyScalar(this.speed * 1.6);
        this.vel.lerp(away, Math.min(1, 4 * dt));
        if (this.scatterT <= 0) this.state = 'dormant';
        stateGlow = 0.6;
        break;
      }
    }

    this.pos.addScaledVector(this.vel, dt);
    this.pos.y = Math.max(this.pos.y, -14);

    // orientation faces velocity
    if (this.vel.lengthSq() > 0.02) {
      tmpB.copy(this.pos).add(this.vel);
      this.group.lookAt(tmpB);
    }
    this.group.position.copy(this.pos);
    this.group.position.y += Math.sin(t * 1.4 + this.phase) * 0.15;

    // material state
    const u = this.mat.uniforms;
    u.uReveal.value = this.reveal;
    u.uState.value = stateGlow;
    const eyeAlpha =
      this.state === 'alert' ? 1 : this.state === 'scatter' ? 0.8 : this.state === 'stunned' ? 0 : 0.18 + this.reveal * 0.6;
    for (const m of this.eyeMats) m.opacity = eyeAlpha;
    (this.tail.material as THREE.MeshBasicMaterial).opacity = 0.5 + this.reveal * 0.4;

    return damaged;
  }

  dispose(parent: THREE.Object3D): void {
    parent.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        o.geometry.dispose();
      }
    });
    this.mat.dispose();
    for (const m of this.eyeMats) m.dispose();
  }
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
