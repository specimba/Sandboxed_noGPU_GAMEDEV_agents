import * as THREE from "three/webgpu";
import {
  uniform, vec2, vec3, vec4, float, mix, sin, cos, abs, exp, smoothstep, length,
  instancedBufferAttribute, texture, uv, normalView, positionViewDirection, pow,
} from "three/tsl";
import { makeCrackTexture } from "./tex";

export const STAR_X = 0;
export const STAR_Y = 4;
export const STAR_Z = 0;
export const STAR_R = 6;
const CORONA = 600;
const RING_ROCKS = 300;
const FED_MAX = 800;
const SHAFTS = 5;

/** Typed read of an instanced attribute (r185 typing narrows via cast). */
function attrF(geo: THREE.BufferGeometry, name: string): ReturnType<typeof float> {
  return instancedBufferAttribute(geo.getAttribute(name) as THREE.InstancedBufferAttribute) as unknown as ReturnType<typeof float>;
}
function attrV3(geo: THREE.BufferGeometry, name: string): ReturnType<typeof vec3> {
  return instancedBufferAttribute(geo.getAttribute(name) as THREE.InstancedBufferAttribute) as unknown as ReturnType<typeof vec3>;
}

/**
 * SUN-HEART — the stage icon. Cracked dark sphere r6 @ y4 with molten crack
 * EMISSIVE map (0.4→3.2 with sun), 600 GPU-orbiting corona sprites, tilted
 * debris ring (300 instanced rocks r9–13, faint ember rim), 5 crossed additive
 * god-shafts, gold point light 10→80, and the FED-MOTE system (800 CPU-updated
 * motes that spiral kills into the star — the visible meta of §8).
 */
export class SunHeart {
  private readonly uTime = uniform(0);
  private readonly uPhase = uniform(0); // corona orbit phase (rate scales with sun)
  private readonly uCrack = uniform(0.9); // 0.9 → 3.2 (visible molten presence at sun = 0)
  private readonly uCharge = uniform(0); // fed-mote arrival glow 0..~1.5
  private readonly uCoronaA = uniform(0.5);
  private readonly uShaft = uniform(0.05);

  private readonly starMesh: THREE.Mesh;
  private readonly ringGroup = new THREE.Group();
  private readonly coronaMesh: THREE.InstancedMesh;
  private readonly light: THREE.PointLight;

  // fed-motes (SoA, CPU physics — the §13 fed-motes budget)
  private readonly fPos: THREE.InstancedBufferAttribute;
  private readonly fCol: THREE.InstancedBufferAttribute;
  private readonly fSize: THREE.InstancedBufferAttribute;
  private readonly fAlpha: THREE.InstancedBufferAttribute;
  private readonly gPos: Float32Array;
  private readonly gCol: Float32Array;
  private readonly gSize: Float32Array;
  private readonly gAlpha: Float32Array;
  private readonly fx = new Float32Array(FED_MAX * 3);
  private readonly fv = new Float32Array(FED_MAX * 3);
  private readonly flife = new Float32Array(FED_MAX);
  private readonly fmax = new Float32Array(FED_MAX);
  private readonly fseed = new Float32Array(FED_MAX);
  private fCursor = 0;

