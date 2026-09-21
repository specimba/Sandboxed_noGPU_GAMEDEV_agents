import * as THREE from "three/webgpu";
import {
  uniform, vec2, vec3, vec4, float, mix, sin, cos, instancedBufferAttribute,
  uv, length, smoothstep, exp,
} from "three/tsl";
import { createFXState, EV } from "@/hollowsun/types";
import type { FXState, SimEvent, Snap } from "@/hollowsun/types";
import { Arena } from "./Arena";
import { SunHeart } from "./SunHeart";
import { EnemyView } from "./EnemyView";
import { BulletView } from "./BulletView";
import { ShardView } from "./ShardView";
import { Particles } from "./Particles";
import { Ribbon } from "./Trails";
import { CameraRig } from "./CameraRig";
import { makeLightDiscTexture } from "./tex";

/* palette (DESIGN_C §2, locked) */
const BG = 0x050408;
const EMBER = 0xff8a3d;
const GOLD = 0xffb454;
const HOT = 0xfff7ea;
const VOID = 0x9a6bff;
const DANGER = 0xff3b5c;

/* spawn pop colors per enemy kind (matches EnemyView rims) */
const KIND_POP = [EMBER, 0xffcf7a, VOID, 0xc08a44, DANGER];

/** Typed read of an instanced attribute (r185 typing narrows via cast). */
function attrF(geo: THREE.BufferGeometry, name: string): ReturnType<typeof float> {
  return instancedBufferAttribute(geo.getAttribute(name) as THREE.InstancedBufferAttribute) as unknown as ReturnType<typeof float>;
}

const PICKUP_CAP = 16;
const CORONA_SPARKS = 12;

interface PickupSlot {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
}

/**
 * HOLLOW SUN world — the arena made of LIGHT (C2 owned).
 * WebGPU boot (init → backend check AFTER init, periapsis pattern), FogExp2
 * bg-colored, the §1 LIGHT RULE world: arena, sun-heart, enemies, bullets,
 * shards, pickups, player, particles, trails, camera rig. PostProcessing is
 * C3's job — this class only exposes renderer/scene/camera.
 */
export class WorldView {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  backendName = "webgl2";

  private readonly fx: FXState;
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;

  private readonly arena: Arena;
  private readonly sunHeart: SunHeart;
  private readonly enemies: EnemyView;
  private readonly bullets: BulletView;
  private readonly shards: ShardView;
  private readonly particles: Particles;
  private readonly rig = new CameraRig();

  /* player visual */
  private readonly core: THREE.Mesh;
  private readonly coreMat: THREE.MeshBasicNodeMaterial;
  private readonly uCore = uniform(3.0);
  private readonly uCoronaFlick = uniform(1);
  private readonly uPX = uniform(0);
  private readonly uPY = uniform(1);
  private readonly uPZ = uniform(0);
  private readonly trailHot: Ribbon;
  private readonly trailEmber: Ribbon;
  private readonly emberLight: THREE.PointLight;

  /* pickups */
  private readonly pickups: PickupSlot[] = [];
  private readonly pickupGeo: THREE.OctahedronGeometry;
  private readonly pickupMat: THREE.MeshBasicNodeMaterial;
  private readonly glowTex: THREE.Texture;

  private readonly aimV = new THREE.Vector3();
  private readonly uT = uniform(0); // player-corona time
  private time = 0;
  private disposed = false;
  private last: Snap | null = null;

  private constructor(container: HTMLElement, fx: FXState) {
    this.container = container;
    this.fx = fx;

    // ---- renderer boot (periapsis pattern; init awaited in create()) ----
    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.touchAction = "none";
    this.canvas.style.outline = "none";
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    // ---- scene: near-black world, edge dissolves into darkness (§1) ----
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.FogExp2(BG, 0.02);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.5, 320);

    // ---- world systems ----
    this.arena = new Arena(this.scene);
    this.sunHeart = new SunHeart(this.scene);
    this.enemies = new EnemyView(this.scene);
    this.bullets = new BulletView(this.scene);
    this.shards = new ShardView(this.scene);
    this.particles = new Particles(this.scene);

    // ---- player: hot core + 12 corona sparks + 2 ribbon trails + ember light ----
    const coreGeo = new THREE.IcosahedronGeometry(0.8, 1);
    this.coreMat = new THREE.MeshBasicNodeMaterial({
      colorNode: vec4(vec3(1.0, 0.97, 0.92).mul(this.uCore), 1),
      fog: false,
    });
    this.core = new THREE.Mesh(coreGeo, this.coreMat);
    this.core.frustumCulled = false;
    this.scene.add(this.core);

