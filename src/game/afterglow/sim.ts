import { mulberry32, type Rng } from '../rng';
import { baseMods, draftById, rollDraft, type Mods } from './draft';
import {
  ARENA_RADIUS,
  BURN,
  CAPS,
  CHAIN,
  FOES,
  HUSK,
  LIGHT,
  PILLARS,
  PLAYER,
  SPAWN,
  TRAIL,
  WARD,
  WAVES,
  WEAPON,
  type FoeKind,
} from './constants';

/**
 * AFTERGLOW simulation — pure 2D math, zero rendering imports.
 *
 * The last light, the GLIMMER auto-weapon, three foe kinds whose threats all
 * telegraph in sim state, wave spawning, the light/mote economy and the
 * post-wave draft all live here. Fixed timestep 1/60, seeded mulberry32,
 * fully headless-testable. The view layer reads the public state fields and
 * reacts to events; it never writes to them.
 */

export type { FoeKind } from './constants';
export type FoeState = 'spawn' | 'walk' | 'windup' | 'charge' | 'recover';
export type WavePhase = 'idle' | 'intro' | 'combat' | 'draft' | 'breather';

/**
 * Event callbacks — the ONLY way the sim talks to the outside world.
 * Keep handlers side-effect-free with respect to sim state (no pickDraft /
 * requestDash from inside events; queue and apply after step returns).
 */
export interface AfterglowEvents {
  /** a foe died (any source: bolt, burn, chain) */
  onFoeDie(kind: FoeKind, x: number, z: number): void;
  /** the player lost hp (hp is the value AFTER the hit); ward absorbs do NOT fire this */
  onHurt(x: number, z: number, hp: number): void;
  /** dash started */
  onDash(x: number, z: number): void;
  /** wave n intro began */
  onWaveStart(n: number): void;
  /** wave n cleared (budget exhausted AND arena empty) */
  onWaveClear(n: number): void;
  /** draft opened after wave n with exactly these choice ids */
  onDraftOffer(n: number, choices: string[]): void;
  /** a draft choice was applied */
  onDraftPick(id: string): void;
  /** a foe spawned; telegraph is always true in M0 (the 0.4s spawn ramp is the tell) */
  onSpawn(kind: FoeKind, x: number, z: number, telegraph: boolean): void;
  /** the run ended */
  onDeath(x: number, z: number, wave: number, kills: number, light: number): void;
  /** a light mote dropped */
  onMote(x: number, z: number): void;
  /** a mote was collected */
  onPickup(): void;
  /** optional: a projectile died on a pillar (impact point) */
  onPillar?(x: number, z: number): void;
  /** optional: a foe took damage (kind, position, raw dmg, source). Burn ticks fire too — the view filters src==='burn' out later. */
  onFoeHurt?(kind: FoeKind, x: number, z: number, dmg: number, src: 'bolt' | 'chain' | 'burn'): void;
  /** optional: a weapon volley fired from the player position toward angle (radians) */
  onVolley?(x: number, z: number, angle: number): void;
}

export interface AfterglowPlayer {
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  /** glimmer_ward charges currently held */
  shield: number;
  dashT: number;
  dashCd: number;
  iframes: number;
  /** aim/movement heading in radians (view rotates the light) */
  facing: number;
}

export interface AfterglowFoe {
  id: number;
  kind: FoeKind;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  r: number;
  state: FoeState;
  /** husk FSM timer (windup / charge / recover / walk charge-cd) */
  timer: number;
  /** per-foe touch damage cooldown */
  touchT: number;
  /** burn seconds remaining (2 dps while > 0) */
  burnT: number;
  /** locked charge direction while winding up / charging, else null */
  chargeDir: { x: number; z: number } | null;
  /** transient: marked by damage this substep, swept before the next — never observable across steps */
  dead: boolean;
}

export interface AfterglowProjectile {
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  r: number;
  pierceLeft: number;
  dmg: number;
}

/** chain_spark visual, carried as sim state so the view just draws it */
export interface AfterglowArc {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  life: number;
}

export interface AfterglowMote {
  x: number;
  z: number;
  /** seconds until despawn */
  t: number;
}

/** dash trail zone; burns foes only when the ember tag is present */
export interface AfterglowTrail {
  x: number;
  z: number;
  r: number;
  life: number;
  burn: boolean;
}

