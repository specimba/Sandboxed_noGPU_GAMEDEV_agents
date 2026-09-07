import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeGlowTexture, ParticlePool, PerPointBatch, type RingPool } from '../fx';
import { coreMaterial, setRimK, stylizedMaterial, updateStylized } from '../materials';
import { getArenaTexture } from './arenaTexture';
import {
  ARENA_RADIUS,
  CAPS,
  HUSK,
  LIGHT,
  PLAYER,
  TRAIL,
  type FoeKind,
} from './constants';
import type { FoeState, Sim } from './sim';

/**
 * AFTERGLOW view — the EMBER RITE house style, rebuilt around the new sim.
 *
 * "Dark world, bright meaning — if it glows it matters."
 *
 * Obsidian + ember: solids are chiseled stylizedMaterial shells (dFdx facets,
 * fresnel rim, emissive heart); the ground is a BAKED obsidian canvas texture
 * (topK 0 — the old top-kiss term painted the whole flat plane mid-sienna);
 * everything that matters is a pooled Points batch or coreMaterial light.
 * The view reads ONLY sim public state — telegraphs live in the sim (foe
 * state 'windup' + locked chargeDir) and the view renders them brighter than
 * everything else. The bright thing is always the important thing.
 *
 * Draw-call discipline (one shape language per species):
 *   arena: ash + floor(map) + rim + wall + 1 MERGED monolith field + pillars
 *   player: two-tone core + spark + 2 halo sprites + dashed pickup ring
 *   foes: 1 merged body each (+ wisp tip-light, husk heart/spear tells)
 *   systems: shadows / motes / bolts / arcs / trails / fx / smoke / embers
 *   = 1 draw per system, everything else pooled.
 */

/* ------------------------------------------------------------------ */
/* identity palette — near-black obsidian, ember accents by temperature */
/* ------------------------------------------------------------------ */

const COL = {
  ember: 0xff8a3d,
  emberSoft: 0xffb454,
  playerCore: 0xffefcf,
  playerHot: 0xfff6e0,
  playerHalo: 0xfff3dc, // rim-temperature ladder top
  wispRim: 0xd8c9a8, // pale ash-bone (desaturated — the cold eater)
  wispCore: 0xffc790, // swallowed light
  huskRim: 0xff6a3d, // resting ember
  huskHot: 0xff4d26, // windup — hottest foe temp
  cinderRim: 0xffb454, // gold spark
  bolt: 0xffd98f,
  mote: 0xffd98f,
  moteRare: 0xfff3dc,
  arc: 0xffe9a0,
  trail: 0xff8a4d,
  hurt: 0xfff1d6,
  pickup: 0xffb454,
};

/* ------------------------------------------------------------------ */
/* foe silhouettes — one merged shape language per species             */
/* (small carved solids are llvmpipe-safe; the derivative ban is only  */
/*  for LARGE flat primitives)                                         */
/* ------------------------------------------------------------------ */

function makeWispGeometry(): THREE.BufferGeometry {
  // "light-eater tooth": inverted cone hanging point-down + 2 blade fins
  const tooth = new THREE.ConeGeometry(0.55, 1.9, 5).rotateX(Math.PI);
  const finL = new THREE.BoxGeometry(0.06, 1.0, 0.5).rotateZ(0.44).translate(0.2, 0.3, 0);
  const finR = new THREE.BoxGeometry(0.06, 1.0, 0.5).rotateZ(-0.44).translate(-0.2, 0.3, 0);
  return mergeGeometries([tooth, finL, finR])!;
}

function makeHuskGeometry(): THREE.BufferGeometry {
  // "wedge brute": tapered slab + 2 horn prongs angled forward-down
  const body = taperedBox(2.0, 1.55, 1.5, 0.55);
  const hornL = new THREE.ConeGeometry(0.16, 0.75, 5).rotateX(1.9).translate(0.45, 0.75, 0.42);
  const hornR = new THREE.ConeGeometry(0.16, 0.75, 5).rotateX(1.9).translate(-0.45, 0.75, 0.42);
  return mergeGeometries([body, hornL, hornR])!;
}

const FOE_GEO: Record<FoeKind, THREE.BufferGeometry> = {
  wisp: makeWispGeometry(),
  husk: makeHuskGeometry(),
  cinder: new THREE.TetrahedronGeometry(0.55, 0), // spark shard
};

/** shared shell per kind (husk gets per-pool clones — its emissive ramps) */
const FOE_MAT: Record<Exclude<FoeKind, 'husk'>, THREE.ShaderMaterial> = {
  wisp: stylizedMaterial({
    base: 0x120b08,
    lit: 0x241610,
    rim: COL.wispRim,
    rimK: 0.8,
    emis: COL.wispCore,
    emisK: 0.08,
  }),
  cinder: stylizedMaterial({
    base: 0x150c08,
    lit: 0x2a1a10,
    rim: COL.cinderRim,
    rimK: 0.95,
    emis: COL.cinderRim,
    emisK: 0.3,
    pulse: 0.25,
  }),
};

