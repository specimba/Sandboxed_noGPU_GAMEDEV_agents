import * as THREE from "three/webgpu";
import {
  vec2 as tslV2, vec3 as tslV3, vec4 as tslV4, float as tslF,
  instancedBufferAttribute,
} from "three/tsl";
import type { QualitySettings } from "@/frontier/core/Quality";

/**
 * BATTLE FX CONTRACT (specialist S3 owns the deep pass: debris chunks,
 * scorch decals, smoke, two-stage kill flash, twin shockwave rings;
 * enrich, keep API).
 *   constructor(scene, q) | setQuality(q) | dispose()
 *   update(dt)
 *   muzzleFlash(x,y,z,dx,dz)         — flash sprite + cordite smoke + spark cone
 *   tracer(x,y,z, dx,dz)             — instant tracer streak for a shell
 *   impact(x,y,z, big)               — bouncing sparks + flash (+ debris when big)
 *   explosion(x,y,z, power)          — white-hot core → orange bloom, sparks,
 *                                      twin rings, light, debris, smoke, scorch
 *   boltGlow(x,y,z)                  — enemy bolt spawn flicker
 *   missileTrail(x,y,z)              — smoke puff + tiny ember spark
 *   hitSpark follows impact(); everything pooled, zero-alloc in update.
 *
 * Pool caps: sparks 1600 · flashes 16 · smoke 60 · debris 40 · scorch 24 ·
 *            rings 8 (outer+inner meshes) · lights 5 · tracers 48.
 */
const SPARK_MAX = 1600;
const SMOKE_MAX = 60;
const DEBRIS_MAX = 40;
const SCORCH_MAX = 24;

interface FlashPoolItem {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  life: number;
  maxLife: number;
  grow: number;
  delay: number;
  o0: number;
}

interface SmokePoolItem {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  life: number;
  maxLife: number;
  s0: number;
  s1: number;
  o0: number;
  rise: number;
  vx: number;
  vz: number;
  spin: number;
}

interface RingPoolItem {
  outer: THREE.Mesh;
  inner: THREE.Mesh;
  matO: THREE.MeshBasicMaterial;
  matI: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  r0: number;
  r1: number;
}

interface DebrisChunk {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number;
  wx: number; wy: number; wz: number;
  life: number;
  maxLife: number;
  size: number;
}

interface ScorchItem {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  o0: number;
  age: number;
}

export class BattleFX {
  private scene: THREE.Scene;
  private sparkPoints: THREE.InstancedMesh;
  private sPos: Float32Array;
  private sVel: Float32Array;
  private sLife: Float32Array;
  private sMax: Float32Array;
  private sCol: Float32Array;
  private sSize: Float32Array;
  private sAlpha: Float32Array;
  private sCursor = 0;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  // (these reference the geometry's actual InstancedBufferAttributes — see ctor)
  private flashes: FlashPoolItem[] = [];
  private flashCursor = 0;
  private smokes: SmokePoolItem[] = [];
  private smokeCursor = 0;
  private rings: RingPoolItem[] = [];
  private ringCursor = 0;
  private lights: { light: THREE.PointLight; life: number }[] = [];
  private lightCursor = 0;
  private tracers: { mesh: THREE.Mesh; life: number }[] = [];
  private tracerCursor = 0;
  private debris: DebrisChunk[] = [];
  private debrisCursor = 0;
  private scorch: ScorchItem[] = [];
  private scorchCursor = 0;
  private emitScale = 1;
  private sparkMat: THREE.SpriteNodeMaterial;
  private time = 0;
  // shared resources (disposed)
  private flashTex: THREE.Texture;
  private smokeTex: THREE.Texture;
  private scorchTex: THREE.Texture;
  private ringGeoO: THREE.RingGeometry;
  private ringGeoI: THREE.RingGeometry;
  private trGeo: THREE.BoxGeometry;
  private scorchGeo: THREE.PlaneGeometry;
  private debrisMesh: THREE.InstancedMesh;
  private debrisMat: THREE.MeshStandardMaterial;
  // scratch (zero-alloc matrix composition for debris)
  private dM = new THREE.Matrix4();
  private dQ = new THREE.Quaternion();
  private dE = new THREE.Euler();
  private dP = new THREE.Vector3();
  private dS = new THREE.Vector3();