export interface AfterglowPillar {
  x: number;
  z: number;
  r: number;
}

export interface AfterglowWave {
  n: number;
  phase: WavePhase;
  /** countdown for intro / combat / breather; 0 during draft (draft never times out in M0) */
  tLeft: number;
  /** spawn budget points not yet spawned */
  budgetLeft: number;
  /** foes spawned this wave */
  spawned: number;
}

interface SpawnGroup {
  kind: FoeKind;
  count: number;
  /** total budget points */
  cost: number;
  /** combat-seconds into the wave when this group spawns */
  t: number;
  x: number;
  z: number;
}

/* ------------------------------------------------------------------ */
/* deterministic canonical serializer (sorted keys, fixed 2 decimals)  */
/* ------------------------------------------------------------------ */

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? 'Inf' : v < 0 ? '-Inf' : 'NaN';
  const n = Math.abs(v) < 0.005 ? 0 : v; // kill -0.00 vs 0.00 noise
  return n.toFixed(2);
}

function canon(v: unknown): string {
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v === null || v === undefined) return '~';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const rec = v as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return '{' + keys.map((k) => k + ':' + canon(rec[k])).join(',') + '}';
}

const TAU = Math.PI * 2;
const SUB_DT = 1 / 60;

/* ------------------------------------------------------------------ */
/* Sim                                                                 */
/* ------------------------------------------------------------------ */

export class Sim {
  readonly events: AfterglowEvents;
  readonly seed: number;
  /** every build modifier (draft picks write here) */
  mods: Mods;

  // ---- public state (view reads; sim writes) ----
  readonly player: AfterglowPlayer;
  readonly foes: AfterglowFoe[] = [];
  readonly projectiles: AfterglowProjectile[] = [];
  readonly arcs: AfterglowArc[] = [];
  readonly motes: AfterglowMote[] = [];
  readonly trails: AfterglowTrail[] = [];
  readonly pillars: AfterglowPillar[] = [];
  readonly wave: AfterglowWave = { n: 0, phase: 'idle', tLeft: 0, budgetLeft: 0, spawned: 0 };
  /** current draft choice ids (empty outside the draft phase) */
  offers: string[] = [];
  time = 0;
  kills = 0;
  light = 0;
  over = false;

  // ---- internals ----
  private rng: Rng;
  private moveX = 0;
  private moveZ = 0;
  private wantDash = false;
  private nextId = 1;
  private fireCd = 0;
  private wardT = -1; // -1 = ward not started
  private trailT = 0;
  private plan: SpawnGroup[] = [];
  private planIdx = 0;
  private combatT = 0;
  private dashDx = 1;
  private dashDz = 0;
  private acc = 0;

  constructor(seed: number, events: AfterglowEvents) {
    this.events = events;
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.mods = baseMods();
    this.player = {
      x: 0,
      z: 0,
      hp: PLAYER.maxHp,
      maxHp: PLAYER.maxHp,
      shield: 0,
      dashT: 0,
      dashCd: 0,
      iframes: 0,
      facing: 0,
    };
    this.genPillars();
  }

  /* -------------------------------------------------------------- */
  /* lifecycle & input API                                          */
  /* -------------------------------------------------------------- */

  /** begin (or restart) the run: wave 1 intro. Pillars stay seed-fixed. */
  start(): void {
    this.foes.length = 0;
    this.projectiles.length = 0;
    this.arcs.length = 0;
    this.motes.length = 0;
    this.trails.length = 0;
    this.offers.length = 0;
    this.time = 0;
    this.kills = 0;
    this.light = 0;
    this.over = false;
    this.mods = baseMods();
    const p = this.player;
    p.x = 0;
    p.z = 0;
    p.hp = PLAYER.maxHp;
    p.maxHp = PLAYER.maxHp;
    p.shield = 0;
    p.dashT = 0;
    p.dashCd = 0;
    p.iframes = 0;
    p.facing = 0;
    this.moveX = 0;
    this.moveZ = 0;
    this.wantDash = false;
    this.nextId = 1;
    this.fireCd = 0;
    this.wardT = -1;
    this.trailT = 0;
    this.acc = 0;
    this.startWave(1);
  }

