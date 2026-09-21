import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS } from './constants';
import { mulberry32, rngRange, rngChance, rngInt, type Rng } from './rng';
import { createRevealMaterial, type PulseArray } from './shaders';

/**
 * Procedural abyss level: a seeded chain of hexagonal pillars winding into the
 * dark, plus branch stubs, crystals, hazards, stalactites, a monolith ring and
 * the far-off Heart. Everything static is merged into ONE reveal-lit mesh.
 */

export interface Collider {
  x: number;
  z: number;
  hx: number;
  hz: number;
  top: number;
}

export interface SpikeZone {
  x: number;
  z: number;
  r: number;
  top: number;
}

export interface LevelData {
  group: THREE.Group;
  material: THREE.ShaderMaterial;
  colliders: Collider[];
  spikes: SpikeZone[];
  shardPositions: THREE.Vector3[];
  gatePosition: THREE.Vector3;
  gateYaw: number;
  spawn: THREE.Vector3;
  hunterHomes: THREE.Vector3[];
  center: THREE.Vector3;
  dispose(): void;
}

interface Node {
  x: number;
  z: number;
  top: number;
  r: number;
}

class GeoBatch {
  private geos: THREE.BufferGeometry[] = [];

  add(g: THREE.BufferGeometry, color: THREE.Color, glow: number, matrix: THREE.Matrix4): void {
    g.applyMatrix4(matrix);
    const nonIndexed = g.index ? g.toNonIndexed() : g;
    if (g.index) g.dispose();
    nonIndexed.deleteAttribute('uv');
    const count = nonIndexed.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const glows = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      glows[i] = glow;
    }
    nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    nonIndexed.setAttribute('aGlow', new THREE.BufferAttribute(glows, 1));
    this.geos.push(nonIndexed);
  }

  merge(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    this.geos = [];
    if (!merged) throw new Error('ECHOVOID: geometry merge failed');
    merged.computeBoundingSphere();
    return merged;
  }
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3(1, 1, 1);
const E = new THREE.Euler();

function mat(px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  E.set(rx, ry, rz);
  Q.setFromEuler(E);
  P.set(px, py, pz);
  S.set(sx, sy, sz);
  return M.compose(P, Q, S);
}

