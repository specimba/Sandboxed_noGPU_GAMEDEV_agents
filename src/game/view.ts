import * as THREE from 'three';
import { ARENA, COLORS } from './constants';
import type { FoeKind, Sim } from './sim';
import { makeGlowTexture, ParticlePool } from './fx';

/**
 * HOLLOW SUN view: pools syncing the sim onto the emissive scene.
 * Foes are shared-geometry meshes with additive glow sprites; bullets are a
 * single Points buffer; shards are elongated blades of light with trails.
 */

const FOE_GEO: Record<FoeKind, THREE.BufferGeometry> = {
  drifter: new THREE.OctahedronGeometry(0.85, 0),
  striker: new THREE.TetrahedronGeometry(0.95, 0),
  weaver: new THREE.TorusGeometry(0.66, 0.17, 8, 26).rotateX(Math.PI / 2),
  warden: new THREE.IcosahedronGeometry(2.2, 0),
};

const FOE_COL: Record<FoeKind, number> = {
  drifter: COLORS.foe,
  striker: 0xff6a3d,
  weaver: 0xff2d6e,
  warden: COLORS.warden,
};

interface FoeView {
  group: THREE.Group;
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  kind: FoeKind;
}

interface MarkView {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

const MAX_BULLETS = 340;

export class View {
  private scene: THREE.Scene;
  private fx: ParticlePool;
  private glowTex: THREE.CanvasTexture;

  private playerGroup = new THREE.Group();
  private playerCore: THREE.Mesh;
  private playerGlow: THREE.Sprite;

  private shardViews: { mesh: THREE.Mesh; glow: THREE.Sprite }[] = [];

  private foePool: FoeView[] = [];

  private bulletGeo = new THREE.BufferGeometry();
  private bulletPos = new THREE.BufferAttribute(new Float32Array(MAX_BULLETS * 3), 3);
  private bulletPoints: THREE.Points;

  private markPool: MarkView[] = [];
  private markCursor = 0;

  private haloPool: MarkView[] = [];
  private haloUsed = 0;

  private telegraphs: { line: THREE.Line; mat: THREE.LineBasicMaterial }[] = [];

  private reticle: THREE.Group;
  private time = 0;

