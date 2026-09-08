import {
  ARENA,
  BURN,
  FOE,
  HEX,
  HOUND,
  OVERDRIVE,
  PLAYER,
  RUN,
  SCORE,
  SHARD,
  SPARK,
  WAVES,
  type Elite,
} from './constants';
import { mulberry32, type Rng } from './rng';
import {
  baseMods,
  bossHp,
  bossScore,
  defaultRoomMods,
  eliteChance,
  isBossRoom,
  rollMutator,
  roomBudget,
  type BoonDef,
  type Mods,
  type RoomMutator,
} from './run';

/**
 * HOLLOW SUN simulation — pure 2D math, zero rendering imports.
 * The ember, the ricocheting shards of light, the foes, the waves,
 * Overdrive and the score→sun feedback all live here.
 */

export type FoeKind = 'drifter' | 'striker' | 'weaver' | 'caster' | 'bulwark' | 'hound' | 'warden';
export type ShardState = 'orbit' | 'fly' | 'chain' | 'return';

export interface SimEvents {
  onThrow(x: number, z: number): void;
  onBounce(x: number, z: number, bounceIndex: number): void;
  onCatch(x: number, z: number): void;
  onKill(kind: FoeKind, x: number, z: number): void;
  /** optional pure-notify hook (view sugar): a foe SURVIVED a hit — kills speak
   *  through onKill. No rng consumed, run digests unchanged. */
  onFoeHurt?(kind: FoeKind, x: number, z: number, dmg: number, chain: boolean): void;
  /** optional pure-notify: a burn beat consumed a foe's stacks for dmg */
  onBurnTick?(x: number, z: number, dmg: number, stacksLeft: number): void;
  /** optional pure-notify: death-light arced from (fx,fz) to (tx,tz) for dmg */
  onSpark?(fx: number, fz: number, tx: number, tz: number, dmg: number): void;
  onGraze(x: number, z: number): void;
  onHurt(x: number, z: number): void;
  onDash(x: number, z: number): void;
  onRecall(x: number, z: number): void;
  onShieldBreak(x: number, z: number): void;
  onBlock(x: number, z: number): void;
  onHeavyShot(x: number, z: number, tx?: number, tz?: number): void;
  /** optional pure-notify: weaver anchored a hex zone at (x,z), t s to detonation.
   *  No rng consumed, run digests unchanged — same law as onFoeHurt. */
  onHexAnchor?(x: number, z: number, t: number): void;
  /** optional pure-notify: a hex zone detonated; hit = the ember was caught */
  onHexDetonate?(x: number, z: number, hit: boolean): void;
  /** optional pure-notify: the ember is ROOTED for dur s (movement zeroed) */
  onPlayerRoot?(x: number, z: number, dur: number): void;
  onBossPhase(x: number, z: number, phase: number): void;
  onRevive(x: number, z: number): void;
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
  boost: number; // recall speed boost timer
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
  elite: Elite;
  shieldUp: boolean;
  boss: boolean;
  spawnT: number; // fade-in, harmless while > 0
  state: number; // kind-specific FSM; boss = phase 1..3
  timer: number;
  tx: number; // striker locked dash target; boss = escort-spawned flag
  tz: number;
  dx: number; // striker dash dir
  dz: number;
  burstLeft: number; // weaver burst queue
  burstT: number;
  hexCd: number; // weaver hex-zone cooldown (enemy time)
  patternAngle: number; // warden radial offset
  face: number; // bulwark armor facing
  burn: number; // EMBER ROT stacks
  burnT: number; // seconds to next burn beat
}

interface Bullet {
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  grazed: boolean;
  heavy: boolean; // caster shots: bigger, faster, dodge me
}

export interface SpawnMark {
  x: number;
  z: number;
  t: number;
  kind: FoeKind;
}

/** HEX LOOM zone — a named patch of floor; detonates when t expires.
 *  Rendered by the view's own pipe (parallel to marks: a zone is not a foe
 *  spawn and must never count into enemiesLeft). */
export interface HexZone {
  x: number;
  z: number;
  t: number; // seconds to detonation (enemy time)
  weaverId: number;
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
  /** every build modifier (meta + boons) lives here */
  mods: Mods;

  // run context (drives budgets, elites, boss stats)
  biome = 0;
  room = 1;

  // ember
  px = 0;
  pz = 0;
  pvx = 0;
  pvz = 0;
  embers = 3;
  maxEmbers = 3;
  invuln = 0;
  dashT = 0;
  dashCd = 0;
  dashDx = 0;
  dashDz = 0;
  reviveUsed = false;

  // shards
  shards: Shard[] = [];
  throwCd = 0;
  private dashHit = new Set<number>();

