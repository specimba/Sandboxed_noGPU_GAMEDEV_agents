import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ARENA, BIOMES, COLORS } from './constants';
import { makeGlowTexture } from './fx';

/**
 * HOLLOW SUN world: a near-black arena carved inside a dead star.
 * The hex floor grid ignites outward from the center as the sun rekindles;
 * kill pulses sweep across the floor; the cracked star leaks god-rays.
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
  float lineA = 0.15 + heat * 0.85 + ring * 1.4;

  // ember light puddle under the player
  float pd = distance(p, uPlayer);
  lineA += exp(-pd * 0.55) * 0.5;
  lineCol += vec3(0.9, 0.75, 0.45) * exp(-pd * 0.55) * 0.35;

  // the star's well: dark sink at the very center + molten core ring
  float well = smoothstep(3.4, 1.2, dCenter);
  lineA += well * (0.35 + uIgnite * 0.6);

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
  vec3 col = vec3(1.0, 0.78, 0.42) * fade * side * (0.10 + uEnergy * 0.45) * breathe;
  gl_FragColor = vec4(col, 1.0);
}
`;

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
  private rayMats: THREE.ShaderMaterial[] = [];
  private crackMat!: THREE.LineBasicMaterial;
  private starCore!: THREE.Mesh;
  private starGlow!: THREE.Sprite;
  private starRing!: THREE.Mesh;
  private sunGroup!: THREE.Group;
  private shells: THREE.Mesh[] = [];
  private starLight: THREE.PointLight;
  private tgtCold = new THREE.Color(BIOMES[0].grid);
  private tgtHot = new THREE.Color(BIOMES[0].hot);
  private tgtFog = new THREE.Color(BIOMES[0].fog);
  private tgtSun = new THREE.Color(BIOMES[0].sun);
  private time = 0;
  private ringCursor = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.bg);
    this.scene.fog = new THREE.FogExp2(COLORS.bg, 0.0135);

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 220);
    this.camera.position.set(0, 24, 16);

    this.scene.add(new THREE.AmbientLight(0x33383f, 0.55));
    this.starLight = new THREE.PointLight(0xffc766, 30, 90, 1.6);
    this.starLight.position.set(0, 3, 0);
    this.scene.add(this.starLight);

    this.buildFloor();
    this.buildWall();
    this.buildShells();
    this.sun = this.buildSun();
    this.buildDust();

    // post: bloom IS the lighting model here
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.05, 0.62, 0.38);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
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

  private buildWall(): void {
    // boundary ring — a thin hot warning line where the shell wall rises
    const geo = new THREE.TorusGeometry(ARENA.wallGlow, 0.09, 8, 128);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x7a1425, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.y = 0.05;
    this.scene.add(ring);

    // the far dead shell — huge inverted cylinder swallowing the horizon
    const wallGeo = new THREE.CylinderGeometry(72, 78, 90, 64, 1, true);
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x06070d, side: THREE.BackSide, fog: true });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 30;
    this.scene.add(wall);
  }

  private buildShells(): void {
    // broken chunks of the dead star, drifting around the perimeter
    const geos = [
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.OctahedronGeometry(1, 0),
    ];
    for (let i = 0; i < 14; i++) {
      const geo = geos[i % geos.length];
      const mat = new THREE.MeshBasicMaterial({ color: 0x0b0d18, fog: true });
      const m = new THREE.Mesh(geo, mat);
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
      const r = 44 + Math.random() * 14;
      m.position.set(Math.sin(a) * r, 4 + Math.random() * 22, Math.cos(a) * r);
      m.scale.setScalar(2.2 + Math.random() * 4.5);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      m.userData.spin = (Math.random() - 0.5) * 0.08;
      this.scene.add(m);
      this.shells.push(m);
    }
  }

  private buildSun(): SunRig {
    const group = new THREE.Group();
    this.scene.add(group);
    this.sunGroup = group;

    // molten core
    const coreGeo = new THREE.IcosahedronGeometry(1.75, 1);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffdda6 });
    this.starCore = new THREE.Mesh(coreGeo, coreMat);
    group.add(this.starCore);

    // halo
    const glowTex = makeGlowTexture('rgba(255,214,150,0.9)', 'rgba(255,150,60,0)');
    this.starGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 }));
    this.starGlow.scale.setScalar(10);
    group.add(this.starGlow);

    // ring halo
    const ringGeo = new THREE.TorusGeometry(3.4, 0.05, 8, 96);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc766, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    this.starRing = new THREE.Mesh(ringGeo, ringMat);
    this.starRing.position.y = 0.4;
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
    this.crackMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
    const cracks = new THREE.LineSegments(crackGeo, this.crackMat);
    group.add(cracks);

    // god-rays — vertical light planes slowly circling the star
    for (let i = 0; i < 6; i++) {
      const geo = new THREE.PlaneGeometry(2.6, 30, 1, 1);
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
        this.crackMat.opacity = e * 0.95;
        (this.starRing.material as THREE.MeshBasicMaterial).opacity = 0.15 + e * 0.6;
        this.starGlow.scale.setScalar(9 + e * 7);
        this.starGlow.material.opacity = 0.55 + e * 0.45;
        this.starCore.scale.setScalar(1 + e * 0.22);
        for (const m of this.rayMats) m.uniforms.uEnergy.value = e;
      },
      update: (dt: number, t: number) => {
        group.rotation.y += dt * 0.12;
        this.starCore.rotation.x += dt * 0.3;
        this.starCore.rotation.y += dt * 0.42;
        const pulse = 1 + Math.sin(t * 2.4) * 0.035;
        this.starCore.scale.setScalar((1 + this.crackMat.opacity * 0.22) * pulse);
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
          vA = (0.10 + aSeed * 0.22) * smoothstep(0.5, 3.0, dist);
          vC = mix(vec3(1.0, 0.72, 0.4), vec3(1.0, 0.9, 0.7), aSeed);
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
    (this.starCore.material as THREE.MeshBasicMaterial).color.lerp(this.tgtSun, k);
    this.starLight.color.lerp(this.tgtSun, k);

    this.floorMat.uniforms.uTime.value = this.time;
    this.dustMat.uniforms.uTime.value = this.time;
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
