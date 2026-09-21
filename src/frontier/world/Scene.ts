import * as THREE from "three/webgpu";
import {
  uniform, vec2, vec3, vec4, float, mix, max, min, smoothstep, normalize,
  positionLocal, positionWorld, dot, pow, exp, sin, abs, fract, floor, length, instancedBufferAttribute,
} from "three/tsl";
import type { QualitySettings } from "@/frontier/core/Quality";

export const ARENA_RADIUS = 38;

/** Typed reads of instanced attributes (r185 typing narrows via casts). */
function attrF(geo: THREE.BufferGeometry, name: string): ReturnType<typeof float> {
  return instancedBufferAttribute(geo.getAttribute(name) as THREE.InstancedBufferAttribute) as unknown as ReturnType<typeof float>;
}
function attrV3(geo: THREE.BufferGeometry, name: string): ReturnType<typeof vec3> {
  return instancedBufferAttribute(geo.getAttribute(name) as THREE.InstancedBufferAttribute) as unknown as ReturnType<typeof vec3>;
}

/**
 * STEEL FRONTIER world — the LOOK TARGET.
 * A dusk mining outpost: burning amber horizon, long shadows, packed-earth
 * arena ringed by rocks and container stacks, sodium practicals, dust.
 * Every surface is art-directed; nothing is default gray.
 */
export class SceneWorld {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGPURenderer;
  backendName = "webgl2";

  readonly sun: THREE.DirectionalLight;
  readonly muzzleLight: THREE.PointLight;
  private sunVec = new THREE.Vector3(-0.62, 0.34, -0.55).normalize();
  private sunDirN = vec3(-0.62, 0.34, -0.55).normalize();
  private uTime = uniform(0);
  private uHeat = uniform(0);
  private beacons: THREE.Mesh[] = [];
  private beaconMats: THREE.MeshBasicNodeMaterial[] = [];
  private dust: THREE.InstancedMesh;
  private envRT: THREE.RenderTarget | null = null;
  private time = 0;

  static async create(canvas: HTMLCanvasElement, q: QualitySettings): Promise<SceneWorld> {
    const w = new SceneWorld(canvas, q);
    await w.renderer.init();
    const backend = w.renderer.backend as unknown as { isWebGPUBackend?: boolean };
    w.backendName = backend && backend.isWebGPUBackend === true ? "webgpu" : "webgl2";
    w.buildEnvironment();
    return w;
  }