  /** normalized movement input (persisted until the next call) */
  setMove(x: number, z: number): void {
    const len = Math.hypot(x, z);
    if (len > 1e-9) {
      this.moveX = x / len;
      this.moveZ = z / len;
    } else {
      this.moveX = 0;
      this.moveZ = 0;
    }
  }

  /** request a dash; consumed on the next substep (lost if dash not ready) */
  requestDash(): void {
    this.wantDash = true;
  }

  /** apply a draft choice; returns false if the id is not currently offered */
  pickDraft(id: string): boolean {
    if (this.over || this.wave.phase !== 'draft') return false;
    if (!this.offers.includes(id)) return false;
    const def = draftById(id);
    if (!def) return false;
    const p = this.player;
    const oldMax = p.maxHp;
    def.apply(this.mods);
    this.mods.takenCounts[id] = (this.mods.takenCounts[id] ?? 0) + 1;
    // maxHp resolution: +diff heals (steady_core), clamp above new max (glass_cannon)
    const newMax = this.resolvedMaxHp();
    if (newMax > oldMax) p.hp += newMax - oldMax;
    p.maxHp = newMax;
    if (p.hp > newMax) p.hp = newMax;
    this.offers.length = 0;
    this.wave.phase = 'breather';
    this.wave.tLeft = WAVES.breatherTime;
    this.events.onDraftPick(id);
    return true;
  }

  /**
   * advance the sim. Fixed-timestep accumulator: substeps of 1/60,
   * dtReal clamped to 0.1s. All randomness flows through this.rng.
   */
  step(dtReal: number): void {
    const dt = Math.min(0.1, Math.max(0, dtReal));
    this.acc += dt;
    let guard = 0;
    while (this.acc >= SUB_DT - 1e-9 && guard++ < 8) {
      this.acc -= SUB_DT;
      this.substep(SUB_DT);
    }
  }

  /**
   * deterministic digest source: sorted-key, fixed-2-decimals serialization
   * of every entity position/hp, timers, wave, kills, light, mods and time.
   * The drive harness hashes this string.
   */
  serializeState(): string {
    const p = this.player;
    return canon({
      v: 1,
      t: this.time,
      k: this.kills,
      l: this.light,
      o: this.over ? 1 : 0,
      w: {
        n: this.wave.n,
        ph: this.wave.phase,
        tL: this.wave.tLeft,
        bL: this.wave.budgetLeft,
        sp: this.wave.spawned,
        ct: this.combatT,
        pi: this.planIdx,
      },
      p: {
        x: p.x,
        z: p.z,
        hp: p.hp,
        mh: p.maxHp,
        sh: p.shield,
        dT: p.dashT,
        dCd: p.dashCd,
        iv: p.iframes,
        f: p.facing,
        fc: this.fireCd,
        wt: this.wardT,
        mx: this.moveX,
        mz: this.moveZ,
        wd: this.wantDash ? 1 : 0,
      },
      m: this.mods,
      F: this.foes.map((f) => ({
        i: f.id,
        k: f.kind,
        x: f.x,
        z: f.z,
        hp: f.hp,
        mh: f.maxHp,
        st: f.state,
        ti: f.timer,
        tt: f.touchT,
        b: f.burnT,
        cd: f.chargeDir,
      })),
      P: this.projectiles.map((q) => ({ x: q.x, z: q.z, vx: q.vx, vz: q.vz, lf: q.life, pl: q.pierceLeft, d: q.dmg })),
      M: this.motes.map((q) => ({ x: q.x, z: q.z, t: q.t })),
      A: this.arcs.map((q) => ({ x1: q.x1, z1: q.z1, x2: q.x2, z2: q.z2, lf: q.life })),
      T: this.trails.map((q) => ({ x: q.x, z: q.z, lf: q.life, b: q.burn ? 1 : 0 })),
      S: this.pillars.map((q) => ({ x: q.x, z: q.z, r: q.r })),
      O: this.offers,
    });
  }

  /* -------------------------------------------------------------- */
  /* private: setup                                                 */
  /* -------------------------------------------------------------- */

