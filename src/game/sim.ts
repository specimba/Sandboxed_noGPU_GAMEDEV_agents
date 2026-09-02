import {
  ARENA,
  FOE,
  OVERDRIVE,
  PLAYER,
  SCORE,
  SHARD,
  WAVES,
} from './constants';

/**
 * HOLLOW SUN simulation — pure 2D math, zero rendering imports.
 * The ember, the ricocheting shards of light, the foes, the waves,
 * Overdrive and the score→sun feedback all live here.
 */

export type FoeKind = 'drifter' | 'striker' | 'weaver' | 'warden';
export type ShardState = 'orbit' | 'fly' | 'chain' | 'return';

export interface SimEvents {
  onThrow(x: number, z: number): void;
  onBounce(x: number, z: number, bounceIndex: number): void;
  onCatch(x: number, z: number): void;
  onKill(kind: FoeKind, x: number, z: number): void;
  onGraze(x: number, z: number): void;
  onHurt(x: number, z: number): void;
  onDash(x: number, z: number): void;
  onWardenSpawn(x: number, z: number): void;
  onWardenDie(x: number, z: number): void;
  onWaveStart(n: number): void;
  onWaveClear(n: number): void;
  onOverdriveStart(): void;
  onShardGain(): void;
  onDeath(): void;
  onSpawnMark(x: number, z: number): void;
}

interface Shard {
  state: ShardState;
  x: number;
  z: number;
  vx: number;
  vz: number;
  orbitAngle: number;
  targetId: number; // foe id while fly/chain (-1 none)
  bounces: number;
  flown: number; // straight-flight distance, forces the return leg
  hitCd: Map<number, number>;
}

interface Foe {
  id: number;
  kind: FoeKind;
  x: number;
  z: number;
  vx: number;
  vz: number;
  hp: number;
  maxHp: number;
  r: number;
  spawnT: number; // fade-in, harmless while > 0
  state: number; // kind-specific FSM
  timer: number;
  tx: number; // striker locked dash target
  tz: number;
  dx: number; // striker dash dir
  dz: number;
  burstLeft: number; // weaver burst queue
  burstT: number;
  patternAngle: number; // warden radial offset
}

interface Bullet {
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  grazed: boolean;
}

export interface SpawnMark {
  x: number;
  z: number;
  t: number;
  kind: FoeKind;
}

const TAU = Math.PI * 2;

function clampArena(x: number, z: number, pad: number): { x: number; z: number } {
  const d = Math.hypot(x, z);
  const max = ARENA.radius - pad;
  if (d <= max || d === 0) return { x, z };
  const s = max / d;
  return { x: x * s, z: z * s };
}

export class Sim {
  readonly events: SimEvents;

  // ember
  px = 0;
  pz = 0;
  pvx = 0;
  pvz = 0;
  embers = PLAYER.embers;
  invuln = 0;
  dashT = 0;
  dashCd = 0;
  dashDx = 0;
  dashDz = 0;

  // shards
  shards: Shard[] = [];
  throwCd = 0;

  // foes & bullets
  foes: Foe[] = [];
  bullets: Bullet[] = [];
  marks: SpawnMark[] = [];
  private nextId = 1;

  // waves
  wave = 0;
  private waveState: 'idle' | 'active' | 'intermission' = 'idle';
  private intermissionT = 0;
  private spawnQueue: FoeKind[] = [];
  private spawnT = 0;
  wardensKilled = 0;

  // score & chain
  score = 0;
  chain = 0;
  chainT = 0;

  // overdrive
  odCharge = 0;
  odActive = false;
  odT = 0;

  time = 0;
  over = false;

  constructor(events: SimEvents) {
    this.events = events;
    this.reset();
  }

  reset(): void {
    this.px = 0;
    this.pz = 12;
    this.pvx = 0;
    this.pvz = 0;
    this.embers = PLAYER.embers;
    this.invuln = 1;
    this.dashT = 0;
    this.dashCd = 0;
    this.shards = [];
    for (let i = 0; i < SHARD.startCount; i++) this.addShard();
    this.throwCd = 0;
    this.foes = [];
    this.bullets = [];
    this.marks = [];
    this.wave = 0;
    this.waveState = 'intermission';
    this.intermissionT = 1.6;
    this.spawnQueue = [];
    this.spawnT = 0;
    this.wardensKilled = 0;
    this.score = 0;
    this.chain = 0;
    this.chainT = 0;
    this.odCharge = 0;
    this.odActive = false;
    this.odT = 0;
    this.time = 0;
    this.over = false;
  }

