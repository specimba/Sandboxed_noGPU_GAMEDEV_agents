import * as THREE from "three/webgpu";
import { vec3, vec4, uniform } from "three/tsl";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Enemies } from "@/frontier/sim/Enemies";

/**
 * ENEMY VIEW CONTRACT (specialist S1): per-archetype COMPOSED SILHOUETTES built
 * from primitives, merged (BufferGeometryUtils.mergeGeometries, verified in
 * three r185 examples/jsm) into ONE hull BufferGeometry + ONE emissive accent
 * geometry per archetype -> 2 InstancedMeshes per type (10 draw calls total).
 *   constructor(scene, caps) | sync(enemies, t)   [byte-stable]
 * Hull: dark hematite-red family baked as VERTEX COLORS (material color white,
 * vertexColors on) + faint warm emissive pulse. Accents: ORANGE emissive
 * (MeshBasicNodeMaterial, per-archetype tint x uAcc pulse uniform).
 * hitFlash -> white-hot per-instance pulse via instanceColor (HDR >1, blooms).
 * instanceColor also carries: brute telegraph flare (state 2), spitter windup,
 * colossus slam/barrage flares and damage-driven crack glow (brute/colossus).
 * Forward = +Z local; state semantics documented in sim/Enemies.ts header.
 */

const HULL = [0.30, 0.17, 0.13] as const; // hematite base ~0x4a2a20
const DARK = [0.14, 0.09, 0.08] as const; // joints / undersides
const GUN = [0.16, 0.15, 0.16] as const; // gunmetal limbs / barrels
const WARM = [0.38, 0.21, 0.14] as const; // warm plated panels
const A_BRIGHT = [1.0, 1.0, 1.0] as const; // eyes / vents (full accent tint)
const A_DIM = [0.55, 0.48, 0.45] as const; // hazard stripes / secondary glow
const A_CRACK = [0.75, 0.65, 0.62] as const; // damage cracks (brighten via instanceColor)
const A_SHIELD = [0.85, 0.8, 0.75] as const; // warden shield film

const ACC_TINT: [number, number, number][] = [
  [1.0, 0.42, 0.12], // skiff
  [1.0, 0.5, 0.16], // spitter
  [1.0, 0.4, 0.1], // brute
  [1.0, 0.62, 0.22], // warden (hotter, shield film)
  [1.0, 0.36, 0.09], // colossus (deep ember)
];

const TSPD = [9.5, 4.6, 3.2, 5.0, 2.6]; // sim max speeds (anim normalization)

/** Transform a primitive, bake a vertex color, return non-indexed for merging.
 *  Rotation order: Z then Y then X (spitter legs rely on Z->Y). */
function part(
  geo: THREE.BufferGeometry,
  px: number, py: number, pz: number,
  rx: number, ry: number, rz: number,
  r: number, g: number, b: number,
): THREE.BufferGeometry {
  if (rz !== 0) geo.rotateZ(rz);
  if (ry !== 0) geo.rotateY(ry);
  if (rx !== 0) geo.rotateX(rx);
  geo.translate(px, py, pz);
  const out = geo.index !== null ? geo.toNonIndexed() : geo;
  const n = out.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    col[v * 3] = r;
    col[v * 3 + 1] = g;
    col[v * 3 + 2] = b;
  }
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error("EnemiesView: geometry merge failed");
  return g;
}

const HALF_PI = Math.PI / 2;

// ---- per-archetype builders: [hullGeo, accentGeo], origin at ground contact,
// forward = +Z. Floaters (skiff/warden) are baked at hover height and lifted in
// sync(); walkers stand on y=0.