const HUSK_MAT_BASE = stylizedMaterial({
  base: 0x1a0f0a,
  lit: 0x33200f,
  rim: COL.huskRim,
  rimK: 0.9,
  rimPow: 2.2,
  emis: COL.huskHot,
  emisK: 0.12,
});

const FOE_Y: Record<FoeKind, number> = { wisp: 1.3, husk: 0.78, cinder: 0.55 };

const MAX_TRAILS = 12;
const ARC_SEGMENTS = CAPS.arcs + 8; // sim chain arcs + view-side muzzle/tracer section
const TRACER_CAP = 6;
const EMBER_CAP = 160;
const SHADOW_CAP = CAPS.foes + 6; // player + foes + pillars

interface FoeView {
  group: THREE.Group;
  mesh: THREE.Mesh;
  core: THREE.Mesh; // wisp tip-light (the swallowed light)
  huskMat: THREE.ShaderMaterial;
  heart: THREE.Sprite;
  spear: THREE.Mesh;
  spearMat: THREE.MeshBasicMaterial;
  flash: THREE.Sprite; // per-hit white pop (shared material)
  kind: FoeKind;
  prevState: FoeState | null;
  prevHp: number;
  popT: number;
  flashT: number;
}

interface TrailView {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

export class AfterglowView {
  private scene: THREE.Scene;
  private fx: ParticlePool;
  private rings: RingPool;
  private glowTex: THREE.CanvasTexture;
  private disposables: { dispose(): void }[] = [];

  private playerGroup = new THREE.Group();
  private playerBody = new THREE.Group();
  private playerCore: THREE.Mesh;
  private playerInner: THREE.Mesh;
  private haloTight: THREE.Sprite;
  private haloWide: THREE.Sprite;
  private sun: THREE.Sprite;
  private playerFlash: THREE.Sprite;
  private flashT = 0;
  private prevPX = 0;
  private prevPZ = 0;

  private foePool: FoeView[] = [];
  private heartMat: THREE.SpriteMaterial;
  private flashMat: THREE.SpriteMaterial;

  private bolts: PerPointBatch;
  private motes: PerPointBatch;
  private shadows: PerPointBatch;
  private embers: PerPointBatch;

  // fresh-bolt detection (object identity — no sim API needed)
  private seenBolts = new WeakSet<object>();
  private boltAge = new WeakMap<object, number>();
  private muzzleT = 0;
  private muzzleX = 0;
  private muzzleZ = 0;
  private muzzleDX = 0;
  private muzzleDZ = 0;
  private tracers = new Float32Array(TRACER_CAP * 4);
  private tracerCount = 0;

  private arcGeo = new THREE.BufferGeometry();
  private arcPos: THREE.BufferAttribute;
  private arcLines: THREE.LineSegments;

  // ambient ember field (wrap, never kill)
  private emberState = new Float32Array(EMBER_CAP * 4); // x,y,z,phase
  private emberRise = new Float32Array(EMBER_CAP);
  private emberSize = new Float32Array(EMBER_CAP);
  private emberCol: THREE.Color[] = [];

  private trailPool: TrailView[] = [];
  private trailGeo: THREE.BufferGeometry;
  private pillarDisposables: { dispose(): void }[] = [];
  private pillarCache: { x: number; z: number; r: number }[] = [];

