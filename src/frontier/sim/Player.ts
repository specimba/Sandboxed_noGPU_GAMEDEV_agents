import { ARENA_RADIUS } from "@/frontier/world/Scene";

/** Walker hull state + movement physics (weighty accel, dash w/ i-frames). */
export const MAX_HP_BASE = 100;
const ACCEL = 46;
const MAX_SPEED = 10.5;
const FRICTION = 7.5;
const DASH_SPEED = 24;
const DASH_TIME = 0.17;
const DASH_CD = 1.6;
const IFRAMES = 0.32;

export class Player {
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  hp = MAX_HP_BASE;
  maxHp = MAX_HP_BASE;
  hullAngle = 0;
  dashTimer = 0; // active dash remaining
  dashCd = 0; // cooldown remaining
  iframes = 0;
  moving = false;
  dashCount = 0;
  // upgradeable stats (mutated by Upgrades)
  stats = {
    damageMul: 1,
    fireRateMul: 1,
    speedMul: 1,
    dashCdMul: 1,
    missileCount: 4,
    missileDmgMul: 1,
    lockRange: 30,
    pierce: 0,
    scoreMul: 1,
  };

  reset(): void {
    this.x = 0;
    this.z = 6;
    this.vx = 0;
    this.vz = 0;
    this.hp = this.maxHp = MAX_HP_BASE;
    this.dashTimer = 0;
    this.dashCd = 0;
    this.iframes = 0;
    this.stats = {
      damageMul: 1, fireRateMul: 1, speedMul: 1, dashCdMul: 1,
      missileCount: 4, missileDmgMul: 1, lockRange: 30,
      pierce: 0, scoreMul: 1,
    };
  }

  /** Returns true if a dash STARTED this step (for fx/audio). */
  step(dt: number, moveX: number, moveZ: number, dashHeld: boolean): boolean {
    let dashStarted = false;
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.iframes > 0) this.iframes -= dt;

    const len = Math.hypot(moveX, moveZ);
    if (len > 0.01) {
      const nx = moveX / len;
      const nz = moveZ / len;
      if (dashHeld && this.dashCd <= 0 && this.dashTimer <= 0) {
        this.dashTimer = DASH_TIME;
        this.dashCd = DASH_CD * this.stats.dashCdMul;
        this.iframes = IFRAMES;
        this.dashCount++;
        dashStarted = true;
      }
      if (this.dashTimer > 0) {
        this.dashTimer -= dt;
        this.vx = nx * DASH_SPEED * this.stats.speedMul;
        this.vz = nz * DASH_SPEED * this.stats.speedMul;
      } else {
        this.vx += nx * ACCEL * this.stats.speedMul * dt;
        this.vz += nz * ACCEL * this.stats.speedMul * dt;
      }
      this.moving = true;
    } else {
      this.moving = false;
    }

    // friction + clamp to max speed (dash overrides)
    if (this.dashTimer <= 0) {
      const f = Math.exp(-FRICTION * dt);
      this.vx *= f;
      this.vz *= f;
      const sp = Math.hypot(this.vx, this.vz);
      const cap = MAX_SPEED * this.stats.speedMul;
      if (sp > cap) {
        this.vx *= cap / sp;
        this.vz *= cap / sp;
      }
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // arena clamp (slide along the berm)
    const r = Math.hypot(this.x, this.z);
    const lim = ARENA_RADIUS - 1.6;
    if (r > lim) {
      this.x *= lim / r;
      this.z *= lim / r;
      this.vx *= 0.4;
      this.vz *= 0.4;
    }

    // hull faces move dir (lerped in Walker visuals)
    if (len > 0.01 && this.dashTimer <= 0) {
      this.hullAngle = Math.atan2(this.vx, this.vz) + Math.PI;
    }
    return dashStarted;
  }

  damage(n: number): boolean {
    if (this.iframes > 0) return false;
    this.hp -= n;
    this.iframes = 0.25;
    return true;
  }
}
