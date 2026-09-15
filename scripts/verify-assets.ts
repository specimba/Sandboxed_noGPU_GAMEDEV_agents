import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * HOLLOW SUN — asset verify gate.
 *
 * Base law (Task 13-a): every public/assets/meshes/*.glb must parse through
 * the SAME GLTFLoader the runtime uses. Sprint 19-b extension: the LIVING
 * FOES (cinder_hound, hex_weaver) must additionally carry their skeletal
 * animation sets — minimum clip counts per asset and >=1 sampler per
 * animation (checked both on the loaded AnimationClips and on the raw glTF
 * JSON chunk, where `samplers` literally lives).
 */

/** asset (with .glb) -> minimum gltf.animations.length (0 = no requirement) */
const ANIM_MIN: Record<string, number> = {
  'cinder_hound.glb': 5, // prowl_idle, windup, charge_lunge, recover, death_collapse
  'hex_weaver.glb': 3, // hover_idle, anchor_cast, death_collapse
};

/** read the glTF JSON chunk straight out of the GLB container */
function glbJson(buf: Buffer): { animations?: { name?: string; samplers?: unknown[] }[] } {
  const clen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + clen).toString('utf8'));
}

const dir = 'public/assets/meshes';
let pass = 0, fail = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.glb')).sort()) {
  const buf = readFileSync(join(dir, f));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const minAnims = ANIM_MIN[f] ?? 0;
  await new Promise<void>((res) => {
    new GLTFLoader().parse(ab, '', (g) => {
      // animated GLBs root the graph at the ARMATURE node — find the mesh
      let verts = 0;
      g.scene.traverse((o) => {
        const m = o as { isMesh?: boolean; geometry?: { attributes?: { position?: { count: number } } } };
        if (!verts && m.isMesh && m.geometry?.attributes?.position) {
          verts = m.geometry.attributes.position.count;
        }
      });
      let note = '';
      if (minAnims > 0) {
        const clips = g.animations ?? [];
        const raw = glbJson(buf);
        const rawAnims = raw.animations ?? [];
        const noSampler = rawAnims.filter((a) => (a.samplers?.length ?? 0) < 1).length;
        const emptyClips = clips.filter((c) => c.tracks.length < 1).length;
        if (clips.length < minAnims) {
          console.log(`FAIL ${f}: animations=${clips.length} < required ${minAnims}`);
          fail++; res(); return;
        }
        if (noSampler > 0 || emptyClips > 0) {
          console.log(`FAIL ${f}: ${noSampler} animation(s) without samplers, ${emptyClips} empty clip(s)`);
          fail++; res(); return;
        }
        const durs = clips.map((c) => c.duration).map((d) => d.toFixed(2)).join(',');
        note = ` anims=${clips.length}(>=${minAnims}) durs=[${durs}s]`;
      }
      console.log(`PASS ${f} verts=${verts}${note}`);
      pass++; res();
    }, (e) => { console.log(`FAIL ${f}: ${e}`); fail++; res(); });
  });
}
console.log(`ASSET_VERIFY pass=${pass} fail=${fail}`);