function skiffGeos(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const hull = merge([
    part(new THREE.ConeGeometry(0.42, 1.5, 5), 0, 0, 0.15, HALF_PI, 0, 0, ...HULL),
    part(new THREE.BoxGeometry(0.5, 0.26, 0.7), 0, -0.02, -0.5, 0, 0, 0, ...DARK),
    part(new THREE.BoxGeometry(0.05, 0.3, 0.55), 0.33, 0.1, -0.6, 0, 0, 0.55, ...GUN),
    part(new THREE.BoxGeometry(0.05, 0.3, 0.55), -0.33, 0.1, -0.6, 0, 0, -0.55, ...GUN),
    part(new THREE.BoxGeometry(0.26, 0.14, 0.42), 0, 0.18, 0.1, 0, 0, 0, ...WARM),
    part(new THREE.BoxGeometry(0.24, 0.1, 0.9), 0, -0.16, 0, 0, 0, 0, ...DARK),
  ]);
  const acc = merge([
    part(new THREE.BoxGeometry(0.09, 0.05, 0.06), 0.12, 0.03, 0.35, 0, 0, 0, ...A_BRIGHT),
    part(new THREE.BoxGeometry(0.09, 0.05, 0.06), -0.12, 0.03, 0.35, 0, 0, 0, ...A_BRIGHT),
    part(new THREE.BoxGeometry(0.34, 0.1, 0.06), 0, 0, -0.87, 0, 0, 0, ...A_BRIGHT),
    part(new THREE.BoxGeometry(0.05, 0.04, 0.16), 0.4, 0.06, -0.62, 0, 0, 0, ...A_DIM),
    part(new THREE.BoxGeometry(0.05, 0.04, 0.16), -0.4, 0.06, -0.62, 0, 0, 0, ...A_DIM),
  ]);
  return [hull, acc];
}

function spitterGeos(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const hull: THREE.BufferGeometry[] = [];
  const acc: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const az = k * (Math.PI * 2 / 3) + 0.5;
    const sa = Math.sin(az);
    const ca = Math.cos(az);
    const hx = sa * 0.28;
    const hz = ca * 0.28;
    const fx = sa * 1.05;
    const fz = ca * 1.05;
    const midx = (hx + fx) / 2;
    const midy = (1.3 + 0.06) / 2;
    const midz = (hz + fz) / 2;
    hull.push(part(new THREE.CylinderGeometry(0.055, 0.075, 1.5, 5), midx, midy, midz, 0, az - HALF_PI, 0.556, ...GUN));
    hull.push(part(new THREE.ConeGeometry(0.09, 0.35, 4), fx, 0.16, fz, Math.PI, 0, 0, ...DARK)); // foot spike (points down)
    acc.push(part(new THREE.BoxGeometry(0.07, 0.07, 0.07), sa * 0.65, 0.72, ca * 0.65, 0, 0, 0, ...A_DIM)); // knee glow
  }
  hull.push(part(new THREE.SphereGeometry(0.4, 8, 6), 0, 1.35, -0.05, 0, 0, 0, ...HULL));
  hull.push(part(new THREE.BoxGeometry(0.34, 0.28, 0.52), 0, 1.62, 0.5, 0, 0, 0, ...WARM));
  hull.push(part(new THREE.CylinderGeometry(0.08, 0.1, 0.72, 6), 0, 1.62, 0.95, HALF_PI, 0, 0, ...GUN));
  hull.push(part(new THREE.ConeGeometry(0.12, 0.5, 5), 0, 1.5, -0.75, -HALF_PI, 0, 0, ...GUN)); // tail stinger
  acc.push(part(new THREE.SphereGeometry(0.09, 6, 5), 0, 1.66, 0.78, 0, 0, 0, ...A_BRIGHT));
  acc.push(part(new THREE.BoxGeometry(0.05, 0.05, 0.05), 0.14, 1.6, 0.72, 0, 0, 0, ...A_DIM));
  acc.push(part(new THREE.BoxGeometry(0.05, 0.05, 0.05), -0.14, 1.6, 0.72, 0, 0, 0, ...A_DIM));
  acc.push(part(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 6), 0, 1.62, 1.3, HALF_PI, 0, 0, ...A_BRIGHT)); // muzzle ring
  acc.push(part(new THREE.BoxGeometry(0.2, 0.06, 0.3), 0, 1.72, -0.35, 0, 0, 0, ...A_DIM)); // back vent
  return [merge(hull), merge(acc)];
}

