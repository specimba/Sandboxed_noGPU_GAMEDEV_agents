/**
 * HOLLOW SUN — assetgen: procedural glTF 2.0 (.glb) generator.
 *
 * "Prompt → Code → Asset" tier 1: deterministic, seeded mesh generation in
 * pure TypeScript — no studio, no GPU, no dependencies. Every mesh is
 * non-indexed with flat face normals (the EMBER RITE chiseled look), packed
 * into a minimal binary glTF that GLTFLoader parses directly.
 *
 * Tier 2 (blender mode, `--blender`): runs the portable Blender build's
 * headless Python (bpy) generator scripts for assets that want modifiers
 * (bevel/solidify/subsurf). Falls back gracefully when Blender is absent.
 *
 * Tier 2 v2 (`--blender-library`): runs scripts/blender/asset_library.py,
 * which builds the WHOLE tier-2 library (obelisk + monolith_cracked +
 * inlay_hex + warden_slab + shard_cluster) into named collections and
 * batch-exports one .glb per collection. `--only a,b` and `--out DIR`
 * are forwarded.
 *
 * Usage:
 *   bun run scripts/assetgen.ts                 # tier 1 → public/assets/meshes
 *   bun run scripts/assetgen.ts --seed 11       # deterministic re-roll
 *   bun run scripts/assetgen.ts --blender       # tier 2 legacy obelisk
 *   bun run scripts/assetgen.ts --blender-library [--only a,b] [--out dir]
 *   bun run scripts/assetgen.ts --out custom/dir
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/* ------------------------------------------------------------------ */
/* seeded rng                                                          */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* mesh model + flat-normal packing                                    */
/* ------------------------------------------------------------------ */

type Tri = [number[], number[], number[]];

interface RawMesh {
  tris: Tri[];
}

/** outward-facing check + flat face normals → exploded triangle soup */
function packFlat(mesh: RawMesh): { positions: Float32Array; normals: Float32Array } {
  const pos: number[] = [];
  const nrm: number[] = [];
  const center = [0, 0, 0];
  let count = 0;
  for (const t of mesh.tris) for (const v of t) { center[0] += v[0]; center[1] += v[1]; center[2] += v[2]; count++; }
  center[0] /= count; center[1] /= count; center[2] /= count;
  for (const tri of mesh.tris) {
    const [a, b, c] = tri;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = (a[0] + b[0] + c[0]) / 3 - center[0];
    const cy = (a[1] + b[1] + c[1]) / 3 - center[1];
    const cz = (a[2] + b[2] + c[2]) / 3 - center[2];
    // flip faces that point into the (roughly convex) volume
    if (nx * cx + ny * cy + nz * cz < 0) {
      [nx, ny, nz] = [-nx, -ny, -nz];
      tri[1] = c; tri[2] = b;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const v of tri) {
      pos.push(v[0], v[1], v[2]);
      nrm.push(nx, ny, nz);
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm) };
}

/* ------------------------------------------------------------------ */
/* minimal .glb writer (non-indexed, POSITION + NORMAL)                */
/* ------------------------------------------------------------------ */

function writeGlb(positions: Float32Array, normals: Float32Array): Buffer {
  const posBin = Buffer.from(positions.buffer);
  const nrmBin = Buffer.from(normals.buffer);
  const vertexCount = positions.length / 3;
  const pad4 = (n: number): number => (4 - (n % 4)) % 4;

  const json = {
    asset: { version: '2.0', generator: 'hollowsun-assetgen' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'asset' }],
    meshes: [{
      name: 'asset',
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, mode: 4 }],
    }],
    buffers: [{ byteLength: posBin.length + nrmBin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBin.length, target: 34962 },
      { buffer: 0, byteOffset: posBin.length, byteLength: nrmBin.length, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' },
    ],
  };

  // true accessor min/max (required by spec for POSITION)
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  (json.accessors[0].min as number[])[0] = min[0];
  (json.accessors[0].min as number[])[1] = min[1];
  (json.accessors[0].min as number[])[2] = min[2];
  (json.accessors[0].max as number[])[0] = max[0];
  (json.accessors[0].max as number[])[1] = max[1];
  (json.accessors[0].max as number[])[2] = max[2];

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = pad4(jsonBuf.length);
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

  const binPad = pad4(posBin.length + nrmBin.length);
  const bin = Buffer.concat([posBin, nrmBin, Buffer.alloc(binPad)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, bin]);
}

