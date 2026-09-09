import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ARENA, BIOMES, COLORS } from './constants';
import { loadAssetGeometry } from './assetLib';
import { makeGlowTexture } from './fx';
import { coreMaterial, setRimK, stylizedMaterial, updateStylized } from './materials';

/**
 * HOLLOW SUN — "EMBER RITE" world layer.
 * A warm near-black obsidian temple: the arena is a chiseled hex floor inside
 * a dead star. THE HOLLOW LANTERN (a broken ring of nine dark monolith slabs
 * around a small ember core) hangs at the heart; a designed field of leaning
 * rim-lit monoliths silhouettes against the fog. Dark solid masses, restrained
 * emissive accents, a graded film look — no round glow-ball aesthetic.
 */

const FLOOR_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FLOOR_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIgnite;      // 0..1 sun energy
uniform vec2 uPlayer;
uniform vec3 uCold;         // biome grid cold color
uniform vec3 uHot;          // biome grid hot color
uniform vec4 uRings[10];    // x, z, t0, unused — kill pulses on the floor
varying vec3 vWorld;

// hex grid: distance to cell border (iq-style)
float hexDist(vec2 p) {
  p = abs(p);
  float c = dot(p, normalize(vec2(1.0, 1.73)));
  c = max(c, p.x);
  return c;
}

vec4 hexCoords(vec2 uv) {
  vec2 r = vec2(1.0, 1.73);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return vec4(gv, uv - gv);
}

void main() {
  vec2 p = vWorld.xz;
  float dCenter = length(p);

  vec4 hc = hexCoords(p * 0.62);
  float edge = smoothstep(0.46, 0.40, hexDist(hc.xy));
  vec2 cell = hc.zw;

  // kill pulse rings sweeping across the grid
  float ring = 0.0;
  for (int i = 0; i < 10; i++) {
    vec4 rp = uRings[i];
    if (rp.z < 0.0) continue;
    float t = uTime - rp.z;
    if (t < 0.0 || t > 1.6) continue;
    float d = distance(p, rp.xy);
    float r = t * 22.0;
    ring = max(ring, exp(-pow((d - r) / 1.6, 2.0)) * exp(-t * 2.4));
  }

  // ignition heat: strongest at the star, spreads with energy
  float heat = (1.0 - smoothstep(0.0, 12.0 + uIgnite * 24.0, dCenter)) * (0.14 + uIgnite * 0.55);
  float flick = 0.85 + 0.15 * sin(uTime * 3.1 + cell.x * 2.0 + cell.y * 1.4);

  vec3 cold = uCold;
  vec3 hot = uHot;
  vec3 lineCol = mix(cold, hot, clamp(heat * 1.5, 0.0, 1.0));
  float lineA = 0.10 + heat * 0.85 + ring * 1.4;

  // ember light puddle under the player
  float pd = distance(p, uPlayer);
  lineA += exp(-pd * 0.55) * 0.5;
  lineCol += vec3(0.9, 0.75, 0.45) * exp(-pd * 0.55) * 0.35;

  // the star's well: dark sink at the very center + molten core ring
  float well = smoothstep(3.4, 1.2, dCenter);
  lineA += well * (0.35 + uIgnite * 0.6);
  lineCol += vec3(1.0, 0.72, 0.35) * well * (0.28 + uIgnite * 0.5);

  vec3 col = lineCol * edge * lineA * flick;
  col = min(col, vec3(1.15));  // keep the grid luminous, never white
  // swallow everything at the arena rim
  col *= 1.0 - smoothstep(ARENA_RADIUS - 4.0, ARENA_RADIUS + 1.0, dCenter);
  col *= 1.0 - smoothstep(14.0, 34.0, length(vWorld - cameraPosition) * 0.35);
  gl_FragColor = vec4(col, 1.0);
}
`.replace(/ARENA_RADIUS/g, ARENA.radius.toFixed(1));

const RAY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RAY_FRAG = /* glsl */ `
uniform float uEnergy;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
void main() {
  float fade = smoothstep(0.0, 0.55, vUv.y) * (1.0 - smoothstep(0.62, 1.0, vUv.y));
  float side = smoothstep(0.0, 0.42, vUv.x) * (1.0 - smoothstep(0.58, 1.0, vUv.x));
  float breathe = 0.75 + 0.25 * sin(uTime * 1.7 + uSeed * 12.0);
  vec3 col = vec3(1.0, 0.78, 0.42) * fade * side * (0.08 + uEnergy * 0.32) * breathe;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** the "designed film look" — grade pass sits between bloom and output */
const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 43.0) * 43758.5453);
    }

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      // gentle S-curve — clamped knee keeps HDR hotspots monotonic
      vec3 s = clamp(col, 0.0, 1.0);
      col = mix(col, col * col * (3.0 - 2.0 * s), 0.22);
      // warm shadow lift
      col += vec3(0.030, 0.016, 0.008);
      // vignette, slightly high anchor
      float d = distance(vUv, vec2(0.5, 0.46));
      col *= 1.0 - smoothstep(0.42, 0.92, d) * 0.38;
      // shimmering film grain — retuned 0.045 -> 0.025 (VLM audit: overcooked
      // grain was muddying mid-tones; keep the texture, lose the mud)
      col += (hash(vUv * vec2(1920.0, 1080.0)) - 0.5) * 0.025;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/** tapered slab geometry — hand-cut stone by construction */