function bruteGeos(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const hull = merge([
    part(new THREE.BoxGeometry(2.1, 0.85, 2.7), 0, 0.85, 0, 0, 0, 0, ...HULL),
    part(new THREE.BoxGeometry(2.14, 0.16, 1.1), 0, 1.05, 1.5, 0.5, 0, 0, ...WARM), // sloped glacis
    part(new THREE.BoxGeometry(0.75, 0.75, 1.15), 1.4, 1.35, -0.1, 0, 0, 0, ...WARM),
    part(new THREE.BoxGeometry(0.75, 0.75, 1.15), -1.4, 1.35, -0.1, 0, 0, 0, ...WARM),
    part(new THREE.BoxGeometry(0.55, 0.42, 0.6), 0, 1.5, 0.85, 0, 0, 0, ...DARK),
    part(new THREE.BoxGeometry(0.6, 0.55, 1.0), 0.85, 0.28, 0.85, 0, 0, 0, ...DARK),
    part(new THREE.BoxGeometry(0.6, 0.55, 1.0), -0.85, 0.28, 0.85, 0, 0, 0, ...DARK),
    part(new THREE.BoxGeometry(0.6, 0.55, 1.0), 0.85, 0.28, -0.85, 0, 0, 0, ...DARK),
    part(new THREE.BoxGeometry(0.6, 0.55, 1.0), -0.85, 0.28, -0.85, 0, 0, 0, ...DARK),
    part(new THREE.CylinderGeometry(0.09, 0.12, 0.6, 6), 0.5, 1.55, -1.25, 0, 0, 0, ...GUN),
    part(new THREE.CylinderGeometry(0.09, 0.12, 0.6, 6), -0.5, 1.55, -1.25, 0, 0, 0, ...GUN),
    part(new THREE.BoxGeometry(2.0, 0.6, 0.2), 0, 1.1, -1.42, 0, 0, 0, ...GUN),
  ]);
  const acc = merge([
    part(new THREE.BoxGeometry(0.4, 0.08, 0.06), 0, 1.56, 1.17, 0, 0, 0, ...A_BRIGHT), // eye bar
    part(new THREE.BoxGeometry(0.78, 0.12, 0.06), 1.42, 1.5, 0.48, 0, 0, 0, ...A_DIM),
    part(new THREE.BoxGeometry(0.78, 0.12, 0.06), -1.42, 1.5, 0.48, 0, 0, 0, ...A_DIM),
    part(new THREE.BoxGeometry(0.34, 0.5, 0.06), 0.55, 1.35, -1.53, 0, 0, 0, ...A_DIM),
    part(new THREE.BoxGeometry(0.34, 0.5, 0.06), -0.55, 1.35, -1.53, 0, 0, 0, ...A_DIM),
    part(new THREE.BoxGeometry(2.1, 0.07, 0.07), 0, 0.72, 2.02, 0, 0, 0, ...A_BRIGHT), // blade edge
    part(new THREE.BoxGeometry(0.05, 0.5, 0.05), 1.06, 0.9, 0.3, 0, 0, 0.3, ...A_CRACK),
    part(new THREE.BoxGeometry(0.05, 0.5, 0.05), -1.06, 0.9, 0.3, 0, 0, -0.3, ...A_CRACK),
    part(new THREE.BoxGeometry(0.05, 0.05, 0.4), 0.3, 1.28, 1.0, 0, 0, 0, ...A_CRACK),
  ]);
  return [hull, acc];
}

