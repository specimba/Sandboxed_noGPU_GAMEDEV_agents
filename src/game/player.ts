import * as THREE from 'three';
import { COLORS, GAME, PLAYER } from './constants';
import { createRimMaterial } from './shaders';
import { makeGlowSprite } from './textures';
import type { Collider } from './level';
import type { ParticlePool } from './particles';

/**
 * The wisp: momentum-based movement with hover, coyote time, jump buffering
 * and a dash. Collision = sphere vs platform AABBs (pillars are chunky hexes,
 * boxes approximate them safely).
 */

export interface PlayerEvents {
  landed: boolean;
  jumped: boolean;
  dashed: boolean;
}

export class Player {
  pos = new THREE.Vector3(0, 3, 0);
  vel = new THREE.Vector3();
  onGround = false;
  hearts = GAME.heartsMax;
  invuln = 0;

  private coyote = 0;
  private jumpBuffer = 0;
  private dashT = 0;
  private dashCd = 0;
  private dashDir = new THREE.Vector3();
  private wasFalling = false;

  readonly group = new THREE.Group();
  private core: THREE.Mesh;
  private shellMat: THREE.ShaderMaterial;
  private trailTimer = 0;

  constructor(parent: THREE.Object3D, private particles: ParticlePool) {
    this.core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.26, 1),
      new THREE.MeshBasicMaterial({ color: COLORS.player.clone().multiplyScalar(1.35) }),
    );
    this.shellMat = createRimMaterial(COLORS.player);
    this.shellMat.uniforms.uReveal.value = 1;
    this.shellMat.uniforms.uState.value = 1;
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), this.shellMat);
    const glow = makeGlowSprite(COLORS.player, 1.6);
    glow.material.fog = false;
    this.group.add(this.core, shell, glow);
    parent.add(this.group);
  }

  /** teleport back without restoring hearts (void-fall recovery, descend) */
  reposition(at: THREE.Vector3): void {
    this.pos.copy(at).add(new THREE.Vector3(0, 4, 0));
    this.vel.set(0, 0, 0);
    this.onGround = false;
    this.invuln = 1.0;
    this.dashT = 0;
    this.dashCd = 0;
  }

  /** full restore (after death, fresh level) */
  respawn(at: THREE.Vector3): void {
    this.reposition(at);
    this.hearts = GAME.heartsMax;
  }

  get dashReady(): boolean {
    return this.dashCd <= 0;
  }

  tryDash(dirX: number, dirZ: number): boolean {
    if (this.dashCd > 0 || this.dashT > 0) return false;
    this.dashDir.set(dirX, 0, dirZ);
    if (this.dashDir.lengthSq() < 0.01) this.dashDir.set(0, 0, 0);
    this.dashDir.normalize();
    this.dashT = PLAYER.dashTime;
    this.dashCd = PLAYER.dashCooldown;
    this.invuln = Math.max(this.invuln, 0.35);
    this.particles.burst(this.pos, 18, 7, { color: COLORS.player, life: 0.5, size: 0.4 });
    return true;
  }

  requestJump(): void {
    this.jumpBuffer = 0.14;
  }

  update(
    dt: number,
    input: { moveX: number; moveY: number; jumpHeld: boolean },
    camYaw: number,
    colliders: Collider[],
    out: PlayerEvents,
  ): void {
    out.landed = false;
    out.jumped = false;
    out.dashed = this.dashT > 0 && this.dashCd > PLAYER.dashCooldown - dt * 0.5;

    // camera-relative basis
    const fwdX = -Math.sin(camYaw);
    const fwdZ = -Math.cos(camYaw);
    const rightX = -fwdZ;
    const rightZ = fwdX;
    const mx = input.moveX;
    const my = input.moveY;

    this.dashCd = Math.max(0, this.dashCd - dt);
    this.invuln = Math.max(0, this.invuln - dt);

    if (this.dashT > 0) {
      // dashing overrides physics
      this.dashT -= dt;
      this.vel.copy(this.dashDir).multiplyScalar(PLAYER.dashSpeed);
      if (this.dashDir.lengthSq() < 0.01) this.vel.set(0, 0, 0);
      this.pos.addScaledVector(this.vel, dt);
    } else {
      // accelerate in input direction
      const ax = (fwdX * my + rightX * mx) * PLAYER.accel;
      const az = (fwdZ * my + rightZ * mx) * PLAYER.accel;
      this.vel.x += ax * dt;
      this.vel.z += az * dt;
      const speedSq = this.vel.x * this.vel.x + this.vel.z * this.vel.z;
      if (speedSq > PLAYER.maxSpeed * PLAYER.maxSpeed) {
        const k = PLAYER.maxSpeed / Math.sqrt(speedSq);
        this.vel.x *= k;
        this.vel.z *= k;
      }
      // friction
      const fr = this.onGround
        ? Math.max(0, 1 - PLAYER.frictionGround * dt)
        : Math.max(0, 1 - PLAYER.frictionAir * dt);
      if (mx === 0 && my === 0) {
        this.vel.x *= fr;
        this.vel.z *= fr;
      } else {
        this.vel.x *= this.onGround ? Math.max(0, 1 - 1.5 * dt) : 1;
        this.vel.z *= this.onGround ? Math.max(0, 1 - 1.5 * dt) : 1;
      }
      // gravity + hover
      this.vel.y += PLAYER.gravity * dt;
      if (input.jumpHeld && this.vel.y < PLAYER.hoverFall) {
        this.vel.y += (PLAYER.hoverFall - this.vel.y) * Math.min(1, 10 * dt);
      }
      if (this.vel.y < -28) this.vel.y = -28;

      const prevY = this.pos.y;
      this.pos.addScaledVector(this.vel, dt);

      // ground collide (top surfaces)
      const wasOnGround = this.onGround;
      this.onGround = false;
      let supportY = -Infinity;
      for (const c of colliders) {
        if (
          this.pos.x > c.x - c.hx - PLAYER.radius &&
          this.pos.x < c.x + c.hx + PLAYER.radius &&
          this.pos.z > c.z - c.hz - PLAYER.radius &&
          this.pos.z < c.z + c.hz + PLAYER.radius
        ) {
          if (prevY >= c.top - 0.05 && this.pos.y <= c.top && this.vel.y <= 0) {
            supportY = Math.max(supportY, c.top);
          }
          // side push-out when below the top
          else if (this.pos.y < c.top - 0.3) {
            const dx = this.pos.x - c.x;
            const dz = this.pos.z - c.z;
            const ox = c.hx + PLAYER.radius - Math.abs(dx);
            const oz = c.hz + PLAYER.radius - Math.abs(dz);
            if (ox > 0 && oz > 0) {
              if (ox < oz) {
                this.pos.x += Math.sign(dx || 1) * ox;
                this.vel.x = 0;
              } else {
                this.pos.z += Math.sign(dz || 1) * oz;
                this.vel.z = 0;
              }
            }
          }
        }
      }
      if (supportY > -Infinity) {
        this.pos.y = supportY;
        this.vel.y = 0;
        this.onGround = true;
        if (!wasOnGround && this.wasFalling) out.landed = true;
      }

      // coyote + jump buffer
      this.coyote = this.onGround ? 0.12 : Math.max(0, this.coyote - dt);
      this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
      if (this.jumpBuffer > 0 && (this.onGround || this.coyote > 0)) {
        this.vel.y = PLAYER.jumpVel;
        this.jumpBuffer = 0;
        this.coyote = 0;
        this.onGround = false;
        out.jumped = true;
      }
    }

    this.wasFalling = this.vel.y < -3;

    // trail
    this.trailTimer -= dt;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 4 && this.trailTimer <= 0) {
      this.trailTimer = 0.045;
      this.particles.spawn(
        this.pos,
        new THREE.Vector3(-this.vel.x * 0.12, 0.4, -this.vel.z * 0.12),
        { color: COLORS.player, life: 0.5, size: 0.34 },
      );
    }

    // visuals
    this.group.position.copy(this.pos);
    this.group.position.y += Math.sin(performance.now() * 0.002) * 0.06;
    const stretch = THREE.MathUtils.clamp(1 + Math.abs(this.vel.y) * 0.012, 1, 1.35);
    this.core.scale.set(1 / stretch, stretch, 1 / stretch);
  }

  dispose(parent: THREE.Object3D): void {
    parent.remove(this.group);
    this.core.geometry.dispose();
    (this.core.material as THREE.Material).dispose();
    this.shellMat.dispose();
  }
}