    const coronaGeo = new THREE.PlaneGeometry(1, 1);
    const cAng = new Float32Array(CORONA_SPARKS);
    const cRad = new Float32Array(CORONA_SPARKS);
    const cSeed = new Float32Array(CORONA_SPARKS);
    for (let i = 0; i < CORONA_SPARKS; i++) {
      cAng[i] = (i / CORONA_SPARKS) * Math.PI * 2;
      cRad[i] = 1.15 + (i % 3) * 0.14;
      cSeed[i] = i / CORONA_SPARKS;
    }
    coronaGeo.setAttribute("iAng", new THREE.InstancedBufferAttribute(cAng, 1));
    coronaGeo.setAttribute("iRad", new THREE.InstancedBufferAttribute(cRad, 1));
    coronaGeo.setAttribute("iSeed", new THREE.InstancedBufferAttribute(cSeed, 1));
    const iAng = attrF(coronaGeo, "iAng");
    const iRad = attrF(coronaGeo, "iRad");
    const iSeed = attrF(coronaGeo, "iSeed");
    const t = this.uT;
    const ang = iAng.add(t.mul(2.4));
    const rad = iRad.mul(sin(t.mul(0.8).add(iSeed.mul(9.0))).mul(0.12).add(1.0));
    const sx = this.uPX.add(cos(ang).mul(rad));
    const sz = this.uPZ.add(sin(ang).mul(rad));
    const sy = this.uPY.add(sin(t.mul(2.2).add(iSeed.mul(15.0))).mul(0.22));
    const tw = sin(t.mul(3.4).add(iSeed.mul(30.0))).mul(0.3).add(0.7);
    const a = this.uCoronaFlick.mul(0.75).mul(tw);
    // SOFT ROUND falloff — corona sparks must never render as solid squares.
    const cD = length(uv().sub(0.5));
    const cGlow = smoothstep(0.5, 0.08, cD);
    const cCore = exp(cD.mul(-7.0));
    const coronaMat = new THREE.SpriteNodeMaterial({
      positionNode: vec3(sx, sy, sz),
      scaleNode: vec2(iSeed.mul(0.18).add(0.14), iSeed.mul(0.18).add(0.14)),
      colorNode: vec4(
        mix(vec3(1.0, 0.97, 0.92), vec3(1.0, 0.54, 0.24), iSeed)
          .mul(cGlow.mul(0.7).add(cCore))
          .mul(a),
        cGlow.mul(a),
      ),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const coronaMesh = new THREE.InstancedMesh(coronaGeo, coronaMat, CORONA_SPARKS);
    const im = new THREE.Matrix4().makeScale(1, 1, 1);
    for (let i = 0; i < CORONA_SPARKS; i++) coronaMesh.setMatrixAt(i, im);
    coronaMesh.frustumCulled = false;
    this.scene.add(coronaMesh);

    this.trailHot = new Ribbon(this.scene, 26, 0.5, HOT, 0.5, 1.04);
    this.trailEmber = new Ribbon(this.scene, 22, 0.34, EMBER, 0.42, 0.96);
    this.emberLight = new THREE.PointLight(EMBER, 30, 26, 1.8);
    this.scene.add(this.emberLight);

    // ---- pickups: spinning gold diamond + glow ----
    this.pickupGeo = new THREE.OctahedronGeometry(0.34, 0);
    this.pickupMat = new THREE.MeshBasicNodeMaterial({
      colorNode: vec4(vec3(1.0, 0.71, 0.33).mul(2.2), 1),
      fog: false,
    });
    this.glowTex = makeLightDiscTexture();
    for (let i = 0; i < PICKUP_CAP; i++) {
      const mesh = new THREE.Mesh(this.pickupGeo, this.pickupMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      const mat = new THREE.SpriteMaterial({
        map: this.glowTex,
        color: GOLD,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.7,
      });
      const glow = new THREE.Sprite(mat);
      glow.scale.setScalar(1.7);
      glow.visible = false;
      glow.renderOrder = 7;
      this.scene.add(glow);
      this.pickups.push({ mesh, glow });
    }
  }

  static async create(container: HTMLElement, fx: FXState): Promise<WorldView> {
    const view = new WorldView(container, fx ?? createFXState());
    await view.renderer.init();
    // backend check AFTER init (periapsis pattern — no flags before init)
    const backend = view.renderer.backend as unknown as { isWebGPUBackend?: boolean };
    view.backendName = backend && backend.isWebGPUBackend === true ? "webgpu" : "webgl2";
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    view.resize(w, h);
    view.setQuality(1); // default start full (§ setQuality contract)
    return view;
  }

  /** Unproject an NDC ray onto the hover plane y=1.0 → world x/y into out. */
  aimRay(ndcX: number, ndcY: number, out: { x: number; y: number }): void {
    this.camera.updateMatrixWorld(); // unproject needs current matrixWorld
    this.aimV.set(ndcX, ndcY, 0.5).unproject(this.camera);
    this.aimV.sub(this.camera.position).normalize();
    if (Math.abs(this.aimV.y) < 1e-5) {
      out.x = this.camera.position.x;
      out.y = this.camera.position.z - 10;
      return;
    }
    const t = (1.0 - this.camera.position.y) / this.aimV.y;
    out.x = this.camera.position.x + this.aimV.x * t;
    out.y = this.camera.position.z + this.aimV.z * t; // sim y == world z
  }

  /** Sim → view juice (§16). Player pos falls back to last snap if present. */
  handleEvent(ev: SimEvent): void {
    const x = ev.x;
    const z = ev.y; // sim y == world z
    switch (ev.type) {
      case EV.KILL: {
        const kind = ev.a;
        this.particles.burst(x, 1, z, 26 + (kind >= 3 ? 14 : 0), EMBER, GOLD, 9, 4.5, 0.55, 0.7);
        this.sunHeart.feed(x, z, kind === 4 ? 10 : 4);
        this.arena.ripple(x, z, EMBER, 0.5, 3.2, 0.45);
        break;
      }
      case EV.GRAZE:
        this.particles.sparkles(x, 1, z, 5, VOID, 2.5);
        break;
      case EV.HURT:
        this.particles.burst(x, 1, z, 14, DANGER, HOT, 8, 4, 0.5, 0.55);
        this.arena.ripple(x, z, DANGER, 0.4, 2.6, 0.4);
        break;
      case EV.DASH: {
        let dx = ev.vx;
        let dz = ev.vy;
        const l = Math.hypot(dx, dz);
        if (l < 0.001) {
          dx = this.last ? this.last.aimX - this.last.px : 1;
          dz = this.last ? this.last.aimY - this.last.py : 0;
        } else {
          dx /= l;
          dz /= l;
        }
        const px = this.last ? this.last.px : x;
        const pz = this.last ? this.last.py : z;
        this.particles.ghosts(px, 1, pz, dx, dz, 5);
        this.particles.streaks(px, 1, pz, dx, dz, 14, HOT);
        this.rig.kickFov(6);
        break;
      }
      case EV.LAUNCH:
        this.particles.sparkles(x, 1, z, 3, HOT, 2);
        break;
      case EV.RICOCHET:
        this.particles.burst(x, 1, z, 8, GOLD, HOT, 7, 2.5, 0.42, 0.42, 3.2, 7);
        break;
      case EV.SPAWN: {
        const kind = Math.min(4, Math.max(0, ev.a));
        this.particles.flash(x, 0.9, z, 2.4, KIND_POP[kind], 0.28);
        this.arena.ripple(x, z, KIND_POP[kind], 0.3, 2.0, 0.55);
        break;
      }
      case EV.OVERDRIVE:
        this.sunHeart.pulse(0.5);
        this.arena.ripple(x, z, GOLD, 0.5, 6, 0.5);
        this.particles.sparkles(x, 1, z, 10, GOLD, 4);
        break;
      case EV.BOSSDIE:
        this.sunHeart.implode(800);
        this.arena.ripple(x, z, GOLD, 2, 32, 0.9);
        this.arena.ripple(x, z, HOT, 0.5, 14, 0.55);
        break;
      case EV.PICKUP:
        this.particles.sparkles(x, 1, z, 12, GOLD, 3.5);
        this.arena.ripple(x, z, GOLD, 0.3, 2.2, 0.45);
        break;
      case EV.SUNRANK:
        this.sunHeart.pulse(0.8);
        this.arena.ripple(0, 0, GOLD, 6, 26, 0.8);
        this.arena.ripple(0, 0, HOT, 4, 18, 0.6);
        break;
      case EV.RIFT:
        this.particles.rift(x, z, VOID, 0.8);
        this.arena.ripple(x, z, VOID, 0.4, 2.2, 0.8);
        break;
      case EV.DIE:
        this.particles.burst(x, 1, z, 60, EMBER, HOT, 12, 6, 0.6, 0.9);
        this.particles.sparkles(x, 1, z, 20, GOLD, 5);
        this.arena.ripple(x, z, EMBER, 0.5, 10, 0.8);
        break;
      default:
        break;
    }
  }

  /** All views from snap SoA (already interpolated by Sim) + rig + ambience. */
  update(realDt: number, snap: Snap): void {
    const dt = Math.min(0.05, Math.max(0.0001, realDt));
    this.time += dt;
    this.uT.value = this.time;
    this.last = snap;

    // camera rig (§3) — reads fx.trauma (Juice owns decay)
    this.rig.update(dt, this.camera, this.fx.trauma, snap.px, snap.py, snap.aimX, snap.aimY, snap.combo);

    // ---- player visual ----
    const bob = Math.sin(this.time * Math.PI * 2 * 1.6) * 0.06;
    const py = 1.0 + bob;
    this.uPX.value = snap.px;
    this.uPY.value = py;
    this.uPZ.value = snap.py;
    this.core.position.set(snap.px, py, snap.py);
    this.core.rotation.y += dt * 1.2;
    this.core.rotation.x += dt * 0.7;
    // invuln → 8Hz emissive flicker (snap.invuln)
    let flick = 1;
    if (snap.invuln > 0) {
      flick = Math.sin(this.time * Math.PI * 2 * 8) > 0 ? 1.0 : 0.3;
    }
    this.uCore.value = 3.0 * flick;
    this.uCoronaFlick.value = 0.35 + 0.65 * flick;
    this.trailHot.push(snap.px, snap.py);
    this.trailEmber.push(snap.px, snap.py);
    this.trailHot.update(dt);
    this.trailEmber.update(dt);
    this.emberLight.position.set(snap.px, 1.6, snap.py);

    // ---- world ----
    this.arena.update(dt, this.time, snap.px, snap.py, snap.sun);
    this.sunHeart.update(dt, this.time, snap.sun);
    this.enemies.update(snap, dt, this.time);
    this.bullets.update(snap);
    this.shards.update(snap, dt, this.time);
    this.particles.update(dt);

    // ---- pickups (spinning gold diamond + glow) ----
    for (let i = 0; i < PICKUP_CAP; i++) {
      const slot = this.pickups[i];
      const active = i < snap.pCount;
      slot.mesh.visible = active;
      slot.glow.visible = active;
      if (!active) continue;
      const x = snap.pPos[i * 2];
      const z = snap.pPos[i * 2 + 1];
      const y = 1.0 + Math.sin(this.time * 2.4 + i * 1.9) * 0.12;
      slot.mesh.position.set(x, y, z);
      slot.mesh.rotation.y += dt * 3.2;
      slot.mesh.rotation.x = Math.sin(this.time * 1.7 + i) * 0.2;
      slot.glow.position.set(x, y, z);
      slot.glow.scale.setScalar(1.5 + Math.sin(this.time * 3.1 + i) * 0.25);
    }
  }

  render(): void {
    void this.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /** q = 1 full (pixelRatio clamp 1.5) · q = 0.5 (pixelRatio 1.0, budget ×0.5). */
  setQuality(q: number): void {
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    const ratio = q < 0.75 ? 1.0 : Math.min(1.5, dpr);
    this.renderer.setPixelRatio(ratio);
    this.particles.setQuality(q);
    this.arena.setQuality(q);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.arena.dispose(this.scene);
    this.sunHeart.dispose(this.scene);
    this.enemies.dispose(this.scene);
    this.bullets.dispose(this.scene);
    this.shards.dispose(this.scene);
    this.particles.dispose(this.scene);
    this.trailHot.dispose(this.scene);
    this.trailEmber.dispose(this.scene);
    for (const slot of this.pickups) {
      this.scene.remove(slot.mesh, slot.glow);
    }
    this.pickupGeo.dispose();
    this.pickupMat.dispose();
    this.glowTex.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else if (m) m.dispose();
    });
    this.renderer.dispose();
    if (this.canvas.parentElement === this.container) {
      this.container.removeChild(this.canvas);
    }
  }
}