  constructor(scene: THREE.Scene, q: QualitySettings) {
    this.scene = scene;

    // ---- spark points (additive, gravity, drag, ground bounce) ----
    this.sPos = new Float32Array(SPARK_MAX * 3);
    this.sVel = new Float32Array(SPARK_MAX * 3);
    this.sLife = new Float32Array(SPARK_MAX);
    this.sMax = new Float32Array(SPARK_MAX);
    this.sCol = new Float32Array(SPARK_MAX * 3);
    this.sSize = new Float32Array(SPARK_MAX);
    this.sAlpha = new Float32Array(SPARK_MAX);
    const geo = new THREE.PlaneGeometry(1, 1);
    // NOTE: the attributes marked dirty in update() MUST be the ones attached to
    // the geometry — wrap the shared arrays once and reuse the SAME objects.
    const posInst = new THREE.InstancedBufferAttribute(this.sPos, 3);
    const colInst = new THREE.InstancedBufferAttribute(this.sCol, 3);
    const sizeInst = new THREE.InstancedBufferAttribute(this.sSize, 1);
    const alphaInst = new THREE.InstancedBufferAttribute(this.sAlpha, 1);
    posInst.setUsage(THREE.DynamicDrawUsage);
    colInst.setUsage(THREE.DynamicDrawUsage);
    sizeInst.setUsage(THREE.DynamicDrawUsage);
    alphaInst.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", posInst);
    geo.setAttribute("iCol", colInst);
    geo.setAttribute("iSize", sizeInst);
    geo.setAttribute("iAlpha", alphaInst);
    this.posAttr = posInst;
    this.colAttr = colInst;
    this.sizeAttr = sizeInst;
    this.alphaAttr = alphaInst;
    this.sparkMat = new THREE.SpriteNodeMaterial({
      positionNode: instancedBufferAttribute(geo.getAttribute("position") as THREE.InstancedBufferAttribute) as unknown as ReturnType<typeof tslV3>,
      colorNode: (() => {
        const iCol = instancedBufferAttribute(geo.getAttribute("iCol") as THREE.InstancedBufferAttribute) as unknown as ReturnType<typeof tslV3>;
        const iAlpha = instancedBufferAttribute(geo.getAttribute("iAlpha") as THREE.InstancedBufferAttribute) as unknown as ReturnType<typeof tslF>;
        return tslV4(iCol.mul(iAlpha), iAlpha);
      })(),
      scaleNode: (() => {
        const iSize = instancedBufferAttribute(geo.getAttribute("iSize") as THREE.InstancedBufferAttribute) as unknown as ReturnType<typeof tslF>;
        return tslV2(iSize, iSize);
      })(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.sparkPoints = new THREE.InstancedMesh(geo, this.sparkMat, SPARK_MAX);
    {
      const im = new THREE.Matrix4().makeScale(1, 1, 1);
      for (let i = 0; i < SPARK_MAX; i++) this.sparkPoints.setMatrixAt(i, im);
    }
    this.sparkPoints.frustumCulled = false;
    this.sparkPoints.renderOrder = 9;
    scene.add(this.sparkPoints);

    // ---- flash sprite pool (THREE.Sprite = auto-billboard; supports delay
    //      slots so the explosion can stage core → bloom) ----
    this.flashTex = makeRadialTexture();
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.flashTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 10;
      scene.add(sprite);
      this.flashes.push({ sprite, mat, life: 0, maxLife: 1, grow: 1, delay: 0, o0: 0.95 });
    }

    // ---- smoke sprite pool (normal-blended dark puffs, grow + rise + spin) ----
    this.smokeTex = makePuffTexture();
    for (let i = 0; i < SMOKE_MAX; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.smokeTex,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        color: 0x2a2521,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 6;
      scene.add(sprite);
      this.smokes.push({ sprite, mat, life: 0, maxLife: 1, s0: 0.8, s1: 2.6, o0: 0.28, rise: 0.8, vx: 0, vz: 0, spin: 0 });
    }

    // ---- shockwave ring pool (outer ring + inner ring lagging behind) ----
    this.ringGeoO = new THREE.RingGeometry(0.86, 1.0, 40);
    this.ringGeoO.rotateX(-Math.PI / 2);
    this.ringGeoI = new THREE.RingGeometry(0.9, 1.0, 40);
    this.ringGeoI.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const matO = new THREE.MeshBasicMaterial({
        color: 0xffc890,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        opacity: 0,
      });
      const matI = new THREE.MeshBasicMaterial({
        color: 0xff9a50,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        opacity: 0,
      });
      const outer = new THREE.Mesh(this.ringGeoO, matO);
      outer.visible = false;
      outer.renderOrder = 8;
      const inner = new THREE.Mesh(this.ringGeoI, matI);
      inner.visible = false;
      inner.renderOrder = 8;
      scene.add(outer, inner);
      this.rings.push({ outer, inner, matO, matI, life: 0, maxLife: 1, r0: 0.5, r1: 3 });
    }

    // ---- pooled explosion lights ----
    for (let i = 0; i < 5; i++) {
      const light = new THREE.PointLight(0xffa050, 0, 22, 1.9);
      light.visible = false;
      scene.add(light);
      this.lights.push({ light, life: 0 });
    }

    // ---- tracer pool (thin stretched additive boxes) ----
    this.trGeo = new THREE.BoxGeometry(0.05, 0.05, 1);
    for (let i = 0; i < 48; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(this.trGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0 });
    }

    // ---- scorch decal pool (individual dark discs, persist until recycled) ----
    this.scorchTex = makeScorchTexture();
    this.scorchGeo = new THREE.PlaneGeometry(1, 1);
    this.scorchGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < SCORCH_MAX; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.scorchTex,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(this.scorchGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      this.scorch.push({ mesh, mat, o0: 0.8, age: 0 });
    }

    // ---- debris chunk pool (instanced dark-steel tetras, CPU physics) ----
    this.debrisMat = new THREE.MeshStandardMaterial({ color: 0x4a4750, roughness: 0.55, metalness: 0.8 });
    this.debrisMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(1, 0), this.debrisMat, DEBRIS_MAX);
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.castShadow = false;
    this.debrisMesh.receiveShadow = false;
    const tint = new THREE.Color();
    this.dQ.identity();
    for (let i = 0; i < DEBRIS_MAX; i++) {
      this.debris.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, life: 0, maxLife: 1, size: 0.15 });
      const v = 0.75 + Math.random() * 0.5;
      tint.setRGB(v, v * 0.96, v * 0.92);
      this.debrisMesh.setColorAt(i, tint);
      this.dP.set(0, -50, 0);
      this.dS.set(0, 0, 0);
      this.dM.compose(this.dP, this.dQ, this.dS);
      this.debrisMesh.setMatrixAt(i, this.dM);
    }
    if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true;
    scene.add(this.debrisMesh);

    this.setQuality(q);
  }

  setQuality(q: QualitySettings): void {
    this.emitScale = Math.min(1, Math.max(0.35, q.particles / 5000));
  }

  private spawnSpark(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number, size: number): void {
    const i = this.sCursor;
    this.sCursor = (this.sCursor + 1) % SPARK_MAX;
    this.sPos[i * 3] = x;
    this.sPos[i * 3 + 1] = y;
    this.sPos[i * 3 + 2] = z;
    this.sVel[i * 3] = vx;
    this.sVel[i * 3 + 1] = vy;
    this.sVel[i * 3 + 2] = vz;
    this.sLife[i] = life;
    this.sMax[i] = life;
    this.sCol[i * 3] = r;
    this.sCol[i * 3 + 1] = g;
    this.sCol[i * 3 + 2] = b;
    this.sSize[i] = size;
    this.sAlpha[i] = 1;
  }

  private spawnSmoke(x: number, y: number, z: number, vx: number, vz: number, s0: number, s1: number, life: number, o0: number, rise: number, warm: number): void {
    const s = this.smokes[this.smokeCursor];
    this.smokeCursor = (this.smokeCursor + 1) % SMOKE_MAX;
    s.sprite.position.set(x, y, z);
    s.vx = vx;
    s.vz = vz;
    s.s0 = s0;
    s.s1 = s1;
    s.life = s.maxLife = life;
    s.o0 = o0;
    s.rise = rise;
    s.spin = (Math.random() - 0.5) * 1.4;
    s.mat.rotation = Math.random() * Math.PI * 2;
    s.mat.color.setRGB(0.24 + warm * 0.2, 0.22 + warm * 0.13, 0.2 + warm * 0.08);
    s.mat.opacity = 0;
    s.sprite.scale.set(s0, s0, 1);
    s.sprite.visible = true;
  }

  private throwDebris(x: number, y: number, z: number, power: number, count: number): void {
    for (let k = 0; k < count; k++) {
      const c = this.debris[this.debrisCursor];
      this.debrisCursor = (this.debrisCursor + 1) % DEBRIS_MAX;
      const a = Math.random() * Math.PI * 2;
      const sp = (3.5 + Math.random() * 4.5) * (0.7 + power * 0.25);
      c.x = x + (Math.random() - 0.5) * 0.4;
      c.y = Math.max(0.25, y) + Math.random() * 0.4;
      c.z = z + (Math.random() - 0.5) * 0.4;
      c.vx = Math.cos(a) * sp;
      c.vz = Math.sin(a) * sp;
      c.vy = 2.5 + Math.random() * 4.5 + power;
      c.wx = (Math.random() - 0.5) * 16;
      c.wy = (Math.random() - 0.5) * 16;
      c.wz = (Math.random() - 0.5) * 16;
      c.maxLife = 0.9 + Math.random() * 0.7;
      c.life = c.maxLife;
      c.size = 0.1 + Math.random() * 0.16;
    }
  }

  private stampScorch(x: number, z: number, size: number): void {
    const s = this.scorch[this.scorchCursor];
    this.scorchCursor = (this.scorchCursor + 1) % SCORCH_MAX;
    s.mesh.position.set(x, 0.04 + Math.random() * 0.02, z);
    s.mesh.rotation.y = Math.random() * Math.PI * 2;
    s.mesh.scale.set(size, 1, size);
    s.o0 = 0.75 + Math.random() * 0.15;
    s.age = 0;
    s.mat.opacity = 0;
    s.mesh.visible = true;
  }

  muzzleFlash(x: number, y: number, z: number, dx: number, dz: number): void {
    const f = this.nextFlash();
    f.sprite.position.set(x, y, z);
    f.sprite.scale.setScalar(1.15);
    f.mat.color.setRGB(1.0, 0.72, 0.35);
    f.mat.opacity = 0.95;
    f.life = f.maxLife = 0.07;
    f.delay = 0;
    f.o0 = 0.95;
    f.grow = 1.3;
    f.sprite.visible = true;
    // cordite wisp drifting downrange
    this.spawnSmoke(x + dx * 0.35, y, z + dz * 0.35, dx * 1.5, dz * 1.5, 0.3, 1.0, 0.45, 0.16, 0.5, 0.3);
    // cone of sparks forward
    for (let k = 0; k < 5; k++) {
      const sp = 9 + Math.random() * 8;
      const jx = dx + (Math.random() - 0.5) * 0.5;
      const jz = dz + (Math.random() - 0.5) * 0.5;
      this.spawnSpark(x, y, z, jx * sp, 1.5 + Math.random() * 2, jz * sp, 0.14 + Math.random() * 0.1, 1.0, 0.75, 0.4, 5);
    }
  }

  tracer(x: number, y: number, z: number, dx: number, dz: number): void {
    const t = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length;
    const len = 2.6;
    t.mesh.position.set(x + dx * len * 0.5, y, z + dz * len * 0.5);
    t.mesh.scale.set(1, 1, len);
    t.mesh.rotation.y = Math.atan2(dx, dz);
    t.mesh.visible = true;
    (t.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
    t.life = 0.06;
  }

  impact(x: number, y: number, z: number, big: boolean): void {
    const n = Math.round((big ? 20 : 9) * this.emitScale) + 3;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (big ? 6.5 : 4) + Math.random() * 5;
      this.spawnSpark(x, y, z, Math.cos(a) * sp, 2 + Math.random() * 4.5, Math.sin(a) * sp, 0.25 + Math.random() * (big ? 0.45 : 0.3), 1.0, 0.6 + Math.random() * 0.3, 0.22, 4 + Math.random() * 3);
    }
    if (big) this.throwDebris(x, y, z, 0.8, 2);
    const f = this.nextFlash();
    f.sprite.position.set(x, y, z);
    f.sprite.scale.setScalar(big ? 1.6 : 0.9);
    f.mat.color.setRGB(1.0, 0.62, 0.3);
    f.mat.opacity = 0.9;
    f.life = f.maxLife = 0.09;
    f.delay = 0;
    f.o0 = 0.9;
    f.grow = 2.2;
    f.sprite.visible = true;
    this.pulseLight(x, z, big ? 26 : 12, 0xffa050);
  }

  explosion(x: number, y: number, z: number, power: number): void {
    // stage 1 — white-hot detonation core, leads the bloom by 50ms
    const core = this.nextFlash();
    core.sprite.position.set(x, y + 0.45, z);
    core.sprite.scale.setScalar(1.2);
    core.mat.color.setRGB(1.0, 0.97, 0.88);
    core.mat.opacity = 1;
    core.life = core.maxLife = 0.08;
    core.delay = 0;
    core.o0 = 1;
    core.grow = 1.6;
    core.sprite.visible = true;
    // stage 2 — orange bloom arriving just behind the pop
    const f = this.nextFlash();
    f.sprite.position.set(x, y + 0.5, z);
    f.sprite.scale.setScalar(2.0 + power * 0.5);
    f.mat.color.setRGB(1.0, 0.7, 0.4);
    f.mat.opacity = 1;
    f.life = f.maxLife = 0.13;
    f.delay = 0.05;
    f.o0 = 1;
    f.grow = 3.2;
    f.sprite.visible = false;
    // ember fountain
    const n = Math.round((26 + power * 10) * this.emitScale);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random();
      const sp = (5 + Math.random() * 8) * (0.6 + power * 0.35);
      this.spawnSpark(
        x, y + 0.3, z,
        Math.cos(a) * sp * (1 - el * 0.5),
        3 + el * 7 + power * 2,
        Math.sin(a) * sp * (1 - el * 0.5),
        0.4 + Math.random() * 0.5,
        1.0, 0.5 + Math.random() * 0.3, 0.15,
        5 + Math.random() * 5,
      );
    }
    // steel chunks
    this.throwDebris(x, y, z, power, Math.max(1, Math.round((3 + Math.random() * 4) * Math.min(1, this.emitScale + 0.15))));
    // rolling smoke wall
    const puffs = Math.max(1, Math.round((4 + Math.random() * 2) * this.emitScale) + 1);
    for (let k = 0; k < puffs; k++) {
      const a = Math.random() * Math.PI * 2;
      const rr = 0.2 + Math.random() * 0.55;
      const sc = 0.75 + power * 0.25;
      this.spawnSmoke(
        x + Math.cos(a) * rr, y * 0.55 + 0.25 + Math.random() * 0.5, z + Math.sin(a) * rr,
        Math.cos(a) * 0.5, Math.sin(a) * 0.5,
        0.8 * sc, 2.6 * sc,
        0.9 + Math.random() * 0.4, 0.28, 0.8,
        0.4 + Math.random() * 0.6,
      );
    }
    // battlefield scar
    this.stampScorch(x, z, (1.5 + Math.random() * 0.8) * (0.8 + power * 0.3));
    const r = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    r.outer.position.set(x, 0.12, z);
    r.inner.position.set(x, 0.12, z);
    r.outer.visible = true;
    r.inner.visible = true;
    r.life = r.maxLife = 0.42;
    r.r0 = 0.6;
    r.r1 = 2.6 + power * 0.9;
    this.pulseLight(x, z, 34 + power * 8, 0xff9040, 0.5);
  }

  boltGlow(x: number, y: number, z: number): void {
    const f = this.nextFlash();
    f.sprite.position.set(x, y, z);
    f.sprite.scale.setScalar(0.8);
    f.mat.color.setRGB(1.0, 0.3, 0.15);
    f.mat.opacity = 0.9;
    f.life = f.maxLife = 0.1;
    f.delay = 0;
    f.o0 = 0.9;
    f.grow = 1.2;
    f.sprite.visible = true;
  }

  missileTrail(x: number, y: number, z: number): void {
    // small gray smoke puff
    this.spawnSmoke(x, y, z, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, 0.22, 0.85, 0.5, 0.2, 0.55, 0.25);
    // tiny ember spark trailing the burn
    this.spawnSpark(x, y, z, (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2, 0.18 + Math.random() * 0.12, 1.0, 0.55, 0.3, 3.5);
  }

  private pulseLight(x: number, z: number, intensity: number, color: number, life = 0.28): void {
    const l = this.lights[this.lightCursor];
    this.lightCursor = (this.lightCursor + 1) % this.lights.length;
    l.light.position.set(x, 2.4, z);
    l.light.color.setHex(color);
    l.light.intensity = intensity;
    l.light.visible = true;
    l.life = life;
  }

  private nextFlash(): FlashPoolItem {
    const f = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    return f;
  }

  update(dt: number): void {
    this.time += dt;
    // sparks — gravity, drag, ground bounce with friction
    let dirty = false;
    for (let i = 0; i < SPARK_MAX; i++) {
      if (this.sLife[i] <= 0) continue;
      dirty = true;
      this.sLife[i] -= dt;
      const drag = Math.exp(-2.6 * dt);
      this.sVel[i * 3] *= drag;
      this.sVel[i * 3 + 1] = this.sVel[i * 3 + 1] * drag - 14 * dt;
      this.sVel[i * 3 + 2] *= drag;
      this.sPos[i * 3] += this.sVel[i * 3] * dt;
      this.sPos[i * 3 + 1] += this.sVel[i * 3 + 1] * dt;
      this.sPos[i * 3 + 2] += this.sVel[i * 3 + 2] * dt;
      if (this.sPos[i * 3 + 1] < 0.05) {
        this.sPos[i * 3 + 1] = 0.05;
        this.sVel[i * 3 + 1] *= -0.4;
        this.sVel[i * 3] *= 0.86;
        this.sVel[i * 3 + 2] *= 0.86;
      }
      const lf = this.sLife[i];
      if (lf <= 0) { this.sAlpha[i] = 0; this.sSize[i] = 0; }
      else { this.sSize[i] *= 0.985; this.sAlpha[i] = Math.min(1, lf / this.sMax[i] * 1.6); }
    }
    if (dirty) {
      // bump the REAL geometry attributes so the GPU buffers re-upload
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
      this.alphaAttr.needsUpdate = true;
    }
    // flashes — delay slots let staged detonations sequence themselves
    for (const f of this.flashes) {
      if (f.delay > 0) {
        f.delay -= dt;
        if (f.delay > 0) continue;
        f.sprite.visible = true;
      }
      if (f.life <= 0) continue;
      f.life -= dt;
      const t = 1 - Math.max(0, f.life) / f.maxLife;
      f.sprite.scale.addScalar(f.grow * dt * 6);
      f.mat.opacity = Math.max(0, (1 - t) * f.o0);
      if (f.life <= 0) f.sprite.visible = false;
    }
    // smoke — grow, rise, spin, fade out
    for (const s of this.smokes) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.sprite.visible = false;
        s.mat.opacity = 0;
        continue;
      }
      const t = 1 - s.life / s.maxLife;
      const sc = s.s0 + (s.s1 - s.s0) * t;
      s.sprite.scale.set(sc, sc, 1);
      s.sprite.position.x += s.vx * dt;
      s.sprite.position.z += s.vz * dt;
      s.sprite.position.y += s.rise * dt;
      s.mat.rotation += s.spin * dt;
      const fade = 1 - t;
      s.mat.opacity = s.o0 * fade * (0.55 + 0.45 * fade);
    }
    // rings — outer leads, inner lags behind on an eased track
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - Math.max(0, r.life) / r.maxLife;
      const rad = r.r0 + (r.r1 - r.r0) * t;
      r.outer.scale.setScalar(rad * 2);
      const ti = Math.pow(t, 1.35) * 0.72;
      const radI = r.r0 + (r.r1 - r.r0) * ti;
      r.inner.scale.setScalar(radI * 2);
      const o = Math.max(0, (1 - t) * (1 - t));
      r.matO.opacity = o * 0.9;
      r.matI.opacity = o * 0.5;
      if (r.life <= 0) {
        r.outer.visible = false;
        r.inner.visible = false;
      }
    }
    // lights
    for (const l of this.lights) {
      if (l.life <= 0) continue;
      l.life -= dt;
      l.light.intensity *= Math.exp(-8 * dt);
      if (l.life <= 0 || l.light.intensity < 0.4) {
        l.light.visible = false;
        l.light.intensity = 0;
      }
    }
    // tracers
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      const m = t.mesh.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, t.life / 0.06) * 0.85;
      if (t.life <= 0) t.mesh.visible = false;
    }
    // debris — gravity, ground bounce at y≈0.1, tumble, scale-out
    let debrisDirty = false;
    for (let i = 0; i < DEBRIS_MAX; i++) {
      const c = this.debris[i];
      if (c.life <= 0) continue;
      debrisDirty = true;
      c.life -= dt;
      if (c.life <= 0) {
        this.dP.set(0, -50, 0);
        this.dQ.identity();
        this.dS.set(0, 0, 0);
        this.dM.compose(this.dP, this.dQ, this.dS);
        this.debrisMesh.setMatrixAt(i, this.dM);
        continue;
      }
      c.vy -= 22 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      if (c.y < 0.1) {
        c.y = 0.1;
        if (c.vy < -1) c.vy = -c.vy * 0.35;
        else c.vy = 0;
        c.vx *= 0.72;
        c.vz *= 0.72;
        c.wx *= 0.55;
        c.wy *= 0.55;
        c.wz *= 0.55;
      }
      c.rx += c.wx * dt;
      c.ry += c.wy * dt;
      c.rz += c.wz * dt;
      const fade = Math.min(1, c.life / (c.maxLife * 0.3));
      const s = c.size * fade * fade;
      this.dP.set(c.x, c.y, c.z);
      this.dE.set(c.rx, c.ry, c.rz);
      this.dQ.setFromEuler(this.dE);
      this.dS.set(s, s, s);
      this.dM.compose(this.dP, this.dQ, this.dS);
      this.debrisMesh.setMatrixAt(i, this.dM);
    }
    if (debrisDirty) this.debrisMesh.instanceMatrix.needsUpdate = true;
    // scorch — quick fade-in, then persist until the slot is recycled
    for (const s of this.scorch) {
      if (!s.mesh.visible || s.mat.opacity >= s.o0) continue;
      s.age += dt;
      s.mat.opacity = Math.min(s.o0, (s.age / 0.15) * s.o0);
    }
  }

  dispose(): void {
    this.scene.remove(this.sparkPoints);
    this.sparkPoints.geometry.dispose();
    this.sparkMat.dispose();
    for (const f of this.flashes) {
      this.scene.remove(f.sprite);
      f.mat.dispose();
    }
    for (const s of this.smokes) {
      this.scene.remove(s.sprite);
      s.mat.dispose();
    }
    for (const r of this.rings) {
      this.scene.remove(r.outer, r.inner);
      r.matO.dispose();
      r.matI.dispose();
    }
    this.ringGeoO.dispose();
    this.ringGeoI.dispose();
    for (const t of this.tracers) {
      this.scene.remove(t.mesh);
      (t.mesh.material as THREE.MeshBasicMaterial).dispose();
    }
    this.trGeo.dispose();
    for (const s of this.scorch) {
      this.scene.remove(s.mesh);
      s.mat.dispose();
    }
    this.scorchGeo.dispose();
    this.scene.remove(this.debrisMesh);
    this.debrisMesh.dispose();
    this.debrisMat.dispose();
    this.flashTex.dispose();
    this.smokeTex.dispose();
    this.scorchTex.dispose();
  }
}

function makeRadialTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,220,160,0.6)");
  g.addColorStop(1, "rgba(255,150,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.Texture(c);
  tex.needsUpdate = true;
  return tex;
}

function makePuffTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const blob = (cx: number, cy: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  };
  blob(64, 64, 60, 0.85);
  blob(46, 52, 30, 0.5);
  blob(82, 58, 26, 0.45);
  blob(64, 84, 24, 0.4);
  const tex = new THREE.Texture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeScorchTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  // ragged satellite blotches for an irregular burnt edge
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + Math.random() * 0.6;
    const rr = 14 + Math.random() * 12;
    const cx = 64 + Math.cos(a) * rr;
    const cy = 64 + Math.sin(a) * rr;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 16 + Math.random() * 12);
    g.addColorStop(0, "rgba(10,8,7,0.55)");
    g.addColorStop(1, "rgba(10,8,7,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  // charred core
  const core = ctx.createRadialGradient(64, 64, 0, 64, 64, 56);
  core.addColorStop(0, "rgba(8,6,5,0.95)");
  core.addColorStop(0.5, "rgba(16,12,9,0.75)");
  core.addColorStop(1, "rgba(16,12,9,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.Texture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