export function buildLevel(
  depth: number,
  seed: number,
  pulseUniform: { value: PulseArray },
): LevelData {
  const rng: Rng = mulberry32(seed);
  const group = new THREE.Group();

  /* ---------- 1. winding path of pillars ---------- */
  const nodes: Node[] = [];
  const branchTips: Node[] = [];
  let dir = rng() * Math.PI * 2;
  let x = 0;
  let z = 0;
  let top = 0;
  nodes.push({ x, z, top, r: 4.5 });

  const mainCount = 13 + Math.min(depth * 2, 9);
  for (let i = 1; i <= mainCount; i++) {
    dir += rngRange(rng, -0.9, 0.9);
    const d = rngRange(rng, 6.0, 8.4);
    x += Math.cos(dir) * d;
    z += Math.sin(dir) * d;
    top = THREE.MathUtils.clamp(top + rngRange(rng, -2.4, 2.8), -6, 5);
    nodes.push({ x, z, top, r: rngRange(rng, 3.1, 4.3) });
  }

  // branch stubs (dead ends — good shard spots)
  const branchCount = 2;
  for (let b = 0; b < branchCount; b++) {
    const idx = rngInt(rng, Math.floor(mainCount * 0.3), mainCount);
    const from = nodes[idx];
    let bx = from.x;
    let bz = from.z;
    let bTop = from.top;
    let bDir = dir + rngRange(rng, -Math.PI, Math.PI);
    const len = rngInt(rng, 2, 4);
    for (let i = 0; i < len; i++) {
      bDir += rngRange(rng, -0.7, 0.7);
      const d = rngRange(rng, 6.0, 7.6);
      bx += Math.cos(bDir) * d;
      bz += Math.sin(bDir) * d;
      bTop = THREE.MathUtils.clamp(bTop + rngRange(rng, -2, 2.4), -6, 5);
      const node: Node = { x: bx, z: bz, top: bTop, r: rngRange(rng, 3.0, 3.8) };
      nodes.push(node);
      if (i === len - 1) branchTips.push(node);
    }
  }

  /* ---------- 2. build geometry ---------- */
  const batch = new GeoBatch();
  const colliders: Collider[] = [];
  const spikes: SpikeZone[] = [];
  const rockColor = new THREE.Color();
  const last = nodes[nodes.length - 1];

  nodes.forEach((n, i) => {
    const isStart = i === 0;
    const isGate = n === last;
    const height = n.top + 13;
    rockColor.copy(COLORS.rockDim).offsetHSL(rngRange(rng, -0.015, 0.015), 0, rngRange(rng, -0.03, 0.05));
    // hexagonal pillar
    batch.add(
      new THREE.CylinderGeometry(n.r, n.r * 1.18, height, 6, 1),
      rockColor,
      isStart || isGate ? 0.95 : rngRange(rng, 0.72, 0.9),
      mat(n.x, n.top - height / 2, n.z),
    );
    // cap rim — slightly larger thin hex, brighter edge
    batch.add(
      new THREE.CylinderGeometry(n.r * 1.04, n.r * 1.04, 0.3, 6, 1),
      COLORS.rock,
      1.0,
      mat(n.x, n.top + 0.05, n.z),
    );
    colliders.push({ x: n.x, z: n.z, hx: n.r * 0.84, hz: n.r * 0.84, top: n.top });

    if (isStart || isGate) return; // keep spawn & gate platforms clean

    // crystal clusters (amber)
    if (rngChance(rng, 0.3)) {
      const cN = rngInt(rng, 2, 5);
      for (let c = 0; c < cN; c++) {
        const a = rng() * Math.PI * 2;
        const cr = rngRange(rng, 0.4, 0.75);
        batch.add(
          new THREE.OctahedronGeometry(rngRange(rng, 0.3, 0.62)),
          COLORS.crystal,
          1.7,
          mat(
            n.x + Math.cos(a) * (n.r - 1.2),
            n.top + cr * 0.8,
            n.z + Math.sin(a) * (n.r - 1.2),
            rngRange(rng, -0.35, 0.35),
            rng() * Math.PI,
            rngRange(rng, -0.35, 0.35),
            1,
            1.9,
            1,
          ),
        );
      }
    }

    // stalagmite
    if (rngChance(rng, 0.4)) {
      const a = rng() * Math.PI * 2;
      const h = rngRange(rng, 1.2, 3.2);
      batch.add(
        new THREE.ConeGeometry(rngRange(rng, 0.35, 0.7), h, 5),
        rockColor,
        0.75,
        mat(n.x + Math.cos(a) * (n.r - 1.4), n.top + h / 2, n.z + Math.sin(a) * (n.r - 1.4)),
      );
    }

    // spike cluster (crimson hazard) — more common deeper
    if (rngChance(rng, 0.18 + depth * 0.035)) {
      const sx = n.x + rngRange(rng, -1.4, 1.4);
      const sz = n.z + rngRange(rng, -1.4, 1.4);
      const sN = rngInt(rng, 2, 5);
      for (let s = 0; s < sN; s++) {
        const h = rngRange(rng, 0.7, 1.25);
        batch.add(
          new THREE.ConeGeometry(0.22, h, 4),
          COLORS.hazard,
          1.45,
          mat(sx + rngRange(rng, -0.55, 0.55), n.top + h / 2, sz + rngRange(rng, -0.55, 0.55)),
        );
      }
      spikes.push({ x: sx, z: sz, r: 1.15, top: n.top });
    }
  });

  // stalactites hanging above the path
  for (let i = 0; i < nodes.length * 1.4; i++) {
    const n = nodes[rngInt(rng, 0, nodes.length)];
    const h = rngRange(rng, 2.5, 7);
    batch.add(
      new THREE.ConeGeometry(rngRange(rng, 0.4, 1.1), h, 5),
      COLORS.rockDim,
      0.7,
      mat(
        n.x + rngRange(rng, -6, 6),
        n.top + rngRange(rng, 9, 16) - h / 2,
        n.z + rngRange(rng, -6, 6),
        Math.PI, // point down
        rng() * Math.PI,
        0,
      ),
    );
  }

  // drifting rock shards around the void
  for (let i = 0; i < 26 + depth * 4; i++) {
    const n = nodes[rngInt(rng, 0, nodes.length)];
    batch.add(
      new THREE.TetrahedronGeometry(rngRange(rng, 0.4, 1.6)),
      COLORS.rockDim,
      rngRange(rng, 0.7, 1.0),
      mat(
        n.x + rngRange(rng, -14, 14),
        n.top + rngRange(rng, -9, 11),
        n.z + rngRange(rng, -14, 14),
        rng() * Math.PI,
        rng() * Math.PI,
        rng() * Math.PI,
      ),
    );
  }

  // perimeter monolith ring — the walls of the world
  let maxDist = 0;
  for (const n of nodes) maxDist = Math.max(maxDist, Math.hypot(n.x, n.z));
  const ringR = maxDist + 17;
  const monoCount = 16 + depth * 2;
  for (let i = 0; i < monoCount; i++) {
    const a = (i / monoCount) * Math.PI * 2 + rngRange(rng, -0.1, 0.1);
    const h = rngRange(rng, 14, 30);
    batch.add(
      new THREE.BoxGeometry(rngRange(rng, 2, 4.5), h, rngRange(rng, 2, 4.5)),
      COLORS.rockDim,
      0.8,
      mat(
        Math.cos(a) * ringR,
        h / 2 - 7,
        Math.sin(a) * ringR,
        rngRange(rng, -0.05, 0.05),
        rng() * Math.PI,
        rngRange(rng, -0.05, 0.05),
      ),
    );
  }

  // far-off Heart of the Void — a colossal crimson ring, always faintly there
  const heart = new THREE.Mesh(
    new THREE.TorusGeometry(26, 2.4, 10, 42),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.9, 0.08, 0.12),
      fog: true,
      transparent: true,
      opacity: 0.55,
    }),
  );
  heart.position.set(0, -85, 0);
  heart.rotation.x = Math.PI / 2.15;
  group.add(heart);

  const material = createRevealMaterial(pulseUniform);
  const geo = batch.merge();
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = true;
  group.add(mesh);

  /* ---------- 3. gameplay anchors ---------- */
  const spawn = new THREE.Vector3(nodes[0].x, nodes[0].top, nodes[0].z);

  // shard spots: branch tips first, then far half of the main path
  const candidates: Node[] = [...branchTips];
  for (let i = Math.floor(mainCount * 0.45); i < mainCount; i++) candidates.push(nodes[i]);
  const shardPositions: THREE.Vector3[] = [];
  const used = new Set<number>();
  while (shardPositions.length < 3 && candidates.length > 0) {
    const i = rngInt(rng, 0, candidates.length);
    if (used.has(i)) continue;
    used.add(i);
    const n = candidates[i];
    shardPositions.push(new THREE.Vector3(n.x, n.top + 1.3, n.z));
  }
  // fallback if branches were unlucky
  let fi = mainCount;
  while (shardPositions.length < 3 && fi >= 1) {
    const n = nodes[fi];
    if (!shardPositions.some((p) => Math.abs(p.x - n.x) < 1 && Math.abs(p.z - n.z) < 1)) {
      shardPositions.push(new THREE.Vector3(n.x, n.top + 1.3, n.z));
    }
    fi--;
  }

  const prev = nodes[nodes.length - 2] ?? nodes[0];
  const gateYaw = Math.atan2(prev.z - last.z, prev.x - last.x);
  const gatePosition = new THREE.Vector3(last.x, last.top, last.z);

  // hunter homes: middle stretch of the path
  const hunterCount = Math.min(2 + depth, 6);
  const hunterHomes: THREE.Vector3[] = [];
  const hiStart = Math.floor(mainCount * 0.3);
  for (let h = 0; h < hunterCount; h++) {
    const n = nodes[hiStart + Math.floor(((h + rng() * 0.8) / hunterCount) * (mainCount - hiStart))] ?? nodes[hiStart];
    hunterHomes.push(new THREE.Vector3(n.x, n.top + 2.6, n.z));
  }

  const center = new THREE.Vector3();
  for (const n of nodes) center.add(new THREE.Vector3(n.x, n.top, n.z));
  center.divideScalar(nodes.length);

  return {
    group,
    material,
    colliders,
    spikes,
    shardPositions,
    gatePosition,
    gateYaw,
    spawn,
    hunterHomes,
    center,
    dispose() {
      geo.dispose();
      material.dispose();
      (heart.material as THREE.Material).dispose();
      heart.geometry.dispose();
      group.removeFromParent();
    },
  };
}
