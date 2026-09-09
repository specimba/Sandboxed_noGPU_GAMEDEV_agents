import * as THREE from 'three';
import { loadAssetGeometry } from './assetLib';
import { ARENA, COLORS, FOE } from './constants';
import type { FoeKind, Sim } from './sim';
import { makeGlowTexture, ParticlePool } from './fx';
import { coreMaterial, makeDiamondTexture, makeStreakTexture, stylizedMaterial } from './materials';

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
  warden: new THREE.OctahedronGeometry(2.2, 0).scale(1, 1.35, 1), // the monolith titan
};

/** identity color — rim, heart, halo and telegraph all speak it */
const FOE_COL: Record<FoeKind, number> = {
  drifter: COLORS.foe,
  striker: 0xff7a3d,
  weaver: 0xff2d6e,
  caster: 0xb8e63d,
  bulwark: 0xffb35c,
  herald: 0x9adfff, // the only cold voice in a warm world — the veil speaks ice
  warden: COLORS.warden,
};

/** one chiseled shell material per kind — all 40 pool entries share it */
const FOE_MAT: Record<FoeKind, THREE.ShaderMaterial> = {
  drifter: stylizedMaterial({
    base: COLORS.obsidian,
    lit: COLORS.obsidianLit,
    rim: FOE_COL.drifter,
    rimK: 1.2,
    emis: FOE_COL.drifter,
    emisK: 0.1,
  }),
  striker: stylizedMaterial({
    base: COLORS.obsidian,
    lit: COLORS.obsidianLit,
    rim: FOE_COL.striker,
    rimK: 1.3,
    emis: FOE_COL.striker,
    emisK: 0.1,
  }),
  weaver: stylizedMaterial({
    base: COLORS.obsidian,
    lit: COLORS.obsidianLit,
    rim: FOE_COL.weaver,
    rimK: 1.4,
    emis: FOE_COL.weaver,
    emisK: 0.1,
  }),
  caster: stylizedMaterial({
    base: COLORS.obsidian,
    lit: COLORS.obsidianLit,
    rim: FOE_COL.caster,
    rimK: 1.2,
    emis: 0x9dc43a,
    emisK: 0.15,
  }),
  bulwark: stylizedMaterial({
    base: COLORS.obsidian,
    lit: COLORS.obsidianLit,
    rim: FOE_COL.bulwark,
    rimK: 0.9,
    rimPow: 3,
  }),
  herald: stylizedMaterial({
    base: 0x0e1a20,
    lit: 0x24404c,
    rim: FOE_COL.herald,
    rimK: 1.5,
    rimPow: 2.2,
    emis: FOE_COL.herald,
    emisK: 0.14,
    pulse: 0.2,
  }),
  warden: stylizedMaterial({
    base: 0x140d08,
    lit: COLORS.obsidianLit,
    rim: FOE_COL.warden,
    rimK: 1.5,
    rimPow: 2.2,
    emis: FOE_COL.warden,
    emisK: 0.12,
    pulse: 0.15,
  }),
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
  warden: { color: 0xff5a2d, scale: 4.5, opacity: 0.4 },
};

interface FoeView {
  group: THREE.Group;
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  core: THREE.Mesh; // weaver's inner light
  plate: THREE.Mesh; // bulwark frontal armor
  kind: FoeKind;
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
const MAX_VEIL = 80; // herald chimes — the slow cold layer
const SHADOW_POOL = 41; // 1 ember dart + 40 foes
const SPARK_SEGS = 8;
const CC_POOL = 12; // per-CC-type marker seats (0 draw calls when idle)

export class View {
  private scene: THREE.Scene;
  private fx: ParticlePool;
  private glowTex: THREE.CanvasTexture;
  private warmTex: THREE.CanvasTexture;
  private diamondTex: THREE.CanvasTexture;
  private streakTex: THREE.CanvasTexture;

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

    // ---- foes: designed silhouettes, shared shell + heart per kind ----
    for (let i = 0; i < 40; i++) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(FOE_GEO.drifter, FOE_MAT.drifter);
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
      this.foePool.push({ group, mesh, glow, core, plate, kind: 'drifter' });
    }

