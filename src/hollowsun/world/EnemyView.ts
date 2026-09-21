import * as THREE from "three/webgpu";
import {
  uniform, vec3, vec4, float, pow, sub, abs, dot, normalView,
  positionViewDirection, instancedBufferAttribute,
} from "three/tsl";
import { CAPS } from "@/hollowsun/types";
import type { Snap } from "@/hollowsun/types";

const KIND_CAP = CAPS.enemy; // per-kind instance cap (total enemies ≤128 anyway)

/** rim colors per enemy kind (DESIGN_C §6): mote ember · lancer gold-hot ·
 *  weaver void · bulwark gold-dim · warden danger */
const RIM = [0xff8a3d, 0xffcf7a, 0x9a6bff, 0xc08a44, 0xff3b5c];
/** hover height per kind */
const HOVER = [1.05, 1.0, 1.15, 1.45, 2.6];

/** Typed read of an instanced attribute (r185 typing narrows via cast). */
function attrF(geo: THREE.BufferGeometry, name: string): ReturnType<typeof float> {
  return instancedBufferAttribute(geo.getAttribute(name) as THREE.InstancedBufferAttribute) as unknown as ReturnType<typeof float>;
}

/**
 * ENEMY VIEW — ONE instanced mesh per kind (tetra / cone / octa / hex-cylinder;
 * warden icosa + 3 rotating torus rings is a single non-instanced group).
 * Body #0d0a14 MeshStandardNodeMaterial + TSL fresnel rim emissive in the kind
 * color, 1.2–2 intensity pulsing at 1.5Hz. snap.eTele → lancer ×4 rim flash,
 * snap.eHp drops → white-ish per-instance flash (instanced iGlow/iFlash attrs).
 */
export class EnemyView {
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly uPulse: ReturnType<typeof uniform>[] = [];
  private readonly glowAttrs: THREE.InstancedBufferAttribute[] = [];
  private readonly flashAttrs: THREE.InstancedBufferAttribute[] = [];
  private readonly glowArr: Float32Array[] = [];
  private readonly flashArr: Float32Array[] = [];
  private readonly counts = [0, 0, 0, 0];

  private readonly warden = new THREE.Group();
  private readonly wardenRings: THREE.Mesh[] = [];
  private readonly wardenUFlash = uniform(0);
  private wardenFlash = 0;
  private wardenPrevHp = 1;
  private wardenSeen = false;

  private readonly prevHp = new Float32Array(CAPS.enemy);
  private readonly flash = new Float32Array(CAPS.enemy);

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const geos: THREE.BufferGeometry[] = [
      new THREE.TetrahedronGeometry(0.5, 0),
      new THREE.ConeGeometry(0.45, 1.6, 6),
      new THREE.OctahedronGeometry(0.7, 0),
      new THREE.CylinderGeometry(1.4, 1.4, 1.4, 6),
    ];
    geos[1].rotateX(Math.PI / 2); // lancer cone points forward (+Z)

    for (let k = 0; k < 4; k++) {
      const geo = geos[k];
      const glow = new Float32Array(KIND_CAP).fill(1);
      const fl = new Float32Array(KIND_CAP);
      const glowAttr = new THREE.InstancedBufferAttribute(glow, 1);
      const flashAttr = new THREE.InstancedBufferAttribute(fl, 1);
      glowAttr.setUsage(THREE.DynamicDrawUsage);
      flashAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("iGlow", glowAttr);
      geo.setAttribute("iFlash", flashAttr);

      const uPulse = uniform(1.6);
      this.uPulse.push(uPulse);
      const iGlow = attrF(geo, "iGlow");
      const iFlash = attrF(geo, "iFlash");
      const rim = vec3(((RIM[k] >> 16) & 255) / 255, ((RIM[k] >> 8) & 255) / 255, (RIM[k] & 255) / 255);
      // BROAD fresnel (pow 1.4) + base emissive floor — small enemies must GLOW,
      // not read as dark smoke against the void (QA lesson c-fight1.png).
      const fres = pow(sub(float(1.0), abs(dot(normalView, positionViewDirection))), 1.4).mul(1.5).add(0.45);
      const mat = new THREE.MeshStandardNodeMaterial({
        color: 0x0d0a14,
        roughness: 0.62,
        metalness: 0.3,
        emissiveNode: rim.mul(fres).mul(uPulse).mul(iGlow)
          .add(vec3(1.0, 0.93, 0.85).mul(fres).mul(iFlash)),
      });
      const mesh = new THREE.InstancedMesh(geo, mat, KIND_CAP);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.glowAttrs.push(glowAttr);
      this.flashAttrs.push(flashAttr);
      this.glowArr.push(glow);
      this.flashArr.push(fl);
    }