function wardenGeos(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const core = new THREE.SphereGeometry(0.5, 10, 8);
  core.scale(1, 0.8, 1.2);
  const hull = merge([
    part(core, 0, 1.5, 0, 0, 0, 0, ...HULL),
    part(new THREE.BoxGeometry(0.08, 0.45, 0.7), 0, 2.05, -0.25, -0.2, 0, 0, ...WARM), // dorsal fin
    part(new THREE.BoxGeometry(0.28, 0.28, 0.8), 0.62, 1.5, 0, 0, 0, 0, ...GUN),
    part(new THREE.BoxGeometry(0.28, 0.28, 0.8), -0.62, 1.5, 0, 0, 0, 0, ...GUN),
    part(new THREE.CylinderGeometry(0.02, 0.035, 0.9, 4), 0.55, 2.25, -0.4, 0, 0, -0.25, ...GUN),
    part(new THREE.CylinderGeometry(0.02, 0.035, 0.9, 4), -0.55, 2.25, -0.4, 0, 0, 0.25, ...GUN),
    part(new THREE.CylinderGeometry(0.045, 0.045, 1.0, 5), 0.75, 1.55, 0.55, 0, 0, -1.15, ...GUN), // shield struts
    part(new THREE.CylinderGeometry(0.045, 0.045, 1.0, 5), -0.75, 1.55, 0.55, 0, 0, 1.15, ...GUN),
  ]);
  const acc = merge([
    part(new THREE.CylinderGeometry(1.15, 1.15, 1.8, 20, 1, true, -1.05, 2.1), 0, 1.55, 0.15, 0, 0, 0, ...A_SHIELD), // shield film
    part(new THREE.SphereGeometry(0.14, 6, 5), 0, 1.5, 0.62, 0, 0, 0, ...A_BRIGHT), // core eye
    part(new THREE.CylinderGeometry(0.3, 0.42, 0.1, 8), 0, 1.02, 0, 0, 0, 0, ...A_DIM), // underglow
    part(new THREE.BoxGeometry(0.05, 0.08, 0.05), 0.72, 2.62, -0.5, 0, 0, 0, ...A_BRIGHT),
    part(new THREE.BoxGeometry(0.05, 0.08, 0.05), -0.72, 2.62, -0.5, 0, 0, 0, ...A_BRIGHT),
  ]);
  return [hull, acc];
}

function colossusGeos(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const hull: THREE.BufferGeometry[] = [];
  const acc: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const side = k < 2 ? 1 : -1;
    const fwd = k % 2 === 0 ? 1 : -1;
    const lean = side > 0 ? 0.32 : -0.32; // top toward body center
    hull.push(part(new THREE.CylinderGeometry(0.3, 0.36, 1.6, 7), side * 1.575, 1.02, fwd * 1.4, 0, 0, lean, ...GUN));
    hull.push(part(new THREE.BoxGeometry(0.85, 0.5, 1.15), side * 2.0, 0.25, fwd * 1.4, 0, 0, 0, ...DARK));
  }
  hull.push(part(new THREE.BoxGeometry(3.0, 1.4, 4.4), 0, 2.3, 0, 0, 0, 0, ...HULL));
  hull.push(part(new THREE.BoxGeometry(2.3, 0.75, 3.2), 0, 3.2, -0.3, 0, 0, 0, ...WARM));
  hull.push(part(new THREE.BoxGeometry(1.15, 0.85, 1.5), 0, 2.6, 2.6, 0, 0, 0, ...DARK));
  hull.push(part(new THREE.BoxGeometry(0.8, 0.8, 0.5), 0, 2.55, 2.9, 0, 0, 0, ...WARM)); // mantlet
  hull.push(part(new THREE.CylinderGeometry(0.24, 0.3, 2.6, 8), 0, 2.55, 3.6, HALF_PI, 0, 0, ...GUN));
  for (let k = 0; k < 3; k++) {
    hull.push(part(new THREE.ConeGeometry(0.16, 0.5, 4), 0, 3.85, -1.3 + k * 0.9, 0, 0, 0, ...GUN));
  }
  const core = new THREE.SphereGeometry(0.55, 8, 6);
  core.scale(1, 0.7, 1);
  acc.push(part(core, 0, 1.85, 0.6, 0, 0, 0, ...A_BRIGHT)); // belly core
  acc.push(part(new THREE.BoxGeometry(0.8, 0.14, 0.08), 0, 2.72, 3.28, 0, 0, 0, ...A_BRIGHT)); // eye bar
  acc.push(part(new THREE.CylinderGeometry(0.32, 0.32, 0.14, 8), 0, 2.55, 4.85, HALF_PI, 0, 0, ...A_BRIGHT)); // cannon ring
  for (let k = 0; k < 3; k++) {
    acc.push(part(new THREE.BoxGeometry(0.5, 0.1, 0.35), 0, 3.62, -1.1 + k * 0.8, 0, 0, 0, ...A_DIM)); // back vents
    acc.push(part(new THREE.BoxGeometry(0.1, 0.08, 0.1), 0, 4.12, -1.3 + k * 0.9, 0, 0, 0, ...A_DIM)); // fin tips
  }
  acc.push(part(new THREE.BoxGeometry(0.06, 0.8, 0.06), 1.52, 2.3, 0.4, 0, 0, 0.4, ...A_CRACK));
  acc.push(part(new THREE.BoxGeometry(0.06, 0.8, 0.06), -1.52, 2.3, 0.4, 0, 0, -0.4, ...A_CRACK));
  acc.push(part(new THREE.BoxGeometry(0.06, 0.06, 0.9), 1.52, 2.7, -0.9, 0, 0, 0, ...A_CRACK));
  acc.push(part(new THREE.BoxGeometry(0.06, 0.06, 0.9), -1.52, 2.7, -0.9, 0, 0, 0, ...A_CRACK));
  return [merge(hull), merge(acc)];
}

