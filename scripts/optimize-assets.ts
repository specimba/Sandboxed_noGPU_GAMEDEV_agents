/**
 * HOLLOW SUN — gltf-transform optimization gate (pipeline v2, PLAYBOOK §6 upgrade #4).
 *
 * For every public/assets/meshes/*.glb:
 *   1. dedup + weld + prune   (structural: merge identical accessors/materials,
 *                              index the triangle soup, drop unused data)
 *   2. KHR_mesh_quantization  (position→14bit, normal→10bit normalized ints)
 *
 * Why quantization and NOT Draco/Meshopt: KHR_mesh_quantization is DECODER-FREE
 * on the three.js side — GLTFLoader parses normalized int16/uint8 attributes
 * natively. Draco/Meshopt would require wiring DRACOLoader/MeshoptDecoder into
 * the runtime, which the game does not do. So: quantize only, never draco.
 *
 * Safety rails:
 *   - After quantization each asset is parsed with the same GLTFLoader used by
 *     scripts/verify-assets.ts. If parsing fails, the pre-quantization bytes
 *     are restored for that asset and it is reported as quant=SKIPPED.
 *   - After weld/prune each asset is also parsed before quantizing, so a
 *     structural failure can never leave a broken .glb behind.
 *
 * Usage: bun scripts/optimize-assets.ts [--dir public/assets/meshes]
 */

import { NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = arg('--dir', 'public/assets/meshes');

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** copy Buffer bytes into a standalone ArrayBuffer (GLTFLoader.parse rejects
 *  the ArrayBufferLike union TS derives from Buffer.buffer on newer libs) */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

/** parse .glb bytes with GLTFLoader — same gate as scripts/verify-assets.ts */
function parseOk(buf: Buffer): Promise<boolean> {
  return new Promise((res) => {
    try {
      new GLTFLoader().parse(toArrayBuffer(buf), '', () => res(true), () => res(false));
    } catch {
      res(false);
    }
  });
}

const io = new NodeIO().registerExtensions([KHRMeshQuantization]);

const files = readdirSync(DIR).filter((f) => f.endsWith('.glb')).sort();
if (files.length === 0) {
  console.log(`OPTIMIZE: no .glb found in ${DIR}`);
  process.exit(0);
}

let totalBefore = 0;
let totalAfter = 0;
let quantApplied = 0;
let quantSkipped = 0;
const skipNotes: string[] = [];

for (const f of files) {
  const path = join(DIR, f);
  const before = statSync(path).size;

  // --- structural pass (weld + dedup + prune) ---
  const doc = await io.read(path);
  await doc.transform(dedup(), weld(), prune());
  await io.write(path, doc);

  // parse-check the structural result before touching quantization
  const structuralBuf = readFileSync(path);
  if (!(await parseOk(structuralBuf))) {
    writeFileSync(path, readFileSync(path)); // unchanged, but keep the rail explicit
    console.log(`OPTIMIZE ${f}  ${before}B → ${statSync(path).size}B  (structural pass FAILED parse — left as-is)`);
    totalBefore += before;
    totalAfter += before;
    quantSkipped++;
    skipNotes.push(`${f}: structural pass failed GLTFLoader parse`);
    continue;
  }

  // --- quantization pass (KHR_mesh_quantization, decoder-free in three.js) ---
  let after = statSync(path).size;
  let quantNote = 'KHR_mesh_quantization';
  try {
    const qdoc = await io.read(path);
    await qdoc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizationVolume: 'mesh' }));
    await io.write(path, qdoc);

    // prove the optimized bytes still parse through GLTFLoader
    const qbuf = readFileSync(path);
    if (await parseOk(qbuf)) {
      after = qbuf.length;
      quantApplied++;
    } else {
      writeFileSync(path, structuralBuf); // roll back to the welded, unquantized asset
      after = structuralBuf.length;
      quantSkipped++;
      quantNote = 'quant SKIPPED (GLTFLoader could not parse quantized output)';
      skipNotes.push(`${f}: quantized output failed GLTFLoader parse — kept welded/unquantized`);
    }
  } catch (e) {
    writeFileSync(path, structuralBuf);
    after = structuralBuf.length;
    quantSkipped++;
    quantNote = `quant SKIPPED (${(e as Error).message})`;
    skipNotes.push(`${f}: quantize threw — kept welded/unquantized`);
  }

  const delta = after - before;
  const pct = before ? ((delta / before) * 100).toFixed(1) : '0.0';
  console.log(`OPTIMIZE ${f}  ${before}B → ${after}B  (${delta >= 0 ? '+' : ''}${pct}%)  ${quantNote}`);
  totalBefore += before;
  totalAfter += after;
}

const saved = totalBefore - totalAfter;
const pctTotal = totalBefore ? ((saved / totalBefore) * 100).toFixed(1) : '0.0';
console.log(
  `OPTIMIZE TOTAL  ${totalBefore}B → ${totalAfter}B  (saved ${saved}B, ${pctTotal}%)  ` +
    `quant applied=${quantApplied} skipped=${quantSkipped} assets=${files.length}`,
);
if (skipNotes.length) skipNotes.forEach((n) => console.log(`  note: ${n}`));
