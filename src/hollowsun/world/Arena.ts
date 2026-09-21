import * as THREE from "three/webgpu";
import {
  uniform, vec2, vec3, vec4, float, texture, uv, sin, abs, smoothstep,
  instancedBufferAttribute,
} from "three/tsl";
import { makeHexGridTexture, makeRuneAtlasTexture, makeLightDiscTexture } from "./tex";

export const ARENA_R = 36;
export const BOUND_R = 34;
const GLYPHS = 48;
const RIPPLES = 12;
const DUST = 300;

/** Typed read of an instanced attribute (r185 typing narrows via cast). */
function attrF(geo: THREE.BufferGeometry, name: string): ReturnType<typeof float> {
  return instancedBufferAttribute(geo.getAttribute(name) as THREE.InstancedBufferAttribute) as unknown as ReturnType<typeof float>;
}
function attrV3(geo: THREE.BufferGeometry, name: string): ReturnType<typeof vec3> {
  return instancedBufferAttribute(geo.getAttribute(name) as THREE.InstancedBufferAttribute) as unknown as ReturnType<typeof vec3>;
}

interface RippleItem {
  mesh: THREE.Mesh;
  uCol: ReturnType<typeof uniform>;
  uA: ReturnType<typeof uniform>;
  life: number;
  maxLife: number;
  r0: number;
  r1: number;
}

/**
 * ARENA — near-black floor + emissive hex grid revealed by additive light
 * discs (player r10 · star r26), ember boundary torus r34, 48 instanced rune
 * glyph planes (one atlas texture, one draw call), floor ripple-ring pool,
 * 300 ambient dust motes (GPU-animated — the periapsis dust pattern).
 */
export class Arena {
  private readonly uTime = uniform(0);
  private readonly uGrid = uniform(0.22); // 0.22 → 0.38 with sun
  private readonly uPlayerA = uniform(0.25);
  private readonly uStarA = uniform(0.2);
  private readonly uTorus = uniform(1.2);
  private readonly uGlyph = uniform(0.6);

  private readonly dustMesh: THREE.InstancedMesh;
  private readonly playerDisc: THREE.Mesh;
  private readonly starDisc: THREE.Mesh;
  private readonly ripples: RippleItem[] = [];
  private rippleCursor = 0;

  private readonly texList: THREE.Texture[] = [];
  private readonly geoList: THREE.BufferGeometry[] = [];
  private readonly matList: THREE.Material[] = [];