  private time = 0;
  private disposed = false;
  private rootObjects: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene, fx: ParticlePool, rings: RingPool) {
    this.scene = scene;
    this.fx = fx;
    this.rings = rings;
    this.glowTex = makeGlowTexture('rgba(255,236,200,0.95)', 'rgba(255,120,40,0)');
    this.disposables.push(this.glowTex);

    this.buildArena();

    // ---- the player: the LAST LIGHT — a two-tone hot core with halo ----
    this.playerCore = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.52, 0),
      new THREE.MeshBasicMaterial({ color: COL.playerCore, transparent: true, opacity: 0.62, fog: false }),
    );
    this.disposables.push(this.playerCore.geometry, this.playerCore.material as THREE.Material);
    this.playerBody.add(this.playerCore);

    // inner white-hot center shining through the translucent shell
    this.playerInner = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), coreMaterial(COL.playerHot, false));
    this.disposables.push(this.playerInner.geometry, this.playerInner.material as THREE.Material);
    this.playerBody.add(this.playerInner);

    // heading spark — a small bright facet showing where the light faces
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), coreMaterial(COL.playerCore));
    spark.position.set(0, 0.1, 0.6);
    this.disposables.push(spark.geometry, spark.material as THREE.Material);
    this.playerBody.add(spark);

    // double halo: tight white + wide amber — the player IS the light source
    this.haloTight = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowTex, color: COL.playerHalo, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55, fog: false }),
    );
    this.haloTight.scale.setScalar(1.4);
    this.disposables.push(this.haloTight.material as THREE.Material);
    this.playerBody.add(this.haloTight);

    this.haloWide = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowTex, color: COL.emberSoft, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.25, fog: false }),
    );
    this.haloWide.scale.setScalar(3.2);
    this.disposables.push(this.haloWide.material as THREE.Material);
    this.playerBody.add(this.haloWide);

    // hurt flash — the one sanctioned white-hot bloom, engine-event driven
    this.playerFlash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowTex, color: COL.hurt, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, fog: false }),
    );
    this.playerFlash.scale.setScalar(2.6);
    this.disposables.push(this.playerFlash.material as THREE.Material);
    this.playerBody.add(this.playerFlash);

    this.playerBody.position.y = 0.9;
    this.playerGroup.add(this.playerBody);
    this.addRoot(this.playerGroup);

    // dashed pickup-radius ring — meaning: what you collect
    const pickupGeo = makeDashedRing(LIGHT.pickupRadius, 14, 0.62);
    const pickupMat = new THREE.MeshBasicMaterial({
      color: COL.pickup,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const pickupRing = new THREE.Mesh(pickupGeo, pickupMat);
    pickupRing.position.y = 0.05;
    pickupRing.renderOrder = 3;
    this.playerGroup.add(pickupRing);
    this.disposables.push(pickupGeo, pickupMat);

    // ---- foes: 40 pooled entries, geometry swapped by kind ----
    this.heartMat = new THREE.SpriteMaterial({ map: this.glowTex, color: COL.huskHot, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.4, fog: false });
    this.disposables.push(this.heartMat);
    this.flashMat = new THREE.SpriteMaterial({ map: this.glowTex, color: COL.playerHalo, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, fog: false });
    this.disposables.push(this.flashMat);
    const wispCoreGeo = new THREE.OctahedronGeometry(0.18, 0);
    const wispCoreMat = coreMaterial(COL.wispCore);
    this.disposables.push(wispCoreGeo, wispCoreMat);
    const spearGeo = new THREE.OctahedronGeometry(0.5, 0).scale(0.22, 0.22, 2.6);
    this.disposables.push(spearGeo);
    for (let i = 0; i < CAPS.foes; i++) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(FOE_GEO.wisp, FOE_MAT.wisp);
      group.add(mesh);
      const core = new THREE.Mesh(wispCoreGeo, wispCoreMat);
      core.position.y = -0.8; // bleeding out of the tooth tip
      core.visible = false;
      group.add(core);
      const huskMat = HUSK_MAT_BASE.clone();
      this.disposables.push(huskMat);
      const heart = new THREE.Sprite(this.heartMat);
      heart.scale.setScalar(2.1);
      heart.position.y = 0.55;
      heart.visible = false;
      group.add(heart);
      const spearMat = new THREE.MeshBasicMaterial({
        color: COL.huskHot,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      this.disposables.push(spearMat);
      const spear = new THREE.Mesh(spearGeo, spearMat);
      spear.visible = false;
      group.add(spear);
      const flash = new THREE.Sprite(this.flashMat);
      flash.scale.setScalar(2.4);
      flash.visible = false;
      group.add(flash);
      group.visible = false;
      this.addRoot(group);
      this.foePool.push({ group, mesh, core, huskMat, heart, spear, spearMat, flash, kind: 'wisp', prevState: null, prevHp: -1, popT: 0, flashT: 0 });
    }

    // ---- bolts: one Points draw — per-point shards of light ----
    this.bolts = new PerPointBatch(scene, CAPS.projectiles, { renderOrder: 9, scale: 880, maxSize: 60, soft: 0.14 });
    this.trackBatch(this.bolts);

    // ---- motes: one Points draw — pulsing drift light ----
    this.motes = new PerPointBatch(scene, CAPS.motes, { renderOrder: 9, scale: 880, maxSize: 60, soft: 0.2 });
    this.trackBatch(this.motes);

    // ---- contact shadows: one NormalBlending Points draw, everything lands ----
    this.shadows = new PerPointBatch(scene, SHADOW_CAP, {
      blending: THREE.NormalBlending,
      renderOrder: 2,
      scale: 880,
      maxSize: 220,
      soft: 0.34,
      squash: 1.5, // ground-plane foreshortening read
    });
    this.trackBatch(this.shadows);

    // ---- ambient ember field: one additive Points draw, wrap not kill ----
    this.embers = new PerPointBatch(scene, EMBER_CAP, { renderOrder: 6, scale: 880, maxSize: 60, soft: 0.24 });
    this.trackBatch(this.embers);
    for (let i = 0; i < EMBER_CAP; i++) {
      this.emberState[i * 4] = (Math.random() - 0.5) * 30;
      this.emberState[i * 4 + 1] = Math.random() * 6;
      this.emberState[i * 4 + 2] = (Math.random() - 0.5) * 30;
      this.emberState[i * 4 + 3] = Math.random() * Math.PI * 2;
      this.emberRise[i] = 0.4 + Math.random() * 0.5;
      this.emberSize[i] = 0.18 + Math.random() * 0.27;
      this.emberCol.push(Math.random() < 0.85 ? EMBER_A : EMBER_B);
    }

    // ---- chain arcs: one LineSegments draw, bright segments ----
    this.arcPos = new THREE.BufferAttribute(new Float32Array(ARC_SEGMENTS * 6), 3).setUsage(THREE.DynamicDrawUsage);
    this.arcGeo.setAttribute('position', this.arcPos);
    this.arcGeo.setDrawRange(0, 0);
    const arcMat = new THREE.LineBasicMaterial({
      color: COL.arc,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.arcLines = new THREE.LineSegments(this.arcGeo, arcMat);
    this.arcLines.frustumCulled = false;
    this.arcLines.renderOrder = 9;
    this.addRoot(this.arcLines);
    this.disposables.push(this.arcGeo, arcMat);

    // ---- dash trails: small fading rings read straight from sim.trails ----
    this.trailGeo = new THREE.RingGeometry(0.78, 1.0, 28).rotateX(-Math.PI / 2);
    this.disposables.push(this.trailGeo);
    for (let i = 0; i < MAX_TRAILS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: COL.trail,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.trailGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      this.addRoot(mesh);
      this.trailPool.push({ mesh, mat });
      this.disposables.push(mat);
    }

    // ---- the dead sun: one additive billboard at the far horizon ----
    const sunTex = makeDeadSunTexture();
    this.disposables.push(sunTex);
    this.sun = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sunTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55, fog: false }),
    );
    this.sun.scale.set(24, 14, 1);
    this.sun.position.set(-29, 8.5, -43); // behind the monolith field
    this.disposables.push(this.sun.material as THREE.Material);
    this.addRoot(this.sun);
  }

  /* ---------------------------------------------------------------- */
  /* arena — baked obsidian floor, ember boundary, monolith field      */
  /* ---------------------------------------------------------------- */

  private buildArena(): void {
    const scene = this.scene;

    // the obsidian floor — baked texture carries the value; NO topK (the
    // old top-kiss term painted the entire up-facing plane mid-sienna)
    const floorGeo = new THREE.CircleGeometry(ARENA_RADIUS + 0.6, 96).rotateX(-Math.PI / 2);
    const floorMat = stylizedMaterial({
      base: 0x0c0806,
      lit: 0x150d09,
      rim: 0xff9a4a,
      rimK: 0.22, // faint warm edge at the disc silhouette
      rimPow: 3.0,
      emis: 0xff7a2d,
      emisK: 0.004,
      topK: 0,
      flat: true,
      map: getArenaTexture(),
      mapMix: 1, // kill-switch: 0 disables the baked map
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.renderOrder = 1;
    this.addRoot(floor);
    this.disposables.push(floorGeo, floorMat);

    // the ash field beyond the rim — the dark is ground, not void; the
    // leaning monoliths outside read against it instead of floating.
    // RING, not overlapping disc: two coplanar-ish large planes z-fight into
    // scanline bands on software GL — the ring starts where the floor ends.
    const ashGeo = new THREE.RingGeometry(ARENA_RADIUS + 0.7, 88, 72, 1).rotateX(-Math.PI / 2);
    const ashMat = stylizedMaterial({
      base: 0x060403,
      lit: 0x0e0906,
      rim: 0xff8a3d,
      rimK: 0.1,
      rimPow: 4.0,
      emis: 0xff7a2d,
      emisK: 0.004,
      topK: 0,
      flat: true,
    });
    const ash = new THREE.Mesh(ashGeo, ashMat);
    ash.position.y = -0.04;
    ash.renderOrder = 0;
    this.addRoot(ash);
    this.disposables.push(ashGeo, ashMat);

    // subtle emissive rim ring marking the boundary
    const rimGeo = new THREE.TorusGeometry(ARENA_RADIUS, 0.16, 8, 128).rotateX(Math.PI / 2);
    const rimMat = new THREE.MeshBasicMaterial({ color: COL.ember, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.y = 0.06;
    this.addRoot(rim);
    this.disposables.push(rimGeo, rimMat);

    // the far dead dark — huge inverted cylinder swallowing the horizon
    const wallGeo = new THREE.CylinderGeometry(70, 76, 80, 48, 1, true);
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x080504, side: THREE.BackSide, fog: true });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 28;
    this.addRoot(wall);
    this.disposables.push(wallGeo, wallMat);

    // leaning monolith silhouettes — MERGED into one mesh (1 draw, was 12)
    const parts: THREE.BufferGeometry[] = [];
    const monoMat = stylizedMaterial({ base: 0x120d08, lit: 0x2a1d12, rim: 0xff9a4a, rimK: 0.32, rimPow: 3.2, fog: true });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + (i % 3) * 0.13;
      const r = 33 + (i % 4) * 3.4;
      const h = 7 + (i % 5) * 2.3;
      const w = 1.7 + (i % 3) * 0.8;
      const d = 1.3 + (i % 2) * 0.9;
      const geo = taperedBox(w, h, d, 0.5 + (i % 3) * 0.12);
      const yaw = Math.atan2(-Math.cos(a) * r, -Math.sin(a) * r) + (i % 4) * 0.14 - 0.2;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05 + (i % 3) * 0.05, yaw, 0, 'YXZ'));
      const m = new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, h * 0.5 - 1.4, Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1));
      geo.applyMatrix4(m);
      parts.push(geo);
    }
    const monoGeo = mergeGeometries(parts)!;
    const monoliths = new THREE.Mesh(monoGeo, monoMat);
    this.addRoot(monoliths);
    this.disposables.push(monoGeo, monoMat);
  }

  /** pillars are read from the sim (seed-placed monoliths); rebuilt per run */
  syncPillars(sim: Sim): void {
    // a new run rolls a new seed → clear the previous monoliths first
    for (let i = this.rootObjects.length - 1; i >= 0; i--) {
      const o = this.rootObjects[i];
      if (o.name === 'ag-pillar') {
        this.scene.remove(o);
        this.rootObjects.splice(i, 1);
      }
    }
    for (const d of this.pillarDisposables) d.dispose();
    this.pillarDisposables.length = 0;
    this.pillarCache.length = 0;

    for (let i = 0; i < sim.pillars.length; i++) {
      const p = sim.pillars[i];
      const h = 2.6 + (i % 3) * 0.55;
      const geo = new THREE.CylinderGeometry(p.r * 0.78, p.r, h, 6);
      const mat = stylizedMaterial({
        base: 0x140e0a,
        lit: 0x2c1e11,
        rim: 0xff9a4a,
        rimK: 0.34,
        rimPow: 3.0,
        emis: 0xff7a2d,
        emisK: 0.05,
        topK: 0.24,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, h / 2, p.z);
      m.rotation.y = i * 1.9;
      m.name = 'ag-pillar';
      this.addRoot(m);
      this.pillarDisposables.push(geo, mat);
      this.pillarCache.push({ x: p.x, z: p.z, r: p.r });
    }
  }

  private addRoot(o: THREE.Object3D): void {
    this.rootObjects.push(o);
    this.scene.add(o);
  }

  /** batches join the scene as roots but dispose through their own handle */
  private trackBatch(b: PerPointBatch): void {
    this.rootObjects.push(b.points);
    this.disposables.push({ dispose: () => b.dispose() });
  }

  /* ---------------------------------------------------------------- */
  /* per-frame sync — pure read of sim public state                    */
  /* ---------------------------------------------------------------- */

  sync(sim: Sim, dt: number): void {
    if (this.disposed) return;
    this.time += dt;

    this.syncPlayer(sim, dt);
    this.syncFoes(sim, dt);
    this.syncBolts(sim, dt);
    this.syncMotes(sim);
    this.syncArcs(sim, dt);
    this.syncTrails(sim);
    this.syncShadows(sim);
    this.syncEmbers(sim, dt);

    // dead-sun breathing — the horizon is alive even when nothing is
    (this.sun.material as THREE.SpriteMaterial).opacity = 0.55 + 0.2 * Math.sin(this.time * 0.35);

    // ambient burn embers
    for (const f of sim.foes) {
      if (f.burnT > 0 && Math.random() < dt * 10) {
        this.fx.spawn(f.x, FOE_Y[f.kind], f.z, (Math.random() - 0.5) * 1.4, 1.6 + Math.random(), (Math.random() - 0.5) * 1.4, {
          life: 0.5,
          size: 0.4,
          color: BURN_COL,
          drag: 2.4,
        });
      }
    }

    updateStylized(this.time);
  }

  private syncPlayer(sim: Sim, dt: number): void {
    const p = sim.player;
    this.playerGroup.position.set(p.x, 0, p.z);

    // hurt flash decay + iframe blink
    this.flashT = Math.max(0, this.flashT - dt * 3.2);
    (this.playerFlash.material as THREE.SpriteMaterial).opacity = this.flashT * 0.85;
    const blink = p.iframes > 0 && Math.floor(this.time * 14) % 2 === 0;
    this.playerBody.visible = !blink;

    // face the heading (facing = atan2(z, x) in sim space)
    this.playerBody.rotation.y = Math.atan2(Math.cos(p.facing), Math.sin(p.facing));

    // idle bob + dash squash (view-only interpolation on sim.dashT)
    const dashK = Math.max(0, Math.min(1, p.dashT / PLAYER.dashDuration));
    this.playerBody.position.y = 0.9 + Math.sin(this.time * 2.2) * 0.07 * (1 - dashK);
    const squash = dashK * dashK;
    this.playerBody.scale.set(1 + squash * 0.34, 1 - squash * 0.42, 1 + squash * 0.34);
    this.playerCore.rotation.y += dt * 2.4;
    this.playerCore.rotation.x += dt * 1.3;
    this.playerInner.rotation.y -= dt * 3.6;
    this.playerInner.rotation.x += dt * 2.2;

    (this.haloTight.material as THREE.SpriteMaterial).opacity =
      0.55 * (1 + 0.12 * Math.sin(this.time * 5.2)) + squash * 0.2;
    (this.haloWide.material as THREE.SpriteMaterial).opacity =
      0.25 * (1 + 0.16 * Math.sin(this.time * 3.1)) + squash * 0.15;

    // dash wake: 3 stretched glow sprites per frame along -facing
    if (p.dashT > 0) {
      const vx = p.x - this.prevPX;
      const vz = p.z - this.prevPZ;
      const vl = Math.hypot(vx, vz);
      const dirX = vl > 0.001 ? vx / vl : Math.cos(p.facing);
      const dirZ = vl > 0.001 ? vz / vl : Math.sin(p.facing);
      for (let i = 0; i < 3; i++) {
        const back = 0.25 + Math.random() * 0.7;
        this.fx.spawn(
          p.x - dirX * back + (Math.random() - 0.5) * 0.34,
          0.4 + Math.random() * 0.8,
          p.z - dirZ * back + (Math.random() - 0.5) * 0.34,
          -dirX * (2 + Math.random() * 2.5),
          0.3,
          -dirZ * (2 + Math.random() * 2.5),
          { life: 0.25, size: 0.55, color: DASH_C, drag: 2.6 },
        );
      }
    }
    this.prevPX = p.x;
    this.prevPZ = p.z;
  }

  private syncFoes(sim: Sim, dt: number): void {
    let fi = 0;
    let maxFlash = 0;
    for (const f of sim.foes) {
      if (fi >= this.foePool.length) break;
      const v = this.foePool[fi++];
      if (v.kind !== f.kind) {
        v.kind = f.kind;
        v.mesh.geometry = FOE_GEO[f.kind];
        v.mesh.material = f.kind === 'husk' ? v.huskMat : FOE_MAT[f.kind];
        v.heart.visible = f.kind === 'husk';
        v.core.visible = f.kind === 'wisp';
        v.prevState = null;
        v.prevHp = -1;
        v.mesh.rotation.set(0, 0, 0);
      }
      v.group.visible = true;
      v.group.position.set(f.x, FOE_Y[f.kind], f.z);
      v.group.rotation.y = 0;

      // spawn ramp: scale-in over the sim's 0.4s tell
      let sc = 1;
      if (f.state === 'spawn') {
        const k = 1 - Math.max(0, f.timer) / 0.4;
        sc = 0.05 + 0.95 * (1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3));
      }

      // per-hit read: hp drop on this pool slot → scale pop + white flash
      if (v.prevHp >= 0 && f.hp < v.prevHp - 0.01) {
        v.popT = 0.09;
        v.flashT = 0.08;
      }
      v.prevHp = f.hp;
      if (v.popT > 0) {
        v.popT = Math.max(0, v.popT - dt);
        sc *= 1 + 0.18 * Math.sin((1 - v.popT / 0.09) * Math.PI);
      }
      v.group.scale.setScalar(sc);

      // per-kind motion + facing (view-side atan2 toward the player)
      const dx = sim.player.x - f.x;
      const dz = sim.player.z - f.z;
      if (f.kind === 'wisp') {
        v.group.rotation.y = Math.atan2(dx, dz);
        v.mesh.rotation.x = 0.17 + Math.sin(this.time * 1.7 + f.id) * 0.05; // ~10° lean to feed
        v.mesh.rotation.z = Math.sin(this.time * 1.3 + f.id * 2.1) * 0.07;
        v.group.position.y = FOE_Y.wisp + Math.sin(this.time * 2.6 + f.id) * 0.22;
      } else if (f.kind === 'cinder') {
        v.mesh.rotation.y += dt * 10;
        v.mesh.rotation.x += dt * 3.1;
        v.group.position.y = FOE_Y.cinder + Math.sin(this.time * 7 + f.id * 1.7) * 0.08;
        // ember wake while alive
        if (Math.random() < dt * 12) {
          this.fx.spawn(f.x, FOE_Y.cinder, f.z, (Math.random() - 0.5) * 0.8, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8, {
            life: 0.4,
            size: 0.3,
            color: WAKE_C,
            drag: 1.6,
          });
        }
      } else {
        // husk faces its locked charge dir while screaming, else the player
        const dir = f.chargeDir ?? { x: dx, z: dz };
        v.mesh.rotation.y = Math.atan2(dir.x, dir.z);
        if (f.state === 'windup') {
          v.mesh.rotation.x = -0.12 * (1 - Math.max(0, f.timer) / HUSK.windup); // coils back
        } else if (f.state === 'charge') {
          v.mesh.rotation.x = 0.16; // lunges forward
        } else {
          v.mesh.rotation.x += (0 - v.mesh.rotation.x) * Math.min(1, dt * 8);
        }
      }

      // husk scream tell — one fire ring at windup START (state transition)
      if (f.kind === 'husk' && f.state === 'windup' && v.prevState !== 'windup') {
        this.rings.fire(f.x, f.z, 4.5, 0.5, COL.huskHot);
      }
      v.prevState = f.state;

      // THE TELL — husk windup: emissive + rim ramp to the hottest ladder
      // step, spear grows along chargeDir
      if (f.kind === 'husk' && (f.state === 'windup' || f.state === 'charge') && f.chargeDir) {
        const dir = f.chargeDir;
        const ang = Math.atan2(dir.x, dir.z);
        v.spear.visible = true;
        v.spear.rotation.y = ang;
        tmpColor.set(COL.huskHot);
        v.huskMat.uniforms.uRim.value.lerp(tmpColor, Math.min(1, dt * 10));
        if (f.state === 'windup') {
          const e = 1 - Math.max(0, f.timer) / HUSK.windup; // 0→1 over the 0.8s scream
          const ext = f.r + 0.6 + e * 1.6;
          v.spear.position.set(dir.x * ext, 0.8, dir.z * ext);
          v.spearMat.opacity = 0.3 + 0.65 * e * (0.7 + 0.3 * Math.sin(this.time * 30));
          v.spear.scale.set(1, 1, 0.5 + e * 0.7);
          v.huskMat.uniforms.uEmisK.value = 0.12 + 1.15 * e;
          setRimK(v.huskMat, 0.9 + 2.3 * e); // → 3.2 at full scream
        } else {
          v.spear.position.set(dir.x * (f.r + 2.2), 0.8, dir.z * (f.r + 2.2));
          v.spearMat.opacity = 0.95;
          v.spear.scale.set(1, 1, 1.2);
          v.huskMat.uniforms.uEmisK.value = 1.15;
          setRimK(v.huskMat, 3.2);
        }
      } else {
        v.spear.visible = false;
        if (f.kind === 'husk') {
          // recover / walk: ease the shout back down to the resting ember
          const cur = v.huskMat.uniforms.uEmisK.value as number;
          v.huskMat.uniforms.uEmisK.value = cur + (0.12 - cur) * Math.min(1, dt * 6);
          const rk = v.huskMat.uniforms.uRimK.value as number;
          setRimK(v.huskMat, rk + (0.9 - rk) * Math.min(1, dt * 6));
          tmpColor.set(COL.huskRim);
          v.huskMat.uniforms.uRim.value.lerp(tmpColor, Math.min(1, dt * 6));
        }
      }

      // shared-material hit flash — brightest active pop wins
      v.flashT = Math.max(0, v.flashT - dt);
      v.flash.visible = v.flashT > 0;
      if (v.flashT > maxFlash) maxFlash = v.flashT;
    }
    for (let i = fi; i < this.foePool.length; i++) this.foePool[i].group.visible = false;
    this.flashMat.opacity = maxFlash > 0 ? (maxFlash / 0.08) * 0.85 : 0;
  }

  private syncBolts(sim: Sim, dt: number): void {
    let n = 0;
    this.tracerCount = 0;
    for (const b of sim.projectiles) {
      if (n >= CAPS.projectiles) break;
      this.bolts.set(n, b.x, 0.95, b.z, 1.25, BOLT_C, 0.95);
      let age = this.boltAge.get(b);
      if (age === undefined) {
        // fresh volley — GLIMMER muzzle read: 0.1s lash + 6-particle cone flash
        age = 0;
        this.muzzleT = 0.1;
        this.muzzleX = sim.player.x;
        this.muzzleZ = sim.player.z;
        const vl = Math.hypot(b.vx, b.vz) || 1;
        this.muzzleDX = b.vx / vl;
        this.muzzleDZ = b.vz / vl;
        const baseAng = Math.atan2(this.muzzleDZ, this.muzzleDX);
        for (let i = 0; i < 6; i++) {
          const a = baseAng + (Math.random() - 0.5) * 0.7;
          const s = 4 + Math.random() * 3.5;
          this.fx.spawn(sim.player.x + this.muzzleDX * 0.5, 0.95, sim.player.z + this.muzzleDZ * 0.5, Math.cos(a) * s, (Math.random() - 0.2) * 0.8, Math.sin(a) * s, {
            life: 0.18,
            size: 0.42,
            color: MOTE_C_RARE,
            drag: 4,
          });
        }
      } else {
        age += dt;
      }
      this.boltAge.set(b, age);
      if (age < 0.06 && this.tracerCount < TRACER_CAP) {
        const t = this.tracerCount++;
        this.tracers[t * 4] = sim.player.x;
        this.tracers[t * 4 + 1] = sim.player.z;
        this.tracers[t * 4 + 2] = b.x;
        this.tracers[t * 4 + 3] = b.z;
      }
      n++;
    }
    this.bolts.setCount(n);
    this.bolts.flush();
  }

  private syncMotes(sim: Sim): void {
    let n = 0;
    for (const m of sim.motes) {
      if (n >= CAPS.motes) break;
      // size 0.9–1.3, per-point sine pulse (phase = index), 10% rare white
      const base = 0.9 + ((n * 0.618034) % 1) * 0.4;
      const pulse = 1 + 0.22 * Math.sin(this.time * 3 + n * 1.7);
      const c = n % 10 === 0 ? MOTE_C_RARE : MOTE_C;
      this.motes.set(n, m.x, 0.55 + Math.sin(this.time * 3 + n) * 0.09, m.z, base * pulse, c, 0.9);
      n++;
    }
    this.motes.setCount(n);
    this.motes.flush();
  }

  private syncArcs(sim: Sim, dt: number): void {
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    let n = 0;
    for (const a of sim.arcs) {
      if (n >= CAPS.arcs) break;
      this.arcPos.setXYZ(n * 2, a.x1, 0.95, a.z1);
      this.arcPos.setXYZ(n * 2 + 1, a.x2, 0.95, a.z2);
      n++;
    }
    // second section: view-side muzzle lash + fresh-bolt tracers
    if (this.muzzleT > 0) {
      this.arcPos.setXYZ(n * 2, this.muzzleX, 0.95, this.muzzleZ);
      this.arcPos.setXYZ(n * 2 + 1, this.muzzleX + this.muzzleDX * 4.5, 0.95, this.muzzleZ + this.muzzleDZ * 4.5);
      n++;
    }
    for (let t = 0; t < this.tracerCount && n < ARC_SEGMENTS; t++) {
      this.arcPos.setXYZ(n * 2, this.tracers[t * 4], 0.95, this.tracers[t * 4 + 1]);
      this.arcPos.setXYZ(n * 2 + 1, this.tracers[t * 4 + 2], 0.95, this.tracers[t * 4 + 3]);
      n++;
    }
    this.arcGeo.setDrawRange(0, n * 2);
    this.arcPos.needsUpdate = true;
  }

  private syncTrails(sim: Sim): void {
    let n = 0;
    for (const t of sim.trails) {
      if (n >= this.trailPool.length) break;
      const v = this.trailPool[n++];
      v.mesh.visible = true;
      v.mesh.position.set(t.x, 0.1, t.z);
      v.mesh.scale.setScalar(t.r);
      v.mat.opacity = Math.max(0, Math.min(1, t.life / TRAIL.life)) * 0.5;
    }
    for (let i = n; i < this.trailPool.length; i++) this.trailPool[i].mesh.visible = false;
  }

  /** one Points draw — player, foes and pillars all land on the ground */
  private syncShadows(sim: Sim): void {
    let n = 0;
    this.shadows.set(
      n++,
      sim.player.x,
      0.04,
      sim.player.z,
      1.1,
      SHADOW_C,
      0.55 * Math.max(0, 1 - this.playerBody.position.y / 3),
    );
    for (const f of sim.foes) {
      if (n >= SHADOW_CAP - 5) break;
      const y = FOE_Y[f.kind] + (f.kind === 'wisp' ? Math.sin(this.time * 2.6 + f.id) * 0.22 : 0);
      this.shadows.set(n++, f.x, 0.04, f.z, f.r * 2.2, SHADOW_C, 0.5 * Math.max(0, 1 - y / 3));
    }
    for (const p of this.pillarCache) {
      this.shadows.set(n++, p.x, 0.035, p.z, p.r * 2.6, SHADOW_C, 0.5);
    }
    this.shadows.setCount(n);
    this.shadows.flush();
  }

  /** 160 drifting embers around the camera focus — wrap, never kill */
  private syncEmbers(sim: Sim, dt: number): void {
    const px = sim.player.x;
    const pz = sim.player.z;
    const s = this.emberState;
    for (let i = 0; i < EMBER_CAP; i++) {
      const o = i * 4;
      let x = s[o];
      let y = s[o + 1];
      let z = s[o + 2];
      const phase = s[o + 3];
      y += this.emberRise[i] * dt;
      x += Math.sin(this.time * 0.7 + phase) * 0.4 * dt;
      z += Math.cos(this.time * 0.53 + phase * 1.3) * 0.35 * dt;
      if (x - px > 15) x -= 30;
      else if (x - px < -15) x += 30;
      if (z - pz > 15) z -= 30;
      else if (z - pz < -15) z += 30;
      if (y > 6) y -= 6;
      s[o] = x;
      s[o + 1] = y;
      s[o + 2] = z;
      const a = 0.55 * Math.min(1, y / 0.5) * Math.max(0, 1 - Math.max(0, y - 4.5) / 1.5);
      this.embers.set(i, x, y, z, this.emberSize[i], this.emberCol[i], a);
    }
    this.embers.setCount(EMBER_CAP);
    this.embers.flush();
  }

  /* ---------------------------------------------------------------- */

  /** engine-event driven hurt flash (the sanctioned white-hot bloom) */
  flashHurt(): void {
    this.flashT = 1;
  }

  dispose(): void {
    this.disposed = true;
    for (const o of this.rootObjects) this.scene.remove(o);
    this.rootObjects.length = 0;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

/** hand-cut tapered slab — local copy of the house helper */
function taperedBox(w: number, h: number, d: number, taper: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * taper);
      pos.setZ(i, pos.getZ(i) * taper);
    }
  }
  return geo;
}