  private constructor(canvas: HTMLCanvasElement, q: QualitySettings) {
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x181009, 0.016);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.5, 420);

    // ---- light rig: low amber sun (long shadows) + cool sky bounce ----
    const hemi = new THREE.HemisphereLight(0x35424a, 0x1a1008, 0.75);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffb469, 3.0);
    this.sun.position.copy(this.sunVec).multiplyScalar(90);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.muzzleLight = new THREE.PointLight(0xffc98a, 0, 18, 1.9);
    this.muzzleLight.position.set(0, 2, 0);
    this.scene.add(this.muzzleLight);

    // ---- world ----
    this.buildSky();
    this.dust = this.buildDust(q.props > 150 ? 420 : 220);
    this.scene.add(this.dust);
    this.buildGround();
    this.buildRidge();
    this.buildBerm();
    this.buildRocks(q.props);
    this.buildOutpost(q.props);
    this.buildTowers();

    this.setQuality(q);
  }

  // ---------- look-target pieces ----------

  private buildSky(): void {
    const mat = new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      colorNode: (() => {
        const d = normalize(positionLocal);
        // deep graphite-teal zenith -> burning amber horizon band -> dusk floor
        const base = mix(
          vec3(0.020, 0.030, 0.042),
          vec3(0.055, 0.030, 0.014),
          smoothstep(0.5, -0.02, d.y),
        );
        const horizon = exp(abs(d.y).mul(-7.5)).mul(vec3(1.35, 0.52, 0.14));
        // sun disc + halo near horizon
        const sd = this.sunDirN;
        const g = max(dot(d, sd), 0.0);
        const disc = pow(g, 900.0).mul(vec3(4.2, 2.4, 1.0));
        const halo = pow(g, 6.0).mul(vec3(0.85, 0.42, 0.14));
        // faint cold stars up high
        const cell = fract(sin(dot(vec2(d.x.mul(97.0), d.z.mul(61.0)).add(d.y.mul(13.0)), vec2(12.9898, 78.233))).mul(43758.5453));
        const stars = smoothstep(0.9986, 1.0, cell).mul(smoothstep(0.12, 0.5, d.y)).mul(vec3(0.5, 0.55, 0.62));
        return base.add(horizon).add(disc).add(halo).add(stars);
      })(),
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 26), mat);
    dome.frustumCulled = false;
    this.scene.add(dome);
  }

  private buildEnvironment(): void {
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const env = new THREE.Scene();
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(50, 24, 14),
        new THREE.MeshBasicNodeMaterial({
          side: THREE.BackSide,
          colorNode: (() => {
            const d = normalize(positionLocal);
            const base = mix(vec3(0.03, 0.04, 0.05), vec3(0.10, 0.05, 0.02), smoothstep(0.4, -0.1, d.y));
            const sunGlow = pow(max(dot(d, this.sunDirN), 0), 10).mul(vec3(1.6, 0.9, 0.4));
            return base.add(sunGlow);
          })(),
        }),
      );
      env.add(dome);
      void (pmrem.fromSceneAsync(env, 0.04) as unknown as Promise<THREE.RenderTarget>)
        .then((rt) => {
          this.scene.environment = rt.texture;
          this.scene.environmentIntensity = 0.5;
          this.envRT = rt;
          pmrem.dispose();
        })
        .catch(() => {});
    } catch { /* degrade to lights only */ }
  }

  private buildDust(count: number): THREE.InstancedMesh {
    // instanced billboard motes (SpriteNodeMaterial — the cross-backend path;
    // classic ShaderMaterial is rejected by WebGPURenderer)
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * ARENA_RADIUS * 1.3;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 7 + 0.2;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random();
    }
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute("position", new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute("iSeed", new THREE.InstancedBufferAttribute(seed, 1));
    const t = this.uTime;
    const iSeed = attrF(geo, "iSeed");
    const iPos = attrV3(geo, "position");
    const py = iPos.y.add(sin(t.mul(iSeed.mul(0.4).add(0.25)).add(iSeed.mul(43.0))).mul(0.8));
    const px = iPos.x.add(sin(t.mul(0.16).add(iSeed.mul(17.0))).mul(1.4));
    const alpha = float(0.05).add(iSeed.mul(0.10)).mul(smoothstep(1.4, 0.2, abs(py.sub(2.0)).mul(0.3)));
    const mat = new THREE.SpriteNodeMaterial({
      positionNode: vec3(px, py, iPos.z),
      scaleNode: vec2(iSeed.mul(3.2).add(1.6), iSeed.mul(3.2).add(1.6)),
      colorNode: vec4(vec3(1.0, 0.72, 0.42).mul(alpha), alpha),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4().makeScale(1, 1, 1);
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, m);
    mesh.frustumCulled = false;
    return mesh;
  }

  private buildGround(): void {
    const mat = new THREE.MeshStandardNodeMaterial({
      colorNode: (() => {
        const p = positionWorld;
        // packed earth: large-scale value mottling + vehicle tracks + scorch tint
        const n1 = sin(p.x.mul(0.23)).mul(sin(p.z.mul(0.31).add(1.7))).mul(0.5).add(0.5);
        const n2 = sin(p.x.mul(0.93).add(sin(p.z.mul(0.71)))).mul(sin(p.z.mul(1.13))).mul(0.5).add(0.5);
        const base = mix(vec3(0.085, 0.062, 0.045), vec3(0.135, 0.098, 0.068), n1.mul(0.7).add(n2.mul(0.3)));
        // twin tire-track bands sweeping the arena
        const band = abs(fract(p.x.mul(0.045).add(sin(p.z.mul(0.02)).mul(2.0))).sub(0.5));
        const tracks = smoothstep(0.10, 0.02, band).mul(0.35);
        // fine grit sparkle
        const grit = fract(sin(dot(floor(p.xz.mul(6.0)), vec2(127.1, 311.7))).mul(43758.5453));
        const spec = smoothstep(0.93, 1.0, grit).mul(0.25);
        return base.sub(vec3(0.03, 0.022, 0.014).mul(tracks)).add(vec3(0.35).mul(spec));
      })(),
      roughnessNode: (() => {
        const p = positionWorld;
        const v = sin(p.x.mul(0.5)).mul(sin(p.z.mul(0.43)));
        return float(0.82).add(v.mul(0.12));
      })(),
      metalness: 0.08,
    });
    const geo = new THREE.CircleGeometry(ARENA_RADIUS + 26, 72);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -0.02;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // arena floor plate: machined octagon slabs with emissive seams (deliberate structure)
    const plate = new THREE.Mesh(
      new THREE.CircleGeometry(10.5, 8),
      new THREE.MeshStandardNodeMaterial({
        roughnessNode: float(0.55),
        metalness: 0.5,
        colorNode: (() => {
          const p = positionLocal;
          const gp = vec2(p.x, p.y).div(2.1);
          const fr = fract(gp);
          const seam = min(abs(fr.x.sub(0.5)), abs(fr.y.sub(0.5))).mul(2.0);
          const line = smoothstep(0.06, 0.012, seam);
          const n = fract(sin(dot(floor(gp.mul(3.7)), vec2(127.1, 311.7))).mul(43758.5453));
          const shade = float(0.05).add(n.mul(0.035));
          return vec3(0.062, 0.064, 0.072).mul(shade.mul(14.0).div(14.0)).add(vec3(0.10, 0.085, 0.05).mul(line).mul(2.2));
        })(),
        emissiveNode: (() => {
          const p = positionLocal;
          const gp = vec2(p.x, p.y).div(2.1);
          const fr = fract(gp);
          const seam = min(abs(fr.x.sub(0.5)), abs(fr.y.sub(0.5))).mul(2.0);
          const line = smoothstep(0.045, 0.008, seam);
          return vec3(1.0, 0.45, 0.12).mul(line.mul(0.22));
        })(),
      }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.rotation.z = Math.PI / 8;
    plate.position.y = 0.03;
    plate.receiveShadow = true;
    this.scene.add(plate);
    // rim emissive edge ring
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(10.3, 10.62, 8),
      new THREE.MeshBasicNodeMaterial({ colorNode: vec4(vec3(1.0, 0.5, 0.16).mul(1.4), 1), side: THREE.DoubleSide }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.rotation.z = Math.PI / 8;
    rim.position.y = 0.045;
    this.scene.add(rim);
  }

  private buildRidge(): void {
    // far mountain ridges: dark low-poly ring silhouettes against the burning sky
    const mat = new THREE.MeshBasicNodeMaterial({
      colorNode: vec4(vec3(0.045, 0.030, 0.022), 1),
      fog: false,
    });
    const N = 26;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + ((i * 31) % 10) / 10;
      const r = 150 + ((i * 7717) % 100) / 100 * 40;
      const h = 14 + ((i * 3571) % 100) / 100 * 26;
      const w = 34 + ((i * 1471) % 100) / 100 * 40;
      const ridge = new THREE.Mesh(new THREE.ConeGeometry(w * 0.5, h, 5), mat);
      ridge.position.set(Math.cos(a) * r, h * 0.32, Math.sin(a) * r);
      ridge.rotation.y = a;
      this.scene.add(ridge);
    }
  }

  private buildBerm(): void {
    // rock berm ring marking the arena edge
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardNodeMaterial({ color: 0x2a2320, roughness: 0.92, metalness: 0.04 });
    const N = 64;
    const inst = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const qt = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + (i % 3) * 0.06;
      const r = ARENA_RADIUS + 1.2 + ((i * 7919) % 100) / 100 * 2.2;
      p.set(Math.cos(a) * r, -0.4 + ((i * 13) % 10) / 10 * 0.5, Math.sin(a) * r);
      e.set(((i * 31) % 100) / 100, a + i, ((i * 17) % 100) / 100);
      qt.setFromEuler(e);
      s.set(2.4 + ((i * 7) % 10) / 10 * 2.2, 1.6 + ((i * 11) % 10) / 10 * 1.4, 2.4 + ((i * 5) % 10) / 10 * 2.0);
      m.compose(p, qt, s);
      inst.setMatrixAt(i, m);
    }
    inst.receiveShadow = true;
    inst.castShadow = true;
    this.scene.add(inst);

    // edge fence posts with amber warning lights
    const postGeo = new THREE.CylinderGeometry(0.06, 0.08, 1.6, 6);
    const postMat = new THREE.MeshStandardNodeMaterial({ color: 0x1c1a18, roughness: 0.7, metalness: 0.5 });
    const M = 28;
    const posts = new THREE.InstancedMesh(postGeo, postMat, M);
    for (let i = 0; i < M; i++) {
      const a = (i / M) * Math.PI * 2;
      p.set(Math.cos(a) * (ARENA_RADIUS + 3.4), 0.8, Math.sin(a) * (ARENA_RADIUS + 3.4));
      e.set(0, a, 0);
      qt.setFromEuler(e);
      s.set(1, 1, 1);
      m.compose(p, qt, s);
      posts.setMatrixAt(i, m);
    }
    this.scene.add(posts);
    for (let i = 0; i < M; i += 2) {
      const a = (i / M) * Math.PI * 2;
      const mat2 = new THREE.MeshBasicNodeMaterial({
        colorNode: vec4(vec3(1.0, 0.42, 0.10).mul(this.uHeat.mul(0).add(1.6)), 1),
      });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat2);
      bulb.position.set(Math.cos(a) * (ARENA_RADIUS + 3.4), 1.68, Math.sin(a) * (ARENA_RADIUS + 3.4));
      this.scene.add(bulb);
    }
  }

  private buildRocks(propBudget: number): void {
    const clusters = Math.min(38, Math.max(14, Math.round(propBudget * 0.14)));
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.05 });
    const N = clusters * 3;
    const inst = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const qt = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    let idx = 0;
    for (let cix = 0; cix < clusters && idx < N; cix++) {
      const a = (cix * 2.399963 + 0.35) % (Math.PI * 2);
      const r = 16 + ((cix * 6151) % 1000) / 1000 * (ARENA_RADIUS - 18);
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const tint = 0.75 + ((cix * 977) % 100) / 100 * 0.5;
      for (let k = 0; k < 3 && idx < N; k++) {
        const ox = ((cix * 13 + k * 7) % 10) / 10 * 3.4 - 1.7;
        const oz = ((cix * 29 + k * 5) % 10) / 10 * 3.4 - 1.7;
        p.set(cx + ox, -0.35 + ((idx * 7) % 10) / 10 * 0.4, cz + oz);
        e.set(((idx * 37) % 100) / 100 * Math.PI, ((idx * 23) % 100) / 100 * Math.PI, ((idx * 41) % 100) / 100);
        qt.setFromEuler(e);
        const sc = (1.4 - k * 0.32) * (0.75 + ((idx * 977) % 100) / 100 * 0.6);
        s.set(sc * (1 + ((idx * 3) % 5) / 10), sc * (0.62 + ((idx * 7) % 5) / 10), sc);
        m.compose(p, qt, s);
        inst.setMatrixAt(idx, m);
        col.setRGB(0.20 * tint, 0.16 * tint, 0.12 * tint);
        inst.setColorAt(idx, col);
        idx++;
      }
    }
    inst.count = idx;
    inst.castShadow = true;
    inst.receiveShadow = true;
    this.scene.add(inst);
  }

  private buildOutpost(propBudget: number): void {
    // container stacks + crates around the rim inside the berm
    const contGeo = new THREE.BoxGeometry(2.4, 2.4, 6.0);
    const contMat = new THREE.MeshStandardNodeMaterial({ color: 0x37322c, roughness: 0.62, metalness: 0.55 });
    const stripeGeo = new THREE.BoxGeometry(2.44, 0.16, 6.04);
    const N = Math.min(56, Math.max(20, Math.round(propBudget * 0.24)));
    const conts = new THREE.InstancedMesh(contGeo, contMat, N);
    const stripes = new THREE.InstancedMesh(stripeGeo, new THREE.MeshStandardNodeMaterial({
      color: 0x140b06,
      emissiveNode: vec3(1.0, 0.52, 0.16).mul(0.85),
      roughness: 0.5,
    }), N);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const qt = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    let si = 0;
    for (let i = 0; i < N; i++) {
      const a = (i * 2.399963 + 0.7) % (Math.PI * 2);
      const r = 17 + ((i * 4523) % 1000) / 1000 * (ARENA_RADIUS - 20);
      const y = 1.2 + (((i * 29) % 3) * 2.42);
      p.set(Math.cos(a) * r, y, Math.sin(a) * r);
      e.set(0, a + Math.PI / 2 + (((i * 11) % 10) / 10 - 0.5) * 0.5, 0);
      qt.setFromEuler(e);
      s.set(1, 1, 1);
      m.compose(p, qt, s);
      conts.setMatrixAt(i, m);
      if (si < N && (i + si) % 2 === 0) {
        const sp = p.clone();
        sp.y = y + 1.0;
        m.compose(sp, qt, s);
        stripes.setMatrixAt(si, m);
        si++;
      }
    }
    for (let k = si; k < N; k++) {
      m.makeScale(0.0001, 0.0001, 0.0001);
      stripes.setMatrixAt(k, m);
    }
    conts.castShadow = true;
    conts.receiveShadow = true;
    this.scene.add(conts, stripes);
  }

  private buildTowers(): void {
    // 3 drilling towers with blinking aviation beacons + sodium floodlights
    const spots = [ // angle, radius, height
      [0.6, ARENA_RADIUS - 8, 15],
      [2.7, ARENA_RADIUS - 6, 12],
      [4.5, ARENA_RADIUS - 9, 17],
    ] as const;
    const legMat = new THREE.MeshStandardNodeMaterial({ color: 0x201c18, roughness: 0.55, metalness: 0.7 });
    for (const [a0, r, h] of spots) {
      const g = new THREE.Group();
      g.position.set(Math.cos(a0) * r, 0, Math.sin(a0) * r);
      // 4 legs tapering inward
      for (let i = 0; i < 4; i++) {
        const lx = (i < 2 ? -1 : 1) * 1.6;
        const lz = (i % 2 === 0 ? -1 : 1) * 1.6;
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.34, h, 0.34), legMat);
        leg.position.set(lx * 0.7, h / 2, lz * 0.7);
        leg.rotation.z = -lx * 0.045;
        leg.rotation.x = lz * 0.045;
        leg.castShadow = true;
        g.add(leg);
      }
      // cross braces
      for (let yy = 3; yy < h; yy += 3.2) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.16, 0.16), legMat);
        brace.position.y = yy;
        brace.rotation.y = Math.PI / 4;
        g.add(brace);
      }
      // top beacon
      const beaconMat = new THREE.MeshBasicNodeMaterial({
        colorNode: vec4(vec3(1.0, 0.16, 0.08).mul(this.uHeat.mul(0).add(0.6).add(sin(this.uTime.mul(2.6).add(a0)).mul(0.5).abs().mul(1.8))), 1),
      });
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), beaconMat);
      beacon.position.y = h + 0.4;
      g.add(beacon);
      this.beaconMats.push(beaconMat as unknown as THREE.MeshBasicNodeMaterial);
      this.beacons.push(beacon);
      // sodium floodlight aimed at arena
      const flood = new THREE.PointLight(0xffa040, 42, 44, 1.8);
      flood.position.set(0, h * 0.72, 0);
      g.add(flood);
      const lampMat = new THREE.MeshBasicNodeMaterial({ colorNode: vec4(vec3(1.0, 0.63, 0.25).mul(2.2), 1) });
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.5), lampMat);
      lamp.position.set(0, h * 0.72, 0);
      g.add(lamp);
      this.scene.add(g);
    }
  }

  // ---------- lifecycle ----------

  setQuality(q: QualitySettings): void {
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    this.renderer.setPixelRatio(Math.min(q.pixelRatio, dpr));
    if (this.renderer.shadowMap.enabled !== q.shadows) {
      this.renderer.shadowMap.enabled = q.shadows;
    }
    this.sun.castShadow = q.shadows;
    if (q.shadows) {
      this.sun.shadow.mapSize.setScalar(q.shadowMapSize);
      this.sun.shadow.camera.left = -34;
      this.sun.shadow.camera.right = 34;
      this.sun.shadow.camera.top = 34;
      this.sun.shadow.camera.bottom = -34;
      this.sun.shadow.camera.far = 190;
      this.sun.shadow.bias = -0.0012;
      this.sun.shadow.camera.updateProjectionMatrix();
    }
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /** Player anchor follows the walker for shadow frustum + muzzle light. */
  update(
    dt: number,
    px: number,
    pz: number,
    heat: number, // 0..1 combat heat for practical flicker
  ): void {
    this.time += dt;
    this.uTime.value = this.time;
    this.uHeat.value = heat;

    if (this.sun.castShadow) {
      this.sun.position.set(px + this.sunVec.x * 80, this.sunVec.y * 80, pz + this.sunVec.z * 80);
      this.sun.target.position.set(px, 0, pz);
      this.sun.target.updateMatrixWorld();
    }
  }

  dispose(): void {
    this.envRT?.dispose();
    this.renderer.dispose();
  }
}
