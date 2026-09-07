import * as THREE from 'three';

/**
 * HOLLOW SUN FX: one additive Points pool (4,096 cap) with kill bursts that
 * spiral into the star, a pool of expanding shockwave rings, and shared
 * canvas-generated glow textures. Single draw call per system.
 *
 * M0 elevation: the pool accepts a blending override (NormalBlending smoke
 * pool), and a fixed-capacity PerPointBatch (per-point size/color/alpha,
 * no CPU particle state) backs view-side systems — motes, bolts, contact
 * shadows, ambient ember field — one draw call each.
 */

/* ------------------------------------------------------------------ */
/* shared glow texture                                                 */
/* ------------------------------------------------------------------ */

export function makeGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ */
/* particle pool                                                       */
/* ------------------------------------------------------------------ */

const PARTICLE_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aSize;
uniform float uPix;
varying vec3 vC;
varying float vA;
void main() {
  vC = aColor;
  vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(0.1, -mv.z);
  gl_PointSize = min(aSize * uPix * (150.0 / dist), 46.0 * uPix);
  vA *= smoothstep(0.3, 1.2, dist);
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAG = /* glsl */ `
varying vec3 vC;
varying float vA;
float hsHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  float d = length(gl_PointCoord - 0.5);
  // crisp core with a tight falloff — sparks, not blobs
  float a = smoothstep(0.5, 0.16, d) * vA;
  vec3 col = vC * a + (hsHash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, a);
}
`;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
  drag: number;
  /** when > 0 the particle swirls into the star at the origin */
  spiral: number;
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

  constructor(parent: THREE.Object3D, max = 4096, opts: { blending?: THREE.Blending } = {}) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(max), 1);
    for (const a of [this.posAttr, this.colAttr, this.alphaAttr, this.sizeAttr]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aColor', this.colAttr);
    this.geo.setAttribute('aAlpha', this.alphaAttr);
    this.geo.setAttribute('aSize', this.sizeAttr);
    this.geo.setDrawRange(0, max);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: { uPix: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: opts.blending ?? THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    parent.add(this.points);
    for (let i = 0; i < max; i++) {
      this.pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 1, r: 1, g: 1, b: 1, drag: 2, spiral: 0, active: false });
    }
  }

  setPixelRatio(dpr: number) {
    this.mat.uniforms.uPix.value = dpr;
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    opts: { life?: number; size?: number; color?: THREE.Color; drag?: number; spiral?: number } = {},
  ): void {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.maxLife = p.life = opts.life ?? 0.8;
    p.size = opts.size ?? 0.5;
    const c = opts.color ?? WHITE;
    p.r = c.r;
    p.g = c.g;
    p.b = c.b;
    p.drag = opts.drag ?? 2.2;
    p.spiral = opts.spiral ?? 0;
    p.active = true;
  }

  /** radial burst; spiral>0 makes the burst arc back into the star */
  burst(
    x: number,
    z: number,
    count: number,
    speed: number,
    opts: { life?: number; size?: number; color?: THREE.Color; spiral?: number; up?: number; drag?: number } = {},
  ): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.85);
      this.spawn(x, 0.9 + Math.random() * 1.2, z, Math.cos(a) * s, (opts.up ?? 0.4) * speed * Math.random(), Math.sin(a) * s, opts);
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
      if (p.spiral > 0) {
        // swirl into the dead star: pull to origin + tangential force
        const dx = -p.x;
        const dz = -p.z;
        const d = Math.hypot(dx, dz) || 1;
        // die at the star — they feed it, they don't stack on it
        if (d < 2.6) {
          p.active = false;
          alp[i] = 0;
          continue;
        }
        const pull = p.spiral * dt;
        p.vx += (dx / d) * pull - (dz / d) * pull * 0.85;
        p.vz += (dz / d) * pull + (dx / d) * pull * 0.85;
      }
      p.vx *= Math.max(0, 1 - p.drag * dt);
      p.vy *= Math.max(0, 1 - p.drag * dt);
      p.vz *= Math.max(0, 1 - p.drag * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.spiral > 0 && p.y < 0.2) p.y += dt * 3;
      const k = p.life / p.maxLife;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      col[i * 3] = p.r;
      col[i * 3 + 1] = p.g;
      col[i * 3 + 2] = p.b;
      alp[i] = k * k * 0.8;
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