    // ---- warden: non-instanced icosa + 3 rotating torus rings ----
    const wGeo = new THREE.IcosahedronGeometry(2.6, 1);
    const fres = pow(sub(float(1.0), abs(dot(normalView, positionViewDirection))), 1.4).mul(1.5).add(0.45);
    const wMat = new THREE.MeshStandardNodeMaterial({
      color: 0x0d0a14,
      roughness: 0.55,
      metalness: 0.35,
      emissiveNode: vec3(((RIM[4] >> 16) & 255) / 255, ((RIM[4] >> 8) & 255) / 255, (RIM[4] & 255) / 255)
        .mul(fres).mul(uniform(1.9)).add(vec3(1.0, 0.9, 0.85).mul(fres).mul(this.wardenUFlash)),
    });
    const wBody = new THREE.Mesh(wGeo, wMat);
    this.warden.add(wBody);
    const ringGeo = new THREE.TorusGeometry(3.6, 0.07, 8, 72);
    for (let r = 0; r < 3; r++) {
      const rMat = new THREE.MeshBasicNodeMaterial({
        colorNode: vec4(vec3(1.0, 0.23, 0.36).mul(1.6 + r * 0.25), 1),
        fog: false,
      });
      const ring = new THREE.Mesh(ringGeo, rMat);
      this.warden.add(ring);
      this.wardenRings.push(ring);
    }
    this.warden.visible = false;
    scene.add(this.warden);
  }

  /** All views from snap SoA — just position instances (zero alloc). */
  update(snap: Snap, dt: number, time: number): void {
    // shared 1.5Hz rim pulse, 1.2–2 intensity
    for (let k = 0; k < 4; k++) {
      this.uPulse[k].value = 1.6 + 0.4 * Math.sin(time * 9.42477 + k * 1.3); // 2π·1.5
    }
    this.counts[0] = this.counts[1] = this.counts[2] = this.counts[3] = 0;
    let wardenPos: [number, number] | null = null;

    for (let i = 0; i < snap.eCount; i++) {
      const kind = snap.eType[i];
      const x = snap.ePos[i * 2];
      const z = snap.ePos[i * 2 + 1];
      const tele = snap.eTele[i];
      // hp-drop → white flash (index-keyed, best effort)
      if (snap.eHp[i] < this.prevHp[i] - 0.02) this.flash[i] = 1;
      this.prevHp[i] = snap.eHp[i];
      this.flash[i] = Math.max(0, this.flash[i] - dt * 6.5);

      if (kind === 4) {
        wardenPos = [x, z];
        if (snap.eHp[i] < this.wardenPrevHp - 0.02) this.wardenFlash = 1;
        this.wardenPrevHp = snap.eHp[i];
        continue;
      }
      const ci = this.counts[kind];
      if (ci >= KIND_CAP) continue;
      this.counts[kind] = ci + 1;

      const bob = Math.sin(time * 4.4 + i * 1.31) * (kind === 3 ? 0.06 : 0.09);
      this.p.set(x, HOVER[kind] + bob, z);
      this.e.set(kind === 1 ? 0.12 : Math.sin(time * 1.7 + i) * 0.12, snap.eRot[i] + time * (kind === 0 ? 1.4 : kind === 2 ? 0.9 : 0.25), kind === 2 ? Math.sin(time * 2.3 + i) * 0.15 : 0);
      this.q.setFromEuler(this.e);
      const sw = 1 + (kind === 1 ? tele * 0.1 : 0);
      this.s.setScalar(sw);
      this.m.compose(this.p, this.q, this.s);
      this.meshes[kind].setMatrixAt(ci, this.m);
      this.glowArr[kind][ci] = kind === 1 ? 1 + tele * 3 : 1 + tele * 0.6;
      this.flashArr[kind][ci] = this.flash[i] * 2.2;
    }

    for (let k = 0; k < 4; k++) {
      const mesh = this.meshes[k];
      const prev = mesh.count;
      const c = this.counts[k];
      mesh.count = c;
      if (c > 0 || prev > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        this.glowAttrs[k].needsUpdate = true;
        this.flashAttrs[k].needsUpdate = true;
      }
    }

    // ---- warden group ----
    this.wardenFlash = Math.max(0, this.wardenFlash - dt * 6.5);
    this.wardenUFlash.value = this.wardenFlash * 2.0;
    if (wardenPos) {
      this.wardenSeen = true;
      this.warden.visible = true;
      this.warden.position.set(wardenPos[0], HOVER[4] + Math.sin(time * 1.6) * 0.18, wardenPos[1]);
      this.warden.rotation.y = time * 0.35;
      this.wardenRings[0].rotation.x = time * 1.25;
      this.wardenRings[0].rotation.y = time * 0.4;
      this.wardenRings[1].rotation.x = time * -0.8;
      this.wardenRings[1].rotation.z = time * 1.05;
      this.wardenRings[2].rotation.y = time * 1.5;
      this.wardenRings[2].rotation.x = time * 0.55;
    } else {
      if (this.wardenSeen) this.wardenPrevHp = 1;
      this.wardenSeen = false;
      this.warden.visible = false;
    }
  }

  /** reset per-run state (restart). */
  reset(): void {
    this.prevHp.fill(1);
    this.flash.fill(0);
    this.wardenPrevHp = 1;
    this.wardenFlash = 0;
    this.warden.visible = false;
    this.wardenSeen = false;
  }

  dispose(scene: THREE.Scene): void {
    for (const mesh of this.meshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    scene.remove(this.warden);
    this.warden.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) (mesh.material as THREE.Material).dispose();
    });
  }
}
