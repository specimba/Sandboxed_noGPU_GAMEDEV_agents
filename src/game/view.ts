import * as THREE from 'three';
import { loadAssetGeometry, loadAssetScene } from './assetLib';
import { FoeAnimator, type AnimKind } from './foeAnim';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ARENA, CC, CINDER, COLORS, FOE, HEX, HOUND, RIME, RITE } from './constants';
import type { FoeKind, Sim } from './sim';
import { makeGlowTexture, ParticlePool, PerPointBatch } from './fx';
import {
  coreMaterial,
  makeDiamondTexture,
  makeDiamondTextureDark,
  makeStreakTexture,
  stylizedMaterial,
  type StylizedOpts,
} from './materials';

/**
 * HOLLOW SUN view — "EMBER RITE" entity layer.
 *
 * Every living thing is a dark chiseled obsidian shell: faceted solid with a
 * fresnel rim in its identity color and a small emissive heart. Silhouettes
 * first, glow never carries the shape — additive sprites survive only as
 * small heart accents, the dart's tail ember and the reticle hairlines.
 *
 * sync() is a pure visual re-sync of the frozen sim contract: same fields
 * read, same pool/pop/spin/telegraph/buffer math — only the looks moved.
 */

const FOE_GEO: Record<FoeKind, THREE.BufferGeometry> = {
  drifter: new THREE.OctahedronGeometry(0.95, 0).scale(1, 1.25, 1), // ash husk
  striker: new THREE.ConeGeometry(0.62, 1.7, 4).rotateX(Math.PI / 2), // cinder dart, tip = +Z
  weaver: new THREE.TorusGeometry(0.66, 0.15, 6, 3).rotateX(Math.PI / 2), // hex weaver ring, flat
  caster: new THREE.CylinderGeometry(0.22, 0.52, 1.8, 4), // grave obelisk
  bulwark: new THREE.BoxGeometry(1.7, 1.5, 1.7), // tomb slab that walks
  herald: new THREE.CylinderGeometry(0.38, 0.78, 1.0, 6), // the flared bell
  hound: new THREE.ConeGeometry(0.55, 1.9, 3).rotateX(Math.PI / 2).scale(1.25, 0.6, 1), // lean wedge, tip = +Z
  warden: new THREE.OctahedronGeometry(2.2, 0).scale(1, 1.35, 1), // the monolith titan
};

/** identity color — rim, heart, halo and telegraph all speak it */
function isAnimKind(k: FoeKind): k is AnimKind {
  return k === 'hound' || k === 'weaver' || k === 'striker' || k === 'bulwark' || k === 'herald';
}

const FOE_COL: Record<FoeKind, number> = {
  drifter: COLORS.foe,
  striker: 0xff7a3d,
  weaver: 0xff2d6e,
  caster: 0xb8e63d,
  bulwark: 0xffb35c,
  herald: 0x9adfff, // the only cold voice in a warm world — the veil speaks ice
  hound: 0xff4a1f, // deep ember — the burn-line color
  warden: COLORS.warden,
};

/** chiseled shell STYLE per kind — every pool entry builds its OWN material
 *  through the stylizedMaterial() factory (which auto-registers it into the
 *  uTime tick), so per-foe hit-flash / tints are possible. Materials are NOT
 *  shared: .clone() would bypass the registry and freeze uTime. Draw-call
 *  law holds: calls are per MESH, not per material. */
const FOE_STYLE: Record<FoeKind, StylizedOpts> = {
  drifter: {
    base: COLORS.obsidian,
    lit: COLORS.obsidianLit,
    rim: FOE_COL.drifter,
    rimK: 1.2,
    emis: FOE_COL.drifter,
    emisK: 0.1,
  },
  striker: {
    base: COLORS.obsidian,
    lit: COLORS.obsidianLit,
    rim: FOE_COL.striker,
    rimK: 1.3,
    emis: FOE_COL.striker,
    emisK: 0.1,
  },
  weaver: {
    base: COLORS.obsidian,
    lit: COLORS.obsidianLit,
    rim: FOE_COL.weaver,
    rimK: 1.4,
    emis: FOE_COL.weaver,
    emisK: 0.1,
  },
  caster: {
    base: COLORS.obsidian,
    lit: COLORS.obsidianLit,
    rim: FOE_COL.caster,
    rimK: 1.2,
    emis: 0x9dc43a,
    emisK: 0.15,
  },
  bulwark: {
    base: COLORS.obsidian,
    lit: COLORS.obsidianLit,
    rim: FOE_COL.bulwark,
    rimK: 0.9,
    rimPow: 3,
  },
  herald: {
    base: 0x0e1a20,
    lit: 0x24404c,
    rim: FOE_COL.herald,
    rimK: 1.5,
    rimPow: 2.2,
    emis: FOE_COL.herald,
    emisK: 0.14,
    pulse: 0.2,
  },
  hound: {
    base: COLORS.obsidian,
    lit: COLORS.obsidianLit,
    rim: FOE_COL.hound,
    rimK: 1.3,
    emis: FOE_COL.hound,
    emisK: 0.12,
    pulse: 0.2, // ember-crack shimmer while it stalks
  },
  warden: {
    base: 0x140d08,
    lit: COLORS.obsidianLit,
    rim: FOE_COL.warden,
    rimK: 1.5,
    rimPow: 2.2,
    emis: FOE_COL.warden,
    emisK: 0.12,
    pulse: 0.15,
  },
};

/** the bulwark's frontal armor — brighter than the body, the block zone reads */
const PLATE_MAT = stylizedMaterial({
  base: 0x3a2a1a,
  lit: COLORS.obsidianLit,
  rim: 0xffe2a8,
  rimK: 1.4,
  emis: 0xffd27a,
  emisK: 0.25,
});

/** small additive heart accents — halved from the old glow-ball scales */
const FOE_HEART: Record<FoeKind, { color: number; scale: number; opacity: number }> = {
  drifter: { color: 0xff3b52, scale: 1.6, opacity: 0.35 },
  striker: { color: 0xff7a3d, scale: 1.4, opacity: 0.35 },
  weaver: { color: 0xff2d6e, scale: 1.6, opacity: 0.3 },
  caster: { color: 0xc9ff6a, scale: 1.5, opacity: 0.35 },
  bulwark: { color: 0xffb35c, scale: 1.8, opacity: 0.3 },
  herald: { color: 0x9adfff, scale: 1.9, opacity: 0.45 },
  hound: { color: 0xff6a2d, scale: 1.5, opacity: 0.38 },
  warden: { color: 0xff5a2d, scale: 4.5, opacity: 0.4 },
};

interface FoeView {
  group: THREE.Group;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial; // per-entry (NOT shared) — hit-flash/tint capable
  baseEmisK: number; // style's resting emissive strength
  baseRim: THREE.Color; // style's identity rim
  flashT: number; // hit-flash clock (0 idle)
  glow: THREE.Sprite;
  core: THREE.Mesh; // weaver's inner light
  plate: THREE.Mesh; // bulwark frontal armor
  kind: FoeKind;
  /* LIVING FOES (sprint 19-b) — the skinned override for rigged kinds.
   * null = static mesh law (fallback / not-yet-arrived asset). */
  skinned: THREE.Group | null;
  skinnedMats: THREE.MeshStandardMaterial[]; // per-entry clones for the hit-flash wash
  animId: number; // FoeAnimator key (stable per pool seat)
}

interface HexView {
  group: THREE.Group;
  rimMat: THREE.MeshBasicMaterial;
  fillMat: THREE.MeshBasicMaterial;
}

/** merged 6-spoke root bind — ONE draw call while rooted, hidden otherwise */
function buildEntangleGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  let vi = 0;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const r0 = 0.3;
    const r1 = 1.3;
    const w = 0.06;
    pos.push(
      ca * r0 - sa * w, 0.1, sa * r0 + ca * w,
      ca * r0 + sa * w, 0.1, sa * r0 - ca * w,
      ca * r1 + sa * w, 0.1, sa * r1 - ca * w,
      ca * r1 - sa * w, 0.1, sa * r1 + ca * w,
    );
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    vi += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** merge flat (already ground-rotated) sub-geometries into ONE vertex-colored
 *  draw — a cinder patch is rim + fill in a single mesh (1 DC per patch, so
 *  the declared worst transient is one draw per live patch, not two) */