    // ---- bullets (one draw call) — diamond shards, not round dots ----
    this.bulletPos.setUsage(THREE.DynamicDrawUsage);
    this.bulletGeo.setAttribute('position', this.bulletPos);
    this.bulletGeo.setDrawRange(0, 0);
    const bMat = new THREE.PointsMaterial({
      color: 0xffb28a, // sprint-17 readability: hotter core, reads on every biome fog
      size: 1.2, // was 0.9 — bullets were losing the visibility fight
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: this.diamondTex,
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
      size: 2.5,
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

    // ---- veil chimes (herald) — big cold hexes; the slow is the threat so
    //      the projectile must read across every biome palette
    this.veilPos.setUsage(THREE.DynamicDrawUsage);
    this.veilGeo.setAttribute('position', this.veilPos);
    this.veilGeo.setDrawRange(0, 0);
    const vMat = new THREE.PointsMaterial({
      color: 0x9adfff,
      size: 1.7,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: this.diamondTex,
    });
    this.veilPoints = new THREE.Points(this.veilGeo, vMat);
    this.veilPoints.frustumCulled = false;
    this.veilPoints.renderOrder = 9;
    scene.add(this.veilPoints);

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
  }

  /* ---------------------------------------------------------------- */

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

  sync(sim: Sim, aimX: number, aimZ: number, showAim: boolean, dt: number): void {
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
    this.stunCursor = 0;
    this.rootCursor = 0;
    this.chillCursor = 0;
    for (const f of sim.foes) {
      if (fi >= this.foePool.length) break;
      const v = this.foePool[fi++];
      if (v.kind !== f.kind) {
        v.kind = f.kind;
        v.mesh.geometry = FOE_GEO[f.kind];
        v.mesh.material = FOE_MAT[f.kind];
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
      if (f.kind === 'bulwark') {
        // the plate must read true — group yaw = armor facing, no spin
        v.group.rotation.y = f.face;
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

      // striker / caster telegraph lines while aiming
      if ((f.kind === 'striker' && f.state === 1) || (f.kind === 'caster' && f.state === 1)) {
        const t = this.telegraphs.find((l) => !l.line.visible);
        if (t) {
          const pos = t.line.geometry.getAttribute('position') as THREE.BufferAttribute;
          pos.setXYZ(0, f.x, 0.9, f.z);
          const dur = f.kind === 'striker' ? 0.55 : 0.5;
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
    for (let i = this.stunCursor; i < this.stunRings.length; i++) this.stunRings[i].mesh.visible = false;
    for (let i = this.rootCursor; i < this.rootRings.length; i++) this.rootRings[i].mesh.visible = false;
    for (let i = this.chillCursor; i < this.chillRings.length; i++) this.chillRings[i].mesh.visible = false;
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
    this.scene.remove(this.playerGroup, this.bulletPoints, this.heavyPoints, this.veilPoints, this.reticle);
    for (const s of this.shardViews) {
      this.scene.remove(s.mesh);
      (s.glow.material as THREE.Material).dispose();
    }
    for (const f of this.foePool) {
      this.scene.remove(f.group);
      (f.glow.material as THREE.Material).dispose();
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
    this.veilGeo.dispose();
    this.ccGeo.dispose();
    this.stunMat.dispose();
    this.rootMat.dispose();
    this.chillMat.dispose();
    for (const pool of [this.stunRings, this.rootRings, this.chillRings]) {
      for (const h of pool) this.scene.remove(h.mesh);
    }
    (this.bulletPoints.material as THREE.Material).dispose();
    (this.heavyPoints.material as THREE.Material).dispose();
    (this.veilPoints.material as THREE.Material).dispose();
    this.playerHull.geometry.dispose();
    (this.playerHull.material as THREE.Material).dispose();
    this.playerTail.material.dispose();
    this.glowTex.dispose();
    this.warmTex.dispose();
    this.diamondTex.dispose();
    this.streakTex.dispose();
  }
}

const EMBER_COL = new THREE.Color(0xffdca0);
const SHARD_COL = new THREE.Color(0xffd27a);
const WARDEN_COL = new THREE.Color(0xff7a2d);
const VEIL_COL = new THREE.Color(0x9adfff);