const BUILDERS = [skiffGeos, spitterGeos, bruteGeos, wardenGeos, colossusGeos];

export class EnemiesView {
  readonly meshes: THREE.InstancedMesh[]; // hull meshes (public, byte-stable)
  private accMeshes: THREE.InstancedMesh[] = [];
  private caps: number[];
  private uAcc = [uniform(0.9), uniform(0.9), uniform(0.9), uniform(0.9), uniform(0.9)];
  private uHull = uniform(0.9);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private hullCol: Float32Array[] = [];
  private accCol: Float32Array[] = [];
  private counts = [0, 0, 0, 0, 0]; // preallocated (zero alloc in sync)

  constructor(scene: THREE.Scene, caps: number[]) {
    this.caps = caps;
    this.e.order = "YXZ";
    this.meshes = [];
    for (let k = 0; k < 5; k++) {
      const [hullGeo, accGeo] = BUILDERS[k]();
      const cap = Math.max(1, caps[k]);
      const hull = new THREE.InstancedMesh(
        hullGeo,
        new THREE.MeshStandardNodeMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: 0.55,
          metalness: 0.5,
          emissiveNode: vec3(1.0, 0.32, 0.1).mul(this.uHull.mul(0.06)),
        }),
        cap,
      );
      const tint = ACC_TINT[k];
      const acc = new THREE.InstancedMesh(
        accGeo,
        new THREE.MeshBasicNodeMaterial({
          vertexColors: true,
          colorNode: vec4(vec3(tint[0], tint[1], tint[2]).mul(this.uAcc[k]), 1),
        }),
        cap,
      );
      const hcol = new Float32Array(cap * 3).fill(1);
      const acol = new Float32Array(cap * 3).fill(1);
      hull.instanceColor = new THREE.InstancedBufferAttribute(hcol, 3);
      acc.instanceColor = new THREE.InstancedBufferAttribute(acol, 3);
      for (const mesh of [hull, acc]) {
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.frustumCulled = false;
      }
      hull.castShadow = true;
      scene.add(hull, acc);
      this.meshes.push(hull);
      this.accMeshes.push(acc);
      this.hullCol.push(hcol);
      this.accCol.push(acol);
    }
  }

  sync(en: Enemies, t: number): void {
    // shared pulses (CPU-computed, no per-frame node churn)
    this.uHull.value = 0.75 + 0.25 * Math.sin(t * 1.7);
    for (let k = 0; k < 5; k++) {
      this.uAcc[k].value = k === 3 ? 0.8 + 0.4 * Math.sin(t * 5.1) : 0.85 + 0.3 * Math.sin(t * 2.9 + k * 1.37);
    }
    const counts = this.counts;
    counts[0] = counts[1] = counts[2] = counts[3] = counts[4] = 0;
    for (let i = 0; i < en.max; i++) {
      if (!en.alive[i]) continue;
      const k = en.type[i];
      const ci = counts[k];
      if (ci >= this.caps[k]) continue;
      counts[k] = ci + 1;
      const st = en.state[i];
      const sn = Math.min(1, en.speed[i] / TSPD[k]); // speed-normalized gait
      // per-archetype placement + animation (scalar math only)
      let y = 0;
      let roll = 0;
      let pitch = 0;
      if (k === 0) {
        y = 0.9 + Math.sin(t * 6.3 + i * 1.31) * 0.09;
        roll = Math.sin(t * 5.1 + i * 0.7) * 0.07;
        pitch = -0.06;
      } else if (k === 1) {
        roll = Math.sin(t * 2.3 + i) * 0.04;
      } else if (k === 2) {
        y = Math.abs(Math.sin(t * 6.8 + i * 0.9)) * 0.06 * sn;
        roll = Math.sin(t * 6.8 + i * 0.9) * 0.02 * sn;
        pitch = Math.sin(t * 3.4 + i) * 0.015;
      } else if (k === 3) {
        y = 0.35 + Math.sin(t * 2.4 + i * 1.7) * 0.12;
        roll = Math.sin(t * 1.8 + i) * 0.05;
        pitch = 0.05;
      } else {
        y = Math.abs(Math.sin(t * 3.2 + i)) * 0.07 * sn;
        pitch = Math.sin(t * 3.2 + i) * 0.03 * sn;
        roll = Math.sin(t * 1.6 + i) * 0.015;
      }
      this.p.set(en.x[i], y, en.z[i]);
      this.e.set(pitch, en.angle[i], roll);
      this.q.setFromEuler(this.e);
      this.s.setScalar(1);
      this.m.compose(this.p, this.q, this.s);
      this.meshes[k].setMatrixAt(ci, this.m);
      this.accMeshes[k].setMatrixAt(ci, this.m);
      // accent factor: state telegraphs + damage-driven cracks
      let am = 1;
      if (k === 2) {
        if (st === 2) am = 1.6 + (0.5 + 0.5 * Math.sin(t * 40)) * 1.6; // charge telegraph flare
        else if (st === 3) am = 1.5;
        else am = 0.9;
      } else if (k === 1) {
        if (st === 2) am = 1.7 + Math.sin(t * 36) * 0.5; // fire windup
      } else if (k === 4) {
        if (st === 2) am = 1.8 + (0.5 + 0.5 * Math.sin(t * 38)) * 1.2; // slam windup
        else if (st === 1) am = 1.35; // barrage
      }
      if (k === 2 || k === 4) am *= 0.85 + (1 - en.hp[i] / en.hpMax[i]) * 0.9;
      // instance colors: hull tint x white-hot flash, accent x flash
      const f = en.hitFlash[i];
      const v = ((i * 40503) & 255) / 255;
      const ho = ci * 3;
      const hc = this.hullCol[k];
      hc[ho] = (0.95 + v * 0.1) * (1 + f * 2.6) + f * 0.9;
      hc[ho + 1] = (0.9 + v * 0.12) * (1 + f * 2.4) + f * 0.75;
      hc[ho + 2] = (0.88 + v * 0.14) * (1 + f * 2.0) + f * 0.55;
      const ac = this.accCol[k];
      ac[ho] = am * (1 + f * 1.9);
      ac[ho + 1] = am * (1 + f * 1.55);
      ac[ho + 2] = am * (1 + f * 1.1);
    }
    for (let k = 0; k < 5; k++) {
      const hull = this.meshes[k];
      const acc = this.accMeshes[k];
      const prev = hull.count;
      const c = counts[k];
      hull.count = c;
      acc.count = c;
      if (c > 0 || prev > 0) {
        hull.instanceMatrix.needsUpdate = true;
        acc.instanceMatrix.needsUpdate = true;
        hull.instanceColor!.needsUpdate = true;
        acc.instanceColor!.needsUpdate = true;
      }
    }
  }
}