  addShard(): void {
    this.shards.push({
      state: 'orbit',
      x: this.px,
      z: this.pz,
      vx: 0,
      vz: 0,
      orbitAngle: (this.shards.length / Math.max(1, SHARD.startCount)) * TAU,
      targetId: -1,
      bounces: 0,
      flown: 0,
      hitCd: new Map(),
    });
  }

  get shardCount(): number {
    return this.shards.length;
  }

  get mult(): number {
    return 1 + Math.min(9, this.chain) * SCORE.multPerBounce;
  }

  get enemiesLeft(): number {
    return this.spawnQueue.length + this.marks.length + this.foes.length;
  }

  get waveActive(): boolean {
    return this.waveState === 'active';
  }

  /** advance the simulation; enemyDt already carries the Overdrive time scale */
  update(dt: number, enemyDt: number, moveX: number, moveY: number, aimX: number, aimZ: number, wantThrow: boolean, wantDash: boolean): void {
    if (this.over) return;
    this.time += dt;

    this.updatePlayer(dt, moveX, moveY, wantDash);
    this.updateShards(dt);

    // foes & bullets live on enemy time (slowed by Overdrive)
    this.updateFoes(enemyDt);
    this.updateBullets(enemyDt);
    this.updateMarks(enemyDt);
    this.updateWave(dt);

    // chain decay
    if (this.chain > 0) {
      this.chainT -= dt;
      if (this.chainT <= 0) this.chain = 0;
    }

    // overdrive duration
    if (this.odActive) {
      this.odT -= dt;
      if (this.odT <= 0) this.odActive = false;
    }

    if (wantThrow) this.tryThrow(aimX, aimZ);
    this.throwCd = Math.max(0, this.throwCd - dt);
  }

  /* ------------------------------------------------------------------ */
  /* ember                                                               */
  /* ------------------------------------------------------------------ */

  private updatePlayer(dt: number, moveX: number, moveY: number, wantDash: boolean): void {
    this.invuln = Math.max(0, this.invuln - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);

    if (wantDash && this.dashCd <= 0 && this.dashT <= 0) {
      let dx = moveX;
      let dz = -moveY;
      const len = Math.hypot(dx, dz);
      if (len < 0.2) {
        // dash along current heading, or aim facing if idle
        dx = this.pvx;
        dz = this.pvz;
        const l2 = Math.hypot(dx, dz);
        if (l2 < 0.5) {
          dx = 0;
          dz = -1;
        } else {
          dx /= l2;
          dz /= l2;
        }
      } else {
        dx /= len;
        dz /= len;
      }
      this.dashDx = dx;
      this.dashDz = dz;
      this.dashT = PLAYER.dashTime;
      this.dashCd = PLAYER.dashCooldown;
      this.events.onDash(this.px, this.pz);
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.pvx = this.dashDx * PLAYER.dashSpeed;
      this.pvz = this.dashDz * PLAYER.dashSpeed;
    } else {
      const ax = moveX * PLAYER.accel;
      const az = -moveY * PLAYER.accel;
      this.pvx += (ax - PLAYER.drag * this.pvx) * dt;
      this.pvz += (az - PLAYER.drag * this.pvz) * dt;
    }

    this.px += this.pvx * dt;
    this.pz += this.pvz * dt;
    const c = clampArena(this.px, this.pz, PLAYER.radius);
    this.px = c.x;
    this.pz = c.z;
  }

  private hurt(): void {
    if (this.invuln > 0 || this.dashT > 0 || this.over) return;
    this.embers -= 1;
    this.invuln = PLAYER.invulnTime;
    this.chain = 0;
    this.events.onHurt(this.px, this.pz);
    if (this.embers <= 0) {
      this.over = true;
      this.events.onDeath();
    }
  }

  /* ------------------------------------------------------------------ */
  /* shards of light                                                     */
  /* ------------------------------------------------------------------ */