/* ------------------------------------------------------------------ */
/* generators — EMBER RITE silhouettes                                 */
/* ------------------------------------------------------------------ */

/** hexagonal bipyramid crystal — shards / pickups (unit ≈ 1.7 long) */
function genCrystal(rng: () => number): RawMesh {
  const r = 0.30, hTop = 1.15, hBot = 0.55;
  const top = [0, hTop, 0];
  const bot = [0, -hBot, 0];
  const ring: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 * i) / 6;
    const rr = r * (0.85 + rng() * 0.3);
    ring.push([Math.cos(a) * rr, (rng() - 0.5) * 0.22, Math.sin(a) * rr]);
  }
  const tris: Tri[] = [];
  for (let i = 0; i < 6; i++) {
    tris.push([top, ring[i], ring[(i + 1) % 6]]);
    tris.push([bot, ring[(i + 1) % 6], ring[i]]);
  }
  return { tris };
}

/** tapered monolith slab — unit height, scale per-instance in engine */
function genMonolith(rng: () => number): RawMesh {
  const w = 0.16 + rng() * 0.08, d = 0.11 + rng() * 0.05;
  const taper = 0.5 + rng() * 0.25;
  const lean = (rng() - 0.5) * 0.06;
  const bot = [
    [-w, 0, -d], [w, 0, -d], [w, 0, d], [-w, 0, d],
  ];
  const mid = bot.map(([x, , z]) => [x * 1.12 + lean * 0.3, 0.55, z * 1.12]);
  const top = bot.map(([x, , z]) => [x * taper + lean, 1, z * taper]);
  const quad = (a: number[], b: number[], c: number[], e: number[]): Tri[] => [
    [a, b, c], [a, c, e],
  ];
  const tris: Tri[] = [];
  for (let ring = 0; ring < 2; ring++) {
    const lo = ring === 0 ? bot : mid;
    const hi = ring === 0 ? mid : top;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      tris.push(...quad(lo[i], lo[j], hi[j], hi[i]));
    }
  }
  tris.push([top[0], top[1], top[2]]);
  tris.push([top[0], top[2], top[3]]);
  return { tris };
}

/** faceted dart hull — player craft (nose +Z) */
function genDart(rng: () => number): RawMesh {
  const L = 0.78, T = -0.52, w = 0.26 + rng() * 0.05, h = 0.22;
  const nose = [0, 0, L];
  const tail = [0, 0, T];
  const ring = [
    [w, 0, 0.05], [0, h, -0.12], [-w, 0, 0.05], [0, -h, -0.12],
  ];
  const tris: Tri[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tris.push([nose, ring[i], ring[j]]);
    tris.push([tail, ring[j], ring[i]]);
  }
  return { tris };
}

/** hollow-lantern crown slab — slim, sword-tip profile (unit height) */
function genLanternSlab(rng: () => number): RawMesh {
  const w = 0.10 + rng() * 0.05;
  const d = w * 0.5;
  const bot = [[-w, 0, -d], [w, 0, -d], [w, 0, d], [-w, 0, d]];
  const mid = bot.map(([x, , z]) => [x * 1.18, 0.45, z * 1.18]);
  const top = bot.map(([x, , z]) => [x * 0.18, 1, z * 0.18]);
  const quad = (a: number[], b: number[], c: number[], e: number[]): Tri[] => [
    [a, b, c], [a, c, e],
  ];
  const tris: Tri[] = [];
  const rings = [bot, mid, top];
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      tris.push(...quad(rings[r][i], rings[r][j], rings[r + 1][j], rings[r + 1][i]));
    }
  }
  tris.push([top[0], top[1], top[2]]);
  tris.push([top[0], top[2], top[3]]);
  return { tris };
}