function mergeFlatVertexColored(geos: THREE.BufferGeometry[], colors: number[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let off = 0;
  const c = new THREE.Color();
  geos.forEach((g, gi) => {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    c.set(colors[gi]);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    const ix = g.getIndex();
    if (ix) {
      for (let i = 0; i < ix.count; i++) idx.push(off + ix.getX(i));
    } else {
      for (let i = 0; i < p.count; i++) idx.push(off + i);
    }
    off += p.count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

interface MarkView {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial; // bright rim
  baseMat: THREE.MeshBasicMaterial; // foeDeep floor wash
}

interface HaloView {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

/** DEATH GHOST (20-4c C3) — a detached SkeletonUtils.clone of the kind's
 *  prototype playing death_collapse once, sinking/fading, then freed */
interface GhostView {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  mats: THREE.MeshStandardMaterial[]; // per-ghost clones — the live pool never fades with it
  t: number;
  dur: number; // the death clip's own duration owns the clock
  y0: number;
}

/** last-seen live state, kept so a vanished id can die again, visibly */
interface FoeRecord {
  kind: FoeKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** ember-vacuum mote — callers own all state (PerPointBatch is stateless) */
interface MoteState {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  size: number;
}

interface CinderView {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

interface SparkView {
  line: THREE.Line;
  mat: THREE.LineBasicMaterial;
  life: number;
}

const MAX_BULLETS = 340;
const MAX_HEAVY = 60;
const MAX_VEIL = 80; // herald chimes — the slow cold layer
const CC_POOL = 12; // per-CC-type marker seats (0 draw calls when idle)
const CINDER_POOL = 5; // wake patch seats (sim caps live patches at CINDER.maxPatches)
const SHADOW_POOL = 41; // 1 ember dart + 40 foes
const SPARK_SEGS = 8;
const FLASH_TIME = 0.09; // per-foe hit-flash window
const HALO_R0 = 0.94; // haloGeo outer edge — scale = desired radius / HALO_R0

/** DEATH GHOST one-shot queue (20-4c C3) — Godot AnimationPlayer.queue
 *  analog: a killed rigged foe re-dies visibly. 2 concurrent seats max —
 *  transient ≤ +2 draw calls, declared; queue full → skip silently. */
const GHOST_POOL = 2;

/** EMBER VACUUM (20-4c C4) — payout income made physical: per kill, 3 motes
 *  linger at the corpse ~0.5s then accelerate to the dart. ONE PerPointBatch
 *  draw while alive, +0 persistent (idle drawRange 0, bullet-pool law).
 *  Phases are the existing hash laws — zero rng. */
const VACUUM_SEATS = 6;
const VACUUM = { linger: 0.5, life: 1.7, pull: 30, cap: 22, reach: 0.7 };

/** sprint 18 crown halos — ring = affix, extending the elite halo law.
 *  Rime speaks the sanctioned cold voice (herald/veil family, view.ts FOE_COL
 *  precedent); cinder speaks the burn-line ember. Zero blue/indigo drift. */
const CROWN_HALO: Partial<Record<'rime' | 'cinder', { rim: number; radius?: number }>> = {
  rime: { rim: RIME.rim, radius: RIME.radius }, // radius: the ring IS the aura zone
  cinder: { rim: CINDER.rim },
};

const PLAYER_RIM = new THREE.Color(0xffb454); // the dart's identity rim
const ROOT_RIM = new THREE.Color(CC.rootRim); // ash desat while ROOTED
const FLASH_RIM = new THREE.Color(0xffe9c0); // hit-flash rim wash

export class View {
  private scene: THREE.Scene;
  private fx: ParticlePool;
  private glowTex: THREE.CanvasTexture;
  private warmTex: THREE.CanvasTexture;
  private diamondTex: THREE.CanvasTexture;
  private darkDiamondTex: THREE.CanvasTexture;
  private streakTex: THREE.CanvasTexture;

  /** CC kit — root visuals + reduced-motion + struggle flag (engine-fed) */
  private hexPool: HexView[] = [];
  private entangle: THREE.Mesh;
  private entangleMat: THREE.MeshBasicMaterial;
  private prevRoot = false;
  private reduceFx = false;
  /** dormant stun kit: three ember stars awaiting a stun source (never shown
   *  this sprint — +0 draws; the kit ships ready for the next CC state) */
  private stunStars = new THREE.Group();

  private playerGroup = new THREE.Group();
  private playerBody = new THREE.Group(); // y=1.0 craft, banks on z
  private playerHull: THREE.Mesh;
  private playerTail: THREE.Sprite;
  private playerYaw = 0;

  private shardViews: { mesh: THREE.Mesh; glow: THREE.Sprite }[] = [];
  private shardGeo: THREE.BufferGeometry;
  private shardMat: THREE.ShaderMaterial;

  private foePool: FoeView[] = [];
  /* LIVING FOES (sprint 19-b) — rigged prototypes + per-foe mixer pool */
  private animator = new FoeAnimator();
  private protos = new Map<AnimKind, THREE.Group>();
  private animSeq = 0;

  /* DEATH GHOST one-shot queue (20-4c C3) + KILL DIFF — sim.killCount is the
   * authoritative kill counter (one increment per death, ZERO on room wipes
   * and run resets), so vanished tracked ids only count as kills when the
   * counter moved. Pure view-side — engine.ts/sim.ts untouched. */
  private deathClips = new Map<AnimKind, THREE.AnimationClip>();
  private ghosts: GhostView[] = [];
  private tracked = new Map<number, FoeRecord>();
  private seenFoes = new Set<number>();
  private lastKillCount = -1;
  private killSeq = 0;

  /* EMBER VACUUM (20-4c C4) — one stateless batch, we own the state */
  private motes: MoteState[] = [];
  private moteCursor = 0;
  private moteBatch: PerPointBatch;
  private plateGeo = new THREE.BoxGeometry(2.3, 1.7, 0.22);
  private coreGeo = new THREE.OctahedronGeometry(0.28, 0);
  private coreMat = coreMaterial(0xffaebf);

  private bulletGeo = new THREE.BufferGeometry();
  private bulletPos = new THREE.BufferAttribute(new Float32Array(MAX_BULLETS * 3), 3);
  private bulletPoints: THREE.Points;

  private heavyGeo = new THREE.BufferGeometry();
  private heavyPos = new THREE.BufferAttribute(new Float32Array(MAX_HEAVY * 3), 3);
  private heavyPoints: THREE.Points;
  private veilGeo = new THREE.BufferGeometry();
  private veilPos = new THREE.BufferAttribute(new Float32Array(MAX_VEIL * 3), 3);
  private veilPoints: THREE.Points;

  private markPool: MarkView[] = [];
  private markCursor = 0;
  private markRingGeo = new THREE.RingGeometry(0.9, 1.0, 40).rotateX(-Math.PI / 2);
  private markBaseGeo = new THREE.RingGeometry(0.58, 0.94, 40).rotateX(-Math.PI / 2);

  private haloPool: HaloView[] = [];
  private haloUsed = 0;
  private haloGeo = new THREE.RingGeometry(0.8, 0.94, 36).rotateX(-Math.PI / 2);

  /** CINDERBOUND wake patches — rim + fill merged into ONE draw per patch;
   *  5 seats, cursor-synced like the hex pool, idle entries visible=false
   *  = 0 persistent draw calls */
  private cinderPool: CinderView[] = [];
  private cinderGeo: THREE.BufferGeometry;

  /** grounded contact shadows — kills the "everything floats" defect */
  private shadowTex: THREE.CanvasTexture;
  private shadows: THREE.Mesh[] = [];
  private shadowGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);

  /** CHAINSPARK death-light arcs */
  private sparkViews: SparkView[] = [];

  private telegraphs: { line: THREE.Line; mat: THREE.LineBasicMaterial }[] = [];

  /** CC KIT markers — pooled per state; idle pools cost zero draw calls.
   *  stun: spinning gold hex-ring at the head · root: clamping ground ring
   *  chill: icy ground ring (foe) — the player veil reads via HUD vignette. */
  private stunRings: HaloView[] = [];
  private rootRings: HaloView[] = [];
  private chillRings: HaloView[] = [];
  private ccGeo = new THREE.RingGeometry(0.62, 0.8, 6).rotateX(-Math.PI / 2); // hex ring
  private stunMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  private rootMat = new THREE.MeshBasicMaterial({ color: 0xc9784a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  private chillMat = new THREE.MeshBasicMaterial({ color: 0x9adfff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  private stunCursor = 0;
  private rootCursor = 0;
  private chillCursor = 0;

  private reticle: THREE.Group;
  private reticleSpin = new THREE.Group();
  private time = 0;
  private disposed = false;

  constructor(scene: THREE.Scene, fx: ParticlePool) {
    this.scene = scene;
    this.fx = fx;
    this.glowTex = makeGlowTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');
    this.warmTex = makeGlowTexture('rgba(255,208,130,0.95)', 'rgba(255,96,32,0)');
    this.diamondTex = makeDiamondTexture();
    this.darkDiamondTex = makeDiamondTextureDark();
    this.streakTex = makeStreakTexture();
    this.shadowTex = makeGlowTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)');

    // ---- contact shadows: one soft dark blob per grounded entity ----
    for (let i = 0; i < SHADOW_POOL; i++) {
      const m = new THREE.Mesh(
        this.shadowGeo,
        new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      m.renderOrder = 2;
      m.position.y = 0.04;
      m.visible = false;
      scene.add(m);
      this.shadows.push(m);
    }

    // ---- spark arcs: jagged death-light lines, additive, fast-fading ----
    for (let i = 0; i < 6; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SPARK_SEGS + 1) * 3), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.sparkViews.push({ line, mat, life: 0 });
    }

    // ---- the EMBER DART: faceted obsidian hull, swept fins, canopy heart ----
    const hullGeo = new THREE.OctahedronGeometry(0.5, 0);
    hullGeo.scale(0.55, 0.5, 1.5); // elongated dart, forward = +Z
    this.playerHull = new THREE.Mesh(
      hullGeo,
      stylizedMaterial({ base: 0x241812, lit: 0x4a3220, rim: 0xffb454, rimK: 1.1, rimPow: 2.4, emis: 0xff9a4a, emisK: 0.12 }),
    );
    this.playerBody.add(this.playerHull);

    const finGeo = new THREE.BoxGeometry(0.55, 0.06, 0.5);
    const finMat = stylizedMaterial({ base: 0x140e09, rim: 0xd98a3d, rimK: 0.7 });
    const finR = new THREE.Mesh(finGeo, finMat);
    finR.position.set(0.42, -0.04, -0.16);
    finR.rotation.y = (25 * Math.PI) / 180; // outer edge swept back
    const finL = new THREE.Mesh(finGeo, finMat);
    finL.position.set(-0.42, -0.04, -0.16);
    finL.rotation.y = (-25 * Math.PI) / 180;
    this.playerBody.add(finR, finL);

    const heart = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), coreMaterial(0xffe8c2));
    heart.position.set(0, 0.3, 0.1); // canopy, top-center
    this.playerBody.add(heart);

    // tail ember — the ONE remaining glow accent on the player
    this.playerTail = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.warmTex, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.45, fog: false }),
    );
    this.playerTail.scale.setScalar(1.3);
    this.playerTail.position.set(0, 0.02, -0.9);
    this.playerBody.add(this.playerTail);

    this.playerBody.position.y = 1.0;
    this.playerGroup.add(this.playerBody);
    scene.add(this.playerGroup);

    // ---- shards of light: solid crystal prisms with an emissive heart ----
    this.shardGeo = new THREE.OctahedronGeometry(0.34, 0);
    this.shardGeo.scale(1, 2.4, 1);
    this.shardMat = stylizedMaterial({
      base: 0x2a1a0e,
      lit: 0x553718,
      rim: 0xffd27a,
      rimK: 1.7,
      rimPow: 1.9,
      emis: 0xffd27a,
      emisK: 0.9,
      pulse: 0.3,
      fog: false,
    });
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(this.shardGeo, this.shardMat);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55, fog: false }),
      );
      glow.scale.setScalar(1.4);
      mesh.add(glow);
      mesh.visible = false;
      scene.add(mesh);
      this.shardViews.push({ mesh, glow });
    }

    // ---- foes: designed silhouettes, per-entry shell + heart per kind ----
    for (let i = 0; i < 40; i++) {
      const group = new THREE.Group();
      const mat = this.foeMatFor('drifter');
      const mesh = new THREE.Mesh(FOE_GEO.drifter, mat);
      group.add(mesh);
      const heartDef = FOE_HEART.drifter;
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glowTex, color: heartDef.color, blending: THREE.AdditiveBlending, depthWrite: false, opacity: heartDef.opacity, fog: false }),
      );
      glow.scale.setScalar(heartDef.scale);
      group.add(glow);
      const core = new THREE.Mesh(this.coreGeo, this.coreMat);
      core.visible = false;
      group.add(core);
      // bulwark frontal plate — brighter than the body, reads as the block zone
      const plate = new THREE.Mesh(this.plateGeo, PLATE_MAT);
      plate.position.set(0, 0, 1.05);
      plate.visible = false;
      group.add(plate);
      group.visible = false;
      scene.add(group);
      this.foePool.push({ group, mesh, mat, baseEmisK: FOE_STYLE.drifter.emisK ?? 0, baseRim: new THREE.Color(FOE_STYLE.drifter.rim ?? 0xffffff), flashT: 0, glow, core, plate, kind: 'drifter', skinned: null, skinnedMats: [], animId: ++this.animSeq });
    }

    // ---- bullets (one draw call) — hot-core diamonds with a dark edge so
    // ---- they keep a silhouette on every biome (normal blending: additive
    // ---- washed out into the bright biome grids + bloom) ----
    this.bulletPos.setUsage(THREE.DynamicDrawUsage);
    this.bulletGeo.setAttribute('position', this.bulletPos);
    this.bulletGeo.setDrawRange(0, 0);
    const bMat = new THREE.PointsMaterial({
      color: COLORS.foeBulletCore,
      size: 0.95,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.97,
      blending: THREE.NormalBlending,
      depthWrite: false,
      map: this.darkDiamondTex,
    });
    this.bulletPoints = new THREE.Points(this.bulletGeo, bMat);
    this.bulletPoints.frustumCulled = false;
    this.bulletPoints.renderOrder = 9;
    scene.add(this.bulletPoints);

    // ---- heavy bullets (caster lances) — horizontal streaks, bigger & acid-pale
    this.heavyPos.setUsage(THREE.DynamicDrawUsage);
    this.heavyGeo.setAttribute('position', this.heavyPos);
    this.heavyGeo.setDrawRange(0, 0);
    const hMat = new THREE.PointsMaterial({
      color: 0xd6ff8a,
      size: 2.0,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: this.streakTex,
    });
    this.heavyPoints = new THREE.Points(this.heavyGeo, hMat);
    this.heavyPoints.frustumCulled = false;
    this.heavyPoints.renderOrder = 9;
    scene.add(this.heavyPoints);

    // ---- veil chimes (herald) — big cold diamonds; the slow is the threat
    //      so the projectile must read across every biome palette. Normal
    //      blending + dark-edge sprite like the light bullets (sprint-15 law).
    this.veilPos.setUsage(THREE.DynamicDrawUsage);
    this.veilGeo.setAttribute('position', this.veilPos);
    this.veilGeo.setDrawRange(0, 0);
    const vMat = new THREE.PointsMaterial({
      color: 0x9adfff,
      size: 1.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.97,
      blending: THREE.NormalBlending,
      depthWrite: false,
      map: this.darkDiamondTex,
    });
    this.veilPoints = new THREE.Points(this.veilGeo, vMat);
    this.veilPoints.frustumCulled = false;
    this.veilPoints.renderOrder = 9;
    scene.add(this.veilPoints);

    // ---- EMBER VACUUM seats (20-4c C4): one PerPointBatch draw while any
    // ---- mote is alive; idle = drawRange 0 = the bullet-pool idle law
    for (let i = 0; i < VACUUM_SEATS; i++) {
      this.motes.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, size: 0.5 });
    }
    this.moteBatch = new PerPointBatch(scene, VACUUM_SEATS, { renderOrder: 8 });

    // ---- CC marker pools (stun / root / chill) — shared geo+mat per type
    for (let i = 0; i < CC_POOL; i++) {
      const defs: [HaloView[], THREE.MeshBasicMaterial][] = [
        [this.stunRings, this.stunMat],
        [this.rootRings, this.rootMat],
        [this.chillRings, this.chillMat],
      ];
      for (const [pool, mat] of defs) {
        const mesh = new THREE.Mesh(this.ccGeo, mat);
        mesh.visible = false;
        mesh.renderOrder = 7;
        scene.add(mesh);
        pool.push({ mesh, mat });
      }
    }

    // ---- HEX LOOM zones: pooled hex telegraphs (≤HEX.maxZones live) ----
    const hexRimGeo = new THREE.RingGeometry(HEX.radius * 0.86, HEX.radius, 6).rotateX(-Math.PI / 2);
    const hexFillGeo = new THREE.CircleGeometry(HEX.radius * 0.86, 6).rotateX(-Math.PI / 2);
    for (let i = 0; i < HEX.maxZones; i++) {
      const rimMat = new THREE.MeshBasicMaterial({ color: FOE_COL.weaver, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const fillMat = new THREE.MeshBasicMaterial({ color: FOE_COL.weaver, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const group = new THREE.Group();
      const rim = new THREE.Mesh(hexRimGeo, rimMat);
      rim.renderOrder = 6;
      const fill = new THREE.Mesh(hexFillGeo, fillMat);
      fill.renderOrder = 5;
      group.add(rim, fill);
      group.position.y = 0.12;
      group.visible = false;
      scene.add(group);
      this.hexPool.push({ group, rimMat, fillMat });
    }

    // ---- ROOT bind: merged 6-spoke entangle at the ember's feet ----
    this.entangleMat = new THREE.MeshBasicMaterial({
      color: FOE_COL.weaver,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.entangle = new THREE.Mesh(buildEntangleGeometry(), this.entangleMat);
    this.entangle.renderOrder = 7;
    this.entangle.visible = false;
    scene.add(this.entangle);

    // ---- dormant stun kit: three ember stars (never visible yet) ----
    for (let i = 0; i < 3; i++) {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), coreMaterial(0xffe8c2, false));
      this.stunStars.add(star);
    }
    this.stunStars.visible = false;
    this.playerGroup.add(this.stunStars);

    // ---- spawn telegraph marks: foeDeep doom-floor + bright rim, thinner ----
    for (let i = 0; i < 14; i++) {
      const group = new THREE.Group();
      const baseMat = new THREE.MeshBasicMaterial({
        color: COLORS.foeDeep,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const base = new THREE.Mesh(this.markBaseGeo, baseMat);
      base.renderOrder = 6;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff5a4a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(this.markRingGeo, mat);
      ring.renderOrder = 6;
      group.add(base, ring);
      group.visible = false;
      scene.add(group);
      this.markPool.push({ group, mat, baseMat });
    }

    // ---- elite halos (readability: ring = affix) ----
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(this.haloGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      scene.add(mesh);
      this.haloPool.push({ mesh, mat });
    }

    // ---- CINDERBOUND wake patches: dim fill + ember rim, ONE draw each ----
    const cinderFill = new THREE.CircleGeometry(CINDER.radius * 0.88, 20).rotateX(-Math.PI / 2);
    const cinderRim = new THREE.RingGeometry(CINDER.radius * 0.86, CINDER.radius, 20).rotateX(-Math.PI / 2);
    this.cinderGeo = mergeFlatVertexColored([cinderFill, cinderRim], [0x38140a, CINDER.rim]);
    cinderFill.dispose();
    cinderRim.dispose();
    for (let i = 0; i < CINDER_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(this.cinderGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      this.cinderPool.push({ mesh, mat });
    }

    // ---- striker / caster telegraph lines ----
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color: FOE_COL.striker, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.telegraphs.push({ line, mat });
    }

    // ---- aim reticle: gold hairline — ring, four ticks, center dot ----
    this.reticle = new THREE.Group();
    const rMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const rGeo = new THREE.RingGeometry(0.5, 0.55, 32);
    rGeo.rotateX(-Math.PI / 2);
    this.reticleSpin.add(new THREE.Mesh(rGeo, rMat));
    const tickGeo = new THREE.BoxGeometry(0.02, 0.01, 0.14);
    for (const [tx, tz] of [
      [0, 0.55],
      [0, -0.55],
      [0.55, 0],
      [-0.55, 0],
    ]) {
      const tick = new THREE.Mesh(tickGeo, rMat);
      tick.position.set(tx, 0, tz);
      if (tz === 0) tick.rotation.y = Math.PI / 2; // long axis radial
      this.reticleSpin.add(tick);
    }
    this.reticle.add(this.reticleSpin);
    const dotGeo = new THREE.CircleGeometry(0.1, 16);
    dotGeo.rotateX(-Math.PI / 2);
    this.reticle.add(new THREE.Mesh(dotGeo, rMat));
    this.reticle.position.y = 0.15;
    scene.add(this.reticle);

    // ---- pipeline swap-in: assetgen .glb assets replace primitives when ----
    // ---- they arrive (procedural geometry stays as the fallback)        ----
    void loadAssetGeometry('shard_crystal').then((geo) => {
      if (!geo || this.disposed) return;
      const old = this.shardGeo;
      this.shardGeo = geo;
      for (const v of this.shardViews) v.mesh.geometry = geo;
      old.dispose();
    });
    void loadAssetGeometry('dart_hull').then((geo) => {
      if (!geo || this.disposed) return;
      const old = this.playerHull.geometry;
      this.playerHull.geometry = geo;
      old.dispose();
    });
    void loadAssetGeometry('obelisk').then((geo) => {
      if (!geo || this.disposed) return;
      geo.scale(1.05, 1.0, 1.05); // match the caster obelisk footprint
      FOE_GEO.caster = geo; // Blender-tier beveled obelisk (shared, never disposed)
    });
    void loadAssetGeometry('warden_slab').then((geo) => {
      if (!geo || this.disposed) return;
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) return;
      const size = bb.getSize(new THREE.Vector3());
      const k = 5.2 / size.y; // match the warden titan footprint (2.2 octahedron ×1.35)
      geo.scale(k, k, k);
      FOE_GEO.warden = geo; // Blender-tier warden body (shared, never disposed)
    });
    void loadAssetGeometry('husk_drifter').then((geo) => {
      if (!geo || this.disposed) return;
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) return;
      const size = bb.getSize(new THREE.Vector3());
      const k = 2.2 / size.y; // match the ash-husk footprint (0.95 octa ×1.25)
      geo.scale(k, k, k);
      FOE_GEO.drifter = geo; // Blender-tier husk body (shared, never disposed)
      // pool entries are born 'drifter' — re-seat them onto the forged body
      for (const v of this.foePool) if (v.kind === 'drifter') v.mesh.geometry = geo;
    });
    void loadAssetGeometry('cinder_hound').then((geo) => {
      if (!geo || this.disposed) return;
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) return;
      const size = bb.getSize(new THREE.Vector3());
      const k = 1.7 / size.y; // match the lean wedge footprint (0.55 cone ×1.9)
      geo.scale(k, k, k);
      FOE_GEO.hound = geo; // Blender-tier hound body (shared, never disposed)
      for (const v of this.foePool) if (v.kind === 'hound') v.mesh.geometry = geo;
    });
    void loadAssetGeometry('hex_weaver').then((geo) => {
      if (!geo || this.disposed) return;
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) return;
      const size = bb.getSize(new THREE.Vector3());
      const k = 1.5 / Math.max(size.x, size.y); // match the weaver ring footprint (0.66×2)
      geo.scale(k, k, k);
      FOE_GEO.weaver = geo; // Blender-tier hex lattice loom (shared, never disposed)
      for (const v of this.foePool) if (v.kind === 'weaver') v.mesh.geometry = geo;
    });

    // ---- LIVING FOES (sprint 19-b): rigged GLBs replace the static bodies
    // ---- for hound + weaver; geometry above stays as the soft fallback
    void loadAssetScene('cinder_hound').then((asset) => {
      if (!asset || this.disposed) return;
      if (!this.animator.register('hound', asset.clips)) return; // no clips → static law holds
      const death = asset.clips.find((c) => c.name === 'death_collapse');
      if (death) this.deathClips.set('hound', death); // ghost fuel — soft-fail: absent → no ghosts
      const proto = asset.scene;
      proto.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(proto);
      const size = bb.getSize(new THREE.Vector3());
      const k = 1.7 / Math.max(0.001, size.y); // match the lean wedge footprint (static law)
      proto.scale.setScalar(k);
      this.protos.set('hound', proto);
      for (const v of this.foePool) if (v.kind === 'hound') this.mountSkinned(v, 'hound');
    });
    void loadAssetScene('hex_weaver').then((asset) => {
      if (!asset || this.disposed) return;
      if (!this.animator.register('weaver', asset.clips)) return;
      const death = asset.clips.find((c) => c.name === 'death_collapse');
      if (death) this.deathClips.set('weaver', death); // ghost fuel — soft-fail: absent → no ghosts
      const proto = asset.scene;
      proto.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(proto);
      const size = bb.getSize(new THREE.Vector3());
      const k = 1.5 / Math.max(0.001, Math.max(size.x, size.y)); // match the weaver ring footprint (static law)
      proto.scale.setScalar(k);
      this.protos.set('weaver', proto);
      for (const v of this.foePool) if (v.kind === 'weaver') this.mountSkinned(v, 'weaver');
    });

    // ---- LIVING FOES II (sprint 20-5): the trio joins the rig law —
    // ---- striker dart, bulwark slab, herald bell. The procedural bodies in
    // ---- FOE_GEO above stay as the soft fallback forever (19-b law).
    void loadAssetScene('striker_dart').then((asset) => {
      if (!asset || this.disposed) return;
      if (!this.animator.register('striker', asset.clips)) return; // no clips → static law holds
      const proto = asset.scene;
      proto.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(proto);
      const size = bb.getSize(new THREE.Vector3());
      // dart: forged length ≈ z (snout −Y Blender → glTF +Z forward law) —
      // normalize LENGTH to the static dart footprint (0.62 cone × 1.7, tip = +Z)
      const k = 1.7 / Math.max(0.001, size.z);
      proto.scale.setScalar(k);
      this.protos.set('striker', proto);
      for (const v of this.foePool) if (v.kind === 'striker') this.mountSkinned(v, 'striker');
    });
    void loadAssetScene('bulwark_slab').then((asset) => {
      if (!asset || this.disposed) return;
      if (!this.animator.register('bulwark', asset.clips)) return;
      const proto = asset.scene;
      proto.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(proto);
      const size = bb.getSize(new THREE.Vector3());
      // slab: forged h=2.4 — normalize HEIGHT to 1.8 (tomb-slab presence; the
      // group-child armor plate at 2.3×1.7 still carries the block-zone read)
      const k = 1.8 / Math.max(0.001, size.y);
      proto.scale.setScalar(k);
      this.protos.set('bulwark', proto);
      for (const v of this.foePool) if (v.kind === 'bulwark') this.mountSkinned(v, 'bulwark');
    });
    void loadAssetScene('herald_bell').then((asset) => {
      if (!asset || this.disposed) return;
      if (!this.animator.register('herald', asset.clips)) return;
      const proto = asset.scene;
      proto.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(proto);
      const size = bb.getSize(new THREE.Vector3());
      // bell: forged h=2.6 — hover at 1.6 tall (weaver precedent: the rig may
      // exceed the procedural placeholder; the heart glow rides the group)
      const k = 1.6 / Math.max(0.001, size.y);
      proto.scale.setScalar(k);
      this.protos.set('herald', proto);
      for (const v of this.foePool) if (v.kind === 'herald') this.mountSkinned(v, 'herald');
    });
  }

  /* ---------------------------------------------------------------- */

  /** per-pool-entry shell material — built through the factory so it lands
   *  in the uTime tick registry (a raw .clone() would freeze the pulse) */
  private foeMatFor(kind: FoeKind): THREE.ShaderMaterial {
    const style = FOE_STYLE[kind];
    const mat = stylizedMaterial(style);
    return mat;
  }

  /* ---------------- LIVING FOES (sprint 19-b) ---------------- */

  /** swap a pool seat's static mesh for its rigged clone (soft-fail: the
   *  static body stays whenever the prototype/clips are missing) */
  private mountSkinned(v: FoeView, kind: AnimKind): void {
    const proto = this.protos.get(kind);
    if (!proto || v.skinned) return;
    const inst = SkeletonUtils.clone(proto) as THREE.Group;
    const mats: THREE.MeshStandardMaterial[] = [];
    inst.traverse((o) => {
      const m = o as THREE.Mesh & { frustumCulled?: boolean; material?: THREE.Material | THREE.Material[] };
      if (!m.isMesh) return;
      m.frustumCulled = false; // skinned bboxes lie — never cull a rig
      const src = m.material as THREE.MeshStandardMaterial;
      const cloned = (src.clone?.() ?? src) as THREE.MeshStandardMaterial; // per-entry flash wash
      m.material = cloned;
      for (const mm of Array.isArray(cloned) ? cloned : [cloned]) {
        if (mm && (mm as THREE.MeshStandardMaterial).emissive) mats.push(mm as THREE.MeshStandardMaterial);
      }
    });
    v.skinned = inst;
    v.skinnedMats = mats;
    v.group.add(inst);
    v.mesh.visible = false;
    this.animator.attach(v.animId, inst, kind);
  }

  /** restore the static body (kind reassignment / dispose) */
  private unmountSkinned(v: FoeView): void {
    if (!v.skinned) return;
    this.animator.detach(v.animId);
    v.group.remove(v.skinned);
    for (const m of v.skinnedMats) m.dispose();
    v.skinned = null;
    v.skinnedMats = [];
    v.mesh.visible = true;
  }

  /** per-foe hit-flash: light up the pool entry nearest the hit (event-time,
   *  not per-frame; foes are spaced by collision radii so the match is clean) */
  flashAt(x: number, z: number): void {
    let best: FoeView | null = null;
    let bestD = 0.9;
    for (const v of this.foePool) {
      if (!v.group.visible) continue;
      const d = Math.hypot(v.group.position.x - x, v.group.position.z - z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    if (best) best.flashT = FLASH_TIME;
  }

  /** heavy-volley direction line — ONE free telegraph-pool line, muzzle →
   *  locked target; silently skipped when the pool is busy (aiming foes win) */
  fireVolleyLine(x: number, z: number, tx: number, tz: number): void {
    const t = this.telegraphs.find((l) => !l.line.visible);
    if (!t) return;
    const pos = t.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, x, 0.9, z);
    const dl = Math.hypot(tx - x, tz - z) || 1;
    pos.setXYZ(1, x + ((tx - x) / dl) * dl, 0.9, z + ((tz - z) / dl) * dl);
    pos.needsUpdate = true;
    t.line.visible = true;
    (t.mat.color as THREE.Color).set(0xd6ff8a);
    t.mat.opacity = 0.85;
  }

  /** reduced-motion wiring (engine reads the media query, view obeys) */
  setReduceFx(v: boolean): void {
    this.reduceFx = v;
  }

  /** CHAINSPARK visual: a jagged additive arc from (fx,fz) to (tx,tz) */
  fireSpark(fx: number, fz: number, tx: number, tz: number): void {
    const s = this.sparkViews.find((p) => p.life <= 0) ?? this.sparkViews[0];
    const pos = s.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= SPARK_SEGS; i++) {
      const t = i / SPARK_SEGS;
      const edge = i === 0 || i === SPARK_SEGS;
      const jx = edge ? 0 : (Math.random() - 0.5) * 1.2;
      const jz = edge ? 0 : (Math.random() - 0.5) * 1.2;
      pos.setXYZ(i, fx + (tx - fx) * t + jx, 1.0 + (Math.random() - 0.5) * 0.6, fz + (tz - fz) * t + jz);
    }
    pos.needsUpdate = true;
    s.life = 0.14;
    s.line.visible = true;
    s.mat.opacity = 0.95;
  }

  /* ---------------- DEATH GHOST one-shot queue (20-4c C3) ---------------- */

  /** reap the vanished — call once per sync after the foe pass. A vanished
   *  tracked id whose killCount moved is a kill: it pays out vacuum motes and
   *  (rigged kinds only, soft-fail law) re-dies as a ghost. Vanishes with a
   *  frozen counter are room wipes / run resets — silently pruned. */
  private reapKills(kills: number): void {
    const dead: FoeRecord[] = [];
    for (const [id, rec] of this.tracked) {
      if (this.seenFoes.has(id)) continue;
      this.tracked.delete(id);
      dead.push(rec);
    }
    if (kills <= 0) return;
    for (const rec of dead) {
      if (kills <= 0) break;
      kills -= 1;
      this.spawnVacuumMotes(rec.x, rec.z); // every kill makes the payout physical
      const kind = rec.kind as AnimKind;
      if (!this.animator.has(kind) || !this.protos.has(kind) || !this.deathClips.has(kind)) continue;
      if (this.ghosts.length >= GHOST_POOL) continue; // queue full — skip silently (cap law)
      this.spawnDeathGhost(kind, rec);
    }
  }

  /** detached SkeletonUtils.clone of the prototype, playing death_collapse
   *  ONCE (LoopOnce + clamp — the forge's first-key-identity law means no
   *  pose pop), then the clip's own duration drives the sink + fade */
  private spawnDeathGhost(kind: AnimKind, rec: FoeRecord): void {
    const proto = this.protos.get(kind);
    const clip = this.deathClips.get(kind);
    if (!proto || !clip) return;
    const inst = SkeletonUtils.clone(proto) as THREE.Group;
    const mats: THREE.MeshStandardMaterial[] = [];
    inst.traverse((o) => {
      const m = o as THREE.Mesh & { frustumCulled?: boolean; material?: THREE.Material | THREE.Material[] };
      if (!m.isMesh) return;
      m.frustumCulled = false; // skinned bboxes lie — never cull a rig
      const src = m.material as THREE.MeshStandardMaterial;
      const cloned = (src.clone?.() ?? src) as THREE.MeshStandardMaterial; // per-seat material-clone law (hit-flash safety)
      cloned.transparent = true;
      cloned.depthWrite = false; // a fading corpse must not punch holes in the pools
      m.material = cloned;
      for (const c of Array.isArray(cloned) ? cloned : [cloned]) {
        if (c && (c as THREE.MeshStandardMaterial).emissive) mats.push(c as THREE.MeshStandardMaterial);
      }
    });
    const root = new THREE.Group();
    root.position.set(rec.x, rec.y, rec.z);
    root.rotation.y = rec.yaw;
    root.add(inst);
    this.scene.add(root);
    const mixer = new THREE.AnimationMixer(inst);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true; // hold the slump — the fade owns the rest
    action.play();
    this.ghosts.push({ root, mixer, mats, t: 0, dur: clip.duration, y0: rec.y });
  }

  private updateGhosts(dt: number): void {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt;
      g.mixer.update(dt);
      const k = Math.min(1, g.t / g.dur);
      g.root.position.y = g.y0 - 0.85 * k * k; // sink as it collapses
      for (const m of g.mats) m.opacity = 1 - k; // fade over the clip's own duration
      if (k >= 1) {
        g.mixer.stopAllAction();
        this.scene.remove(g.root);
        for (const m of g.mats) m.dispose(); // clones share proto geometry — mats only (unmountSkinned law)
        this.ghosts.splice(i, 1);
      }
    }
  }

  /* ---------------- EMBER VACUUM (20-4c C4) ---------------- */

  /** 3 motes per kill — they linger at the corpse, then accelerate to the
   *  dart. Spawn phases ride the existing hash laws (i/count·2π plus
   *  killSeq·goldenAngle, constants.ts:330 convention) — zero rng. */
  private spawnVacuumMotes(x: number, z: number): void {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const m = this.motes[this.moteCursor];
      this.moteCursor = (this.moteCursor + 1) % this.motes.length; // oldest seat reused — cap law
      const a = (i / n) * Math.PI * 2 + this.killSeq * RITE.CHOIR.goldenAngle;
      m.active = true;
      m.age = 0;
      m.x = x + Math.cos(a) * 0.35;
      m.y = 1.0;
      m.z = z + Math.sin(a) * 0.35;
      m.vx = Math.cos(a) * 2.4;
      m.vy = 1.6 + 0.4 * (i % 2);
      m.vz = Math.sin(a) * 2.4;
      m.size = 0.5 + 0.08 * (i % 3);
    }
    this.killSeq += 1;
  }

  private updateMotes(dt: number, px: number, pz: number): void {
    let n = 0;
    for (const m of this.motes) {
      if (!m.active) continue;
      m.age += dt;
      if (m.age >= VACUUM.life) {
        m.active = false;
        continue;
      }
      const drag = Math.max(0, 1 - 3.2 * dt);
      m.vx *= drag;
      m.vy *= drag;
      m.vz *= drag;
      if (m.age >= VACUUM.linger) {
        // the pull — accelerate toward the dart, ramping in over the first beats
        const dx = px - m.x;
        const dy = 1.0 - m.y;
        const dz = pz - m.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        if (d < VACUUM.reach) {
          m.active = false; // paid — the mote lands
          continue;
        }
        const pull = VACUUM.pull * Math.min(1, (m.age - VACUUM.linger) * 2.5);
        m.vx += (dx / d) * pull * dt;
        m.vy += (dy / d) * pull * dt;
        m.vz += (dz / d) * pull * dt;
        const sp = Math.hypot(m.vx, m.vy, m.vz);
        if (sp > VACUUM.cap) {
          const k = VACUUM.cap / sp;
          m.vx *= k;
          m.vy *= k;
          m.vz *= k;
        }
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      const k = m.age / VACUUM.life;
      const alpha = 0.9 * Math.min(1, m.age * 6) * (1 - k * k);
      this.moteBatch.set(n++, m.x, m.y, m.z, m.size * (0.7 + 0.5 * (1 - k)), EMBER_COL, alpha);
    }
    this.moteBatch.setCount(n);
    if (n > 0) this.moteBatch.flush();
  }

  sync(sim: Sim, aimX: number, aimZ: number, showAim: boolean, dt: number, struggle = false): void {
    this.time += dt;

    // ember dart
    this.playerGroup.position.set(sim.px, 0, sim.pz);
    const blink = sim.invuln > 0 && Math.floor(this.time * 14) % 2 === 0;
    this.playerBody.visible = !blink;
    // face the aim — smoothed yaw with angle wrap
    const targetYaw = Math.atan2(aimX - sim.px, aimZ - sim.pz);
    const yawDiff = Math.atan2(Math.sin(targetYaw - this.playerYaw), Math.cos(targetYaw - this.playerYaw));
    this.playerYaw += yawDiff * (1 - Math.exp(-14 * dt));
    this.playerGroup.rotation.y = this.playerYaw;
    // subtle bank into strafes: velocity perpendicular to facing, rolled negative
    const lateral = sim.pvx * Math.cos(this.playerYaw) - sim.pvz * Math.sin(this.playerYaw);
    this.playerBody.rotation.z = THREE.MathUtils.clamp(-lateral * 0.03, -0.4, 0.4);
    // velocity stretch along the hull spine
    const stretch = 1 + Math.min(0.9, Math.hypot(sim.pvx, sim.pvz) * 0.035);
    const pinch = 1 / Math.sqrt(stretch);
    this.playerHull.scale.set(pinch, pinch, stretch);
    if (sim.dashT > 0) {
      this.fx.spawn(sim.px, 1.0, sim.pz, (Math.random() - 0.5) * 3, 0.6, (Math.random() - 0.5) * 3, {
        life: 0.32,
        size: 0.55,
        color: EMBER_COL,
        drag: 3.2,
      });
    }

    // ---- ROOT kit: desat the hull, swirl the entangle, struggle nudge ----
    const rooted = sim.pRootT > 0;
    const hullMat = this.playerHull.material as THREE.ShaderMaterial;
    if (rooted) {
      const rk = Math.min(1, sim.pRootT / HEX.rootDur);
      hullMat.uniforms.uEmisK.value = THREE.MathUtils.lerp(0.12, CC.rootEmisK, rk);
      (hullMat.uniforms.uRim.value as THREE.Color).copy(PLAYER_RIM).lerp(ROOT_RIM, rk);
      this.playerTail.material.opacity = 0.45 - 0.27 * rk;
      this.entangle.visible = true;
      this.entangle.position.set(sim.px, 0, sim.pz);
      this.entangle.rotation.y += dt * 2.2;
      this.entangle.scale.setScalar(0.85 + 0.65 * rk); // closes in as the bind expires
      this.entangleMat.opacity = 0.85 * Math.min(1, rk * 4) * (0.6 + 0.4 * Math.sin(this.time * 10));
      // movement-attempt shake: a tiny bank-axis rattle while the player fights the bind
      if (struggle && !this.reduceFx) {
        this.playerBody.rotation.x = Math.sin(this.time * 30) * 0.05 * rk;
      } else {
        this.playerBody.rotation.x *= Math.max(0, 1 - dt * 10);
      }
    } else {
      if (this.prevRoot) {
        // bind broke — restore the authored hull the same frame
        hullMat.uniforms.uEmisK.value = 0.12;
        (hullMat.uniforms.uRim.value as THREE.Color).copy(PLAYER_RIM);
        this.playerTail.material.opacity = 0.45;
        this.playerBody.rotation.x = 0;
      }
      this.entangle.visible = false;
    }
    this.prevRoot = rooted;

    // contact shadow — the dart grounds itself
    const psh = this.shadows[0];
    psh.visible = true;
    psh.position.set(sim.px, 0.04, sim.pz);
    psh.scale.setScalar(1.15);
    (psh.material as THREE.MeshBasicMaterial).opacity = sim.dashT > 0 ? 0.32 : 0.5;

    // VEILED player — cold wisps bleed off the dart while the chill lasts
    if (sim.veilT > 0) {
      this.fx.spawn(sim.px, 0.9, sim.pz, (Math.random() - 0.5) * 3.4, 1.6, (Math.random() - 0.5) * 3.4, {
        life: 0.5,
        size: 0.5,
        color: VEIL_COL,
        drag: 2.2,
      });
    }

    // shards
    for (let i = 0; i < this.shardViews.length; i++) {
      const v = this.shardViews[i];
      const s = sim.shards[i];
      if (!s) {
        v.mesh.visible = false;
        continue;
      }
      v.mesh.visible = true;
      v.mesh.position.set(s.x, 1.0, s.z);
      const speed = Math.hypot(s.vx, s.vz);
      if (speed > 1) {
        v.mesh.rotation.set(Math.atan2(s.vz, s.vx) + Math.PI / 2, 0, Math.PI / 2);
      } else {
        v.mesh.rotation.y = this.time * 2.4;
      }
      const flying = s.state !== 'orbit';
      (v.glow.material as THREE.SpriteMaterial).opacity = flying ? 0.55 : 0.3;
      if (flying) {
        this.fx.spawn(s.x, 1.0, s.z, (Math.random() - 0.5) * 1.2, 0.3, (Math.random() - 0.5) * 1.2, {
          life: 0.26,
          size: 0.5,
          color: SHARD_COL,
          drag: 3,
        });
      }
    }

    // foes — hide all, then re-assign from sim
    let fi = 0;
    let shI = 1;
    this.seenFoes.clear();
    this.stunCursor = 0;
    this.rootCursor = 0;
    this.chillCursor = 0;
    for (const f of sim.foes) {
      if (fi >= this.foePool.length) break;
      const v = this.foePool[fi++];
      if (v.kind !== f.kind) {
        this.unmountSkinned(v); // a seat changing kind always restores the static law first
        v.kind = f.kind;
        v.mesh.geometry = FOE_GEO[f.kind];
        v.mesh.material = this.foeMatFor(f.kind);
        v.mat = v.mesh.material as THREE.ShaderMaterial;
        v.baseEmisK = FOE_STYLE[f.kind].emisK ?? 0;
        v.baseRim.set(FOE_STYLE[f.kind].rim ?? 0xffffff);
        v.flashT = 0;
        const heartDef = FOE_HEART[f.kind];
        (v.glow.material as THREE.SpriteMaterial).color.set(heartDef.color);
        (v.glow.material as THREE.SpriteMaterial).opacity = heartDef.opacity;
        v.glow.scale.setScalar(heartDef.scale);
        v.core.visible = f.kind === 'weaver';
        // LIVING FOES — take the rigged body the moment it is available
        // (sprint 20-5: the striker/bulwark/herald trio joins hound + weaver)
        if (isAnimKind(f.kind) && this.animator.has(f.kind) && this.protos.has(f.kind)) {
          this.mountSkinned(v, f.kind);
        }
      }
      v.plate.visible = f.kind === 'bulwark' && f.spawnT <= 0;
      v.group.visible = true;
      v.group.position.set(f.x, f.kind === 'warden' ? 2.4 : 1.0, f.z);
      const spawnK = f.spawnT > 0 ? 1 - Math.max(0, f.spawnT) / (f.kind === 'warden' ? 1.4 : f.kind === 'bulwark' ? 0.7 : 0.45) : 1;
      const pop = f.kind === 'warden' ? 0.35 : 0.15;
      const sc = Math.max(0.02, spawnK) * (1 + pop * (1 - spawnK));
      v.group.scale.setScalar(sc * (f.elite === 'swift' ? 0.85 : 1));

      // grounded contact shadow (pool index 0 = the dart)
      if (shI < this.shadows.length) {
        const sh = this.shadows[shI++];
        sh.visible = true;
        sh.position.set(f.x, 0.04, f.z);
        sh.scale.setScalar(f.r * 1.5 * Math.max(0.05, spawnK));
        (sh.material as THREE.MeshBasicMaterial).opacity = 0.42 * Math.max(0.2, spawnK);
      }

      // EMBER ROT read — a burning foe's heart flickers hot and wide
      const hd = FOE_HEART[f.kind];
      const burning = f.burn > 0;
      const gm = v.glow.material as THREE.SpriteMaterial;
      gm.opacity = hd.opacity + (burning ? 0.2 + 0.1 * Math.sin(this.time * 18) : 0);
      v.glow.scale.setScalar(hd.scale * (burning ? 1.25 : 1));
      if (f.kind === 'bulwark' || f.kind === 'hound') {
        // the plate / the snout must read true — group yaw = locked facing
        v.group.rotation.y = f.face;
        v.mesh.rotation.y = 0;
      } else if (f.kind === 'striker' && v.skinned) {
        // rigged dart reads its run: velocity-facing (the dash line is the
        // threat, so the dart must point where it will strike; view-layer only)
        v.group.rotation.y = Math.atan2(f.vx, f.vz);
        v.mesh.rotation.y = 0;
      } else {
        v.group.rotation.y = 0;
        v.mesh.rotation.y += dt * (f.kind === 'warden' ? 0.7 : f.kind === 'caster' ? 0.5 : 1.8);
      }
      if (f.kind === 'drifter') v.mesh.rotation.x += dt * 1.1;
      if (f.kind === 'caster' && f.state === 1) v.mesh.rotation.x += dt * 6; // charging drill spin
      // herald windup: the bell trembles and swells before the volley
      if (f.kind === 'herald' && f.state === 1) {
        v.mesh.rotation.z = Math.sin(this.time * 34) * 0.16;
        const wobble = 1 + Math.max(0, 1 - f.timer / FOE.heraldWindup) * 0.22;
        v.mesh.scale.setScalar(wobble);
      } else if (f.kind === 'herald') {
        v.mesh.rotation.z = 0;
        v.mesh.scale.setScalar(1);
      }

      // LIVING FOES — the rig follows the sim FSM (view-layer only: the
      // digest never sees this). hound: lurk→windup→charge→recover;
      // weaver: a live loom zone = the anchor cast; striker: seek→telegraph
      // coil→strike→recover; bulwark: one gait (the plate IS its statement);
      // herald: the bell winds, then pulses right before the volley breaks.
      if (v.skinned) {
        if (f.kind === 'hound') {
          this.animator.setState(v.animId, f.state === 1 ? 'windup' : f.state === 2 ? 'charge' : f.state === 3 ? 'recover' : 'idle');
        } else if (f.kind === 'weaver') {
          const casting = sim.hexes.some((h) => h.weaverId === f.id && h.kind !== 'meteor');
          this.animator.setState(v.animId, casting ? 'cast' : 'idle');
        } else if (f.kind === 'striker') {
          this.animator.setState(v.animId, f.state === 1 ? 'windup' : f.state === 2 ? 'charge' : f.state === 3 ? 'recover' : 'idle');
        } else if (f.kind === 'bulwark') {
          this.animator.setState(v.animId, 'idle');
        } else if (f.kind === 'herald') {
          const late = f.state === 1 && f.timer <= 0.25; // the last quarter of the ring telegraph
          this.animator.setState(v.animId, f.state === 1 ? (late ? 'cast' : 'windup') : 'idle');
        }
      }

      // per-foe hit-flash — the shell answers the hit that landed
      if (v.flashT > 0) {
        v.flashT -= dt;
        const fk = Math.max(0, v.flashT / FLASH_TIME);
        if (v.skinned) {
          // rigged body: wash the cloned standard materials' emissive
          for (const m of v.skinnedMats) m.emissive.copy(FLASH_RIM).multiplyScalar(0.9 * fk);
        } else {
          v.mat.uniforms.uEmisK.value = v.baseEmisK + 0.9 * fk;
          (v.mat.uniforms.uRim.value as THREE.Color).copy(v.baseRim).lerp(FLASH_RIM, fk);
        }
        if (v.flashT <= 0) {
          if (v.skinned) {
            for (const m of v.skinnedMats) m.emissive.setScalar(0);
          } else {
            v.mat.uniforms.uEmisK.value = v.baseEmisK;
            (v.mat.uniforms.uRim.value as THREE.Color).copy(v.baseRim);
          }
        }
      }

      // elite halo — the affix is the ring (VISUAL_AUDIO.md color law).
      // Sprint 18 crowns extend the law: rime speaks the sanctioned cold
      // voice AND scales its ring to the 5.5u aura (the ring IS the zone);
      // cinder speaks the burn-line ember. Pool stays idle-zero-cost.
      if (f.elite && f.spawnT <= 0 && this.haloUsed < this.haloPool.length) {
        const h = this.haloPool[this.haloUsed++];
        h.mesh.visible = true;
        h.mesh.position.set(f.x, 0.16, f.z);
        const haloR = f.elite === 'rime' ? RIME.radius / HALO_R0 : (f.r + 0.55) * (f.elite === 'swift' ? 0.85 : 1);
        h.mesh.scale.setScalar(haloR);
        const crown = f.elite === 'rime' || f.elite === 'cinder' ? CROWN_HALO[f.elite] : undefined;
        h.mat.color.set(f.elite === 'swift' ? 0xffffff : f.elite === 'shield' ? 0xffe9a0 : crown ? crown.rim : 0xff8aa0);
        h.mat.opacity = 0.55 + 0.25 * Math.sin(this.time * 6 + f.id);
      }

      // CC KIT markers — the state is visible ON the body, never a guess
      if (f.stunT > 0 && this.stunCursor < this.stunRings.length) {
        const m = this.stunRings[this.stunCursor++];
        m.mesh.visible = true;
        m.mesh.position.set(f.x, f.kind === 'warden' ? 4.6 : 2.2, f.z);
        m.mesh.scale.setScalar((0.7 + 0.08 * Math.sin(this.time * 20 + f.id)) * (f.kind === 'warden' ? 1.8 : 1));
        m.mesh.rotation.y = this.time * 9 + f.id;
      }
      if (f.rootT > 0 && this.rootCursor < this.rootRings.length) {
        const m = this.rootRings[this.rootCursor++];
        m.mesh.visible = true;
        m.mesh.position.set(f.x, 0.14, f.z);
        m.mesh.scale.setScalar((f.r + 0.7) * (1 + 0.05 * Math.sin(this.time * 14)));
        m.mesh.rotation.y = -this.time * 2.2;
      }
      if (f.chillT > 0 && this.chillCursor < this.chillRings.length) {
        const m = this.chillRings[this.chillCursor++];
        m.mesh.visible = true;
        m.mesh.position.set(f.x, 0.13, f.z);
        m.mesh.scale.setScalar((f.r + 0.55) * (1 + 0.06 * Math.sin(this.time * 8 + f.id)));
      }

      // striker / hound / caster telegraph lines while aiming
      if (
        (f.kind === 'striker' && f.state === 1) ||
        (f.kind === 'hound' && f.state === 1) ||
        (f.kind === 'caster' && f.state === 1)
      ) {
        const t = this.telegraphs.find((l) => !l.line.visible);
        if (t) {
          const pos = t.line.geometry.getAttribute('position') as THREE.BufferAttribute;
          pos.setXYZ(0, f.x, 0.9, f.z);
          const dur = f.kind === 'striker' ? 0.55 : f.kind === 'hound' ? HOUND.windupTime : 0.5;
          const dl = Math.hypot(f.tx - f.x, f.tz - f.z) || 1;
          const grow = 1 - Math.max(0, f.timer) / dur;
          pos.setXYZ(1, f.x + ((f.tx - f.x) / dl) * dl * Math.min(1, grow * 1.4), 0.9, f.z + ((f.tz - f.z) / dl) * dl * Math.min(1, grow * 1.4));
          pos.needsUpdate = true;
          t.line.visible = true;
          (t.mat.color as THREE.Color).set(FOE_COL[f.kind]);
          t.mat.opacity = 0.25 + 0.55 * grow * (0.7 + 0.3 * Math.sin(this.time * 30));
        }
      }

      // kill tracking (20-4c C3/C4) — last-seen live state; the reap needs the
      // corpse's spot because the sim has already removed it by the next sync
      this.seenFoes.add(f.id);
      this.tracked.set(f.id, { kind: f.kind, x: f.x, y: v.group.position.y, z: f.z, yaw: v.group.rotation.y });
    }
    for (let i = fi; i < this.foePool.length; i++) this.foePool[i].group.visible = false;
    for (let i = shI; i < this.shadows.length; i++) this.shadows[i].visible = false;

    // KILL DIFF (20-4c C3/C4) — sim.killCount moves exactly once per kill and
    // NEVER on room wipes / run resets, so vanished tracked ids are the dead
    // only when the counter moved. Ghosts + vacuum motes stay view-only.
    const kc = sim.killCount;
    const killDelta = this.lastKillCount >= 0 && kc >= this.lastKillCount ? kc - this.lastKillCount : 0;
    this.lastKillCount = kc;
    this.reapKills(killDelta);
    this.updateGhosts(dt);
    this.updateMotes(dt, sim.px, sim.pz);
    for (const t of this.telegraphs) {
      if (t.line.visible) {
        t.mat.opacity -= dt * 4;
        if (t.mat.opacity <= 0) t.line.visible = false;
      }
    }
    for (const s of this.sparkViews) {
      if (s.life > 0) {
        s.life -= dt;
        s.mat.opacity = Math.max(0, (s.life / 0.14) * 0.95);
        if (s.life <= 0) s.line.visible = false;
      }
    }

    // bullets — light / heavy / veil split into their own draw calls
    let n = 0;
    let hn = 0;
    let vn = 0;
    for (let i = 0; i < sim.bullets.length; i++) {
      const b = sim.bullets[i];
      if (b.veil) {
        if (vn < MAX_VEIL) this.veilPos.setXYZ(vn++, b.x, 1.0, b.z);
      } else if (b.heavy) {
        if (hn < MAX_HEAVY) this.heavyPos.setXYZ(hn++, b.x, 1.0, b.z);
      } else {
        if (n < MAX_BULLETS) this.bulletPos.setXYZ(n++, b.x, 1.0, b.z);
      }
    }
    this.bulletGeo.setDrawRange(0, n);
    this.bulletPos.needsUpdate = true;
    this.heavyGeo.setDrawRange(0, hn);
    this.heavyPos.needsUpdate = true;
    this.veilGeo.setDrawRange(0, vn);
    this.veilPos.needsUpdate = true;

    // spawn marks
    this.markCursor = 0;
    for (const m of sim.marks) {
      if (this.markCursor >= this.markPool.length) break;
      const v = this.markPool[this.markCursor++];
      v.group.visible = true;
      v.group.position.set(m.x, 0.14, m.z);
      const total = m.kind === 'warden' ? 1.5 : 0.9;
      const k = 1 - Math.max(0, m.t) / total;
      v.group.scale.setScalar(2.6 - k * 1.7);
      v.mat.opacity = 0.25 + 0.6 * k * (0.6 + 0.4 * Math.sin(this.time * 22));
      v.baseMat.opacity = v.mat.opacity * 0.45;
    }
    for (let i = this.markCursor; i < this.markPool.length; i++) this.markPool[i].group.visible = false;

    // HEX LOOM zones — the named floor, readable at a glance
    let hi = 0;
    for (const h of sim.hexes) {
      if (hi >= this.hexPool.length) break;
      const hv = this.hexPool[hi++];
      hv.group.visible = true;
      hv.group.position.set(h.x, 0.12, h.z);
      const hk = Math.max(0, Math.min(1, h.t / HEX.telegraph)); // 1 fresh → 0 detonate
      // SUNFALL meteors ride the zone's own radius (constants.ts:284 law —
      // warning circle = blast circle); root hexes keep the authored read
      const zr = h.kind === 'meteor' && h.radius ? h.radius / HEX.radius : 1;
      hv.group.scale.setScalar((0.9 + 0.22 * (1 - hk)) * zr);
      hv.group.rotation.y = this.time * 0.7;
      hv.rimMat.opacity = (0.3 + 0.6 * (1 - hk)) * (0.75 + 0.25 * Math.sin(this.time * 14));
      hv.fillMat.opacity = 0.08 + 0.2 * (1 - hk);
    }
    for (let i = hi; i < this.hexPool.length; i++) this.hexPool[i].group.visible = false;

    // LIVING FOES — advance the rigs (after the foe pass, once per frame)
    this.animator.tick(dt);

    // CINDERBOUND wake — burning patches gutter in the ember family
    let ci = 0;
    for (const c of sim.cinders) {
      if (ci >= this.cinderPool.length) break;
      const pv = this.cinderPool[ci++];
      pv.mesh.visible = true;
      pv.mesh.position.set(c.x, 0.1, c.z);
      const lk = Math.max(0, Math.min(1, c.life / CINDER.life)); // 1 fresh → 0 burnt out
      pv.mesh.scale.setScalar(0.7 + 0.3 * lk); // the patch shrinks as it dies
      pv.mat.opacity = (0.16 + 0.5 * lk) * (0.85 + 0.15 * Math.sin(this.time * 13 + ci));
    }
    for (let i = ci; i < this.cinderPool.length; i++) this.cinderPool[i].mesh.visible = false;
    for (let i = this.haloUsed; i < this.haloPool.length; i++) this.haloPool[i].mesh.visible = false;
    for (let i = this.stunCursor; i < this.stunRings.length; i++) this.stunRings[i].mesh.visible = false;
    for (let i = this.rootCursor; i < this.rootRings.length; i++) this.rootRings[i].mesh.visible = false;
    for (let i = this.chillCursor; i < this.chillRings.length; i++) this.chillRings[i].mesh.visible = false;
    this.haloUsed = 0;

    // warden arriving: extra dread particles
    for (const f of sim.foes) {
      if (f.kind === 'warden' && f.spawnT > 0) {
        this.fx.spawn(f.x + (Math.random() - 0.5) * 6, 0.4, f.z + (Math.random() - 0.5) * 6, 0, 2.4 + Math.random() * 2, 0, {
          life: 0.7,
          size: 0.5,
          color: WARDEN_COL,
          drag: 1.4,
        });
      }
    }

    // reticle
    this.reticle.visible = showAim;
    if (showAim) {
      const dCenter = Math.hypot(aimX, aimZ);
      const clamped = Math.min(1, (ARENA.radius - 1) / Math.max(0.001, dCenter));
      this.reticle.position.x = aimX * clamped;
      this.reticle.position.z = aimZ * clamped;
      this.reticleSpin.rotateY(dt * 1.6);
    }
  }

  setAimVisible(v: boolean): void {
    this.reticle.visible = v;
  }

  dispose(): void {
    this.disposed = true;
    this.animator.dispose();
    for (const f of this.foePool) this.unmountSkinned(f);
    for (const g of this.ghosts) {
      g.mixer.stopAllAction();
      this.scene.remove(g.root);
      for (const m of g.mats) m.dispose();
    }
    this.ghosts = [];
    this.moteBatch.dispose();
    this.scene.remove(this.playerGroup, this.bulletPoints, this.heavyPoints, this.veilPoints, this.reticle);
    for (const s of this.shardViews) {
      this.scene.remove(s.mesh);
      (s.glow.material as THREE.Material).dispose();
    }
    for (const f of this.foePool) {
      this.scene.remove(f.group);
      (f.glow.material as THREE.Material).dispose();
      f.mat.dispose(); // per-entry shell materials — each needs its own dispose
    }
    for (const hv of this.hexPool) {
      this.scene.remove(hv.group);
      hv.rimMat.dispose();
      hv.fillMat.dispose();
    }
    for (const pv of this.cinderPool) {
      this.scene.remove(pv.mesh);
      pv.mat.dispose();
    }
    this.cinderGeo.dispose();
    this.scene.remove(this.entangle);
    this.entangleMat.dispose();
    this.entangle.geometry.dispose();
    for (const s of this.stunStars.children) {
      ((s as THREE.Mesh).material as THREE.Material).dispose();
    }
    for (const m of this.markPool) {
      this.scene.remove(m.group);
      m.mat.dispose();
      m.baseMat.dispose();
    }
    for (const h of this.haloPool) {
      this.scene.remove(h.mesh);
      h.mat.dispose();
    }
    for (const s of this.shadows) {
      this.scene.remove(s);
      (s.material as THREE.MeshBasicMaterial).dispose();
    }
    this.shadowGeo.dispose();
    this.shadowTex.dispose();
    for (const s of this.sparkViews) {
      this.scene.remove(s.line);
      s.mat.dispose();
      s.line.geometry.dispose();
    }
    for (const t of this.telegraphs) {
      this.scene.remove(t.line);
      t.mat.dispose();
      t.line.geometry.dispose();
    }
    this.bulletGeo.dispose();
    this.veilGeo.dispose();
    this.ccGeo.dispose();
    this.stunMat.dispose();
    this.rootMat.dispose();
    this.chillMat.dispose();
    for (const pool of [this.stunRings, this.rootRings, this.chillRings]) {
      for (const h of pool) this.scene.remove(h.mesh);
    }
    (this.veilPoints.material as THREE.Material).dispose();
    this.heavyGeo.dispose();
    (this.bulletPoints.material as THREE.Material).dispose();
    (this.heavyPoints.material as THREE.Material).dispose();
    this.playerHull.geometry.dispose();
    (this.playerHull.material as THREE.Material).dispose();
    this.playerTail.material.dispose();
    this.glowTex.dispose();
    this.warmTex.dispose();
    this.diamondTex.dispose();
    this.darkDiamondTex.dispose();
    this.streakTex.dispose();
  }
}

const EMBER_COL = new THREE.Color(0xffdca0);
const SHARD_COL = new THREE.Color(0xffd27a);
const WARDEN_COL = new THREE.Color(0xff7a2d);
const VEIL_COL = new THREE.Color(0x9adfff);