  constructor(scene: THREE.Scene, fx: ParticlePool) {
    this.scene = scene;
    this.fx = fx;
    this.glowTex = makeGlowTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');

    // ---- ember ----
    const coreGeo = new THREE.IcosahedronGeometry(0.42, 1);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff4dc });
    this.playerCore = new THREE.Mesh(coreGeo, coreMat);
    this.playerCore.position.y = 1.0;
    this.playerGroup.add(this.playerCore);
    this.playerGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffd9a0, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9, fog: false }),
    );
    this.playerGlow.scale.setScalar(4.2);
    this.playerGlow.position.y = 1.0;
    this.playerGroup.add(this.playerGlow);
    scene.add(this.playerGroup);

    // ---- shards of light ----
    const bladeGeo = new THREE.OctahedronGeometry(0.34, 0);
    bladeGeo.scale(1, 2.4, 1);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe9bd, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95, depthWrite: false, fog: false });
      const mesh = new THREE.Mesh(bladeGeo, mat);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75, fog: false }));
      glow.scale.setScalar(2.2);
      mesh.add(glow);
      mesh.visible = false;
      scene.add(mesh);
      this.shardViews.push({ mesh, glow });
    }

    // ---- foes ----
    for (let i = 0; i < 40; i++) {
      const group = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: COLORS.foe, transparent: true, opacity: 0.95, fog: true });
      const mesh = new THREE.Mesh(FOE_GEO.drifter, mat);
      group.add(mesh);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: COLORS.foe, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.4, fog: false }));
      glow.scale.setScalar(3);
      group.add(glow);
      group.visible = false;
      scene.add(group);
      this.foePool.push({ group, mesh, glow, kind: 'drifter' });
    }

    // ---- bullets (one draw call) ----
    this.bulletPos.setUsage(THREE.DynamicDrawUsage);
    this.bulletGeo.setAttribute('position', this.bulletPos);
    this.bulletGeo.setDrawRange(0, 0);
    const bMat = new THREE.PointsMaterial({
      color: COLORS.foeBullet,
      size: 0.85,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: this.glowTex,
    });
    this.bulletPoints = new THREE.Points(this.bulletGeo, bMat);
    this.bulletPoints.frustumCulled = false;
    this.bulletPoints.renderOrder = 9;
    scene.add(this.bulletPoints);

    // ---- spawn telegraph marks ----
    const markGeo = new THREE.RingGeometry(0.78, 1.0, 40);
    markGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: COLORS.foe, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(markGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      scene.add(mesh);
      this.markPool.push({ mesh, mat });
    }

    // ---- elite halos (readability: ring = affix) ----
    const haloGeo = new THREE.RingGeometry(0.8, 0.94, 36);
    haloGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(haloGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      scene.add(mesh);
      this.haloPool.push({ mesh, mat });
    }

    // ---- striker telegraph lines ----
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.telegraphs.push({ line, mat });
    }

    // ---- aim reticle ----
    this.reticle = new THREE.Group();
    const rGeo = new THREE.RingGeometry(0.5, 0.62, 24);
    rGeo.rotateX(-Math.PI / 2);
    const rMat = new THREE.MeshBasicMaterial({ color: 0xffe9bd, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(rGeo, rMat);
    this.reticle.add(ring);
    const dotGeo = new THREE.CircleGeometry(0.14, 12);
    dotGeo.rotateX(-Math.PI / 2);
    const dot = new THREE.Mesh(dotGeo, rMat);
    this.reticle.add(dot);
    this.reticle.position.y = 0.15;
    scene.add(this.reticle);
  }

  /* ---------------------------------------------------------------- */

  sync(sim: Sim, aimX: number, aimZ: number, showAim: boolean, dt: number): void {
    this.time += dt;

    // ember
    this.playerGroup.position.set(sim.px, 0, sim.pz);
    const blink = sim.invuln > 0 && Math.floor(this.time * 14) % 2 === 0;
    this.playerCore.visible = !blink;
    this.playerGlow.visible = !blink;
    this.playerCore.rotation.y += dt * 3;
    const stretch = 1 + Math.min(0.9, Math.hypot(sim.pvx, sim.pvz) * 0.035);
    this.playerCore.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
    if (sim.dashT > 0) {
      this.fx.spawn(sim.px, 1.0, sim.pz, (Math.random() - 0.5) * 3, 0.6, (Math.random() - 0.5) * 3, {
        life: 0.32,
        size: 0.55,
        color: EMBER_COL,
        drag: 3.2,
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
      (v.glow.material as THREE.SpriteMaterial).opacity = flying ? 0.9 : 0.5;
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
    for (const f of sim.foes) {
      if (fi >= this.foePool.length) break;
      const v = this.foePool[fi++];
      if (v.kind !== f.kind) {
        v.kind = f.kind;
        v.mesh.geometry = FOE_GEO[f.kind];
        (v.mesh.material as THREE.MeshBasicMaterial).color.set(FOE_COL[f.kind]);
        (v.glow.material as THREE.SpriteMaterial).color.set(FOE_COL[f.kind]);
        v.glow.scale.setScalar(f.kind === 'warden' ? 7.5 : 3);
      }
      v.group.visible = true;
      v.group.position.set(f.x, f.kind === 'warden' ? 2.4 : 1.0, f.z);
      const spawnK = f.spawnT > 0 ? 1 - Math.max(0, f.spawnT) / (f.kind === 'warden' ? 1.4 : 0.45) : 1;
      const pop = f.kind === 'warden' ? 0.35 : 0.15;
      const sc = Math.max(0.02, spawnK) * (1 + pop * (1 - spawnK));
      v.group.scale.setScalar(sc * (f.elite === 'swift' ? 0.85 : 1));
      v.mesh.rotation.y += dt * (f.kind === 'warden' ? 0.7 : 1.8);
      if (f.kind === 'drifter') v.mesh.rotation.x += dt * 1.1;

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

      // striker telegraph line while aiming
      if (f.kind === 'striker' && f.state === 1) {
        const t = this.telegraphs.find((l) => !l.line.visible);
        if (t) {
          const pos = t.line.geometry.getAttribute('position') as THREE.BufferAttribute;
          pos.setXYZ(0, f.x, 0.9, f.z);
          const dl = Math.hypot(f.tx - f.x, f.tz - f.z) || 1;
          const grow = 1 - Math.max(0, f.timer) / 0.55;
          pos.setXYZ(1, f.x + ((f.tx - f.x) / dl) * dl * Math.min(1, grow * 1.4), 0.9, f.z + ((f.tz - f.z) / dl) * dl * Math.min(1, grow * 1.4));
          pos.needsUpdate = true;
          t.line.visible = true;
          t.mat.opacity = 0.25 + 0.55 * grow * (0.7 + 0.3 * Math.sin(this.time * 30));
        }
      }
    }
    for (let i = fi; i < this.foePool.length; i++) this.foePool[i].group.visible = false;
    for (const t of this.telegraphs) {
      if (t.line.visible) {
        t.mat.opacity -= dt * 4;
        if (t.mat.opacity <= 0) t.line.visible = false;
      }
    }

    // bullets
    const n = Math.min(sim.bullets.length, MAX_BULLETS);
    for (let i = 0; i < n; i++) {
      const b = sim.bullets[i];
      this.bulletPos.setXYZ(i, b.x, 1.0, b.z);
    }
    this.bulletGeo.setDrawRange(0, n);
    this.bulletPos.needsUpdate = true;

    // spawn marks
    this.markCursor = 0;
    for (const m of sim.marks) {
      if (this.markCursor >= this.markPool.length) break;
      const v = this.markPool[this.markCursor++];
      v.mesh.visible = true;
      v.mesh.position.set(m.x, 0.14, m.z);
      const total = m.kind === 'warden' ? 1.5 : 0.9;
      const k = 1 - Math.max(0, m.t) / total;
      v.mesh.scale.setScalar(2.6 - k * 1.7);
      v.mat.opacity = 0.25 + 0.6 * k * (0.6 + 0.4 * Math.sin(this.time * 22));
    }
    for (let i = this.markCursor; i < this.markPool.length; i++) this.markPool[i].mesh.visible = false;
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
      this.reticle.children[0].rotateY(dt * 1.6);
    }
  }

  setAimVisible(v: boolean): void {
    this.reticle.visible = v;
  }

  dispose(): void {
    this.scene.remove(this.playerGroup, this.bulletPoints, this.reticle);
    for (const s of this.shardViews) this.scene.remove(s.mesh);
    for (const f of this.foePool) this.scene.remove(f.group);
    for (const m of this.markPool) this.scene.remove(m.mesh);
    for (const t of this.telegraphs) this.scene.remove(t.line);
  }
}

const EMBER_COL = new THREE.Color(0xffdca0);
const SHARD_COL = new THREE.Color(0xffd27a);
const WARDEN_COL = new THREE.Color(0xff7a2d);