/* ---------------------------------------------------------------- */
/* sprint 17 — GLASS HOLLOW monolith set (biome-2 asset family)        */
/* ---------------------------------------------------------------- */

const HEX_N = 6;

function hexRing(r: number, y: number, wobble: number, rng: () => number): number[][] {
  const ring: number[][] = [];
  for (let i = 0; i < HEX_N; i++) {
    const a = (Math.PI * 2 * i) / HEX_N;
    const rr = r * (1 - wobble * 0.5 + rng() * wobble);
    ring.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
  }
  return ring;
}

function loftRings(tris: Tri[], lo: number[][], hi: number[][]): void {
  const quad = (a: number[], b: number[], c: number[], e: number[]): Tri[] => [
    [a, b, c], [a, c, e],
  ];
  for (let i = 0; i < HEX_N; i++) {
    const j = (i + 1) % HEX_N;
    tris.push(...quad(lo[i], lo[j], hi[j], hi[i]));
  }
}

function capTop(tris: Tri[], ring: number[][]): void {
  const c = [0, ring[0][1], 0];
  for (let i = 0; i < HEX_N; i++) tris.push([c, ring[i], ring[(i + 1) % HEX_N]]);
}

/** glass monolith — a faceted hex needle with a molten collar; unit height */
function genGlassMonolith(rng: () => number): RawMesh {
  const lean = (rng() - 0.5) * 0.1;
  const r0 = 0.16 + rng() * 0.05;
  const bot = hexRing(r0, 0, 0.1, rng);
  const low = bot.map(([x, , z]) => [x * 0.92 + lean * 0.2, 0.28, z * 0.92]);
  const mid = bot.map(([x, , z]) => [x * 0.55 + lean * 0.6, 0.62, z * 0.55]);
  // the collar — a flared band that catches the biome rim light
  const collar = bot.map(([x, , z]) => [x * 0.95 + lean * 0.7, 0.72, z * 0.95]);
  const top = bot.map(([x, , z]) => [x * 0.1 + lean, 1, z * 0.1]);
  const tris: Tri[] = [];
  loftRings(tris, bot, low);
  loftRings(tris, low, mid);
  loftRings(tris, mid, collar);
  loftRings(tris, collar, top);
  capTop(tris, top);
  return { tris };
}

/** vesica arch — two leaning slabs crossing at the crown (ruin gate) */
function genVesicaArch(rng: () => number): RawMesh {
  const tris: Tri[] = [];
  const slab = (lean: number): void => {
    const w = 0.09 + rng() * 0.03;
    const d = w * 0.7;
    const bot = [[-w, 0, -d], [w, 0, -d], [w, 0, d], [-w, 0, d]];
    const top = bot.map(([x, , z]) => [x * 0.22 + lean, 1, z * 0.22 + lean * 0.4]);
    const quad = (a: number[], b: number[], c: number[], e: number[]): Tri[] => [
      [a, b, c], [a, c, e],
    ];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      tris.push(...quad(bot[i], bot[j], top[j], top[i]));
    }
    tris.push([top[0], top[1], top[2]]);
    tris.push([top[0], top[2], top[3]]);
  };
  slab(-0.34 - rng() * 0.1);
  slab(0.34 + rng() * 0.1);
  return { tris };
}