  private tryThrow(aimX: number, aimZ: number): void {
    if (this.throwCd > 0) return;
    let launched = false;
    for (const s of this.shards) {
      if (s.state !== 'orbit') continue;
      launched = true;
      // slight fan so simultaneous shards don't stack
      const ang = Math.atan2(aimX - this.px, aimZ - this.pz) + (Math.random() - 0.5) * 0.24;
      const dirX = Math.sin(ang);
      const dirZ = Math.cos(ang);
      s.x = this.px + dirX * 1.2;
      s.z = this.pz + dirZ * 1.2;
      s.bounces = 0;
      s.hitCd.clear();

      // aim magnetism: snap to a foe near the aim point
      let best: Foe | null = null;
      let bestD = SHARD.aimMagnet;
      for (const f of this.foes) {
        if (f.spawnT > 0) continue;
        const d = Math.hypot(f.x - aimX, f.z - aimZ);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      if (best) {
        s.state = 'fly';
        s.targetId = best.id;
      } else {
        s.state = 'fly';
        s.targetId = -1;
        s.vx = dirX * SHARD.speed;
        s.vz = dirZ * SHARD.speed;
      }
    }
    if (launched) {
      this.throwCd = SHARD.throwCooldown;
      this.events.onThrow(this.px, this.pz);
    }
  }

  private foeById(id: number): Foe | null {
    for (const f of this.foes) if (f.id === id) return f;
    return null;
  }

  private updateShards(dt: number): void {
    for (const s of this.shards) {
      // per-enemy re-hit cooldowns tick on enemy time so slowed foes don't farm hits
      for (const [k, v] of s.hitCd) {
        const nv = v - dt;
        if (nv <= 0) s.hitCd.delete(k);
        else s.hitCd.set(k, nv);
      }

      if (s.state === 'orbit') {
        s.orbitAngle += dt * 2.9;
        const orbitR = 1.7 + this.shards.length * 0.06;
        s.x = this.px + Math.sin(s.orbitAngle) * orbitR;
        s.z = this.pz + Math.cos(s.orbitAngle) * orbitR;
        s.vx = 0;
        s.vz = 0;
        continue;
      }

      if (s.state === 'return') {
        const dx = this.px - s.x;
        const dz = this.pz - s.z;
        const d = Math.hypot(dx, dz);
        if (d < SHARD.catchRadius) {
          s.state = 'orbit';
          this.events.onCatch(s.x, s.z);
          this.addOverdrive(OVERDRIVE.catchCharge);
          continue;
        }
        const want = Math.atan2(dx, dz);
        this.steer(s, want, dt);
        s.x += s.vx * dt;
        s.z += s.vz * dt;
        continue;
      }

      // fly / chain: seek target or keep heading; hit anything touched
      let target: Foe | null = null;
      if (s.targetId >= 0) target = this.foeById(s.targetId);
      if (target && target.spawnT > 0) target = null;

      if (target) {
        const want = Math.atan2(target.x - s.x, target.z - s.z);
        this.steer(s, want, dt);
      } else if (s.targetId < 0) {
        // straight flight: after enough distance with nothing hit, arc home
        s.flown += SHARD.speed * dt;
        if (s.flown > 46) {
          s.state = 'return';
          continue;
        }
      }
      s.x += s.vx * dt;
      s.z += s.vz * dt;

      // wall bounce — light reflects inward
      const dCenter = Math.hypot(s.x, s.z);
      if (dCenter > ARENA.radius - 0.4) {
        const nx = s.x / dCenter;
        const nz = s.z / dCenter;
        const dot = s.vx * nx + s.vz * nz;
        s.vx -= 2 * dot * nx;
        s.vz -= 2 * dot * nz;
        const max = ARENA.radius - 0.4;
        s.x = nx * max;
        s.z = nz * max;
        if (s.state === 'fly' && s.targetId < 0) s.state = 'return';
      }

      // catch while passing the ember
      const pd = Math.hypot(this.px - s.x, this.pz - s.z);
      if (s.state === 'return' && pd < SHARD.catchRadius) {
        s.state = 'orbit';
        this.events.onCatch(s.x, s.z);
        this.addOverdrive(OVERDRIVE.catchCharge);
        continue;
      }
      if (pd < SHARD.catchRadius * 0.7 && s.bounces > SHARD.maxBounces) {
        s.state = 'orbit';
        this.events.onCatch(s.x, s.z);
        continue;
      }

      // contact with foes
      const dmg = SHARD.damage * (this.odActive ? OVERDRIVE.damageMult : 1);
      for (const f of this.foes) {
        if (f.spawnT > 0) continue;
        if ((s.hitCd.get(f.id) ?? 0) > 0) continue;
        const dd = Math.hypot(f.x - s.x, f.z - s.z);
        if (dd < f.r + 0.55) {
          s.hitCd.set(f.id, SHARD.hitCooldown);
          const killed = this.damageFoe(f, dmg);
          if (killed) continue;
          // ricochet to the next foe
          s.bounces += 1;
          if (s.bounces <= SHARD.maxBounces) {
            this.chain += 1;
            this.chainT = SCORE.multDecay;
            const next = this.findChainTarget(f, s);
            this.events.onBounce(f.x, f.z, this.chain);
            if (next) {
              s.targetId = next.id;
              s.state = 'chain';
            } else {
              s.state = 'return';
              s.targetId = -1;
            }
          } else {
            s.state = 'return';
            s.targetId = -1;
          }
        }
      }
    }
  }

  private steer(s: Shard, wantAngle: number, dt: number): void {
    const cur = Math.atan2(s.vx, s.vz);
    let delta = wantAngle - cur;
    while (delta > Math.PI) delta -= TAU;
    while (delta < -Math.PI) delta += TAU;
    const maxTurn = SHARD.turnRate * dt;
    const ang = cur + Math.max(-maxTurn, Math.min(maxTurn, delta));
    s.vx = Math.sin(ang) * SHARD.speed;
    s.vz = Math.cos(ang) * SHARD.speed;
  }

  private findChainTarget(from: Foe, s: Shard): Foe | null {
    let best: Foe | null = null;
    let bestD = SHARD.chainRadius;
    for (const f of this.foes) {
      if (f.id === from.id || f.spawnT > 0) continue;
      const d = Math.hypot(f.x - from.x, f.z - from.z);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    void s;
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* foes                                                                */
  /* ------------------------------------------------------------------ */

  private damageFoe(f: Foe, dmg: number): boolean {
    f.hp -= dmg;
    if (f.hp > 0) return false;
    // score
    const base =
      f.kind === 'drifter' ? SCORE.drifter : f.kind === 'striker' ? SCORE.striker : f.kind === 'weaver' ? SCORE.weaver : WAVES.wardenScore;
    this.score += Math.round((base * this.mult) / 5) * 5;
    this.addOverdrive(OVERDRIVE.killCharge);
    if (f.kind === 'warden') {
      this.wardensKilled += 1;
      this.events.onWardenDie(f.x, f.z);
      if (this.shardCount < SHARD.maxCount) {
        this.addShard();
        this.events.onShardGain();
      }
    }
    this.events.onKill(f.kind, f.x, f.z);
    this.removeFoe(f);
    return true;
  }

  private removeFoe(f: Foe): void {
    const i = this.foes.indexOf(f);
    if (i >= 0) this.foes.splice(i, 1);
  }

  private spawnFoe(kind: FoeKind, x: number, z: number): void {
    const id = this.nextId++;
    let hp = 2;
    let r = 0.8;
    if (kind === 'striker') {
      hp = 2;
      r = 0.7;
    } else if (kind === 'weaver') {
      hp = 3;
      r = 0.9;
    } else if (kind === 'warden') {
      hp = WAVES.wardenHpBase + WAVES.wardenHpPerKill * this.wardensKilled;
      r = 2.2;
    }
    this.foes.push({
      id,
      kind,
      x,
      z,
      vx: 0,
      vz: 0,
      hp,
      maxHp: hp,
      r,
      spawnT: kind === 'warden' ? 1.4 : 0.45,
      state: 0,
      timer: 0,
      tx: 0,
      tz: 0,
      dx: 0,
      dz: 0,
      burstLeft: 0,
      burstT: 0,
      patternAngle: Math.random() * TAU,
    });
    if (kind === 'warden') this.events.onWardenSpawn(x, z);
  }

  private updateFoes(dt: number): void {
    const spdScale = Math.min(1.6, 1 + this.wave * 0.03);
    for (const f of this.foes) {
      if (f.spawnT > 0) {
        f.spawnT -= dt;
        continue;
      }
      const pdx = this.px - f.x;
      const pdz = this.pz - f.z;
      const pd = Math.hypot(pdx, pdz) || 1;

      switch (f.kind) {
        case 'drifter': {
          const sp = 4.3 * spdScale;
          f.vx += ((pdx / pd) * sp - f.vx) * Math.min(1, dt * 2.2);
          f.vz += ((pdz / pd) * sp - f.vz) * Math.min(1, dt * 2.2);
          break;
        }
        case 'striker': {
          if (f.state === 0) {
            // seek
            const sp = 6 * spdScale;
            f.vx += ((pdx / pd) * sp - f.vx) * Math.min(1, dt * 2.5);
            f.vz += ((pdz / pd) * sp - f.vz) * Math.min(1, dt * 2.5);
            if (pd < 15) {
              f.state = 1;
              f.timer = 0.55;
            }
          } else if (f.state === 1) {
            // telegraph — lock target at the end
            f.vx *= Math.max(0, 1 - dt * 8);
            f.vz *= Math.max(0, 1 - dt * 8);
            f.timer -= dt;
            f.tx = this.px;
            f.tz = this.pz;
            if (f.timer <= 0) {
              const ddx = f.tx - f.x;
              const ddz = f.tz - f.z;
              const dl = Math.hypot(ddx, ddz) || 1;
              f.dx = ddx / dl;
              f.dz = ddz / dl;
              f.state = 2;
              f.timer = 0.55;
            }
          } else if (f.state === 2) {
            // dash
            f.vx = f.dx * 27;
            f.vz = f.dz * 27;
            f.timer -= dt;
            if (f.timer <= 0) {
              f.state = 3;
              f.timer = 0.9;
            }
          } else {
            f.vx *= Math.max(0, 1 - dt * 6);
            f.vz *= Math.max(0, 1 - dt * 6);
            f.timer -= dt;
            if (f.timer <= 0) f.state = 0;
          }
          break;
        }
        case 'weaver': {
          // hold the 15..21 band, strafe clockwise
          const tangX = -pdz / pd;
          const tangZ = pdx / pd;
          const radial = pd > 21 ? -0.8 : pd < 15 ? 0.8 : 0;
          const wantVx = tangX * 5 * spdScale + (pdx / pd) * radial * 5;
          const wantVz = tangZ * 5 * spdScale + (pdz / pd) * radial * 5;
          f.vx += (wantVx - f.vx) * Math.min(1, dt * 2.4);
          f.vz += (wantVz - f.vz) * Math.min(1, dt * 2.4);
          if (f.burstLeft > 0) {
            f.burstT -= dt;
            if (f.burstT <= 0) {
              f.burstLeft -= 1;
              f.burstT = 0.13;
              this.fireAt(f, (Math.random() - 0.5) * 0.18);
            }
          } else {
            f.timer -= dt;
            if (f.timer <= 0) {
              f.timer = 2.7;
              f.burstLeft = 3;
              f.burstT = 0.01;
            }
          }
          break;
        }
        case 'warden': {
          // slow menacing drift toward the ember
          f.vx += ((pdx / pd) * 1.7 - f.vx) * Math.min(1, dt * 1.2);
          f.vz += ((pdz / pd) * 1.7 - f.vz) * Math.min(1, dt * 1.2);
          f.timer -= dt;
          if (f.timer <= 0) {
            f.timer = 2.6;
            f.patternAngle += 0.37;
            const n = 14;
            for (let i = 0; i < n; i++) {
              const a = (i / n) * TAU + f.patternAngle;
              this.bullets.push({
                x: f.x + Math.sin(a) * f.r,
                z: f.z + Math.cos(a) * f.r,
                vx: Math.sin(a) * 8.5,
                vz: Math.cos(a) * 8.5,
                life: FOE.bulletLife,
                grazed: false,
              });
            }
          }
          break;
        }
      }

      f.x += f.vx * dt;
      f.z += f.vz * dt;

      // soft separation so foes don't stack
      for (const o of this.foes) {
        if (o === f || o.spawnT > 0) continue;
        const ox = f.x - o.x;
        const oz = f.z - o.z;
        const od = Math.hypot(ox, oz);
        const minD = f.r + o.r;
        if (od > 0.001 && od < minD) {
          const push = ((minD - od) / minD) * 6 * dt;
          f.x += (ox / od) * push * 6;
          f.z += (oz / od) * push * 6;
        }
      }

      const c = clampArena(f.x, f.z, f.r);
      f.x = c.x;
      f.z = c.z;

      // contact damage
      if (pd < f.r + FOE.contactRadius) this.hurt();
    }
  }

  private fireAt(f: Foe, spread: number): void {
    const a = Math.atan2(this.px - f.x, this.pz - f.z) + spread;
    this.bullets.push({
      x: f.x + Math.sin(a) * f.r,
      z: f.z + Math.cos(a) * f.r,
      vx: Math.sin(a) * FOE.bulletSpeed,
      vz: Math.cos(a) * FOE.bulletSpeed,
      life: FOE.bulletLife,
      grazed: false,
    });
  }

  private updateBullets(dt: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      const dx = this.px - b.x;
      const dz = this.pz - b.z;
      const d = Math.hypot(dx, dz);
      if (d < PLAYER.radius + FOE.bulletRadius) {
        if (this.invuln <= 0 && this.dashT <= 0) {
          this.hurt();
          this.bullets.splice(i, 1);
          continue;
        }
      } else if (!b.grazed && d < PLAYER.grazeRadius + FOE.bulletRadius) {
        b.grazed = true;
        this.addOverdrive(OVERDRIVE.grazeCharge);
        this.score += SCORE.graze;
        this.events.onGraze(b.x, b.z);
      }
      if (b.life <= 0 || Math.hypot(b.x, b.z) > ARENA.radius + 1.5) {
        this.bullets.splice(i, 1);
        continue;
      }
    }
  }

  private updateMarks(dt: number): void {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.t -= dt;
      if (m.t <= 0) {
        this.marks.splice(i, 1);
        this.spawnFoe(m.kind, m.x, m.z);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* waves                                                               */
  /* ------------------------------------------------------------------ */

  private buildWaveQueue(n: number): FoeKind[] {
    const isWarden = n % WAVES.wardenEvery === 0;
    let points = Math.round(WAVES.budgetBase + WAVES.budgetPerWave * n) * (isWarden ? 0.5 : 1);
    const q: FoeKind[] = [];
    while (points >= 1) {
      const roll = Math.random();
      if (n >= 3 && roll < 0.24 && points >= 3) {
        q.push('weaver');
        points -= 3;
      } else if (n >= 2 && roll < 0.52 && points >= 2) {
        q.push('striker');
        points -= 2;
      } else {
        q.push('drifter');
        points -= 1;
      }
    }
    // deterministic floor so late waves always escalate
    if (n >= 3 && !q.includes('weaver')) q.push('weaver');
    if (n >= 2 && !q.includes('striker')) q.push('striker');
    if (isWarden) q.push('warden');
    // shuffle the fodder but keep the warden mid-queue
    for (let i = q.length - 1; i > 0; i--) {
      if (q[i] === 'warden') continue;
      const j = Math.floor(Math.random() * (i + 1));
      if (q[j] === 'warden') continue;
      [q[i], q[j]] = [q[i], q[j]];
    }
    return q;
  }

  private startWave(n: number): void {
    this.wave = n;
    this.waveState = 'active';
    this.spawnQueue = this.buildWaveQueue(n);
    this.spawnT = 0.4;
    this.events.onWaveStart(n);
  }

  private updateWave(dt: number): void {
    if (this.waveState === 'intermission') {
      this.intermissionT -= dt;
      if (this.intermissionT <= 0) this.startWave(this.wave + 1);
      return;
    }
    if (this.spawnQueue.length > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        const interval = Math.max(WAVES.spawnIntervalMin, WAVES.spawnIntervalBase - WAVES.spawnIntervalPerWave * this.wave);
        this.spawnT = interval * (0.7 + Math.random() * 0.6);
        const batch = Math.min(this.spawnQueue.length, 1 + (this.wave > 4 && Math.random() < 0.4 ? 1 : 0));
        for (let i = 0; i < batch; i++) {
          const kind = this.spawnQueue.shift();
          if (!kind) break;
          // spawn on the rim away from the ember
          let x = 0;
          let z = 0;
          for (let tries = 0; tries < 8; tries++) {
            const a = Math.random() * TAU;
            const r = ARENA.radius - 2.5;
            x = Math.sin(a) * r;
            z = Math.cos(a) * r;
            if (Math.hypot(x - this.px, z - this.pz) > 14) break;
          }
          this.marks.push({ x, z, t: kind === 'warden' ? 1.5 : 0.9, kind });
          this.events.onSpawnMark(x, z);
        }
      }
    } else if (this.marks.length === 0 && this.foes.length === 0) {
      this.waveState = 'intermission';
      this.intermissionT = WAVES.intermission;
      this.events.onWaveClear(this.wave);
    }
  }

  /* ------------------------------------------------------------------ */
  /* overdrive                                                           */
  /* ------------------------------------------------------------------ */

  addOverdrive(v: number): void {
    if (this.odActive) {
      if (v >= OVERDRIVE.grazeCharge) this.odT += OVERDRIVE.extendPerGraze;
      return;
    }
    this.odCharge = Math.min(OVERDRIVE.max, this.odCharge + v);
    if (this.odCharge >= OVERDRIVE.max) {
      this.odCharge = 0;
      this.odActive = true;
      this.odT = OVERDRIVE.duration;
      this.events.onOverdriveStart();
    }
  }
}
