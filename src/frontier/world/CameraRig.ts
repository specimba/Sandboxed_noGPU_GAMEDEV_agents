import * as THREE from "three/webgpu";

/**
 * 3rd-person chase camera: damped follow, aim bias (looks toward where you
 * shoot), trauma² shake, FOV kick on dash.
 */
export class CameraRig {
  private pos = new THREE.Vector3(0, 16, 14);
  private look = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private trauma = 0;
  private fov = 52;
  private fovPulse = 0;
  private time = 0;
  private mode: "title" | "play" = "title";

  reset(x: number, z: number): void {
    this.trauma = 0;
    this.fovPulse = 0;
    this.mode = "play";
    this.pos.set(x, 10.6, z + 16.8);
    this.look.set(x, 1.15, z - 3.4);
  }

  enterTitle(x: number, z: number): void {
    this.mode = "title";
    this.pos.set(x - 9, 7.5, z + 13);
    this.look.set(x + 6, 3.4, z - 18);
  }

  addTrauma(a: number): void {
    this.trauma = Math.min(1, this.trauma + a);
  }
  kickFov(d: number): void {
    this.fovPulse = Math.min(10, this.fovPulse + d);
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    px: number,
    pz: number,
    aimX: number,
    aimZ: number,
    dashKicked: boolean,
  ): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.35);
    this.fovPulse *= Math.exp(-4 * dt);
    void dashKicked;

    if (this.mode === "title") {
      // slow cinematic drift past the walker toward the burning horizon
      const t = this.time * 0.06;
      this.desired.set(px - 9 + Math.sin(t) * 2.5, 7.2 + Math.sin(t * 0.7) * 0.6, pz + 13);
      this.pos.lerp(this.desired, Math.min(1, dt));
      this.desired.set(px + 7, 3.2, pz - 22);
      this.look.lerp(this.desired, Math.min(1, dt * 0.8));
      camera.position.copy(this.pos);
      camera.lookAt(this.look);
      return;
    }

    // camera anchors behind the walker but biases toward the aim point.
    // Framing targets ~21-26° pitch so the burning horizon + ridge line ride
    // the top of frame during combat (stranger-test: sky must be visible).
    // A fixed forward look-offset (-3.4) keeps the mech in the lower third and
    // leans the camera INTO the horizon when engaging distant targets.
    const biasX = (aimX - px) * 0.18;
    const biasZ = (aimZ - pz) * 0.18;
    this.desired.set(px + biasX, 10.6, pz + 16.8 + biasZ * 0.5);
    this.pos.lerp(this.desired, Math.min(1, dt * 4.5));
    this.desired.set(px + biasX * 1.4, 1.15, pz + biasZ * 1.4 - 3.4);
    this.look.lerp(this.desired, Math.min(1, dt * 7));

    camera.position.copy(this.pos);
    camera.lookAt(this.look);

    const target = 52 + this.fovPulse;
    this.fov += (target - this.fov) * Math.min(1, dt * 6);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }

    const s = this.trauma * this.trauma;
    if (s > 0.0004) {
      const t = this.time;
      const n1 = Math.sin(t * 33.7) * 0.5 + Math.sin(t * 57.3 + 1.7) * 0.5;
      const n2 = Math.sin(t * 27.1 + 4.2) * 0.5 + Math.sin(t * 49.7 + 2.1) * 0.5;
      camera.position.x += n1 * s * 0.42;
      camera.position.y += n2 * s * 0.34;
      camera.rotation.z += n1 * s * 0.045;
    }
  }
}