/** prism cluster — three tilted hex prisms of uneven height off one base */
function genPrismCluster(rng: () => number): RawMesh {
  const tris: Tri[] = [];
  for (let p = 0; p < 3; p++) {
    const a = (Math.PI * 2 * p) / 3 + rng() * 0.5;
    const ox = Math.cos(a) * (0.1 + rng() * 0.12);
    const oz = Math.sin(a) * (0.1 + rng() * 0.12);
    const r = 0.09 + rng() * 0.07;
    const h = 0.5 + rng() * 0.5;
    const tilt = (rng() - 0.5) * 0.28;
    const base: number[][] = [];
    const cap: number[][] = [];
    for (let i = 0; i < HEX_N; i++) {
      const ai = (Math.PI * 2 * i) / HEX_N;
      const bx = ox + Math.cos(ai) * r;
      const bz = oz + Math.sin(ai) * r;
      base.push([bx, 0, bz]);
      cap.push([bx + tilt * h, h, bz + tilt * h * 0.3]);
    }
    loftRings(tris, base, cap);
    capTop(tris, cap);
  }
  return { tris };
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const seed = parseInt(arg('--seed', '7'), 10) || 7;
const outDir = arg('--out', 'public/assets/meshes');
const wantBlender = process.argv.includes('--blender');
const wantBlenderLibrary = process.argv.includes('--blender-library');

mkdirSync(outDir, { recursive: true });

const jobs: { name: string; make: (rng: () => number) => RawMesh }[] = [
  { name: 'shard_crystal', make: genCrystal },
  { name: 'monolith_a', make: genMonolith },
  { name: 'monolith_b', make: genMonolith },
  { name: 'monolith_c', make: genMonolith },
  { name: 'dart_hull', make: genDart },
  { name: 'lantern_slab', make: genLanternSlab },
  // sprint 17 — GLASS HOLLOW monolith set (seeded forever, reproducible)
  { name: 'glass_monolith', make: genGlassMonolith },
  { name: 'vesica_arch', make: genVesicaArch },
  { name: 'prism_cluster', make: genPrismCluster },
];

for (const job of jobs) {
  const rng = mulberry32(seed);
  // advance the stream deterministically per job so re-rolls don't cascade
  for (let i = 0; i < job.name.length * 13; i++) rng();
  const packed = packFlat(job.make(rng));
  const glb = writeGlb(packed.positions, packed.normals);
  const file = join(outDir, `${job.name}.glb`);
  writeFileSync(file, glb);
  console.log(`assetgen  ${job.name}.glb  verts=${packed.positions.length / 3}  ${glb.length}B`);
}

/* ------------------------------------------------------------------ */
/* tier 2 — Blender headless (bpy) for modifier-grade assets           */
/* ------------------------------------------------------------------ */

const BLENDER_CANDIDATES = [
  '/home/z/tools/blender-4.2.0-linux-x64/blender',
  '/usr/bin/blender',
  'blender',
];

function findBlender(): string | null {
  const bin = BLENDER_CANDIDATES.find((p) => (p.includes('/') ? existsSync(p) : true));
  return bin ?? null;
}

function runBlenderScript(scriptRel: string, extraArgs: string[], markers: string[], timeoutMs: number): void {
  const bin = findBlender();
  if (!bin) {
    console.log('blender not found — tier 2 skipped (tier 1 assets already written)');
    return;
  }
  const script = join(process.cwd(), scriptRel);
  try {
    const out = execFileSync(bin, ['-b', '-P', script, '--', ...extraArgs], {
      encoding: 'utf8',
      timeout: timeoutMs,
    });
    const hits = out.split('\n').filter((l) => markers.some((m) => l.includes(m)));
    if (hits.length) hits.forEach((l) => console.log(l));
    else console.log('blender ran (no marker found)');
  } catch (e) {
    console.error('blender tier failed:', (e as Error).message);
  }
}

if (wantBlender) {
  // legacy single-asset obelisk (superseded by the library, kept runnable)
  runBlenderScript('scripts/blender/obelisk.py', [outDir], ['BLENDER_ASSET_OK'], 120000);
}

if (wantBlenderLibrary) {
  // pipeline v2: one bpy script builds the whole tier-2 library and
  // batch-exports one .glb per collection (see asset_library.py header)
  const libArgs = ['out', outDir];
  const onlyIdx = process.argv.indexOf('--only');
  if (onlyIdx > -1 && process.argv[onlyIdx + 1]) libArgs.push('--only', process.argv[onlyIdx + 1]);
  runBlenderScript(
    'scripts/blender/asset_library.py',
    libArgs,
    ['LIBRARY_BUILD', 'LIBRARY_ASSET_OK', 'ASSET_LIBRARY_DONE'],
    540000,
  );
}

console.log(`assetgen done → ${outDir} (seed ${seed})`);
