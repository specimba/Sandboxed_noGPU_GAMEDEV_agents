import * as THREE from 'three';
import { makeGlowTexture, ParticlePool } from '../fx';
import { coreMaterial, makeDiamondTexture, setRimK, stylizedMaterial, updateStylized } from '../materials';
import {
  ARENA_RADIUS,
  CAPS,
  FOES,
  HUSK,
  PLAYER,
  TRAIL,
  type FoeKind,
} from './constants';
import type { Sim } from './sim';

/**
 * AFTERGLOW view — the EMBER RITE house style, rebuilt around the new sim.
 *
 * Obsidian + ember: every solid is a chiseled stylizedMaterial shell (dFdx
 * facets, fresnel rim, emissive heart); lights are coreMaterial. Law 2: the
 * view reads ONLY sim public state — telegraphs live in the sim (foe state
 * 'windup' + locked chargeDir) and the view renders them brighter than
 * everything else. The bright thing is always the important thing.
 *
 * Draw-call discipline: foes are a 40-entry pooled group list (wisp/cinder are
 * single meshes; husks carry a heart sprite + telegraph spear), projectiles /
 * motes are one Points draw each, arcs one LineSegments draw.
 */

/* ------------------------------------------------------------------ */
/* identity palette — near-black obsidian, ember-orange accents only    */
/* ------------------------------------------------------------------ */

const COL = {
  ember: 0xff8a3d,
  emberSoft: 0xffb454,
  playerCore: 0xffefcf,
  playerRim: 0xffb454,
  wispRim: 0xff8a5c,
  huskRim: 0xff6a3d,
  huskHot: 0xff4d26,
  cinderRim: 0xffb454,
  bolt: 0xffd98f,
  mote: 0xffc766,
  arc: 0xffe9a0,
  trail: 0xff8a4d,
  hurt: 0xfff1d6,
};

const FOE_GEO: Record<FoeKind, THREE.BufferGeometry> = {
  wisp: new THREE.TetrahedronGeometry(0.68, 0).scale(1, 1.45, 1), // dark light-eater shard
  husk: new THREE.BoxGeometry(1.3, 1.35, 1.1), // chunky box brute
  cinder: new THREE.OctahedronGeometry(0.42, 0), // fast swarm body
};

