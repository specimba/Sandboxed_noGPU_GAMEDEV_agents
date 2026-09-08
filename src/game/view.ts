import * as THREE from 'three';
import { loadAssetGeometry } from './assetLib';
import { ARENA, CC, COLORS, HEX, HOUND } from './constants';
import type { FoeKind, Sim } from './sim';
import { makeGlowTexture, ParticlePool } from './fx';
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
  hound: new THREE.ConeGeometry(0.55, 1.9, 3).rotateX(Math.PI / 2).scale(1.25, 0.6, 1), // lean wedge, tip = +Z
  warden: new THREE.OctahedronGeometry(2.2, 0).scale(1, 1.35, 1), // the monolith titan
};

/** identity color — rim, heart, halo and telegraph all speak it */
const FOE_COL: Record<FoeKind, number> = {
  drifter: COLORS.foe,
  striker: 0xff7a3d,
  weaver: 0xff2d6e,
  caster: 0xb8e63d,
  bulwark: 0xffb35c,
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

interface MarkView {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial; // bright rim
  baseMat: THREE.MeshBasicMaterial; // foeDeep floor wash
}

interface HaloView {
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
const SHADOW_POOL = 41; // 1 ember dart + 40 foes
const SPARK_SEGS = 8;
const FLASH_TIME = 0.09; // per-foe hit-flash window

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
  private plateGeo = new THREE.BoxGeometry(2.3, 1.7, 0.22);
  private coreGeo = new THREE.OctahedronGeometry(0.28, 0);
  private coreMat = coreMaterial(0xffaebf);

  private bulletGeo = new THREE.BufferGeometry();
  private bulletPos = new THREE.BufferAttribute(new Float32Array(MAX_BULLETS * 3), 3);
  private bulletPoints: THREE.Points;

  private heavyGeo = new THREE.BufferGeometry();
  private heavyPos = new THREE.BufferAttribute(new Float32Array(MAX_HEAVY * 3), 3);
  private heavyPoints: THREE.Points;

  private markPool: MarkView[] = [];
  private markCursor = 0;
  private markRingGeo = new THREE.RingGeometry(0.9, 1.0, 40).rotateX(-Math.PI / 2);
  private markBaseGeo = new THREE.RingGeometry(0.58, 0.94, 40).rotateX(-Math.PI / 2);

  private haloPool: HaloView[] = [];
  private haloUsed = 0;
  private haloGeo = new THREE.RingGeometry(0.8, 0.94, 36).rotateX(-Math.PI / 2);

  /** grounded contact shadows — kills the "everything floats" defect */
  private shadowTex: THREE.CanvasTexture;
  private shadows: THREE.Mesh[] = [];
  private shadowGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);

  /** CHAINSPARK death-light arcs */
  private sparkViews: SparkView[] = [];

  private telegraphs: { line: THREE.Line; mat: THREE.LineBasicMaterial }[] = [];

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
      this.foePool.push({ group, mesh, mat, baseEmisK: FOE_STYLE.drifter.emisK ?? 0, baseRim: new THREE.Color(FOE_STYLE.drifter.rim ?? 0xffffff), flashT: 0, glow, core, plate, kind: 'drifter' });
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
  }

  /* ---------------------------------------------------------------- */

  /** per-pool-entry shell material — built through the factory so it lands
   *  in the uTime tick registry (a raw .clone() would freeze the pulse) */
  private foeMatFor(kind: FoeKind): THREE.ShaderMaterial {
    const style = FOE_STYLE[kind];
    const mat = stylizedMaterial(style);
    return mat;
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
    for (const f of sim.foes) {
      if (fi >= this.foePool.length) break;
      const v = this.foePool[fi++];
      if (v.kind !== f.kind) {
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
      } else {
        v.group.rotation.y = 0;
        v.mesh.rotation.y += dt * (f.kind === 'warden' ? 0.7 : f.kind === 'caster' ? 0.5 : 1.8);
      }
      if (f.kind === 'drifter') v.mesh.rotation.x += dt * 1.1;
      if (f.kind === 'caster' && f.state === 1) v.mesh.rotation.x += dt * 6; // charging drill spin

      // per-foe hit-flash — the shell answers the hit that landed
      if (v.flashT > 0) {
        v.flashT -= dt;
        const fk = Math.max(0, v.flashT / FLASH_TIME);
        v.mat.uniforms.uEmisK.value = v.baseEmisK + 0.9 * fk;
        (v.mat.uniforms.uRim.value as THREE.Color).copy(v.baseRim).lerp(FLASH_RIM, fk);
        if (v.flashT <= 0) {
          v.mat.uniforms.uEmisK.value = v.baseEmisK;
          (v.mat.uniforms.uRim.value as THREE.Color).copy(v.baseRim);
        }
      }

      // elite halo — the affix is the ring (VISUAL_AUDIO.md color law)
      if (f.elite && f.spawnT <= 0 && this.haloUsed < this.haloPool.length) {
        const h = this.haloPool[this.haloUsed++];
        h.mesh.visible = true;
        h.mesh.position.set(f.x, 0.16, f.z);
        const haloR = (f.r + 0.55) * (f.elite === 'swift' ? 0.85 : 1);
        h.mesh.scale.setScalar(haloR);
        h.mat.color.set(f.elite === 'swift' ? 0xffffff : f.elite === 'shield' ? 0xffe9a0 : 0xff8aa0);
        h.mat.opacity = 0.55 + 0.25 * Math.sin(this.time * 6 + f.id);
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
    }
    for (let i = fi; i < this.foePool.length; i++) this.foePool[i].group.visible = false;
    for (let i = shI; i < this.shadows.length; i++) this.shadows[i].visible = false;
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

    // bullets — light and heavy split into their own draw calls
    let n = 0;
    let hn = 0;
    for (let i = 0; i < sim.bullets.length; i++) {
      const b = sim.bullets[i];
      if (b.heavy) {
        if (hn < MAX_HEAVY) this.heavyPos.setXYZ(hn++, b.x, 1.0, b.z);
      } else {
        if (n < MAX_BULLETS) this.bulletPos.setXYZ(n++, b.x, 1.0, b.z);
      }
    }
    this.bulletGeo.setDrawRange(0, n);
    this.bulletPos.needsUpdate = true;
    this.heavyGeo.setDrawRange(0, hn);
    this.heavyPos.needsUpdate = true;

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
      hv.group.scale.setScalar(0.9 + 0.22 * (1 - hk));
      hv.group.rotation.y = this.time * 0.7;
      hv.rimMat.opacity = (0.3 + 0.6 * (1 - hk)) * (0.75 + 0.25 * Math.sin(this.time * 14));
      hv.fillMat.opacity = 0.08 + 0.2 * (1 - hk);
    }
    for (let i = hi; i < this.hexPool.length; i++) this.hexPool[i].group.visible = false;
    for (let i = this.haloUsed; i < this.haloPool.length; i++) this.haloPool[i].mesh.visible = false;
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
    this.scene.remove(this.playerGroup, this.bulletPoints, this.heavyPoints, this.reticle);
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