/** dashed circle of arc segments — the pickup-radius readout */
function makeDashedRing(radius: number, dashes: number, fill: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const step = (Math.PI * 2) / dashes;
  for (let i = 0; i < dashes; i++) {
    parts.push(new THREE.RingGeometry(radius - 0.07, radius, 5, 1, i * step, step * fill).rotateX(-Math.PI / 2));
  }
  return mergeGeometries(parts)!;
}

/** the dead sun — big soft radial ember haze for the far horizon */
function makeDeadSunTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 84, 0, 128, 84, 120);
  g.addColorStop(0, 'rgba(42,18,6,0.9)');
  g.addColorStop(0.4, 'rgba(42,18,6,0.45)');
  g.addColorStop(1, 'rgba(42,18,6,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 160);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const BURN_COL = new THREE.Color(0xff7a35);
const WAKE_C = new THREE.Color(0xffb454);
const DASH_C = new THREE.Color(0xffd27a);
const BOLT_C = new THREE.Color(0xffd98f);
const MOTE_C = new THREE.Color(0xffd98f);
const MOTE_C_RARE = new THREE.Color(0xfff3dc);
const SHADOW_C = new THREE.Color(0x000000);
const EMBER_A = new THREE.Color(0xffb454);
const EMBER_B = new THREE.Color(0xff7a35);
const tmpColor = new THREE.Color();
