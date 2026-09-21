import * as THREE from "three/webgpu";

/**
 * Camera rig (DESIGN_C §3 EXACT): FOV 52, fixed offset (0, 17.5, 10.5)
 * → pitch ≈58°, look target = player + 0.22·aimVec (lead clamped 3.5u)
 * smoothed at lerp 8/s, combo zoom 1→0.88 (lerp 3/s), dash fovKick +6°
 * (0.35s decay), trauma² shake — trauma is READ from FXState (C3 owns it):
 * pos amp 0.5u, rot 0.02rad.
 */
export class CameraRig {
  private readonly look = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private zoomScale = 1;
  private fov = 52;
  private fovKick = 0;
  private time = 0;
  private initialized = false;

  private readonly offset = new THREE.Vector3(0, 20, 8.5); // pitch ≈67° — more floor, readable dodging

  /** Snap (no lerp) to a fresh run position. */
  reset(px: number, py: number, aimX: number, aimY: number): void {
    this.computeLook(px, py, aimX, aimY, this.look);
    this.zoomScale = 1;
    this.fovKick = 0;
    this.fov = 52;
    this.initialized = true;
  }

  /** DASH event → +6° fov kick, decays over ≈0.35s. */
  kickFov(deg: number): void {
    this.fovKick = Math.min(9, this.fovKick + deg);
  }

  private computeLook(px: number, py: number, aimX: number, aimY: number, out: THREE.Vector3): void {
    // lead = 0.22 · (aim - player), clamped to 3.5u
    const dx = aimX - px;
    const dy = aimY - py;
    let lx = dx * 0.22;
    let ly = dy * 0.22;
    const len = Math.hypot(lx, ly);
    if (len > 3.5) {
      const k = 3.5 / len;
      lx *= k;
      ly *= k;
    }
    out.set(px + lx, 1.0, py + ly);
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    trauma: number, // READ from fx.trauma (decay owned by Juice)
    px: number,
    py: number,
    aimX: number,
    aimY: number,
    combo: number,
  ): void {
    this.time += dt;

    // look target: player + clamped aim lead, lerp 8/s
    this.computeLook(px, py, aimX, aimY, this.desired);
    if (!this.initialized) {
      this.reset(px, py, aimX, aimY);
    }
    this.look.lerp(this.desired, Math.min(1, dt * 8));

    // zoom: distance scale 1 → 0.88 when combo ≥ 8, lerp 3/s
    const zoomTarget = combo >= 8 ? 0.88 : 1.0;
    this.zoomScale += (zoomTarget - this.zoomScale) * Math.min(1, dt * 3);

    // fov kick decay (≈0.35s to spent)
    this.fovKick *= Math.exp(-8.6 * dt);
    if (this.fovKick < 0.02) this.fovKick = 0;
    const targetFov = 52 + this.fovKick;
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }

    // fixed offset scaled by zoom
    camera.position.set(
      this.look.x + this.offset.x * this.zoomScale,
      this.look.y + this.offset.y * this.zoomScale,
      this.look.z + this.offset.z * this.zoomScale,
    );
    camera.lookAt(this.look);

    // shake: trauma² — pos amp 0.5u, rot 0.02rad
    const s = trauma * trauma;
    if (s > 0.0004) {
      const t = this.time;
      const n1 = Math.sin(t * 33.7) * 0.5 + Math.sin(t * 57.3 + 1.7) * 0.5;
      const n2 = Math.sin(t * 27.1 + 4.2) * 0.5 + Math.sin(t * 49.7 + 2.1) * 0.5;
      camera.position.x += n1 * s * 0.5;
      camera.position.y += n2 * s * 0.42;
      camera.position.z += n2 * s * 0.3;
      camera.rotation.z += n1 * s * 0.02;
    }
  }
}