  private genPillars(): void {
    const rng = this.rng;
    for (let i = 0; i < PILLARS.count; i++) {
      let x = 0;
      let z = 0;
      let r = PILLARS.rMin;
      let ok = false;
      for (let a = 0; a < PILLARS.attempts && !ok; a++) {
        r = PILLARS.rMin + rng() * (PILLARS.rMax - PILLARS.rMin);
        const ang = rng() * TAU;
        const dMax = ARENA_RADIUS - PILLARS.edgePad - r;
        const d = PILLARS.minSpawnDist + rng() * Math.max(0.1, dMax - PILLARS.minSpawnDist);
        x = Math.cos(ang) * d;
        z = Math.sin(ang) * d;
        ok = true;
        for (const q of this.pillars) {
          const gap = Math.hypot(x - q.x, z - q.z) - q.r - r;
          if (gap < PILLARS.centerGap) {
            ok = false;
            break;
          }
        }
      }
      this.pillars.push({ x, z, r });
    }
  }

  /** budget in half-points so 0.5-cost cinders compose exactly */
  private buildWavePlan(n: number): SpawnGroup[] {
    const rng = this.rng;
    let b2 = (WAVES.budgetBase + WAVES.budgetPerWave * n) * 2;
    const groups: { kind: FoeKind; count: number; cost: number }[] = [];
    while (b2 > 0) {
      const roll = rng();
      if (roll < WAVES.weights.husk && b2 >= 6) {
        groups.push({ kind: 'husk', count: 1, cost: 3 });
        b2 -= 6;
      } else if (roll < WAVES.weights.husk + WAVES.weights.cinder && b2 >= WAVES.ringMin) {
        // ring sizes keep budget parity (6 or 8 cinders) so the plan lands exactly on 0
        const size = b2 >= WAVES.ringMax && rng() < 0.5 ? WAVES.ringMax : WAVES.ringMin;
        groups.push({ kind: 'cinder', count: size, cost: size * 0.5 });
        b2 -= size;
      } else {
        groups.push({ kind: 'wisp', count: 1, cost: 1 });
        b2 -= 2;
      }
    }
    const window = WAVES.duration * WAVES.spawnWindowFrac;
    const plan: SpawnGroup[] = groups.map((g, i) => {
      const [x, z] = this.pickSpawnPoint();
      return { ...g, t: ((i + rng() * 0.6) / groups.length) * window, x, z };
    });
    plan.sort((a, b) => a.t - b.t);
    return plan;
  }

  /** deterministic spawn point: clear of pillars, inside the wall */
  private pickSpawnPoint(): [number, number] {
    let x = 0;
    let z = 0;
    for (let a = 0; a < SPAWN.attempts; a++) {
      const ang = this.rng() * TAU;
      const dMax = ARENA_RADIUS - SPAWN.wallPad;
      const d = SPAWN.minDist + this.rng() * Math.max(0.1, dMax - SPAWN.minDist);
      x = Math.cos(ang) * d;
      z = Math.sin(ang) * d;
      let ok = true;
      for (const pil of this.pillars) {
        if (Math.hypot(x - pil.x, z - pil.z) < pil.r + SPAWN.pillarPad) {
          ok = false;
          break;
        }
      }
      if (ok) return [x, z];
    }
    return [x, z];
  }

  private startWave(n: number): void {
    const w = this.wave;
    w.n = n;
    w.phase = 'intro';
    w.tLeft = WAVES.introTime;
    w.budgetLeft = WAVES.budgetBase + WAVES.budgetPerWave * n;
    w.spawned = 0;
    this.combatT = 0;
    this.planIdx = 0;
    this.plan = this.buildWavePlan(n);
    this.events.onWaveStart(n);
  }

  /* -------------------------------------------------------------- */
  /* private: per-substep systems                                   */
  /* -------------------------------------------------------------- */

  private substep(dt: number): void {
    this.time += dt;
    if (this.over) return; // the dark took the light: state freezes, time flows
    this.updatePlayer(dt);
    this.updateWeapon(dt);
    this.updateWave(dt);
    this.updateFoes(dt);
    this.updateProjectiles(dt);
    this.sweepDead();
    this.updateTrails(dt);
    this.updateMotes(dt);
    this.updateArcs(dt);
  }

  private resolvedMaxHp(): number {
    return Math.max(PLAYER.minMaxHp, PLAYER.maxHp + this.mods.bonusMaxHp);
  }