/* ------------------------------------------------------------------ */
/* per-point batch — fixed-capacity attribute pool, no CPU state       */
/* (motes / bolts / contact shadows / ambient field: 1 draw call each) */
/* ------------------------------------------------------------------ */

export interface PerPointOpts {
  blending?: THREE.Blending;
  renderOrder?: number;
  /** world-units → px scale (150 ≈ house particles; ~880 ≈ world-true at arena distances) */
  scale?: number;
  /** point size clamp in px */
  maxSize?: number;
  /** soft inner edge of the round falloff (0.14 crisp … 0.4 blob) */
  soft?: number;
  /** vertical squash for ground-plane reads (contact shadows) */
  squash?: number;
}

const BATCH_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aSize;
uniform float uPix;
uniform float uScale;
uniform float uMax;
varying vec3 vC;
varying float vA;
void main() {
  vC = aColor;
  vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(0.1, -mv.z);
  gl_PointSize = min(aSize * uPix * (uScale / dist), uMax * uPix);
  vA *= smoothstep(0.3, 1.2, dist);
  gl_Position = projectionMatrix * mv;
}
`;

const BATCH_FRAG = /* glsl */ `
uniform float uSoft;
uniform float uSquash;
varying vec3 vC;
varying float vA;
float hsHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec2 pc = (gl_PointCoord - 0.5) * vec2(1.0, uSquash);
  float d = length(pc);
  float a = smoothstep(0.5, uSoft, d) * vA;
  vec3 col = vC * a + (hsHash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, a);
}
`;

export class PerPointBatch {
  readonly points: THREE.Points;
  private max: number;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;

  constructor(parent: THREE.Object3D, max: number, opts: PerPointOpts = {}) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aColor', this.colAttr);
    this.geo.setAttribute('aAlpha', this.alphaAttr);
    this.geo.setAttribute('aSize', this.sizeAttr);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: BATCH_VERT,
      fragmentShader: BATCH_FRAG,
      uniforms: {
        uPix: { value: 1 },
        uScale: { value: opts.scale ?? 150 },
        uMax: { value: opts.maxSize ?? 46 },
        uSoft: { value: opts.soft ?? 0.16 },
        uSquash: { value: opts.squash ?? 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: opts.blending ?? THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = opts.renderOrder ?? 8;
    parent.add(this.points);
  }

  /** write one slot — callers own all per-point state */
  set(i: number, x: number, y: number, z: number, size: number, color: THREE.Color, alpha: number): void {
    const pos = this.posAttr.array as Float32Array;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    const col = this.colAttr.array as Float32Array;
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
    (this.sizeAttr.array as Float32Array)[i] = size;
    (this.alphaAttr.array as Float32Array)[i] = alpha;
  }

  setCount(n: number): void {
    this.geo.setDrawRange(0, Math.max(0, Math.min(n, this.max)));
  }

  flush(): void {
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  setPixelRatio(dpr: number): void {
    this.mat.uniforms.uPix.value = dpr;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.points.removeFromParent();
  }
}

/* ------------------------------------------------------------------ */
/* shockwave rings                                                     */
/* ------------------------------------------------------------------ */

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  from: number;
  to: number;
  active: boolean;
}

export class RingPool {
  private rings: Ring[] = [];
  private cursor = 0;

  constructor(parent: THREE.Object3D, count = 14, color: THREE.ColorRepresentation = 0xffd27a) {
    const geo = new THREE.RingGeometry(0.92, 1.0, 56);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 7;
      parent.add(mesh);
      this.rings.push({ mesh, mat, t: 0, dur: 0.5, from: 0.5, to: 6, active: false });
    }
  }

  fire(x: number, z: number, to: number, dur: number, color?: THREE.ColorRepresentation): void {
    const r = this.rings[this.cursor];
    this.cursor = (this.cursor + 1) % this.rings.length;
    r.t = 0;
    r.dur = dur;
    r.from = 0.6;
    r.to = to;
    r.active = true;
    r.mesh.visible = true;
    r.mesh.position.set(x, 0.12, z);
    if (color !== undefined) r.mat.color.set(color);
  }

  update(dt: number): void {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 2.4);
      const s = r.from + (r.to - r.from) * e;
      r.mesh.scale.setScalar(s);
      r.mat.opacity = (1 - k) * 0.85;
    }
  }

  dispose(): void {
    for (const r of this.rings) {
      r.mesh.geometry.dispose();
      r.mat.dispose();
      r.mesh.removeFromParent();
    }
  }
}

const WHITE = new THREE.Color('#ffffff');