  private charge = 0;
  private readonly texList: THREE.Texture[] = [];
  private readonly geoList: THREE.BufferGeometry[] = [];
  private readonly matList: THREE.Material[] = [];
  private readonly meshList: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene) {
    // ---- body: charred rock + molten crack emissive map ----
    const crackTex = makeCrackTexture();
    this.texList.push(crackTex);
    const starGeo = new THREE.SphereGeometry(STAR_R, 48, 32);
    this.geoList.push(starGeo);
    const starMat = new THREE.MeshStandardNodeMaterial({
      color: 0x0b0710,
      roughness: 0.95,
      metalness: 0.05,
      // Molten cracks + fresnel ember rim — the heart must NEVER read as a
      // black blob: its silhouette glows ember even at sun = 0.
      emissiveNode: texture(crackTex).rgb
        .mul(this.uCrack.mul(this.uCharge.mul(0.6).add(1.0)))
        .add(vec3(1.0, 0.71, 0.33).mul(this.uCharge.mul(0.35)))
        .add(
          vec3(1.0, 0.5, 0.22).mul(
            pow(normalView.dot(positionViewDirection).oneMinus(), 2.2).mul(
              this.uCrack.mul(0.3).add(0.3),
            ),
          ),
        ),
    });
    this.matList.push(starMat);
    this.starMesh = new THREE.Mesh(starGeo, starMat);
    this.starMesh.position.set(STAR_X, STAR_Y, STAR_Z);
    this.starMesh.rotation.z = 0.1;
    scene.add(this.starMesh);
    this.meshList.push(this.starMesh);

    // ---- corona: 600 GPU-orbiting additive sprites ----
    const cGeo = new THREE.PlaneGeometry(1, 1);
    const cAng = new Float32Array(CORONA);
    const cRad = new Float32Array(CORONA);
    const cH = new Float32Array(CORONA);
    const cSpd = new Float32Array(CORONA);
    const cSeed = new Float32Array(CORONA);
    for (let i = 0; i < CORONA; i++) {
      cAng[i] = Math.random() * Math.PI * 2;
      cRad[i] = STAR_R * 1.1 + Math.random() * 5.0; // 6.6..11.6
      cH[i] = (Math.random() - 0.5) * 5.4;
      cSpd[i] = 0.35 + Math.random() * 0.75;
      cSeed[i] = Math.random();
    }
    cGeo.setAttribute("iAng", new THREE.InstancedBufferAttribute(cAng, 1));
    cGeo.setAttribute("iRad", new THREE.InstancedBufferAttribute(cRad, 1));
    cGeo.setAttribute("iH", new THREE.InstancedBufferAttribute(cH, 1));
    cGeo.setAttribute("iSpd", new THREE.InstancedBufferAttribute(cSpd, 1));
    cGeo.setAttribute("iSeed", new THREE.InstancedBufferAttribute(cSeed, 1));
    this.geoList.push(cGeo);
    const iAng = attrF(cGeo, "iAng");
    const iRad = attrF(cGeo, "iRad");
    const iH = attrF(cGeo, "iH");
    const iSpd = attrF(cGeo, "iSpd");
    const iSeed = attrF(cGeo, "iSeed");
    const ang = iAng.add(this.uPhase.mul(iSpd));
    const rad = iRad.mul(sin(this.uTime.mul(0.5).add(iSeed.mul(6.28))).mul(0.05).add(1.0)); // breathing orbit
    const cx = cos(ang).mul(rad);
    const cz = sin(ang).mul(rad);
    const cy = float(STAR_Y).add(iH).add(sin(this.uPhase.mul(iSpd).mul(2.0).add(iSeed.mul(20.0))).mul(0.5));
    const tw = sin(this.uTime.mul(3.1).add(iSeed.mul(40.0))).mul(0.3).add(0.7);
    const cAlpha = smoothstep(0.2, 0.9, iSeed).mul(this.uCoronaA).mul(tw);
    const cCol = mix(vec3(1.0, 0.45, 0.18), vec3(1.0, 0.75, 0.36), iSeed); // ember → gold
    // SOFT ROUND falloff — corona sprites must never render as solid squares.
    const cD = length(uv().sub(0.5));
    const cGlow = smoothstep(0.5, 0.06, cD);
    const cCore = exp(cD.mul(-7.0));
    const coronaMat = new THREE.SpriteNodeMaterial({
      positionNode: vec3(cx, cy, cz),
      scaleNode: vec2(iSeed.mul(0.55).add(0.28), iSeed.mul(0.55).add(0.28)).mul(tw),
      colorNode: vec4(cCol.mul(cGlow.mul(0.7).add(cCore)).mul(cAlpha), cGlow.mul(cAlpha)),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.matList.push(coronaMat);
    this.coronaMesh = new THREE.InstancedMesh(cGeo, coronaMat, CORONA);
    const im = new THREE.Matrix4().makeScale(1, 1, 1);
    for (let i = 0; i < CORONA; i++) this.coronaMesh.setMatrixAt(i, im);
    this.coronaMesh.frustumCulled = false;
    scene.add(this.coronaMesh);
    this.meshList.push(this.coronaMesh);

    // ---- tilted debris ring: 300 instanced UNLIT silhouettes (never smoke) ----
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    this.geoList.push(rockGeo);
    const rockMat = new THREE.MeshBasicNodeMaterial({
      // LINEAR color values — 0.006 linear ≈ 0.09 sRGB (dark silhouette).
      colorNode: vec3(0.006, 0.004, 0.008).add(
        vec3(1.0, 0.45, 0.18).mul(this.uTime.mul(0).add(0.02).add(sin(this.uTime.mul(1.3)).mul(0.012)).mul(this.uCoronaA)),
      ),
      fog: true,
    });
    this.matList.push(rockMat);
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, RING_ROCKS);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (let i = 0; i < RING_ROCKS; i++) {
      const a = (i / RING_ROCKS) * Math.PI * 2 + ((i * 31) % 10) / 10 * 0.1;
      const r = 9 + ((i * 6151) % 1000) / 1000 * 4; // 9..13
      p.set(Math.cos(a) * r, ((i * 37) % 100) / 100 * 1.6 - 0.8, Math.sin(a) * r);
      e.set(((i * 13) % 100) / 100 * Math.PI, a + i, ((i * 7) % 100) / 100 * Math.PI);
      q.setFromEuler(e);
      const s0 = 0.22 + ((i * 977) % 100) / 100 * 0.5;
      sc.set(s0 * (1 + ((i * 3) % 5) / 10), s0 * (0.6 + ((i * 7) % 5) / 10), s0);
      m.compose(p, q, sc);
      rocks.setMatrixAt(i, m);
    }
    rocks.frustumCulled = false;
    this.ringGroup.add(rocks);
    this.ringGroup.rotation.x = 0.19;
    this.ringGroup.rotation.z = 0.07;
    this.ringGroup.position.set(STAR_X, STAR_Y, STAR_Z);
    scene.add(this.ringGroup);
    this.meshList.push(this.ringGroup);

    // ---- 5 crossed god-shafts (additive planes, 0.05+0.15·sun) ----
    const shaftGeo = new THREE.PlaneGeometry(7.5, 26);
    this.geoList.push(shaftGeo);
    const shaftMat = new THREE.MeshBasicNodeMaterial({
      colorNode: (() => {
        const u = uv();
        const hFall = smoothstep(0.5, 0.05, abs(u.x.sub(0.5)));
        const vFall = smoothstep(0.02, 0.5, u.y).mul(smoothstep(1.0, 0.55, u.y));
        const a = hFall.mul(vFall).mul(this.uShaft);
        return vec4(vec3(1.0, 0.74, 0.38).mul(a), a);
      })(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.matList.push(shaftMat);
    for (let i = 0; i < SHAFTS; i++) {
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.position.set(STAR_X, STAR_Y, STAR_Z);
      shaft.rotation.y = (i / SHAFTS) * Math.PI + 0.25;
      scene.add(shaft);
      this.meshList.push(shaft);
    }

    // ---- gold star light 10→80 ----
    this.light = new THREE.PointLight(0xffb454, 10, 60, 1.8);
    this.light.position.set(STAR_X, STAR_Y + 3, STAR_Z);
    scene.add(this.light);
    this.meshList.push(this.light);

    // ---- fed-motes: 800 instanced CPU-driven motes ----
    this.gPos = new Float32Array(FED_MAX * 3);
    this.gCol = new Float32Array(FED_MAX * 3);
    this.gSize = new Float32Array(FED_MAX);
    this.gAlpha = new Float32Array(FED_MAX);
    const fGeo = new THREE.PlaneGeometry(1, 1);
    this.fPos = new THREE.InstancedBufferAttribute(this.gPos, 3);
    this.fCol = new THREE.InstancedBufferAttribute(this.gCol, 3);
    this.fSize = new THREE.InstancedBufferAttribute(this.gSize, 1);
    this.fAlpha = new THREE.InstancedBufferAttribute(this.gAlpha, 1);
    this.fPos.setUsage(THREE.DynamicDrawUsage);
    this.fCol.setUsage(THREE.DynamicDrawUsage);
    this.fSize.setUsage(THREE.DynamicDrawUsage);
    this.fAlpha.setUsage(THREE.DynamicDrawUsage);
    fGeo.setAttribute("position", this.fPos);
    fGeo.setAttribute("iCol", this.fCol);
    fGeo.setAttribute("iSize", this.fSize);
    fGeo.setAttribute("iAlpha", this.fAlpha);
    this.geoList.push(fGeo);
    const fIcol = attrV3(fGeo, "iCol");
    const fIalpha = attrF(fGeo, "iAlpha");
    const fIsize = attrF(fGeo, "iSize");
    const d = length(uv().sub(0.5));
    const glow = smoothstep(0.5, 0.04, d);
    const core = exp(d.mul(-9.0));
    const fA = glow.mul(fIalpha);
    const fedMat = new THREE.SpriteNodeMaterial({
      positionNode: attrV3(fGeo, "position"),
      scaleNode: vec2(fIsize, fIsize),
      colorNode: vec4(fIcol.mul(glow.mul(0.7).add(core)).mul(fIalpha), fA),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.matList.push(fedMat);
    const fedMesh = new THREE.InstancedMesh(fGeo, fedMat, FED_MAX);
    for (let i = 0; i < FED_MAX; i++) fedMesh.setMatrixAt(i, im);
    fedMesh.frustumCulled = false;
    fedMesh.renderOrder = 8;
    scene.add(fedMesh);
    this.meshList.push(fedMesh);
  }

  /** Kill → n motes spiral from (x,y) into the star (§10 feed). */
  feed(x: number, y: number, n: number): void {
    for (let k = 0; k < n; k++) {
      const i = this.fCursor;
      this.fCursor = (this.fCursor + 1) % FED_MAX;
      this.spawnFed(i, x, 1.0, y, 7.5, 22);
      this.flife[i] = this.fmax[i] = 2.6 + Math.random() * 1.4;
      this.fseed[i] = Math.random();
    }
  }

  /** BOSSDIE → n motes implosion from the arena edge (800 spec). */
  implode(n: number): void {
    for (let k = 0; k < n; k++) {
      const i = this.fCursor;
      this.fCursor = (this.fCursor + 1) % FED_MAX;
      const a = Math.random() * Math.PI * 2;
      const r = 22 + Math.random() * 12;
      this.spawnFed(i, Math.cos(a) * r, 0.5 + Math.random() * 6.5, Math.sin(a) * r, 30, 46);
      this.flife[i] = this.fmax[i] = 1.6 + Math.random() * 0.9;
      this.fseed[i] = Math.random();
    }
  }

  private spawnFed(i: number, x: number, y: number, z: number, accel: number, maxSpd: number): void {
    const o = i * 3;
    this.fx[o] = x;
    this.fx[o + 1] = y;
    this.fx[o + 2] = z;
    const a = Math.random() * Math.PI * 2;
    const s = accel * 0.14;
    this.fv[o] = Math.cos(a) * s;
    this.fv[o + 1] = 1.5 + Math.random() * 2;
    this.fv[o + 2] = Math.sin(a) * s;
    this.flife[i] = 3;
    this.fmax[i] = 3;
    this.fAccel[i] = accel;
    this.fMaxSpd[i] = maxSpd;
  }

  private readonly fAccel = new Float32Array(FED_MAX);
  private readonly fMaxSpd = new Float32Array(FED_MAX);

  /** SUNRANK / overdrive — golden surge of the heart. */
  pulse(strength: number): void {
    this.charge = Math.min(1.6, this.charge + strength);
  }

  private setFedColor(i: number): void {
    const t = this.fseed[i];
    const o = i * 3;
    // ember → gold mix + white-hot flash near arrival (alpha ramp handles it)
    this.gCol[o] = 1.0;
    this.gCol[o + 1] = 0.55 + t * 0.25;
    this.gCol[o + 2] = 0.24 + t * 0.16;
  }

  update(dt: number, time: number, sun: number): void {
    this.uTime.value = time;
    this.uPhase.value += dt * (1.0 + sun); // corona rate ×2 at full sun
    this.uCrack.value = 0.9 + 2.3 * sun;
    this.uCoronaA.value = 0.5 + 0.4 * sun;
    this.uShaft.value = 0.05 + 0.15 * sun;
    this.charge = Math.max(0, this.charge - dt * 0.75);
    this.uCharge.value = this.charge;
    this.light.intensity = 10 + 70 * sun + this.charge * 38;

    // slow rotation of heart + ring
    this.starMesh.rotation.y += dt * 0.05;
    this.ringGroup.rotation.y += dt * 0.03;

    // ---- fed-mote physics: seek star + tangential swirl ----
    let dirty = false;
    for (let i = 0; i < FED_MAX; i++) {
      if (this.flife[i] <= 0) continue;
      dirty = true;
      this.flife[i] -= dt;
      const o = i * 3;
      const dx = STAR_X - this.fx[o];
      const dy = STAR_Y - this.fx[o + 1];
      const dz = STAR_Z - this.fx[o + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 1.5 || this.flife[i] <= 0) {
        // arrival → charge the heart
        if (dist < 1.5) this.charge = Math.min(1.6, this.charge + 0.012);
        this.flife[i] = 0;
        this.gSize[i] = 0;
        this.gAlpha[i] = 0;
        continue;
      }
      const inv = 1 / Math.max(dist, 0.001);
      const nx = dx * inv;
      const ny = dy * inv;
      const nz = dz * inv;
      const acc = this.fAccel[i];
      const sw = 9.0; // tangential swirl
      this.fv[o] += (nx * acc - nz * sw) * dt;
      this.fv[o + 1] += (ny * acc + Math.sin(time * 3 + this.fseed[i] * 20) * 3) * dt;
      this.fv[o + 2] += (nz * acc + nx * sw) * dt;
      const spd = Math.sqrt(this.fv[o] * this.fv[o] + this.fv[o + 1] * this.fv[o + 1] + this.fv[o + 2] * this.fv[o + 2]);
      const cap = this.fMaxSpd[i];
      if (spd > cap) {
        const k = cap / spd;
        this.fv[o] *= k;
        this.fv[o + 1] *= k;
        this.fv[o + 2] *= k;
      }
      this.fx[o] += this.fv[o] * dt;
      this.fx[o + 1] += this.fv[o + 1] * dt;
      this.fx[o + 2] += this.fv[o + 2] * dt;
      const lf = Math.min(1, this.flife[i] / this.fmax[i] * 2.2);
      const near = Math.max(0, 1 - dist / 9); // heat up on approach
      this.gPos[o] = this.fx[o];
      this.gPos[o + 1] = this.fx[o + 1];
      this.gPos[o + 2] = this.fx[o + 2];
      this.setFedColor(i);
      this.gCol[o + 1] += near * 0.3;
      this.gCol[o + 2] += near * 0.45;
      this.gSize[i] = 0.55 + near * 0.35;
      this.gAlpha[i] = Math.min(1, lf) * (0.75 + near * 0.25);
    }
    if (dirty) {
      this.fPos.needsUpdate = true;
      this.fCol.needsUpdate = true;
      this.fSize.needsUpdate = true;
      this.fAlpha.needsUpdate = true;
    }
  }

  dispose(scene: THREE.Scene): void {
    for (const o of this.meshList) scene.remove(o);
    for (const t of this.texList) t.dispose();
    for (const g of this.geoList) g.dispose();
    for (const mm of this.matList) mm.dispose();
  }
}