  private hurtIframes(): number {
    return PLAYER.hurtIframes + this.mods.iframeBonus;
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.iframes = Math.max(0, p.iframes - dt);

    // ward regen: first charge WARD.period after the pick, then one per period
    if (this.mods.wardMax > 0) {
      if (this.wardT < 0) this.wardT = WARD.period;
      else if (p.shield < this.mods.wardMax) {
        this.wardT -= dt;
        if (this.wardT <= 0) {
          p.shield++;
          this.wardT = WARD.period;
        }
      }
    }

    const wantDash = this.wantDash;
    this.wantDash = false;
    if (wantDash && p.dashT <= 0 && p.dashCd <= 0) {
      let dx = this.moveX;
      let dz = this.moveZ;
      const len = Math.hypot(dx, dz);
      if (len < 0.1) {
        dx = Math.cos(p.facing);
        dz = Math.sin(p.facing);
      } else {
        dx /= len;
        dz /= len;
      }
      this.dashDx = dx;
      this.dashDz = dz;
      p.dashT = PLAYER.dashDuration;
      p.dashCd = PLAYER.dashCooldown * this.mods.dashCdMul;
      this.trailT = 0;
      this.events.onDash(p.x, p.z);
    }

    let vx: number;
    let vz: number;
    if (p.dashT > 0) {
      p.dashT -= dt;
      vx = this.dashDx * PLAYER.dashSpeed;
      vz = this.dashDz * PLAYER.dashSpeed;
      // ember trail (cosmetic unless the ember tag is present)
      this.trailT -= dt;
      if (this.trailT <= 0 && this.trails.length < CAPS.trails) {
        this.trails.push({ x: p.x, z: p.z, r: TRAIL.radius, life: TRAIL.life, burn: this.mods.burnOnHit });
        this.trailT = TRAIL.spawnEvery;
      }
    } else {
      const spd = PLAYER.speed * this.mods.speedMul;
      vx = this.moveX * spd;
      vz = this.moveZ * spd;
      if (this.moveX !== 0 || this.moveZ !== 0) p.facing = Math.atan2(this.moveZ, this.moveX);
    }
    p.x += vx * dt;
    p.z += vz * dt;
    this.clampArena(p, PLAYER.radius);
    this.pushOutOfPillars(p, PLAYER.radius);
  }

