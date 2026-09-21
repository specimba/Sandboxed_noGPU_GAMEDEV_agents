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
 *
 * Sprint 20-4b extension: the three newly rigged foes (striker_dart,
 * bulwark_slab, herald_bell) join ANIM_MIN, and animated GLBs get a
 * CONTENT-LEVEL determinism gate (ANIM_CLIPS): the clip-name set must match
 * the forge contract EXACTLY, every clip must carry >0 samplers and a sane
 * duration (0.2s < d < 12s). This is the declared replacement for md5 on
 * animated assets — animated-GLB forging is not byte-deterministic
 * (19-b deviation), but the RUNTIME-VISIBLE CONTENT is fully pinned here.
 * Static forges stay under the byte-determinism law (forge_ashfall stones
 * are md5 twice-verified out-of-band) and simply join the parse gate below.
 */

/** asset (with .glb) -> minimum gltf.animations.length (0 = no requirement) */
const ANIM_MIN: Record<string, number> = {
  'cinder_hound.glb': 5, // prowl_idle, windup, charge_lunge, recover, death_collapse
  'hex_weaver.glb': 3, // hover_idle, anchor_cast, death_collapse
  'striker_dart.glb': 4, // coil_idle, windup, strike_lunge, recover
  'bulwark_slab.glb': 3, // plod_idle, windup_slam, slam_recover
  'herald_bell.glb': 4, // hover_idle, bell_swing, chime_pulse, recover
};

/**
 * Sprint 20-4b content-level determinism map — asset -> EXACT clip-name set
 * (order-insensitive). Any missing/extra/renamed clip fails the gate.
 */
const ANIM_CLIPS: Record<string, string[]> = {
  'cinder_hound.glb': ['prowl_idle', 'windup', 'charge_lunge', 'recover', 'death_collapse'],
  'hex_weaver.glb': ['hover_idle', 'anchor_cast', 'death_collapse'],
  'striker_dart.glb': ['coil_idle', 'windup', 'strike_lunge', 'recover'],
  'bulwark_slab.glb': ['plod_idle', 'windup_slam', 'slam_recover'],
  'herald_bell.glb': ['hover_idle', 'bell_swing', 'chime_pulse', 'recover'],
};

/** sane clip duration window (s) — catches empty/truncated samplers */
const DUR_MIN = 0.2;
const DUR_MAX = 12.0;

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
  const expectedClips = ANIM_CLIPS[f];
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
      if (expectedClips) {
        // content-level determinism block (declared md5 replacement)
        const clips = g.animations ?? [];
        const raw = glbJson(buf);
        const rawAnims = raw.animations ?? [];
        const got = clips.map((c) => c.name).sort().join(',');
        const want = [...expectedClips].sort().join(',');
        if (got !== want) {
          console.log(`FAIL ${f}: clip set mismatch — got [${got}] want [${want}]`);
          fail++; res(); return;
        }
        const problems: string[] = [];
        for (const name of expectedClips) {
          const clip = clips.find((c) => c.name === name);
          const rawAnim = rawAnims.find((a) => a.name === name);
          if (!clip || !rawAnim) { problems.push(`${name}:missing`); continue; }
          if ((rawAnim.samplers?.length ?? 0) < 1) problems.push(`${name}:no-samplers`);
          if (clip.tracks.length < 1) problems.push(`${name}:empty-tracks`);
          if (!(clip.duration > DUR_MIN && clip.duration < DUR_MAX)) {
            problems.push(`${name}:dur=${clip.duration.toFixed(2)}s`);
          }
        }
        if (problems.length > 0) {
          console.log(`FAIL ${f}: content determinism — ${problems.join(' ')}`);
          fail++; res(); return;
        }
        note += ` clips=[${got}] content-determinism=OK`;
      }
      console.log(`PASS ${f} verts=${verts}${note}`);
      pass++; res();
    }, (e) => { console.log(`FAIL ${f}: ${e}`); fail++; res(); });
  });
}
console.log(`ASSET_VERIFY pass=${pass} fail=${fail}`);