function taperedBoxGeo(w: number, h: number, d: number, taper: number): THREE.BufferGeometry {
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

/* ------------------------------------------------------------------ */
/* PROP SCATTER LAW (sprint 18) — data-driven instanced dressing       */
/* Godot-Resource shape: every biome dressing family is one record in   */
/* this table; buildScatterFamily() turns each record into ONE          */
/* InstancedMesh (1 draw call per family, regardless of count).         */
/* Placement is pure index-hash — (i/count)*2π + a0, baseR + ((i*step)  */
/* % mod)*unit — zero rng, so scatter is deterministic per build.       */
/* ------------------------------------------------------------------ */

export interface PropScatterRow {
  glb: string; // public/assets/meshes/<glb>.glb (loadAssetGeometry cache)
  biomeIdx: number; // dressing belongs to exactly one biome (setBiome toggle)
  count: number; // instances in the family
  baseR: number; // first ring radius (u)
  rim: number; // identity rim tint (stylizedMaterial color-coding channel)
  instanced: true; // InstancedMesh law — never one mesh per prop
  h: number; // authored target height (u) — k = h / bbox.y normalize law
  a0: number; // angular offset (rad) — the deterministic seed
  rStep: number; // radius hash: r = baseR + ((i * rStep) % rMod) * rUnit
  rMod: number;
  rUnit: number;
  rotK: number; // yaw hash: rotation.y = a * rotK
  mat: { base: number; lit: number; rimK: number; rimPow: number; emis: number; emisK: number };
}

/** the whole biome dressing sweep — spires + glass family (biome 2), heart
 *  roots (biome 3), PALE CHOIR bone cathedral (biome 4, warm bone/candle
 *  tints only — zero blue/indigo per the 18-a MUST-2 palette law) */
export const PROP_SCATTER: PropScatterRow[] = [
  // GLASS HOLLOW spires (forge v3) — broken crystal growths
  {
    glb: 'glass_spire', biomeIdx: 1, count: 6, baseR: 26, rim: 0xff5c8a, instanced: true,
    h: 4.6, a0: 2.1, rStep: 1, rMod: 3, rUnit: 3.5, rotK: 1.7,
    mat: { base: 0x1a0f1c, lit: 0x33182f, rimK: 0.85, rimPow: 2.2, emis: 0xff5c8a, emisK: 0.07 },
  },
  // GLASS HOLLOW monolith set (sprint 17 assetgen) — needles, ruin gates, prisms
  {
    glb: 'glass_monolith', biomeIdx: 1, count: 4, baseR: 28, rim: 0xd9a8ff, instanced: true,
    h: 6.4, a0: 0.4, rStep: 7, rMod: 4, rUnit: 1, rotK: 2.9,
    mat: { base: 0x160d1a, lit: 0x2c1830, rimK: 0.95, rimPow: 2.0, emis: 0xd9a8ff, emisK: 0.06 },
  },
  {
    glb: 'vesica_arch', biomeIdx: 1, count: 2, baseR: 24.5, rim: 0xff5c8a, instanced: true,
    h: 5.2, a0: 1.35, rStep: 7, rMod: 4, rUnit: 1, rotK: 2.9,
    mat: { base: 0x160d1a, lit: 0x2c1830, rimK: 0.95, rimPow: 2.0, emis: 0xff5c8a, emisK: 0.06 },
  },
  {
    glb: 'prism_cluster', biomeIdx: 1, count: 2, baseR: 30, rim: 0xc9784a, instanced: true,
    h: 3.4, a0: 3.6, rStep: 7, rMod: 4, rUnit: 1, rotK: 2.9,
    mat: { base: 0x160d1a, lit: 0x2c1830, rimK: 0.95, rimPow: 2.0, emis: 0xc9784a, emisK: 0.06 },
  },
  // THE HEART roots (forge v3) — knurled obsidian roots
  {
    glb: 'heart_root', biomeIdx: 2, count: 5, baseR: 24, rim: 0xffd9a0, instanced: true,
    h: 5.2, a0: 0.9, rStep: 1, rMod: 2, rUnit: 5, rotK: 2.3,
    mat: { base: 0x140d08, lit: 0x2a1d12, rimK: 0.7, rimPow: 2.4, emis: 0xffb454, emisK: 0.05 },
  },
  // THE PALE CHOIR (forge_choir, sprint 18) — bone spires rise around the nave
  {
    glb: 'bone_spire', biomeIdx: 3, count: 7, baseR: 25, rim: 0xd9c8a4, instanced: true,
    h: 4.6, a0: 0.15, rStep: 1, rMod: 4, rUnit: 2, rotK: 2.2,
    mat: { base: 0x1a140c, lit: 0x2e2418, rimK: 0.9, rimPow: 2.2, emis: 0xd9c8a4, emisK: 0.05 },
  },
  // rib arches straddle the scatter ring — walk-through gap faces the lanes
  {
    glb: 'rib_arch', biomeIdx: 3, count: 4, baseR: 23, rim: 0xcbb896, instanced: true,
    h: 5.0, a0: 0.8, rStep: 1, rMod: 2, rUnit: 4, rotK: 1.7,
    mat: { base: 0x16100a, lit: 0x2a2216, rimK: 0.85, rimPow: 2.4, emis: 0xcbb896, emisK: 0.04 },
  },
  // pipe organ chest + reliquary lanterns — warm candle voice deep in the ring
  {
    glb: 'pipe_organ_cluster', biomeIdx: 3, count: 2, baseR: 29, rim: 0xe0c9a0, instanced: true,
    h: 3.8, a0: 2.3, rStep: 1, rMod: 2, rUnit: 3, rotK: 2.6,
    mat: { base: 0x17110b, lit: 0x2c2214, rimK: 0.9, rimPow: 2.2, emis: 0xffc98a, emisK: 0.07 },
  },
  {
    glb: 'reliquary_lantern', biomeIdx: 3, count: 2, baseR: 21, rim: 0xffd9a0, instanced: true,
    h: 2.2, a0: 3.9, rStep: 1, rMod: 2, rUnit: 3, rotK: 2.0,
    mat: { base: 0x120d08, lit: 0x261c10, rimK: 1.0, rimPow: 2.0, emis: 0xffc766, emisK: 0.1 },
  },
];

export interface SunRig {
  group: THREE.Group;
  setEnergy(e: number): void;
  update(dt: number, t: number): void;
  dispose(): void;
}

export class Scene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  floorMat!: THREE.ShaderMaterial;
  readonly sun: SunRig;
  private dustMat!: THREE.ShaderMaterial;
  private gradePass!: ShaderPass;
  private rayMats: THREE.ShaderMaterial[] = [];
  private crackMat!: THREE.LineBasicMaterial;
  private starCore!: THREE.Mesh;
  private starGlow!: THREE.Sprite;
  private starRing!: THREE.Mesh;
  private sunGroup!: THREE.Group;
  private shells: THREE.Mesh[] = [];
  /** lantern slabs — rim retuned with sun energy */
  private slabMats: THREE.ShaderMaterial[] = [];
  private slabs: { mesh: THREE.Mesh; baseY: number }[] = [];
  /** rim monolith field — stored for future animation */
  private monolithMats: THREE.ShaderMaterial[] = [];
  private monolithMeshes: THREE.Mesh[] = [];
  /** biome-dressed props — one InstancedMesh per PROP_SCATTER family,
   *  toggled by setBiome via userData.biomeIdx */
  private biomeProps: THREE.Mesh[] = [];
  private starLight: THREE.PointLight;
  private sunEnergy = 0;
  private tgtCold = new THREE.Color(BIOMES[0].grid);
  private tgtHot = new THREE.Color(BIOMES[0].hot);
  private tgtFog = new THREE.Color(BIOMES[0].fog);
  private tgtSun = new THREE.Color(BIOMES[0].sun);
  private time = 0;
  private ringCursor = 0;
  private fogSwellT = -1; // biome arrival swell clock (-1 idle)

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.bg);
    this.scene.fog = new THREE.FogExp2(COLORS.bg, 0.016);

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 220);
    this.camera.position.set(0, 24, 16);

    // lights only affect standard materials — stylized stone is self-lit
    this.scene.add(new THREE.AmbientLight(0x2a2420, 0.4));
    this.scene.add(new THREE.HemisphereLight(0x2a1c10, 0x0a0708, 0.5));
    this.starLight = new THREE.PointLight(0xffb454, 24, 90, 1.6);
    this.starLight.position.set(0, 3, 0);
    this.scene.add(this.starLight);

    this.buildFloor();
    this.buildWall();
    this.buildShells();
    this.sun = this.buildSun();
    this.buildDust();

    // post: restrained bloom + film grade IS the look here
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.55, 0.55);
    this.composer.addPass(this.bloom);
    this.gradePass = new ShaderPass(GRADE_SHADER);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());

    // pipeline swap-in: assetgen .glb meshes replace primitives when they arrive
    this.loadGeneratedWorld();
  }

  /** swap procedural monoliths/lantern slabs for assetgen meshes (safe-fail) */
  private loadGeneratedWorld(): void {
    const names = ['monolith_a', 'monolith_b', 'monolith_c'] as const;
    void Promise.all(names.map((n) => loadAssetGeometry(n, true))).then((loaded) => {
      const variants = loaded.filter((g): g is THREE.BufferGeometry => !!g);
      if (!variants.length) return;
      const sizes = variants.map((g) => {
        g.computeBoundingBox();
        const bb = g.boundingBox;
        return bb ? bb.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1);
      });
      for (let i = 0; i < this.monolithMeshes.length; i++) {
        const m = this.monolithMeshes[i];
        const dims = m.userData.dims as { w: number; h: number; d: number } | undefined;
        if (!dims) continue;
        const k = i % variants.length;
        const size = sizes[k];
        const old = m.geometry;
        m.geometry = variants[k];
        m.scale.set(dims.w / size.x, dims.h / size.y, dims.d / size.z);
        old.dispose();
      }
    });
    void loadAssetGeometry('lantern_slab', true).then((geo) => {
      if (!geo) return;
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) return;
      const size = bb.getSize(new THREE.Vector3());
      for (const s of this.slabs) {
        const dims = s.mesh.userData.dims as { w: number; h: number; d: number } | undefined;
        if (!dims) continue;
        const old = s.mesh.geometry;
        s.mesh.geometry = geo;
        s.mesh.scale.set(dims.w / size.x, dims.h / size.y, dims.d / size.z);
        old.dispose();
      }
    });

    // cracked titan landmarks — broken monuments guarding the rim approaches
    void loadAssetGeometry('monolith_cracked', true).then((geo) => {
      if (!geo) return;
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) return;
      const size = bb.getSize(new THREE.Vector3());
      const k = 6.0 / size.y; // read as a rim-field titan
      geo.scale(k, k, k);
      const spots: Array<[number, number]> = [
        [0.65, ARENA.radius - 7.5],
        [3.9, ARENA.radius - 8.5],
      ];
      for (const [a, r] of spots) {
        const mat = stylizedMaterial({ base: 0x120d08, lit: 0x2a1d12, rim: 0xff9a4a, rimK: 0.4, rimPow: 3.2, fog: true });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        m.rotation.y = -a + Math.PI / 2;
        this.scene.add(m);
        this.monolithMats.push(mat);
      }
    });

    // shard clusters — crystal growths scattered between the lanes
    void loadAssetGeometry('shard_cluster', true).then((geo) => {
      if (!geo) return;
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) return;
      const size = bb.getSize(new THREE.Vector3());
      const k = 1.6 / size.y;
      geo.scale(k, k, k);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.5;
        const r = 11 + (i % 2) * 6;
        const mat = stylizedMaterial({
          base: COLORS.obsidian,
          lit: COLORS.obsidianLit,
          rim: 0xffc766,
          rimK: 0.9,
          rimPow: 2.6,
          emis: 0xff8a3d,
          emisK: 0.08,
          fog: true,
        });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        m.rotation.y = a;
        this.scene.add(m);
      }
    });

    // hex floor inlays — engraved rings flush with the obsidian floor
    void loadAssetGeometry('inlay_hex', true).then((geo) => {
      if (!geo) return;
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) return;
      const size = bb.getSize(new THREE.Vector3());
      const k = 3.4 / Math.max(size.x, size.z);
      geo.scale(k, k, k);
      if (size.y > Math.max(size.x, size.z)) geo.rotateX(-Math.PI / 2); // stand-up mesh -> lay flat
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 1.05;
        const mat = stylizedMaterial({ base: 0x0c0805, lit: 0x181009, rim: 0xffb454, rimK: 0.5, rimPow: 3.0, fog: true });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(Math.cos(a) * 10, 0.05, Math.sin(a) * 10);
        this.scene.add(m);
      }
    });

    // PROP SCATTER — every biome dressing family is one data row, one
    // InstancedMesh (1 draw call per family; deterministic index-hash spots)
    for (const row of PROP_SCATTER) this.buildScatterFamily(row);
  }

  /** one PROP_SCATTER row → ONE InstancedMesh pushed into the biomeProps
   *  toggle. Same k-scale law (k = target_h / bbox.y) and loadAssetGeometry
   *  (name, true) cache as the pre-instancing blocks; one shared
   *  stylizedMaterial per family (the factory auto-registers it into the
   *  uTime tick). Placement is pure index-hash — zero rng. */
  private buildScatterFamily(row: PropScatterRow): void {
    void loadAssetGeometry(row.glb, true).then((geo) => {
      if (!geo) return;
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) return;
      const size = bb.getSize(new THREE.Vector3());
      const k = row.h / size.y;
      geo.scale(k, k, k);
      const mat = stylizedMaterial({
        base: row.mat.base,
        lit: row.mat.lit,
        rim: row.rim,
        rimK: row.mat.rimK,
        rimPow: row.mat.rimPow,
        emis: row.mat.emis,
        emisK: row.mat.emisK,
        fog: true,
      });
      const inst = new THREE.InstancedMesh(geo, mat, row.count);
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const s = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < row.count; i++) {
        const a = row.a0 + (i / row.count) * Math.PI * 2; // deterministic angle hash
        const r = row.baseR + ((i * row.rStep) % row.rMod) * row.rUnit; // deterministic radius hash
        p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        e.set(0, a * row.rotK, 0);
        q.setFromEuler(e);
        m.compose(p, q, s);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.visible = false; // the setBiome toggle owns visibility via userData.biomeIdx
      inst.userData.biomeIdx = row.biomeIdx;
      this.scene.add(inst);
      this.biomeProps.push(inst);
    });
  }

  /* ---------------------------------------------------------------- */

  private buildFloor(): void {
    const geo = new THREE.CircleGeometry(ARENA.radius + 2, 110);
    geo.rotateX(-Math.PI / 2);
    this.floorMat = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uIgnite: { value: 0 },
        uPlayer: { value: new THREE.Vector2(0, 12) },
        uCold: { value: new THREE.Color(BIOMES[0].grid) },
        uHot: { value: new THREE.Color(BIOMES[0].hot) },
        uRings: { value: Array.from({ length: 10 }, () => new THREE.Vector4(0, 0, -1, 0)) },
      },
    });
    const floor = new THREE.Mesh(geo, this.floorMat);
    floor.renderOrder = 1;
    this.scene.add(floor);
  }

  /** floor pulse rings written by kills */
  floorPulse(x: number, z: number): void {
    const rings = this.floorMat.uniforms.uRings.value as THREE.Vector4[];
    const r = rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % rings.length;
    r.set(x, z, this.time, 0);
  }

  /** BIOME ARRIVAL fog swell — density breathes out and back over 1.4s
   *  (uniform-only, zero draw calls). Idle = -1. */
  fogSwell(): void {
    this.fogSwellT = 0;
  }

  private buildWall(): void {
    // boundary ring — a thin cold-red warning line where the shell wall rises
    const geo = new THREE.TorusGeometry(ARENA.wallGlow, 0.09, 8, 128);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.foeDeep, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.y = 0.05;
    this.scene.add(ring);

    // the far dead shell — huge inverted cylinder swallowing the horizon
    const wallGeo = new THREE.CylinderGeometry(72, 78, 90, 64, 1, true);
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x090605, side: THREE.BackSide, fog: true });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 30;
    this.scene.add(wall);
  }

  /** RIM MONOLITH FIELD — designed ring of leaning slabs around the arena */
  private buildShells(): void {
    const count = 16;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.24;
      const r = 40 + Math.random() * 12;
      const h = 7 + Math.random() * 11;
      const w = 1.6 + Math.random() * 1.4;
      const d = 1.2 + Math.random() * 1.2;
      const geo = taperedBoxGeo(w, h, d, 0.5 + Math.random() * 0.3);
      const mat = stylizedMaterial({ base: 0x120d08, lit: 0x2a1d12, rim: 0xff9a4a, rimK: 0.35, rimPow: 3.2, fog: true });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * r, h * 0.5 - 1.2, Math.sin(a) * r);
      // lean toward the arena heart
      m.lookAt(0, m.position.y, 0);
      m.rotateY((Math.random() - 0.5) * 0.5);
      m.rotateX(0.05 + Math.random() * 0.15);
      m.userData.dims = { w, h, d };
      this.scene.add(m);
      this.monolithMats.push(mat);
      this.monolithMeshes.push(m);
    }

    // a few dark broken-shell chunks drift higher for parallax
    const geos = [
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.IcosahedronGeometry(1, 0),
    ];
    for (let i = 0; i < 7; i++) {
      const geo = geos[i % geos.length];
      const mat = stylizedMaterial({ base: 0x0c0805, lit: 0x181009, rim: 0xff9a4a, rimK: 0.22, rimPow: 3.6, fog: true });
      const m = new THREE.Mesh(geo, mat);
      const a = Math.random() * Math.PI * 2;
      const r = 46 + Math.random() * 18;
      m.position.set(Math.sin(a) * r, 15 + Math.random() * 15, Math.cos(a) * r);
      m.scale.setScalar(2.0 + Math.random() * 3.6);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      m.userData.spin = (Math.random() - 0.5) * 0.08;
      this.scene.add(m);
      this.shells.push(m);
    }
  }

  /** THE HOLLOW LANTERN — nine dark monolith slabs orbiting an ember core */
  private buildSun(): SunRig {
    const group = new THREE.Group();
    this.scene.add(group);
    this.sunGroup = group;

    // broken ring of monolith slabs
    const slabCount = 9;
    for (let i = 0; i < slabCount; i++) {
      const a = (i / slabCount) * Math.PI * 2;
      const r = 4.0 + Math.random() * 1.2;
      const h = 2.4 + Math.random() * 1.8;
      const w = 0.9 + Math.random() * 0.4;
      const geo = taperedBoxGeo(w, h, w * 0.62, 0.55 + Math.random() * 0.2);
      const mat = stylizedMaterial({ base: COLORS.obsidian, rim: 0xffb454, rimK: 0.55, emis: 0xff8a3d, emisK: 0.06 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      // face the core, alternate the lean so the ring reads as a broken crown
      m.lookAt(0, m.position.y, 0);
      m.rotateY((Math.random() - 0.5) * 0.4);
      m.rotateX((i % 2 === 0 ? 1 : -1) * (0.12 + Math.random() * 0.13));
      const baseY = h * 0.5 + 0.3 + Math.random() * 0.9;
      m.position.y = baseY;
      m.userData.dims = { w, h, d: w * 0.62 };
      group.add(m);
      this.slabMats.push(mat);
      this.slabs.push({ mesh: m, baseY });
    }

    // ember core — small, hard, faceted
    const coreGeo = new THREE.IcosahedronGeometry(1.15, 0);
    const coreMat = coreMaterial(0xffe8c2);
    this.starCore = new THREE.Mesh(coreGeo, coreMat);
    group.add(this.starCore);

    // compact warm glow
    const glowTex = makeGlowTexture('rgba(255,190,110,0.9)', 'rgba(255,120,40,0)');
    this.starGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.18 }));
    this.starGlow.scale.setScalar(5);
    group.add(this.starGlow);

    // thin molten ring on the ground
    const ringGeo = new THREE.TorusGeometry(2.6, 0.06, 8, 96);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc766, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
    this.starRing = new THREE.Mesh(ringGeo, ringMat);
    this.starRing.position.y = 0.06;
    group.add(this.starRing);

    // cracks — jagged light escaping the broken shell
    const crackPts: number[] = [];
    for (let c = 0; c < 16; c++) {
      const a = (c / 16) * Math.PI * 2 + Math.random() * 0.3;
      let x = Math.cos(a) * 1.6;
      let z = Math.sin(a) * 1.6;
      let y = 1.2 + Math.random() * 0.8;
      const segs = 5 + Math.floor(Math.random() * 4);
      for (let s = 0; s < segs; s++) {
        const nx = x + Math.cos(a) * (0.9 + Math.random() * 1.4) + (Math.random() - 0.5) * 0.9;
        const nz = z + Math.sin(a) * (0.9 + Math.random() * 1.4) + (Math.random() - 0.5) * 0.9;
        const ny = y * (0.35 + Math.random() * 0.4);
        crackPts.push(x, y, z, nx, ny, nz);
        x = nx;
        z = nz;
        y = ny;
      }
    }
    const crackGeo = new THREE.BufferGeometry();
    crackGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(crackPts), 3));
    this.crackMat = new THREE.LineBasicMaterial({ color: 0xffcf8a, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
    const cracks = new THREE.LineSegments(crackGeo, this.crackMat);
    group.add(cracks);

    // god-rays — narrow vertical light planes slowly circling the core
    for (let i = 0; i < 6; i++) {
      const geo = new THREE.PlaneGeometry(1.6, 30, 1, 1);
      geo.translate(0, 14, 0);
      const mat = new THREE.ShaderMaterial({
        vertexShader: RAY_VERT,
        fragmentShader: RAY_FRAG,
        uniforms: {
          uEnergy: { value: 0 },
          uTime: { value: 0 },
          uSeed: { value: i * 0.61 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const plane = new THREE.Mesh(geo, mat);
      plane.rotation.y = (i / 6) * Math.PI * 2;
      plane.position.y = 0.4;
      group.add(plane);
      this.rayMats.push(mat);
    }

    return {
      group,
      setEnergy: (e: number) => {
        this.sunEnergy = e;
        this.crackMat.opacity = e * 0.9;
        this.starGlow.material.opacity = 0.18 + e * 0.4;
        this.starGlow.scale.setScalar(4.6 + e * 1.8);
        this.starCore.scale.setScalar(1 + e * 0.3);
        for (const m of this.rayMats) m.uniforms.uEnergy.value = e;
        for (const m of this.slabMats) setRimK(m, 0.55 + e * 0.95);
      },
      update: (dt: number, t: number) => {
        group.rotation.y += dt * 0.12;
        this.starCore.rotation.x += dt * 0.3;
        this.starCore.rotation.y += dt * 0.42;
        const pulse = 1 + Math.sin(t * 2.4) * 0.035;
        this.starCore.scale.setScalar((1 + this.sunEnergy * 0.3) * pulse);
        for (let i = 0; i < this.slabs.length; i++) {
          const s = this.slabs[i];
          s.mesh.position.y = s.baseY + Math.sin(t * 0.5 + i) * 0.15;
        }
        for (const m of this.rayMats) m.uniforms.uTime.value = t;
        this.sunGroup = group;
      },
      dispose: () => {
        group.removeFromParent();
      },
    };
  }

  private buildDust(): void {
    const count = 700;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 46;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 22;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uPix;
        varying float vA;
        varying vec3 vC;
        void main() {
          vec3 p = position;
          p.y = mod(p.y + uTime * (0.25 + aSeed * 0.5), 22.0);
          p.x += sin(uTime * 0.3 + aSeed * 31.0) * 1.1;
          p.z += cos(uTime * 0.24 + aSeed * 17.0) * 1.1;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = max(0.1, -mv.z);
          gl_PointSize = min((1.0 + aSeed * 1.8) * uPix * (60.0 / dist), 14.0 * uPix);
          vA = (0.07 + aSeed * 0.16) * smoothstep(0.5, 3.0, dist);
          vC = mix(vec3(1.0, 0.62, 0.32), vec3(1.0, 0.85, 0.62), aSeed);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        varying vec3 vC;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vA;
          gl_FragColor = vec4(vC * a, a);
        }
      `,
      uniforms: { uTime: { value: 0 }, uPix: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dust = new THREE.Points(geo, this.dustMat);
    dust.frustumCulled = false;
    this.scene.add(dust);
  }

  /* ---------------------------------------------------------------- */

  setEnergy(e: number): void {
    this.floorMat.uniforms.uIgnite.value = e;
    this.sun.setEnergy(e);
  }

  update(dt: number): void {
    this.time += dt;
    // biome palette ease
    const k = Math.min(1, dt * 1.6);
    (this.floorMat.uniforms.uCold.value as THREE.Color).lerp(this.tgtCold, k);
    (this.floorMat.uniforms.uHot.value as THREE.Color).lerp(this.tgtHot, k);
    (this.scene.fog as THREE.FogExp2).color.lerp(this.tgtFog, k);
    (this.scene.background as THREE.Color).lerp(this.tgtFog, k);
    if (this.fogSwellT >= 0) {
      this.fogSwellT += dt;
      const t = Math.min(1, this.fogSwellT / 1.4);
      (this.scene.fog as THREE.FogExp2).density = 0.016 + 0.012 * Math.sin(Math.PI * t);
      if (t >= 1) {
        this.fogSwellT = -1;
        (this.scene.fog as THREE.FogExp2).density = 0.016;
      }
    }
    (this.starCore.material as THREE.MeshBasicMaterial).color.lerp(this.tgtSun, k);
    this.starLight.color.lerp(this.tgtSun, k);

    this.floorMat.uniforms.uTime.value = this.time;
    this.dustMat.uniforms.uTime.value = this.time;
    this.gradePass.uniforms.uTime.value = this.time;
    updateStylized(this.time);
    this.sun.update(dt, this.time);
    for (const s of this.shells) {
      s.rotation.y += s.userData.spin * dt;
      s.rotation.x += s.userData.spin * 0.6 * dt;
    }
  }

  /** biome palette target (lerped in update) */
  setBiome(i: number): void {
    const b = BIOMES[Math.min(BIOMES.length - 1, Math.max(0, i))];
    this.tgtCold.set(b.grid);
    this.tgtHot.set(b.hot);
    this.tgtFog.set(b.fog);
    this.tgtSun.set(b.sun);
    // biome dressing — each forge prop family belongs to exactly one biome
    // (clamp to the LAST biome so new rows always show — no hardcoded cap)
    const active = Math.min(BIOMES.length - 1, Math.max(0, i));
    for (const m of this.biomeProps) m.visible = m.userData.biomeIdx === active;
  }

  render(): void {
    this.composer.render();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  get sunGroupRef(): THREE.Group {
    return this.sunGroup;
  }

  setPixelRatio(dpr: number): void {
    this.dustMat.uniforms.uPix.value = dpr;
  }
}