  private updateWeapon(dt: number): void {
    this.fireCd = Math.max(0, this.fireCd - dt);
    if (this.fireCd > 0) return;
    const p = this.player;
    const range = WEAPON.range * this.mods.rangeMul;
    // auto-target: nearest foe inside range (spawn-ramping foes are not there yet)
    let best: AfterglowFoe | null = null;
    let bd = range;
    for (const f of this.foes) {
      if (f.dead || f.state === 'spawn') continue;
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    if (!best) return;
    const speed = WEAPON.projectileSpeed * this.mods.projSpeedMul;
    const dmg = WEAPON.damage * this.mods.damageMul;
    const volleys = WEAPON.volleys + this.mods.volleys;
    const angle = Math.atan2(best.z - p.z, best.x - p.x);
    p.facing = angle;
    let shot = 0;
    for (let v = 0; v < volleys; v++) {
      if (this.projectiles.length >= CAPS.projectiles) break;
      const off = (v - (volleys - 1) / 2) * WEAPON.spreadPerVolley;
      const a = angle + off;
      this.projectiles.push({
        x: p.x + Math.cos(a) * (PLAYER.radius + WEAPON.projectileRadius),
        z: p.z + Math.sin(a) * (PLAYER.radius + WEAPON.projectileRadius),
        vx: Math.cos(a) * speed,
        vz: Math.sin(a) * speed,
        life: (range / speed) + WEAPON.lifetimePad,
        r: WEAPON.projectileRadius,
        pierceLeft: WEAPON.pierce,
        dmg,
      });
      shot++;
    }
    this.fireCd = WEAPON.fireInterval * this.mods.intervalMul;
    // pure notification — no rng, no state writes; only fires if a shot left the barrel
    if (shot > 0) this.events.onVolley?.(p.x, p.z, angle);
  }

  private updateWave(dt: number): void {
    const w = this.wave;
    if (w.phase === 'intro') {
      w.tLeft -= dt;
      if (w.tLeft <= 0) {
        w.phase = 'combat';
        w.tLeft = WAVES.duration;
        this.combatT = 0;
      }
    } else if (w.phase === 'combat') {
      this.combatT += dt;
      w.tLeft = Math.max(0, WAVES.duration - this.combatT);
      while (this.planIdx < this.plan.length && this.plan[this.planIdx].t <= this.combatT) {
        const g = this.plan[this.planIdx];
        if (this.foes.length + g.count > CAPS.foes) break; // leak guard: wait for room
        this.spawnGroup(g);
        this.planIdx++;
      }
      if (this.planIdx >= this.plan.length && w.budgetLeft <= 1e-9 && this.foes.length === 0) {
        this.events.onWaveClear(w.n);
        w.phase = 'draft';
        w.tLeft = 0;
        this.offers = rollDraft(this.rng, this.mods.takenCounts, this.mods);
        if (this.offers.length > 0) {
          this.events.onDraftOffer(w.n, this.offers);
        } else {
          // pool exhausted (possible only far beyond M0): skip the draft
          this.wave.phase = 'breather';
          this.wave.tLeft = WAVES.breatherTime;
        }
      }
    } else if (w.phase === 'breather') {
      w.tLeft -= dt;
      if (w.tLeft <= 0) this.startWave(w.n + 1);
    }
    // draft: offers persist until picked — the draft phase never times out in M0
  }

  private spawnGroup(g: SpawnGroup): void {
    const tuning = FOES[g.kind];
    const per = g.cost / g.count;
    for (let i = 0; i < g.count; i++) {
      const ang = (i / g.count) * TAU;
      const ringR = g.count > 1 ? 1.6 : 0;
      let x = g.x + Math.cos(ang) * ringR;
      let z = g.z + Math.sin(ang) * ringR;
      const maxD = ARENA_RADIUS - tuning.radius - 0.1;
      const d = Math.hypot(x, z);
      if (d > maxD) {
        x = (x / d) * maxD;
        z = (z / d) * maxD;
      }
      const hp = tuning.hpBase + tuning.hpPerWave * (this.wave.n - 1);
      this.foes.push({
        id: this.nextId++,
        kind: g.kind,
        x,
        z,
        hp,
        maxHp: hp,
        r: tuning.radius,
        state: 'spawn',
        timer: WAVES.spawnRamp,
        touchT: 0,
        burnT: 0,
        chargeDir: null,
        dead: false,
      });
      this.wave.spawned++;
      this.wave.budgetLeft = Math.max(0, this.wave.budgetLeft - per);
      this.events.onSpawn(g.kind, x, z, true);
    }
  }

  private updateFoes(dt: number): void {
    const p = this.player;
    for (const f of this.foes) {
      if (f.dead) continue;
      f.touchT = Math.max(0, f.touchT - dt);

      // burn ticks even while the foe is doing anything else
      if (f.burnT > 0) {
        f.burnT -= dt;
        this.damageFoe(f, BURN.dps * dt, 'burn');
        if (f.dead) continue;
      }

      switch (f.state) {
        case 'spawn': {
          f.timer -= dt;
          if (f.timer <= 0) f.state = 'walk';
          break;
        }
        case 'walk': {
          const dx = p.x - f.x;
          const dz = p.z - f.z;
          const d = Math.hypot(dx, dz) || 1e-6;
          if (f.kind === 'husk') {
            if (f.timer > 0) {
              f.timer -= dt; // charge cooldown before the next scream
            } else if (d <= HUSK.windupRange) {
              f.state = 'windup';
              f.timer = HUSK.windup;
              f.chargeDir = { x: dx / d, z: dz / d }; // THE TELL: direction locked now
              break;
            }
          }
          const spd = FOES[f.kind].speed;
          f.x += (dx / d) * spd * dt;
          f.z += (dz / d) * spd * dt;
          break;
        }
        case 'windup': {
          f.timer -= dt;
          if (f.timer <= 0) {
            f.state = 'charge';
            f.timer = HUSK.chargeTime;
          }
          break;
        }
        case 'charge': {
          const cd = f.chargeDir ?? { x: 1, z: 0 };
          f.x += cd.x * HUSK.chargeSpeed * dt;
          f.z += cd.z * HUSK.chargeSpeed * dt;
          f.timer -= dt;
          if (f.timer <= 0) {
            f.state = 'recover';
            f.timer = HUSK.recover;
            f.chargeDir = null;
          }
          break;
        }
        case 'recover': {
          f.timer -= dt;
          if (f.timer <= 0) {
            f.state = 'walk';
            f.timer = HUSK.chargeCd;
          }
          break;
        }
      }

      this.clampArena(f, f.r);
      this.pushOutOfPillars(f, f.r);

      // touch damage (spawn ramp and dead foes don't bite; dashing = intangible)
      if (f.state !== 'spawn' && p.dashT <= 0 && p.iframes <= 0 && f.touchT <= 0) {
        const dx = p.x - f.x;
        const dz = p.z - f.z;
        const rr = f.r + PLAYER.radius;
        if (dx * dx + dz * dz <= rr * rr) this.hurtPlayer(f);
      }
    }

    // gentle pairwise separation so swarmers don't stack into one point
    for (let i = 0; i < this.foes.length; i++) {
      const a = this.foes[i];
      if (a.dead || a.state === 'spawn') continue;
      for (let j = i + 1; j < this.foes.length; j++) {
        const b = this.foes[j];
        if (b.dead || b.state === 'spawn') continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const minD = a.r + b.r;
        const d2 = dx * dx + dz * dz;
        if (d2 < minD * minD && d2 > 1e-9) {
          const d = Math.sqrt(d2);
          const push = (minD - d) / 2;
          const ux = dx / d;
          const uz = dz / d;
          a.x -= ux * push;
          a.z -= uz * push;
          b.x += ux * push;
          b.z += uz * push;
        }
      }
    }
    // resolve any separation-induced overlap with walls/pillars
    for (const f of this.foes) {
      if (f.dead) continue;
      this.clampArena(f, f.r);
      this.pushOutOfPillars(f, f.r);
    }
  }

  private hurtPlayer(f: AfterglowFoe): void {
    const p = this.player;
    f.touchT = FOES[f.kind].touchCd;
    if (p.shield > 0) {
      p.shield--; // the ward drinks the hit; iframes still granted
      p.iframes = this.hurtIframes();
      return;
    }
    p.hp = Math.max(0, p.hp - FOES[f.kind].touchDmg);
    p.iframes = this.hurtIframes();
    this.events.onHurt(p.x, p.z, p.hp);
    if (p.hp <= 0) {
      this.over = true;
      this.events.onDeath(p.x, p.z, this.wave.n, this.kills, this.light);
    }
  }

  private updateProjectiles(dt: number): void {
    let w = 0;
    for (const pr of this.projectiles) {
      pr.life -= dt;
      pr.x += pr.vx * dt;
      pr.z += pr.vz * dt;
      let alive = pr.life > 0 && Math.hypot(pr.x, pr.z) < ARENA_RADIUS;
      if (alive) {
        for (const pil of this.pillars) {
          const dx = pr.x - pil.x;
          const dz = pr.z - pil.z;
          const rr = pil.r + pr.r;
          if (dx * dx + dz * dz <= rr * rr) {
            alive = false;
            this.events.onPillar?.(pr.x, pr.z);
            break;
          }
        }
      }
      if (alive) {
        for (const f of this.foes) {
          if (f.dead || f.state === 'spawn') continue;
          const dx = f.x - pr.x;
          const dz = f.z - pr.z;
          const rr = f.r + pr.r;
          if (dx * dx + dz * dz <= rr * rr) {
            this.damageFoe(f, pr.dmg, 'bolt');
            if (this.mods.burnOnHit) f.burnT = BURN.duration;
            this.chainSpark(f, pr.dmg);
            pr.pierceLeft--;
            if (pr.pierceLeft < 0) {
              alive = false;
              break;
            }
          }
        }
      }
      if (alive) this.projectiles[w++] = pr;
    }
    this.projectiles.length = w;
  }

  /** chain_spark: arcs to the nearest not-yet-chained foe, walking outward */
  private chainSpark(from: AfterglowFoe, dmg: number): void {
    if (this.mods.chainCount <= 0) return;
    const chained = new Set<number>([from.id]);
    let src = from;
    for (let c = 0; c < this.mods.chainCount; c++) {
      let best: AfterglowFoe | null = null;
      let bd = CHAIN.radius;
      for (const f of this.foes) {
        if (f.dead || f.state === 'spawn' || chained.has(f.id)) continue;
        const d = Math.hypot(f.x - src.x, f.z - src.z);
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
      if (!best) break;
      this.damageFoe(best, dmg * CHAIN.dmgMul, 'chain');
      if (this.mods.burnOnHit) best.burnT = BURN.duration;
      if (this.arcs.length < CAPS.arcs) {
        this.arcs.push({ x1: src.x, z1: src.z, x2: best.x, z2: best.z, life: CHAIN.arcLife });
      }
      chained.add(best.id);
      src = best;
    }
  }

  private updateTrails(dt: number): void {
    let w = 0;
    for (const t of this.trails) {
      t.life -= dt;
      if (t.life <= 0) continue;
      if (t.burn) {
        for (const f of this.foes) {
          if (f.dead || f.state === 'spawn') continue;
          const dx = f.x - t.x;
          const dz = f.z - t.z;
          const rr = t.r + f.r;
          if (dx * dx + dz * dz <= rr * rr) f.burnT = BURN.duration;
        }
      }
      this.trails[w++] = t;
    }
    this.trails.length = w;
  }

  private updateMotes(dt: number): void {
    const p = this.player;
    const pr = LIGHT.pickupRadius * this.mods.pickupMul;
    let w = 0;
    for (const m of this.motes) {
      m.t -= dt;
      let alive = m.t > 0;
      if (alive) {
        const dx = p.x - m.x;
        const dz = p.z - m.z;
        const d = Math.hypot(dx, dz);
        if (d <= pr) {
          if (d <= LIGHT.pickupDist) {
            this.light += LIGHT.value;
            this.events.onPickup();
            alive = false;
          } else {
            const s = (LIGHT.driftSpeed * dt) / d;
            m.x += dx * s;
            m.z += dz * s;
          }
        }
      }
      if (alive) this.motes[w++] = m;
    }
    this.motes.length = w;
  }

  private updateArcs(dt: number): void {
    let w = 0;
    for (const a of this.arcs) {
      a.life -= dt;
      if (a.life > 0) this.arcs[w++] = a;
    }
    this.arcs.length = w;
  }

  /** funnel every damage source through here (src only tags the notification) */
  private damageFoe(f: AfterglowFoe, dmg: number, src: 'bolt' | 'chain' | 'burn'): void {
    if (f.dead || f.state === 'spawn') return;
    f.hp -= dmg;
    if (f.hp <= 0) {
      f.hp = 0;
      f.dead = true;
    }
    // pure notification — no rng, no state writes; invisible to serializeState()
    this.events.onFoeHurt?.(f.kind, f.x, f.z, dmg, src);
  }

  private sweepDead(): void {
    let w = 0;
    for (const f of this.foes) {
      if (f.dead) {
        this.kills++;
        this.events.onFoeDie(f.kind, f.x, f.z);
        this.dropMotes(f.x, f.z);
      } else {
        this.foes[w++] = f;
      }
    }
    this.foes.length = w;
  }

  private dropMotes(x: number, z: number): void {
    let count = LIGHT.motesMin + Math.floor(this.rng() * (LIGHT.motesMax - LIGHT.motesMin + 1));
    count = Math.min(count, CAPS.motes - this.motes.length);
    for (let i = 0; i < count; i++) {
      this.motes.push({ x, z, t: LIGHT.despawn });
      this.events.onMote(x, z);
    }
  }

  /* -------------------------------------------------------------- */
  /* private: collision helpers                                     */
  /* -------------------------------------------------------------- */

  private clampArena(e: { x: number; z: number }, r: number): void {
    const d = Math.hypot(e.x, e.z);
    const max = ARENA_RADIUS - r;
    if (d > max && d > 1e-9) {
      e.x = (e.x / d) * max;
      e.z = (e.z / d) * max;
    }
  }

  private pushOutOfPillars(e: { x: number; z: number }, r: number): void {
    for (const pil of this.pillars) {
      const dx = e.x - pil.x;
      const dz = e.z - pil.z;
      const min = pil.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 1e-6;
        e.x = pil.x + (dx / d) * min;
        e.z = pil.z + (dz / d) * min;
      }
    }
  }
}
