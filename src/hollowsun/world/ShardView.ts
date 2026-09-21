import * as THREE from "three/webgpu";
import { vec3, vec4 } from "three/tsl";
import { Ribbon } from "./Trails";
import { makeLightDiscTexture } from "./tex";
import type { Snap } from "@/hollowsun/types";

const SHARD_CAP = 8;

interface ShardSlot {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  trail: Ribbon;
}

/**
 * SHARDS — the player's living light boomerangs (§5). Per shard: octahedron
 * r0.28 emissive hot ×3 + additive glow sprite + short ribbon trail. Orbit /
 * fly / return states ALL render from snap.sPos; unused slots hide + clear.
 */
export class ShardView {
  private readonly slots: ShardSlot[] = [];
  private readonly geo: THREE.OctahedronGeometry;
  private readonly mat: THREE.MeshBasicNodeMaterial;
  private readonly glowTex: THREE.Texture;
  private readonly glowMatBase: THREE.SpriteMaterial;

  constructor(scene: THREE.Scene) {
    this.geo = new THREE.OctahedronGeometry(0.28, 0);
    this.mat = new THREE.MeshBasicNodeMaterial({
      colorNode: vec4(vec3(1.0, 0.97, 0.92).mul(3.0), 1),
      fog: false,
    });
    this.glowTex = makeLightDiscTexture();
    this.glowMatBase = new THREE.SpriteMaterial({
      map: this.glowTex,
      color: 0xffd9a0,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.85,
    });
    for (let i = 0; i < SHARD_CAP; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
      const glow = new THREE.Sprite(this.glowMatBase);
      glow.scale.setScalar(1.6);
      glow.renderOrder = 8;
      scene.add(glow);
      const trail = new Ribbon(scene, 16, 0.17, 0xfff7ea, 0.3, 1.0);
      this.slots.push({ mesh, glow, trail });
    }
  }

  /** All views from snap SoA (ALREADY interpolated by Sim) — just position. */
  update(snap: Snap, dt: number, time: number): void {
    for (let i = 0; i < SHARD_CAP; i++) {
      const slot = this.slots[i];
      const active = i < snap.sCount;
      slot.mesh.visible = active;
      slot.glow.visible = active;
      slot.trail.setVisible(active);
      if (!active) {
        slot.trail.clear();
        continue;
      }
      const x = snap.sPos[i * 2];
      const z = snap.sPos[i * 2 + 1];
      const st = snap.sState[i];
      const y = 1.0 + Math.sin(time * 5.2 + i * 2.1) * 0.07 + (st === 0 ? 0 : 0.04);
      slot.mesh.position.set(x, y, z);
      slot.mesh.rotation.y = time * 4.2 + i * 1.7;
      slot.mesh.rotation.x = Math.sin(time * 3.1 + i) * 0.35 + (st === 1 ? 0.5 : 0);
      slot.glow.position.set(x, y, z);
      slot.trail.push(x, z);
      slot.trail.update(dt);
    }
  }

  /** restart wipe */
  reset(): void {
    for (const slot of this.slots) {
      slot.trail.clear();
      slot.mesh.visible = false;
      slot.glow.visible = false;
      slot.trail.setVisible(false);
    }
  }

  dispose(scene: THREE.Scene): void {
    for (const slot of this.slots) {
      scene.remove(slot.mesh, slot.glow);
      slot.trail.dispose(scene);
    }
    this.geo.dispose();
    this.mat.dispose();
    this.glowMatBase.dispose();
    this.glowTex.dispose();
  }
}