/** shared shell per kind (husk gets per-pool clones — its emissive ramps) */
const FOE_MAT: Record<Exclude<FoeKind, 'husk'>, THREE.ShaderMaterial> = {
  wisp: stylizedMaterial({
    base: 0x120b08,
    lit: 0x241610,
    rim: COL.wispRim,
    rimK: 0.55,
    emis: COL.wispRim,
    emisK: 0.08,
  }),
  cinder: stylizedMaterial({
    base: 0x150c08,
    lit: 0x2a1a10,
    rim: COL.cinderRim,
    rimK: 0.95,
    emis: COL.cinderRim,
    emisK: 0.16,
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

const FOE_Y: Record<FoeKind, number> = { wisp: 1.0, husk: 0.78, cinder: 0.55 };

interface FoeView {
  group: THREE.Group;
  mesh: THREE.Mesh;
  huskMat: THREE.ShaderMaterial;
  heart: THREE.Sprite;
  spear: THREE.Mesh;
  spearMat: THREE.MeshBasicMaterial;
  kind: FoeKind;
}

interface TrailView {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

const MAX_TRAILS = 12;

export class AfterglowView {
  private scene: THREE.Scene;
  private fx: ParticlePool;
  private glowTex: THREE.CanvasTexture;
  private diamondTex: THREE.CanvasTexture;
  private disposables: { dispose(): void }[] = [];

  private playerGroup = new THREE.Group();
  private playerBody = new THREE.Group();
  private playerCore: THREE.Mesh;
  private playerShell: THREE.Mesh;
  private playerGlow: THREE.Sprite;
  private playerFlash: THREE.Sprite;
  private flashT = 0;

  private foePool: FoeView[] = [];
  private heartMat: THREE.SpriteMaterial;

  private boltGeo = new THREE.BufferGeometry();
  private boltPos: THREE.BufferAttribute;
  private boltPoints: THREE.Points;

  private moteGeo = new THREE.BufferGeometry();
  private motePos: THREE.BufferAttribute;
  private motePoints: THREE.Points;

  private arcGeo = new THREE.BufferGeometry();
  private arcPos: THREE.BufferAttribute;
  private arcLines: THREE.LineSegments;

  private trailPool: TrailView[] = [];
  private trailGeo: THREE.BufferGeometry;
  private pillarDisposables: { dispose(): void }[] = [];

  private time = 0;
  private disposed = false;
  private rootObjects: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene, fx: ParticlePool) {
    this.scene = scene;
    this.fx = fx;
    this.glowTex = makeGlowTexture('rgba(255,236,200,0.95)', 'rgba(255,120,40,0)');
    this.diamondTex = makeDiamondTexture();
    this.disposables.push(this.glowTex, this.diamondTex);

    this.buildArena();

    // ---- the player: the LAST LIGHT — a glowing core figure ----
    this.playerCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), coreMaterial(COL.playerCore));
    this.disposables.push(this.playerCore.geometry, this.playerCore.material as THREE.Material);
    this.playerBody.add(this.playerCore);

    this.playerShell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 0),
      stylizedMaterial({
        base: 0x1b120b,
        lit: 0x3a2a1a,
        rim: COL.playerRim,
        rimK: 0.55,
        rimPow: 2.2,
        emis: 0xff9a4a,
        emisK: 0.08,
        topK: 0.1,
      }),
    );
    this.disposables.push(this.playerShell.geometry, this.playerShell.material as THREE.Material);
    this.playerBody.add(this.playerShell);

    // heading spark — a small bright facet showing where the light faces
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), coreMaterial(COL.playerCore));
    spark.position.set(0, 0.1, 0.6);
    this.disposables.push(spark.geometry, spark.material as THREE.Material);
    this.playerBody.add(spark);

    this.playerGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5, fog: false }),
    );
    this.playerGlow.scale.setScalar(1.7);
    this.disposables.push(this.playerGlow.material as THREE.Material);
    this.playerBody.add(this.playerGlow);

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

    // ---- foes: 40 pooled entries, geometry swapped by kind ----
    this.heartMat = new THREE.SpriteMaterial({ map: this.glowTex, color: COL.huskHot, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.4, fog: false });
    this.disposables.push(this.heartMat);
    const spearGeo = new THREE.OctahedronGeometry(0.5, 0).scale(0.22, 0.22, 2.6);
    this.disposables.push(spearGeo);
    for (let i = 0; i < CAPS.foes; i++) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(FOE_GEO.wisp, FOE_MAT.wisp);
      group.add(mesh);
      const huskMat = HUSK_MAT_BASE.clone();
      this.disposables.push(huskMat);
      const heart = new THREE.Sprite(this.heartMat);
      heart.scale.setScalar(1.9);
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
      group.visible = false;
      this.addRoot(group);
      this.foePool.push({ group, mesh, huskMat, heart, spear, spearMat, kind: 'wisp' });
    }

    // ---- bolts: one Points draw — diamond shards of light ----
    this.boltPos = new THREE.BufferAttribute(new Float32Array(CAPS.projectiles * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.boltGeo.setAttribute('position', this.boltPos);
    this.boltGeo.setDrawRange(0, 0);
    const boltMat = new THREE.PointsMaterial({
      color: COL.bolt,
      size: 0.85,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: this.diamondTex,
    });
    this.boltPoints = new THREE.Points(this.boltGeo, boltMat);
    this.boltPoints.frustumCulled = false;
    this.boltPoints.renderOrder = 9;
    this.addRoot(this.boltPoints);
    this.disposables.push(this.boltGeo, boltMat);

    // ---- motes: one Points draw — drifting light ----
    this.motePos = new THREE.BufferAttribute(new Float32Array(CAPS.motes * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.moteGeo.setAttribute('position', this.motePos);
    this.moteGeo.setDrawRange(0, 0);
    const moteMat = new THREE.PointsMaterial({
      color: COL.mote,
      size: 0.62,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: this.glowTex,
    });
    this.motePoints = new THREE.Points(this.moteGeo, moteMat);
    this.motePoints.frustumCulled = false;
    this.motePoints.renderOrder = 9;
    this.addRoot(this.motePoints);
    this.disposables.push(this.moteGeo, moteMat);

    // ---- chain arcs: one LineSegments draw, bright segments ----
    this.arcPos = new THREE.BufferAttribute(new Float32Array(CAPS.arcs * 6), 3).setUsage(THREE.DynamicDrawUsage);
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
  }

  /* ---------------------------------------------------------------- */
  /* arena — obsidian disc, ember boundary, pillar monoliths           */
  /* ---------------------------------------------------------------- */

  private buildArena(): void {
    const scene = this.scene;

    // the obsidian floor — dark by law; the ember rim ring carries the accent
    const floorGeo = new THREE.CircleGeometry(ARENA_RADIUS + 0.6, 96).rotateX(-Math.PI / 2);
    const floorMat = stylizedMaterial({
      base: 0x0a0705,
      lit: 0x181009,
      rim: 0xff9a4a,
      rimK: 0.14,
      rimPow: 3.0,
      emis: 0xff7a2d,
      emisK: 0.012,
      topK: 0.1,
      flat: true,
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
      base: 0x070403,
      lit: 0x0e0906,
      rim: 0xff8a3d,
      rimK: 0.1,
      rimPow: 4.0,
      emis: 0xff7a2d,
      emisK: 0.006,
      topK: 0.05,
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

    // engraved inner rings (cheap dressing, 2 draws)
    for (const [r, tube, op] of [
      [23.5, 0.05, 0.16],
      [2.8, 0.07, 0.22],
    ] as const) {
      const g = new THREE.TorusGeometry(r, tube, 6, 96).rotateX(Math.PI / 2);
      const m = new THREE.MeshBasicMaterial({ color: COL.emberSoft, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.y = 0.04;
      this.addRoot(mesh);
      this.disposables.push(g, m);
    }

    // the far dead dark — huge inverted cylinder swallowing the horizon
    const wallGeo = new THREE.CylinderGeometry(70, 76, 80, 48, 1, true);
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x080504, side: THREE.BackSide, fog: true });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 28;
    this.addRoot(wall);
    this.disposables.push(wallGeo, wallMat);

    // leaning monolith silhouettes outside the rim (ember-flecked edge feel)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + (i % 3) * 0.13;
      const r = 33 + (i % 4) * 3.4;
      const h = 7 + (i % 5) * 2.3;
      const w = 1.7 + (i % 3) * 0.8;
      const d = 1.3 + (i % 2) * 0.9;
      const geo = taperedBox(w, h, d, 0.5 + (i % 3) * 0.12);
      const mat = stylizedMaterial({ base: 0x120d08, lit: 0x2a1d12, rim: 0xff9a4a, rimK: 0.32, rimPow: 3.2, fog: true });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * r, h * 0.5 - 1.4, Math.sin(a) * r);
      m.lookAt(0, m.position.y, 0);
      m.rotateY((i % 4) * 0.14 - 0.2);
      m.rotateX(0.05 + (i % 3) * 0.05);
      this.addRoot(m);
      this.disposables.push(geo, mat);
    }
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
    }
  }

  private addRoot(o: THREE.Object3D): void {
    this.rootObjects.push(o);
    this.scene.add(o);
  }

  /* ---------------------------------------------------------------- */
  /* per-frame sync — pure read of sim public state                    */
  /* ---------------------------------------------------------------- */

  sync(sim: Sim, dt: number): void {
    if (this.disposed) return;
    this.time += dt;

    this.syncPlayer(sim, dt);
    this.syncFoes(sim, dt);
    this.syncBolts(sim);
    this.syncMotes(sim);
    this.syncArcs(sim);
    this.syncTrails(sim, dt);

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

    (this.playerGlow.material as THREE.SpriteMaterial).opacity = 0.42 + 0.14 * Math.sin(this.time * 5.2) + squash * 0.3;
  }

  private syncFoes(sim: Sim, dt: number): void {
    let fi = 0;
    for (const f of sim.foes) {
      if (fi >= this.foePool.length) break;
      const v = this.foePool[fi++];
      if (v.kind !== f.kind) {
        v.kind = f.kind;
        v.mesh.geometry = FOE_GEO[f.kind];
        v.mesh.material = f.kind === 'husk' ? v.huskMat : FOE_MAT[f.kind];
        v.heart.visible = f.kind === 'husk';
      }
      v.group.visible = true;
      v.group.position.set(f.x, FOE_Y[f.kind], f.z);

      // spawn ramp: scale-in over the sim's 0.4s tell
      let sc = 1;
      if (f.state === 'spawn') {
        const k = 1 - Math.max(0, f.timer) / 0.4;
        sc = 0.05 + 0.95 * (1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3));
      }
      v.group.scale.setScalar(sc);

      // spin / bob per kind — husk holds still, it is about to scream
      if (f.kind === 'wisp') {
        v.mesh.rotation.y += dt * 1.7;
        v.mesh.rotation.x += dt * 0.9;
        v.group.position.y = FOE_Y.wisp + Math.sin(this.time * 2.6 + f.id) * 0.12;
      } else if (f.kind === 'cinder') {
        v.mesh.rotation.y += dt * 6.5;
        v.group.position.y = FOE_Y.cinder + Math.sin(this.time * 7 + f.id * 1.7) * 0.08;
      } else {
        v.mesh.rotation.y = 0;
      }

      // THE TELL — husk windup: emissive + rim ramp, spear grows along chargeDir
      if (f.kind === 'husk' && (f.state === 'windup' || f.state === 'charge') && f.chargeDir) {
        const dir = f.chargeDir;
        const ang = Math.atan2(dir.x, dir.z);
        v.spear.visible = true;
        v.spear.rotation.y = ang;
        if (f.state === 'windup') {
          const e = 1 - Math.max(0, f.timer) / HUSK.windup; // 0→1 over the 0.8s scream
          const ext = f.r + 0.6 + e * 1.6;
          v.spear.position.set(dir.x * ext, 0.8, dir.z * ext);
          v.spearMat.opacity = 0.3 + 0.65 * e * (0.7 + 0.3 * Math.sin(this.time * 30));
          v.spear.scale.set(1, 1, 0.5 + e * 0.7);
          v.huskMat.uniforms.uEmisK.value = 0.12 + 1.15 * e;
          setRimK(v.huskMat, 0.9 + 1.5 * e);
        } else {
          v.spear.position.set(dir.x * (f.r + 2.2), 0.8, dir.z * (f.r + 2.2));
          v.spearMat.opacity = 0.95;
          v.spear.scale.set(1, 1, 1.2);
          v.huskMat.uniforms.uEmisK.value = 1.15;
          setRimK(v.huskMat, 2.4);
        }
      } else {
        v.spear.visible = false;
        if (f.kind === 'husk') {
          // recover / walk: ease the shout back down to the resting ember
          const cur = v.huskMat.uniforms.uEmisK.value as number;
          v.huskMat.uniforms.uEmisK.value = cur + (0.12 - cur) * Math.min(1, dt * 6);
          const rk = v.huskMat.uniforms.uRimK.value as number;
          setRimK(v.huskMat, rk + (0.9 - rk) * Math.min(1, dt * 6));
        }
      }
    }
    for (let i = fi; i < this.foePool.length; i++) this.foePool[i].group.visible = false;
  }

  private syncBolts(sim: Sim): void {
    let n = 0;
    for (const b of sim.projectiles) {
      if (n >= CAPS.projectiles) break;
      this.boltPos.setXYZ(n++, b.x, 0.95, b.z);
    }
    this.boltGeo.setDrawRange(0, n);
    this.boltPos.needsUpdate = true;
  }

  private syncMotes(sim: Sim): void {
    let n = 0;
    for (const m of sim.motes) {
      if (n >= CAPS.motes) break;
      this.motePos.setXYZ(n++, m.x, 0.55 + Math.sin(this.time * 3 + n) * 0.09, m.z);
    }
    this.moteGeo.setDrawRange(0, n);
    this.motePos.needsUpdate = true;
  }

  private syncArcs(sim: Sim): void {
    let n = 0;
    for (const a of sim.arcs) {
      if (n >= CAPS.arcs) break;
      this.arcPos.setXYZ(n * 2, a.x1, 0.95, a.z1);
      this.arcPos.setXYZ(n * 2 + 1, a.x2, 0.95, a.z2);
      n++;
    }
    this.arcGeo.setDrawRange(0, n * 2);
    this.arcPos.needsUpdate = true;
  }

  private syncTrails(sim: Sim, dt: number): void {
    void dt;
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

const BURN_COL = new THREE.Color(0xff7a35);
