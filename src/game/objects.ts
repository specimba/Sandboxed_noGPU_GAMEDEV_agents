import * as THREE from 'three';
import { COLORS } from './constants';
import { makeGlowSprite } from './textures';
import type { ParticlePool } from './particles';

/**
 * Echo Shards (collect 3 to wake the Gate) and the Gate itself.
 * CPU-driven glow: when a wavefront reaches them the engine bumps `reveal`
 * and they bloom, then slowly settle to a base glimmer.
 */

export class Shard {
  taken = false;
  reveal = 0.18;
  private phase = Math.random() * Math.PI * 2;
  readonly group = new THREE.Group();
  private outerMat: THREE.MeshBasicMaterial;
  private inner: THREE.Mesh;
  private base = new THREE.Vector3();

  constructor(parent: THREE.Object3D, pos: THREE.Vector3) {
    this.base.copy(pos);
    this.group.position.copy(pos);
    this.outerMat = new THREE.MeshBasicMaterial({
      color: COLORS.crystal.clone(),
      transparent: true,
      opacity: 0.9,
      fog: true,
    });
    const outer = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), this.outerMat);
    outer.scale.set(1, 1.7, 1);
    this.inner = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }),
    );
    this.inner.scale.set(1, 1.7, 1);
    const glow = makeGlowSprite(COLORS.crystal, 2.4);
    this.group.add(outer, this.inner, glow);
    parent.add(this.group);
  }

  bloom(): void {
    this.reveal = 1;
  }

  update(dt: number, t: number): void {
    if (this.taken) return;
    this.reveal = Math.max(0.18, this.reveal - dt * 0.3);
    this.group.position.y = this.base.y + Math.sin(t * 1.6 + this.phase) * 0.22;
    this.group.rotation.y = t * 0.9 + this.phase;
    this.inner.rotation.x = -t * 1.4;
    const k = 0.55 + this.reveal * 2.2;
    this.outerMat.color.copy(COLORS.crystal).multiplyScalar(k);
    this.outerMat.opacity = 0.55 + this.reveal * 0.45;
  }

  collect(particles: ParticlePool): void {
    this.taken = true;
    this.group.visible = false;
    particles.burst(this.base, 30, 5.5, { color: COLORS.crystal, life: 0.9, size: 0.5, gravity: -2 });
  }

  dispose(parent: THREE.Object3D): void {
    parent.remove(this.group);
    this.outerMat.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

export class Gate {
  active = false;
  reveal = 0.25;
  private ringMat: THREE.MeshBasicMaterial;
  private beamMat: THREE.MeshBasicMaterial;
  private beam: THREE.Mesh;
  private ring: THREE.Mesh;
  private base = new THREE.Vector3();
  readonly group = new THREE.Group();

  constructor(parent: THREE.Object3D, pos: THREE.Vector3, yaw: number) {
    this.base.copy(pos);
    this.group.position.copy(pos);
    this.group.rotation.y = yaw;

    this.ringMat = new THREE.MeshBasicMaterial({
      color: COLORS.gate.clone().multiplyScalar(0.5),
      fog: true,
    });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.14, 10, 48), this.ringMat);
    this.ring.position.y = 2.1;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(2.0, 2.3, 0.4, 24),
      new THREE.MeshBasicMaterial({ color: 0x3a2c14, fog: true }),
    );
    base.position.y = 0.2;
    this.beamMat = new THREE.MeshBasicMaterial({
      color: COLORS.gate,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.75, 30, 24, 1, true), this.beamMat);
    this.beam.position.y = 15;
    const glow = makeGlowSprite(COLORS.gate, 6);
    glow.position.y = 2.1;
    this.group.add(this.ring, base, this.beam, glow);
    parent.add(this.group);
  }

  activate(particles: ParticlePool): void {
    this.active = true;
    particles.burst(new THREE.Vector3(this.base.x, this.base.y + 2.1, this.base.z), 60, 8, {
      color: COLORS.gate,
      life: 1.4,
      size: 0.55,
      gravity: 1.5,
    });
  }

  update(dt: number, t: number): void {
    this.reveal = Math.max(this.active ? 0.85 : 0.25, this.reveal - dt * 0.4);
    const spin = t * (this.active ? 1.2 : 0.25);
    this.ring.rotation.z = spin;
    this.ring.rotation.y = Math.sin(t * 0.7) * 0.3;
    this.ring.position.y = 2.1 + Math.sin(t * 1.2) * 0.08;
    const pulse = this.active ? 1.15 + Math.sin(t * 2.4) * 0.25 : this.reveal;
    this.ringMat.color.copy(COLORS.gate).multiplyScalar(pulse);
    this.beamMat.opacity = THREE.MathUtils.lerp(this.beamMat.opacity, this.active ? 0.16 : 0, Math.min(1, dt * 2));
    this.beam.rotation.y = t * 0.4;
  }

  dispose(parent: THREE.Object3D): void {
    parent.remove(this.group);
    this.ringMat.dispose();
    this.beamMat.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