  constructor(scene: THREE.Scene) {
    // ---- floor: near-black disc r36 + emissive hex grid (§1 LIGHT RULE) ----
    const hexTex = makeHexGridTexture();
    const discTex = makeLightDiscTexture();
    this.texList.push(hexTex, discTex);
    const floorGeo = new THREE.CircleGeometry(ARENA_R, 72);
    floorGeo.rotateX(-Math.PI / 2);
    this.geoList.push(floorGeo);
    const floorMat = new THREE.MeshStandardNodeMaterial({
      color: 0x07060a,
      roughness: 0.92,
      metalness: 0.08,
      emissiveNode: texture(hexTex, uv().mul(6.0)).rgb.mul(this.uGrid),
    });
    this.matList.push(floorMat);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    scene.add(floor);

    // ---- additive light discs: the floor is "revealed by light" (§1) ----
    const discGeoP = new THREE.CircleGeometry(10, 48);
    discGeoP.rotateX(-Math.PI / 2);
    const discGeoS = new THREE.CircleGeometry(26, 64);
    discGeoS.rotateX(-Math.PI / 2);
    this.geoList.push(discGeoP, discGeoS);
    const discMatP = new THREE.MeshBasicNodeMaterial({
      colorNode: vec4(texture(discTex).rgb.mul(this.uPlayerA), this.uPlayerA),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const discMatS = new THREE.MeshBasicNodeMaterial({
      colorNode: vec4(texture(discTex).rgb.mul(this.uStarA), this.uStarA),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.matList.push(discMatP, discMatS);
    this.playerDisc = new THREE.Mesh(discGeoP, discMatP);
    this.playerDisc.position.y = 0.02;
    this.playerDisc.renderOrder = 2;
    scene.add(this.playerDisc);
    this.starDisc = new THREE.Mesh(discGeoS, discMatS);
    this.starDisc.position.set(0, 0.015, 0);
    this.starDisc.renderOrder = 2;
    scene.add(this.starDisc);

    // ---- boundary: emissive ember torus r34 (pulsing, brightens with sun) ----
    const torusGeo = new THREE.TorusGeometry(BOUND_R, 0.09, 8, 160);
    torusGeo.rotateX(Math.PI / 2);
    this.geoList.push(torusGeo);
    const torusMat = new THREE.MeshBasicNodeMaterial({
      colorNode: vec4(
        vec3(1.0, 0.54, 0.24).mul(this.uTorus),
        1,
      ),
      fog: false,
    });
    this.matList.push(torusMat);
    const torus = new THREE.Mesh(torusGeo, torusMat);
    torus.position.y = 0.2;
    scene.add(torus);

    // ---- 48 rune glyph planes (atlas + instancing = 1 draw call) ----
    const atlas = makeRuneAtlasTexture();
    this.texList.push(atlas);
    const gGeo = new THREE.PlaneGeometry(2.6, 2.6);
    const gU = new Float32Array(GLYPHS);
    const gV = new Float32Array(GLYPHS);
    const gPh = new Float32Array(GLYPHS);
    for (let i = 0; i < GLYPHS; i++) {
      const cell = i % 16;
      gU[i] = (cell % 4) * 0.25;
      gV[i] = Math.floor(cell / 4) * 0.25;
      gPh[i] = (i % 12) * 0.52;
    }
    gGeo.setAttribute("iU", new THREE.InstancedBufferAttribute(gU, 1));
    gGeo.setAttribute("iV", new THREE.InstancedBufferAttribute(gV, 1));
    gGeo.setAttribute("iPh", new THREE.InstancedBufferAttribute(gPh, 1));
    const iU = attrF(gGeo, "iU");
    const iV = attrF(gGeo, "iV");
    const iPh = attrF(gGeo, "iPh");
    const cellUv = uv().mul(0.25).add(vec2(iU, iV));
    const glyphA = this.uGlyph.mul(smoothstep(0.12, 0.95, sin(this.uTime.mul(2.2).add(iPh)).mul(0.5).add(0.5)));
    const glyphMat = new THREE.MeshBasicNodeMaterial({
      colorNode: vec4(texture(atlas, cellUv).rgb.mul(glyphA), glyphA),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.matList.push(glyphMat);
    const glyphs = new THREE.InstancedMesh(gGeo, glyphMat, GLYPHS);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < GLYPHS; i++) {
      const a = (i / GLYPHS) * Math.PI * 2;
      const r = BOUND_R + 1.5;
      p.set(Math.cos(a) * r, 1.7 + ((i * 7) % 5) * 0.12, Math.sin(a) * r);
      e.set(0, -a - Math.PI / 2, 0); // face the arena center
      q.setFromEuler(e);
      m.compose(p, q, s);
      glyphs.setMatrixAt(i, m);
    }
    glyphs.frustumCulled = false;
    scene.add(glyphs);
    this.geoList.push(gGeo);

    // ---- floor ripple-ring pool (kill ripples, sunrank pulses, shockwaves) ----
    const ringGeo = new THREE.RingGeometry(0.86, 1.0, 56);
    ringGeo.rotateX(-Math.PI / 2);
    this.geoList.push(ringGeo);
    for (let i = 0; i < RIPPLES; i++) {
      const uCol = uniform(new THREE.Vector3(1, 0.6, 0.3));
      const uA = uniform(0);
      const mat = new THREE.MeshBasicNodeMaterial({
        colorNode: vec4(uCol.mul(uA), uA),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      this.matList.push(mat);
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
      this.ripples.push({ mesh, uCol, uA, life: 0, maxLife: 1, r0: 0.5, r1: 3 });
    }

    // ---- ambient dust: 300 instanced GPU-animated motes ----
    this.dustMesh = this.buildDust();
    scene.add(this.dustMesh);
  }

  private buildDust(): THREE.InstancedMesh {
    const pos = new Float32Array(DUST * 3);
    const seed = new Float32Array(DUST);
    for (let i = 0; i < DUST; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (ARENA_R + 2);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 6.5 + 0.3;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random();
    }
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute("position", new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute("iSeed", new THREE.InstancedBufferAttribute(seed, 1));
    const iSeed = attrF(geo, "iSeed");
    const iPos = attrV3(geo, "position");
    const t = this.uTime;
    const py = iPos.y.add(sin(t.mul(iSeed.mul(0.35).add(0.2)).add(iSeed.mul(43.0))).mul(0.7));
    const px = iPos.x.add(sin(t.mul(0.14).add(iSeed.mul(17.0))).mul(1.2));
    const pz = iPos.z.add(sin(t.mul(0.11).add(iSeed.mul(29.0))).mul(1.2));
    const alpha = float(0.045).add(iSeed.mul(0.075)).mul(smoothstep(6.4, 0.4, abs(py.sub(2.2))));
    const col = vec3(1.0, 0.62, 0.3);
    const mat = new THREE.SpriteNodeMaterial({
      positionNode: vec3(px, py, pz),
      scaleNode: vec2(iSeed.mul(0.5).add(0.22), iSeed.mul(0.5).add(0.22)),
      colorNode: vec4(col.mul(alpha), alpha),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.matList.push(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, DUST);
    const im = new THREE.Matrix4().makeScale(1, 1, 1);
    for (let i = 0; i < DUST; i++) mesh.setMatrixAt(i, im);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    return mesh;
  }

  /** Expand+fade floor ring. r1 = end radius. */
  ripple(x: number, z: number, color: number, r0: number, r1: number, life: number): void {
    const r = this.ripples[this.rippleCursor];
    this.rippleCursor = (this.rippleCursor + 1) % RIPPLES;
    r.mesh.position.set(x, 0.06, z);
    r.mesh.visible = true;
    (r.uCol.value as THREE.Vector3).set(
      ((color >> 16) & 255) / 255,
      ((color >> 8) & 255) / 255,
      (color & 255) / 255,
    );
    r.life = r.maxLife = life;
    r.r0 = r0;
    r.r1 = r1;
  }

  /** q = 1 full · q = 0.5 halves dust. */
  setQuality(q: number): void {
    this.dustMesh.count = q < 0.75 ? Math.floor(DUST / 2) : DUST;
  }

  update(dt: number, time: number, px: number, pz: number, sun: number): void {
    this.uTime.value = time;
    this.uGrid.value = 0.22 + 0.16 * sun;
    this.uStarA.value = 0.2 + 0.5 * sun;
    this.uTorus.value = 1.15 + 0.55 * sun + Math.sin(time * 5.6) * 0.22;
    this.uGlyph.value = 0.5 + 0.35 * sun;
    this.playerDisc.position.set(px, 0.02, pz);
    // ripples
    for (const r of this.ripples) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.mesh.visible = false;
        r.uA.value = 0;
        continue;
      }
      const t = 1 - r.life / r.maxLife;
      const ease = 1 - (1 - t) * (1 - t);
      const rad = r.r0 + (r.r1 - r.r0) * ease;
      r.mesh.scale.setScalar(rad);
      r.uA.value = (1 - t) * (1 - t) * 0.9;
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.playerDisc, this.starDisc, this.dustMesh);
    for (const r of this.ripples) scene.remove(r.mesh);
    for (const t of this.texList) t.dispose();
    for (const g of this.geoList) g.dispose();
    for (const mm of this.matList) mm.dispose();
  }
}