  // foes & bullets
  foes: Foe[] = [];
  bullets: Bullet[] = [];
  marks: SpawnMark[] = [];
  hexes: HexZone[] = [];
  /** player crowd control — ROOTED: movement zeroed, dash blocked, throwing
   *  free. Ticks on PLAYER time. Public: the engine watchdog enforces the
   *  failsafe law (never locked > CC.max × factor). */
  pRootT = 0;
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

  // seeded run
  seed = 0;
  rng: Rng = Math.random;
  mutator: RoomMutator = { id: '', name: '', desc: '', mods: defaultRoomMods() };

  constructor(events: SimEvents, mods?: Partial<Mods>) {
    this.events = events;
    this.mods = { ...baseMods(), ...mods };
    this.reset();
  }

  /** every run of the same seed descends the same star */
  setSeed(seed: number): void {
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
  }

  reset(): void {
    this.px = 0;
    this.pz = 12;
    this.pvx = 0;
    this.pvz = 0;
    this.maxEmbers = this.mods.maxEmbers;
    this.embers = this.mods.maxEmbers;
    this.invuln = 1;
    this.dashT = 0;
    this.dashCd = 0;
    this.reviveUsed = false;
    this.dashHit.clear();
    this.biome = 0;
    this.room = 1;
    this.shards = [];
    for (let i = 0; i < SHARD.startCount + this.mods.startShards; i++) this.addShard();
    this.throwCd = 0;
    this.foes = [];
    this.bullets = [];
    this.marks = [];
    this.hexes = [];
    this.pRootT = 0;
    this.wave = 1;
    this.waveState = 'idle';
    this.intermissionT = 0;
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
    this.mutator = { id: '', name: '', desc: '', mods: defaultRoomMods() };
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
      boost: 0,
      hitCd: new Map(),
    });
  }

  /* ---------------------------------------------------------------- */
  /* run rooms                                                        */
  /* ---------------------------------------------------------------- */

  /** begin a specific run room (combat 1-2, boss = roomsPerBiome) */
  startRoom(biome: number, room: number): void {
    this.biome = biome;
    this.room = room;
    this.foes.length = 0;
    this.bullets.length = 0;
    this.marks.length = 0;
    this.hexes.length = 0;
    this.pRootT = 0;
    this.spawnQueue.length = 0;
    this.invuln = Math.max(this.invuln, 0.8);
    this.wave = biome * RUN.roomsPerBiome + room;
    // room weather — deterministic per seed
    this.mutator = rollMutator(this.rng, this.wave);
    this.waveState = 'active';
    this.spawnT = 0.5;
    if (isBossRoom(room)) {
      // boss + small escort fodder
      const escort: FoeKind[] = biome === 0 ? ['drifter', 'drifter'] : biome === 1 ? ['drifter', 'striker'] : ['caster', 'drifter'];
      this.spawnQueue = escort;
      this.marks.push({ x: this.px + 10, z: this.pz, t: 1.6, kind: 'warden' });
      this.events.onWaveStart(this.wave);
    } else {
      const budget = Math.round(roomBudget(biome, room) * (1 + this.mutator.mods.budget));
      this.spawnQueue = this.buildWaveQueue(this.wave, budget);
      this.events.onWaveStart(this.wave);
    }
    if (this.mutator.mods.glassRain) {
      // the room opens under a collapsing ring of glass — banner buys you the read
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + this.rng() * 0.2;
        const r = 25;
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        const d = Math.hypot(x, z) || 1;
        this.bullets.push({ x, z, vx: (-x / d) * 8.5, vz: (-z / d) * 8.5, life: 6, grazed: false, heavy: false });
      }
    }
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

  /* ---- modded tuning getters ---- */

  private get shardSpeed(): number {
    return SHARD.speed * this.mods.shardSpeed * this.mutator.mods.shardSpeed;
  }
  private get maxBounces(): number {
    return SHARD.maxBounces + this.mods.bounces;
  }
  private get grazeR(): number {
    return PLAYER.grazeRadius * this.mods.graze;
  }
  private get odDuration(): number {
    return OVERDRIVE.duration + this.mods.odDuration;
  }

  /** advance the simulation; enemyDt already carries the Overdrive time scale */
  update(dt: number, enemyDt: number, moveX: number, moveY: number, aimX: number, aimZ: number, wantThrow: boolean, wantDash: boolean): void {
    if (this.over) return;
    this.time += dt;

    this.updatePlayer(dt, moveX, moveY, wantDash);
    this.updateShards(dt);

    // the root binds the PLAYER — it ticks on player time
    this.pRootT = Math.max(0, this.pRootT - dt);

    // foes & bullets live on enemy time (slowed by Overdrive)
    this.updateFoes(enemyDt);
    this.updateBullets(enemyDt);
    this.updateMarks(enemyDt);
    this.updateHexes(enemyDt);
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

    // ROOTED: an in-flight dash dies the frame the bind lands; no new dash
    if (this.pRootT > 0) this.dashT = 0;

    if (wantDash && this.dashCd <= 0 && this.dashT <= 0 && this.pRootT <= 0) {
      // dash-recall: airborne shards whip home at 1.5× speed
      let recalled = false;
      for (const s of this.shards) {
        if (s.state !== 'orbit') {
          s.state = 'return';
          s.targetId = -1;
          s.boost = 1;
          recalled = true;
        }
      }
      if (recalled) this.events.onRecall(this.px, this.pz);
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
      this.dashCd = PLAYER.dashCooldown * this.mods.dashCd;
      this.dashHit.clear();
      this.events.onDash(this.px, this.pz);
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.pvx = this.dashDx * PLAYER.dashSpeed;
      this.pvz = this.dashDz * PLAYER.dashSpeed;
    } else if (this.pRootT > 0) {
      // ROOTED: input is ignored, velocity hard-decays under the bind —
      // throwing stays free (the counterplay ladder keeps a weapon in hand)
      const drag = Math.max(0, 1 - dt * 12);
      this.pvx *= drag;
      this.pvz *= drag;
    } else {
      const spd = this.mods.speed;
      const ax = moveX * PLAYER.accel * spd;
      const az = -moveY * PLAYER.accel * spd;
      this.pvx += (ax - PLAYER.drag * this.pvx) * dt;
      this.pvz += (az - PLAYER.drag * this.pvz) * dt;
    }

    this.px += this.pvx * dt;
    this.pz += this.pvz * dt;
    const c = clampArena(this.px, this.pz, PLAYER.radius);
    this.px = c.x;
    this.pz = c.z;

    // dash strike: dashing through a foe burns it
    if (this.dashT > 0) {
      for (const f of this.foes) {
        if (f.spawnT > 0 || this.dashHit.has(f.id)) continue;
        const dd = Math.hypot(f.x - this.px, f.z - this.pz);
        if (dd < f.r + PLAYER.radius + 0.35) {
          this.dashHit.add(f.id);
          // dashing into the bulwark's shield face clangs off — go around
          if (f.kind === 'bulwark') {
            const dl2 = Math.hypot(f.x - this.px, f.z - this.pz) || 1;
            const dot = ((f.x - this.px) / dl2) * Math.sin(f.face) + ((f.z - this.pz) / dl2) * Math.cos(f.face);
            if (dot < -Math.cos(FOE.bulwarkCone)) {
              this.events.onBlock(f.x, f.z);
              continue;
            }
          }
          const dl = Math.hypot(f.x - this.px, f.z - this.pz) || 1;
          const kx = ((f.x - this.px) / dl) * 14 * this.mods.dashKnock;
          const kz = ((f.z - this.pz) / dl) * 14 * this.mods.dashKnock;
          const dead = this.damageFoe(f, this.mods.dashStrike);
          if (!dead) {
            f.vx += kx;
            f.vz += kz;
          }
        }
      }
    }
  }

  private hurt(): void {
    if (this.invuln > 0 || this.dashT > 0 || this.over) return;
    this.embers -= 1;
    this.chain = 0;
    if (this.embers <= 0 && this.mods.revive && !this.reviveUsed) {
      // SECOND DAWN — the shrine remembers you
      this.reviveUsed = true;
      this.embers = 1;
      this.invuln = 2.5;
      this.events.onRevive(this.px, this.pz);
      return;
    }
    this.invuln = PLAYER.invulnTime;
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
      const ang = Math.atan2(aimX - this.px, aimZ - this.pz) + (this.rng() - 0.5) * 0.24;
      const dirX = Math.sin(ang);
      const dirZ = Math.cos(ang);
      s.x = this.px + dirX * 1.2;
      s.z = this.pz + dirZ * 1.2;
      s.bounces = 0;
      s.flown = 0;
      s.boost = 0;
      s.hitCd.clear();
      // always launch with full velocity along the aim direction; steering corrects from there
      s.vx = dirX * this.shardSpeed;
      s.vz = dirZ * this.shardSpeed;

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
      }
    }
    if (launched) {
      this.throwCd = SHARD.throwCooldown * this.mods.throwCd;
      this.events.onThrow(this.px, this.pz);
    }
  }

  /** a chosen boon reshapes the build; immediate effects apply here too */
  applyBoon(b: BoonDef): void {
    const prevMax = this.mods.maxEmbers;
    b.apply(this.mods);
    if (this.mods.maxEmbers > prevMax) {
      this.maxEmbers = this.mods.maxEmbers;
      this.embers = Math.min(this.maxEmbers, this.embers + 1); // heal 1
    }
  }

  /** QA hook: wipe the room (browser verification only) — bypasses boss floors */
  debugClearRoom(): void {
    for (const f of this.foes.slice()) {
      f.state = 3;
      f.spawnT = 0;
      this.damageFoe(f, 999);
    }
    this.spawnQueue.length = 0;
    this.marks.length = 0;
    this.hexes.length = 0;
    this.pRootT = 0;
  }

  /** QA hook: strike the nearest live foe as a direct shard-class hit — the
   *  harness seam for burn/spark assertions (headless tests only) */
  debugStrikeNearest(dmg: number): boolean {
    let best: Foe | null = null;
    let bestD = 1e9;
    for (const f of this.foes) {
      if (f.spawnT > 0) continue;
      const d = Math.hypot(f.x - this.px, f.z - this.pz);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (!best) return false;
    return this.damageFoe(best, dmg, false, 'hit');
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
          s.boost = 0;
          this.events.onCatch(s.x, s.z);
          this.addOverdrive(OVERDRIVE.catchCharge + this.mods.odCatch);
          continue;
        }
        s.boost = Math.max(0, s.boost - dt);
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
      if (!target && s.targetId >= 0) {
        // target died mid-flight — fall back to straight flight, then return
        s.targetId = -1;
      }

      if (target) {
        const want = Math.atan2(target.x - s.x, target.z - s.z);
        this.steer(s, want, dt);
      } else if (s.targetId < 0) {
        // straight flight: after enough distance with nothing hit, arc home
        s.flown += this.shardSpeed * dt;
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
        s.boost = 0;
        this.events.onCatch(s.x, s.z);
        this.addOverdrive(OVERDRIVE.catchCharge + this.mods.odCatch);
        continue;
      }
      if (pd < SHARD.catchRadius * 0.7 && s.bounces > this.maxBounces) {
        s.state = 'orbit';
        s.boost = 0;
        this.events.onCatch(s.x, s.z);
        continue;
      }

      // contact with foes
      const dmg = (1 + (SHARD.damage - 1) + (this.mods.dmg - 1)) * (this.odActive ? OVERDRIVE.damageMult : 1);
      for (const f of this.foes) {
        if (f.spawnT > 0) continue;
        if ((s.hitCd.get(f.id) ?? 0) > 0) continue;
        const dd = Math.hypot(f.x - s.x, f.z - s.z);
        if (dd < f.r + 0.55) {
          s.hitCd.set(f.id, SHARD.hitCooldown);
          // BULWARK frontal armor — light ricochets off the plate, no damage,
          // but the ricochet still chains. Backstab it or bend around.
          if (f.kind === 'bulwark') {
            const al = Math.hypot(s.vx, s.vz) || 1;
            const dot = (s.vx / al) * Math.sin(f.face) + (s.vz / al) * Math.cos(f.face);
            if (dot < -Math.cos(FOE.bulwarkCone)) {
              this.events.onBlock(f.x, f.z);
              s.bounces += 1;
              if (s.bounces <= this.maxBounces) {
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
              continue;
            }
          }
          // SHIELDED elite: first hit only strips the halo
          if (f.shieldUp) {
            f.shieldUp = false;
            this.events.onShieldBreak(f.x, f.z);
            continue;
          }
          const killed = this.damageFoe(f, dmg, this.chain > 0);
          if (!killed) {
            // knockback along the shard's travel
            const sl = Math.hypot(s.vx, s.vz) || 1;
            f.vx += (s.vx / sl) * 9;
            f.vz += (s.vz / sl) * 9;
          }
          // SEARING CHAIN: splash around every shard impact
          if (this.mods.splash > 0) {
            for (const o of this.foes) {
              if (o === f || o.spawnT > 0 || o.shieldUp) continue;
              if (Math.hypot(o.x - f.x, o.z - f.z) < 3.5) this.damageFoe(o, this.mods.splash, true);
            }
          }
          if (killed) continue;
          // ricochet to the next foe
          s.bounces += 1;
          if (s.bounces <= this.maxBounces) {
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
    const sp = this.shardSpeed * (s.boost > 0 ? 1.5 : 1);
    s.vx = Math.sin(ang) * sp;
    s.vz = Math.cos(ang) * sp;
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

  private damageFoe(f: Foe, dmg: number, chain = false, cause: 'hit' | 'burn' | 'spark' | 'splash' = 'hit'): boolean {
    // BOSS PHASE FLOOR: a warden hangs on by a thread until its final phase
    // has played — burst builds can never skip the learning curve
    if (f.boss && f.state < 3) {
      const floor = f.state === 1 ? f.maxHp * 0.34 : 0.5;
      if (f.hp - dmg < floor) {
        f.hp = Math.max(floor, 0.5);
        return false;
      }
    }
    // CINDER HOUND recovery: mid-dash-past you, it pays extra to die
    if (f.kind === 'hound' && f.state === 3) dmg *= HOUND.recoverVuln;
    f.hp -= dmg;
    if (f.hp > 0) {
      // EMBER ROT: direct hits stack burning light on the survivor
      if (cause === 'hit' && this.mods.burn > 0) {
        f.burn = Math.min(BURN.maxStacks, f.burn + this.mods.burn);
        if (f.burnT <= 0) f.burnT = BURN.tick;
      }
      this.events.onFoeHurt?.(f.kind, f.x, f.z, dmg, chain);
      return false;
    }
    // CHAINSPARK: the kill arcs death-light to the nearest kindred — sparks
    // never re-spark, so the light stops there
    if (cause !== 'spark' && this.mods.spark > 0) this.fireSparks(f);
    // score: elites pay ×1.5, bosses scale by biome, mutators sweeten the pot
    let base = f.kind === 'warden' ? WAVES.wardenScore : SCORE[f.kind];
    if (f.boss) base = bossScore(this.biome);
    if (f.elite) base *= 1.5;
    this.score += Math.round((base * this.mult * this.mutator.mods.score) / 5) * 5;
    this.addOverdrive(OVERDRIVE.killCharge + this.mods.odOnKill + (f.elite ? 3 : 0));
    if (f.kind === 'warden') {
      this.wardensKilled += 1;
      this.events.onWardenDie(f.x, f.z);
      if (this.shardCount < SHARD.maxCount) {
        this.addShard();
        this.events.onShardGain();
      }
    }
    if (f.elite === 'split') {
      // SPLITTER: two minis burst out
      for (const side of [-1, 1]) {
        const a = this.rng() * TAU;
        this.spawnFoe('drifter', f.x + Math.cos(a) * 1.4 * side, f.z + Math.sin(a) * 1.4 * side, '', false, 1, 0.5);
      }
    }
    this.events.onKill(f.kind, f.x, f.z);
    this.removeFoe(f);
    return true;
  }

  /** death-light arcs: nearest-first from the slain foe, each struck foe pays
   *  SPARK.dmg. Pure geometry — no rng, fully deterministic. */
  private fireSparks(from: Foe): void {
    let fx = from.x;
    let fz = from.z;
    const struck = new Set<number>([from.id]);
    let radius = SPARK.radius;
    for (let n = 0; n < this.mods.spark; n++) {
      let best: Foe | null = null;
      let bestD = radius;
      for (const o of this.foes) {
        if (o.spawnT > 0 || struck.has(o.id)) continue;
        const d = Math.hypot(o.x - fx, o.z - fz);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (!best) break;
      struck.add(best.id);
      this.events.onSpark?.(fx, fz, best.x, best.z, SPARK.dmg);
      const died = this.damageFoe(best, SPARK.dmg, true, 'spark');
      fx = best.x;
      fz = best.z;
      radius = SPARK.chainRadius;
      if (died) break; // the arc dies with its target
    }
  }

  private removeFoe(f: Foe): void {
    const i = this.foes.indexOf(f);
    if (i >= 0) this.foes.splice(i, 1);
  }

  private spawnFoe(kind: FoeKind, x: number, z: number, elite: Elite = '', boss = false, hpOverride?: number, rOverride?: number): void {
    const id = this.nextId++;
    let hp = 2;
    let r = 0.8;
    if (kind === 'striker') {
      hp = 2;
      r = 0.7;
    } else if (kind === 'weaver') {
      hp = 3;
      r = 0.9;
    } else if (kind === 'caster') {
      hp = 2;
      r = 0.85;
    } else if (kind === 'bulwark') {
      hp = 6;
      r = 1.3;
    } else if (kind === 'hound') {
      hp = HOUND.hp;
      r = HOUND.radius;
    } else if (kind === 'warden') {
      hp = boss ? bossHp(this.biome) : WAVES.wardenHpBase;
      r = 2.2;
    }
    if (hpOverride !== undefined) hp = hpOverride;
    if (rOverride !== undefined) r = rOverride;
    if (elite === 'shield') hp += 2;
    if (elite === 'swift') hp = Math.max(1, hp - 1);
    if (kind === 'bulwark' && elite === 'shield') elite = ''; // the plate IS the shield
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
      elite,
      shieldUp: elite === 'shield',
      boss,
      spawnT: kind === 'warden' ? 1.4 : kind === 'bulwark' ? 0.7 : 0.45,
      state: boss ? 1 : 0, // boss phase
      timer:
        kind === 'caster'
          ? 1.2 + this.rng() * 0.8
          : kind === 'hound'
            ? HOUND.cooldown * 0.5 + this.rng() * 0.4
            : 0,
      tx: 0,
      tz: 0,
      dx: 0,
      dz: 0,
      burstLeft: 0,
      burstT: 0,
      hexCd: kind === 'weaver' ? 1.2 : 0, // first hex waits one beat
      patternAngle: this.rng() * TAU,
      face: Math.atan2(this.px - x, this.pz - z), // armor starts facing the ember
      burn: 0,
      burnT: 0,
    });
    if (kind === 'warden' && boss) this.events.onWardenSpawn(x, z);
  }

  private rollElite(): Elite {
    if (this.rng() >= eliteChance(this.biome)) return '';
    const roll = this.rng();
    return roll < 0.34 ? 'swift' : roll < 0.67 ? 'shield' : 'split';
  }

  private updateFoes(dt: number): void {
    const spdScale = Math.min(1.6, 1 + this.wave * 0.03) * this.mutator.mods.foeSpeed; // per-foe swift handled below
    for (const f of this.foes) {
      const swiftK = f.elite === 'swift' ? 1.55 : 1;
      const eff = spdScale * swiftK;
      if (f.spawnT > 0) {
        f.spawnT -= dt;
        continue;
      }
      const pdx = this.px - f.x;
      const pdz = this.pz - f.z;
      const pd = Math.hypot(pdx, pdz) || 1;

      switch (f.kind) {
        case 'drifter': {
          const sp = 4.3 * eff;
          f.vx += ((pdx / pd) * sp - f.vx) * Math.min(1, dt * 2.2);
          f.vz += ((pdz / pd) * sp - f.vz) * Math.min(1, dt * 2.2);
          break;
        }
        case 'striker': {
          if (f.state === 0) {
            // seek
            const sp = 6 * eff;
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
        case 'hound': {
          // CINDER HOUND: lurk → locked wind-up → straight dash → exposed
          // recovery. The dash line is named by the wind-up and never re-aims.
          if (f.state === 0) {
            // lurk: hold the 12..18 band, slow tangential drift
            const tangX = -pdz / pd;
            const tangZ = pdx / pd;
            const radial = pd > 18 ? -0.6 : pd < 12 ? 0.6 : 0;
            const wantVx = tangX * HOUND.lurkSpeed * eff + (pdx / pd) * radial * HOUND.lurkSpeed;
            const wantVz = tangZ * HOUND.lurkSpeed * eff + (pdz / pd) * radial * HOUND.lurkSpeed;
            f.vx += (wantVx - f.vx) * Math.min(1, dt * 2.2);
            f.vz += (wantVz - f.vz) * Math.min(1, dt * 2.2);
            f.timer -= dt;
            if (pd < HOUND.triggerRange && f.timer <= 0) {
              f.state = 1;
              f.timer = HOUND.windupTime;
              // lock the line NOW — the telegraph names exactly where it goes
              const dl = pd || 1;
              f.dx = pdx / dl;
              f.dz = pdz / dl;
              f.tx = f.x + f.dx * 20;
              f.tz = f.z + f.dz * 20;
              f.face = Math.atan2(f.dx, f.dz);
            }
          } else if (f.state === 1) {
            // wind-up — uninterruptible, velocity dies, line burns
            f.vx *= Math.max(0, 1 - dt * 10);
            f.vz *= Math.max(0, 1 - dt * 10);
            f.timer -= dt;
            if (f.timer <= 0) {
              f.state = 2;
              f.timer = HOUND.dashTime;
            }
          } else if (f.state === 2) {
            // dash — dead straight, full commit
            f.vx = f.dx * HOUND.dashSpeed * eff;
            f.vz = f.dz * HOUND.dashSpeed * eff;
            f.timer -= dt;
            if (f.timer <= 0) {
              f.state = 3;
              f.timer = HOUND.recoverTime;
            }
          } else {
            // recovery — the punish window (damageFoe pays x1.5 here)
            f.vx *= Math.max(0, 1 - dt * 7);
            f.vz *= Math.max(0, 1 - dt * 7);
            f.timer -= dt;
            if (f.timer <= 0) {
              f.state = 0;
              f.timer = HOUND.cooldown;
            }
          }
          break;
        }
        case 'weaver': {
          // HEX LOOM: name a patch of floor at the ember's feet — leave it or
          // be rooted. Zero rng; all timers on enemy time.
          f.hexCd -= dt;
          if (
            f.hexCd <= 0 &&
            pd <= HEX.castRange &&
            this.hexes.length < HEX.maxZones &&
            !this.hexes.some((h) => h.weaverId === f.id)
          ) {
            f.hexCd = HEX.cooldown;
            this.hexes.push({ x: this.px, z: this.pz, t: HEX.telegraph, weaverId: f.id });
            this.events.onHexAnchor?.(this.px, this.pz, HEX.telegraph);
          }
          // hold the 15..21 band, strafe clockwise
          const tangX = -pdz / pd;
          const tangZ = pdx / pd;
          const radial = pd > 21 ? -0.8 : pd < 15 ? 0.8 : 0;
          const wantVx = tangX * 5 * eff + (pdx / pd) * radial * 5;
          const wantVz = tangZ * 5 * eff + (pdz / pd) * radial * 5;
          f.vx += (wantVx - f.vx) * Math.min(1, dt * 2.4);
          f.vz += (wantVz - f.vz) * Math.min(1, dt * 2.4);
          if (f.burstLeft > 0) {
            f.burstT -= dt;
            if (f.burstT <= 0) {
              f.burstLeft -= 1;
              f.burstT = 0.13;
              this.fireAt(f, (this.rng() - 0.5) * 0.18); // seeded — the sim is deterministic under a fixed seed
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
        case 'caster': {
          if (f.state === 0) {
            // hold the 16..23 band, slow strafe — then lock, telegraph, lance
            const tangX = -pdz / pd;
            const tangZ = pdx / pd;
            const radial = pd > 23 ? -0.7 : pd < 16 ? 0.7 : 0;
            const wantVx = tangX * 3.4 * eff + (pdx / pd) * radial * 4;
            const wantVz = tangZ * 3.4 * eff + (pdz / pd) * radial * 4;
            f.vx += (wantVx - f.vx) * Math.min(1, dt * 2.2);
            f.vz += (wantVz - f.vz) * Math.min(1, dt * 2.2);
            f.timer -= dt;
            if (f.timer <= 0) {
              f.state = 1;
              f.timer = 0.5;
              f.tx = this.px; // locked at telegraph start — move!
              f.tz = this.pz;
            }
          } else if (f.state === 1) {
            f.vx *= Math.max(0, 1 - dt * 6);
            f.vz *= Math.max(0, 1 - dt * 6);
            f.timer -= dt;
            if (f.timer <= 0) {
              f.state = 2;
              f.timer = 0.1;
            }
          } else {
            f.timer -= dt;
            if (f.timer <= 0) {
              f.state = 0;
              f.timer = 2.0 + this.rng() * 1.1;
              const a = Math.atan2(f.tx - f.x, f.tz - f.z);
              this.bullets.push({
                x: f.x + Math.sin(a) * (f.r + 0.4),
                z: f.z + Math.cos(a) * (f.r + 0.4),
                vx: Math.sin(a) * FOE.heavySpeed,
                vz: Math.cos(a) * FOE.heavySpeed,
                life: FOE.heavyLife,
                grazed: false,
                heavy: true,
              });
              this.events.onHeavyShot(f.x, f.z, f.tx, f.tz);
            }
          }
          break;
        }
        case 'bulwark': {
          // slow armored advance; the plate turns toward you at 1.1 rad/s —
          // outrun its facing and hit the naked back
          const sp = 2.1 * eff;
          f.vx += ((pdx / pd) * sp - f.vx) * Math.min(1, dt * 1.6);
          f.vz += ((pdz / pd) * sp - f.vz) * Math.min(1, dt * 1.6);
          const wantFace = Math.atan2(pdx, pdz);
          let fd = wantFace - f.face;
          while (fd > Math.PI) fd -= TAU;
          while (fd < -Math.PI) fd += TAU;
          const maxTurn = 1.1 * dt;
          f.face += Math.max(-maxTurn, Math.min(maxTurn, fd));
          break;
        }
        case 'warden': {
          // slow menacing drift toward the ember
          f.vx += ((pdx / pd) * 1.7 - f.vx) * Math.min(1, dt * 1.2);
          f.vz += ((pdz / pd) * 1.7 - f.vz) * Math.min(1, dt * 1.2);

          if (f.boss) {
            // phase escalation on hp thresholds
            const frac = f.hp / f.maxHp;
            const wantPhase = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
            if (wantPhase > f.state) {
              f.state = wantPhase;
              f.timer = Math.max(f.timer, 0.9); // breath before the new pattern
              this.events.onBossPhase(f.x, f.z, wantPhase);
            }
          }

          const interval = f.boss ? 2.6 * (f.state === 1 ? 1 : f.state === 2 ? 0.75 : 0.55) : 2.6;
          const ringN = f.boss ? 12 + f.state * 3 : 14;
          f.timer -= dt;
          if (f.timer <= 0) {
            f.timer = interval;
            f.patternAngle += 0.37;
            for (let i = 0; i < ringN; i++) {
              const a = (i / ringN) * TAU + f.patternAngle * (f.boss && f.state === 3 ? 1.9 : 1);
              this.bullets.push({
                x: f.x + Math.sin(a) * f.r,
                z: f.z + Math.cos(a) * f.r,
                vx: Math.sin(a) * 8.5,
                vz: Math.cos(a) * 8.5,
                life: FOE.bulletLife,
                grazed: false,
                heavy: false,
              });
            }
            // The Hollow Choir: escorts in phase 3
            if (f.boss && this.biome === 2 && f.state === 3 && f.tx < 1) {
              f.tx = 1;
              const a1 = this.rng() * TAU;
              this.marks.push({ x: Math.sin(a1) * 20, z: Math.cos(a1) * 20, t: 0.9, kind: 'striker' });
              this.marks.push({ x: -Math.sin(a1) * 20, z: -Math.cos(a1) * 20, t: 0.9, kind: 'striker' });
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

    // EMBER ROT beats — after the movement pass so burn deaths never desync
    // the foe walk. Runs on enemy time (Overdrive slows the fire too).
    if (this.mods.burn > 0) {
      for (const f of this.foes.slice()) {
        if (f.burn <= 0) continue;
        f.burnT -= dt;
        if (f.burnT <= 0) {
          f.burnT = BURN.tick;
          const dmg = f.burn;
          f.burn = Math.max(0, f.burn - 1);
          this.events.onBurnTick?.(f.x, f.z, dmg, f.burn);
          this.damageFoe(f, dmg, false, 'burn');
        }
      }
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
      heavy: false,
    });
  }

  private updateBullets(dt: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      const brad = b.heavy ? FOE.heavyRadius : FOE.bulletRadius;
      const dx = this.px - b.x;
      const dz = this.pz - b.z;
      const d = Math.hypot(dx, dz);
      if (d < PLAYER.radius + brad) {
        if (this.invuln <= 0 && this.dashT <= 0) {
          this.hurt();
          this.bullets.splice(i, 1);
          continue;
        }
      } else if (!b.grazed && d < this.grazeR + brad) {
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
        this.spawnFoe(m.kind, m.x, m.z, m.kind === 'warden' ? '' : this.rollElite(), m.kind === 'warden');
      }
    }
  }

  /** HEX LOOM detonations — enemy time (Overdrive slows the trap) */
  private updateHexes(dt: number): void {
    for (let i = this.hexes.length - 1; i >= 0; i--) {
      const h = this.hexes[i];
      h.t -= dt;
      if (h.t > 0) continue;
      const hit = Math.hypot(this.px - h.x, this.pz - h.z) <= HEX.radius;
      this.hexes.splice(i, 1);
      this.events.onHexDetonate?.(h.x, h.z, hit);
      if (hit) {
        this.pRootT = Math.max(this.pRootT, HEX.rootDur); // never stacks/extends
        this.events.onPlayerRoot?.(h.x, h.z, HEX.rootDur);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* waves                                                               */
  /* ------------------------------------------------------------------ */

  private buildWaveQueue(n: number, budget: number): FoeKind[] {
    let points = budget;
    const q: FoeKind[] = [];
    while (points >= 1) {
      const roll = this.rng();
      if (n >= 5 && roll < 0.18 && points >= 4) {
        q.push('bulwark');
        points -= 4;
      } else if (n >= 5 && roll < 0.3 && points >= 3) {
        q.push('hound');
        points -= 3;
      } else if (n >= 4 && roll < 0.4 && points >= 3) {
        q.push('caster');
        points -= 3;
      } else if (n >= 3 && roll < 0.62 && points >= 3) {
        q.push('weaver');
        points -= 3;
      } else if (n >= 2 && roll < 0.85 && points >= 2) {
        q.push('striker');
        points -= 2;
      } else {
        q.push('drifter');
        points -= 1;
      }
    }
    // deterministic floor so later rooms always escalate
    if (n >= 3 && !q.includes('weaver')) q.push('weaver');
    if (n >= 2 && !q.includes('striker')) q.push('striker');
    if (n >= 5 && !q.includes('caster')) q.push('caster');
    if (n >= 5 && !q.includes('hound')) q.push('hound');
    if (n >= 8 && !q.includes('bulwark')) q.push('bulwark');
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [q[i], q[j]] = [q[i], q[j]];
    }
    return q;
  }

  private updateWave(dt: number): void {
    void dt;
    if (this.waveState !== 'active') return;
    if (this.spawnQueue.length > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        const interval = Math.max(WAVES.spawnIntervalMin, WAVES.spawnIntervalBase - WAVES.spawnIntervalPerWave * this.wave);
        this.spawnT = interval * (0.7 + this.rng() * 0.6);
        const batch = Math.min(this.spawnQueue.length, 1 + (this.wave > 4 && this.rng() < 0.4 ? 1 : 0));
        for (let i = 0; i < batch; i++) {
          const kind = this.spawnQueue.shift();
          if (!kind) break;
          // spawn on the rim away from the ember
          let x = 0;
          let z = 0;
          for (let tries = 0; tries < 8; tries++) {
            const a = this.rng() * TAU;
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
      // room cleared — the engine decides what comes next (shrine / boss / next biome)
      this.waveState = 'idle';
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
      this.odT = this.odDuration;
      this.events.onOverdriveStart();
    }
  }
}
