import * as THREE from 'three';
import { createParticleMaterial } from './shaders';

/**
 * Fixed-size CPU particle pool (single draw call).
 * Used for: wisp trail, dash bursts, shard collection, impacts, gate embers.
 */

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  drag: number;
  gravity: number;
  active: boolean;
}

export class ParticlePool {
  readonly points: THREE.Points;
  private pool: Particle[] = [];
  private max: number;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private cursor = 0;

  constructor(parent: THREE.Object3D, max = 700) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aColor', this.colAttr);
    this.geo.setAttribute('aAlpha', this.alphaAttr);
    this.geo.setAttribute('aSize', this.sizeAttr);
    this.geo.setDrawRange(0, max);
    this.mat = createParticleMaterial();
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    parent.add(this.points);

    for (let i = 0; i < max; i++) {
      this.pool.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
        color: new THREE.Color(),
        drag: 2,
        gravity: 0,
        active: false,
      });
    }
  }

  setPixelRatio(dpr: number) {
    this.mat.uniforms.uPix.value = dpr;
  }

  spawn(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    opts: {
      life?: number;
      size?: number;
      color?: THREE.Color;
      drag?: number;
      gravity?: number;
    } = {},
  ): void {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.maxLife = p.life = opts.life ?? 0.8;
    p.size = opts.size ?? 0.5;
    p.color.copy(opts.color ?? WHITE);
    p.drag = opts.drag ?? 2.2;
    p.gravity = opts.gravity ?? 0;
    p.active = true;
  }

  burst(
    pos: THREE.Vector3,
    count: number,
    speed: number,
    opts: {
      life?: number;
      size?: number;
      color?: THREE.Color;
      gravity?: number;
      spread?: number;
    } = {},
  ): void {
    for (let i = 0; i < count; i++) {
      const dir = randUnit(tmpV);
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn(pos, dir.multiplyScalar(s), opts);
    }
  }

  update(dt: number): void {
    const pos = this.posAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    const alp = this.alphaAttr.array as Float32Array;
    const siz = this.sizeAttr.array as Float32Array;
    for (let i = 0; i < this.max; i++) {
      const p = this.pool[i];
      if (!p.active) {
        alp[i] = 0;
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        alp[i] = 0;
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      const k = p.life / p.maxLife;
      pos[i * 3] = p.pos.x;
      pos[i * 3 + 1] = p.pos.y;
      pos[i * 3 + 2] = p.pos.z;
      col[i * 3] = p.color.r;
      col[i * 3 + 1] = p.color.g;
      col[i * 3 + 2] = p.color.b;
      alp[i] = k * k * 0.9;
      siz[i] = p.size * (0.5 + k * 0.7);
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.points.removeFromParent();
  }
}

const tmpV = new THREE.Vector3();
const WHITE = new THREE.Color('#ffffff');

function randUnit(out: THREE.Vector3): THREE.Vector3 {
  const a = Math.random() * Math.PI * 2;
  const z = Math.random() * 2 - 1;
  const s = Math.sqrt(1 - z * z);
  return out.set(Math.cos(a) * s, z, Math.sin(a) * s);
}
