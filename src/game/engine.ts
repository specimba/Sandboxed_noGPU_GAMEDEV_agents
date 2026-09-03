import * as THREE from 'three';
import {
  ARENA,
  FEEL,
  OVERDRIVE,
  PLAYER,
  RUN,
  starEnergy,
} from './constants';
import { AudioEngine } from './audio';
import { CameraRig } from './cameraRig';
import { ParticlePool, RingPool } from './fx';
import { Input } from './input';
import {
  BOONS,
  SHRINE_UPGRADES,
  biomeName,
  bossName,
  dawnEarned,
  isBossRoom,
  metaMods,
  rollBoons,
  type BoonDef,
} from './run';
import { Scene } from './scene';
import { Sim, type FoeKind, type SimEvents } from './sim';
import { loadBest, loadMeta, saveBest, saveMeta, useGameStore } from './store';
import { View } from './view';

/**
 * HOLLOW SUN engine — fixed-timestep orchestrator.
 * Sim runs at 60Hz; hitstop and Overdrive live in the timestep split.
 */

const STEP = 1 / 60;

let active: Engine | null = null;
export function getEngine(): Engine | null {
  return active;
}

const BURST: Record<FoeKind, number> = {
  drifter: 170,
  striker: 220,
  weaver: 280,
  warden: 900,
};

export class Engine {
  private scene: Scene;
  private fx: ParticlePool;
  private rings: RingPool;
  private view: View;
  private audio = new AudioEngine();
  private rig = new CameraRig();
  private input: Input;
  private sim: Sim;
  private store = useGameStore;

  private raf = 0;
  private lastT = 0;
  private acc = 0;
  private hitstop = 0;
  private slowT = 0;
  private hudT = 0;
  private heartT = 0;
  private deathT = -1;
  private aim = new THREE.Vector3(0, 0, -6);
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private disposed = false;

  // run progression
  private runBiome = 0;
  private runRoom = 1;
  private roomsCleared = 0;
  private bossesKilled = 0;
  private boonsTaken: Record<string, number> = {};
  private lastBoonChoices: BoonDef[] = [];

  constructor(canvas: HTMLCanvasElement) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    active = this;
    this.scene = new Scene(canvas);
    this.fx = new ParticlePool(this.scene.scene, 4096);
    this.rings = new RingPool(this.scene.scene, 14, 0xffd27a);
    this.view = new View(this.scene.scene, this.fx);
    this.input = new Input(canvas);

    this.sim = new Sim(this.makeEvents());

    const best = loadBest();
    const meta = loadMeta();
    this.store.getState().set({
      phase: 'title',
      best: best.score,
      bestWave: best.wave,
      dawn: meta.dawn,
      unlocked: meta.unlocked,
      muted: false,
      touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    });

    this.rig.setTitleMode();
    this.scene.setEnergy(0);

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);

    // QA/debug hooks
    (window as unknown as Record<string, unknown>).__hollowsun = {
      engine: this,
      sim: this.sim,
      store: this.store,
    };
  }

  /* ---------------------------------------------------------------- */
  /* public API used by React                                          */
  /* ---------------------------------------------------------------- */

  begin(): void {
    if (this.store.getState().phase !== 'title' && this.store.getState().phase !== 'dead') return;
    this.startRun();
  }

  private startRun(): void {
    this.audio.unlock();
    this.audio.uiClick();
    // stack the shrine into a fresh build
    this.sim.mods = metaMods(this.store.getState().unlocked);
    this.sim.reset();
    this.runBiome = 0;
    this.runRoom = 1;
    this.roomsCleared = 0;
    this.bossesKilled = 0;
    this.boonsTaken = {};
    this.lastBoonChoices = [];
    this.deathT = -1;
    this.hitstop = 0;
    this.slowT = 0;
    this.scene.setBiome(0);
    this.audio.setBiome(0);
    this.rig.engage(this.sim.px, this.sim.pz);
    this.sim.startRoom(0, 1);
    this.store.getState().set({
      phase: 'playing',
      score: 0,
      wave: 1,
      embers: this.sim.embers,
      shards: this.sim.shardCount,
      mult: 1,
      overdrive: 0,
      overdriveActive: false,
      sun: 0,
      banner: null,
      boonsTaken: [],
      bossBar: null,
      won: false,
      dawnEarned: 0,
      roomLabel: `${biomeName(0)} · ROOM 1`,
    });
  }

  restart(): void {
    const p = this.store.getState().phase;
    if (p !== 'paused' && p !== 'dead') return;
    this.startRun();
  }

  /* ---- reward shrine ---- */

  private openReward(): void {
    const depth = this.runBiome * RUN.roomsPerBiome + this.runRoom;
    this.lastBoonChoices = rollBoons(this.boonsTaken, 3, depth);
    this.store.getState().set({
      phase: 'reward',
      boonChoices: this.lastBoonChoices.map((b) => ({ id: b.id, name: b.name, desc: b.desc, tier: b.tier })),
    });
  }

  chooseBoon(i: number): void {
    if (this.store.getState().phase !== 'reward') return;
    const def = this.lastBoonChoices[i];
    if (!def) return;
    this.sim.applyBoon(def);
    this.boonsTaken[def.id] = (this.boonsTaken[def.id] ?? 0) + 1;
    this.store.getState().pushToast(`+ ${def.name}`, 'gold');
    this.audio.shrine();
    this.advanceRoom();
  }

  chooseHeal(): void {
    if (this.store.getState().phase !== 'reward') return;
    if (this.sim.embers < this.sim.maxEmbers) {
      this.sim.embers += 1;
      this.store.getState().pushToast('EMBER MENDED', 'gold');
    } else {
      this.store.getState().pushToast('ALREADY FULL', 'info');
    }
    this.audio.shrine();
    this.advanceRoom();
  }

  private advanceRoom(): void {
    this.runRoom += 1;
    if (this.runRoom > RUN.roomsPerBiome) {
      this.runBiome += 1;
      this.runRoom = 1;
      this.scene.setBiome(this.runBiome);
      this.audio.setBiome(this.runBiome);
      this.store.getState().showBanner(biomeName(this.runBiome), 'DEEPER INTO THE DEAD STAR', 'room');
    }
    this.sim.startRoom(this.runBiome, this.runRoom);
    this.store.getState().set({
      phase: 'playing',
      boonChoices: [],
      bossBar: null,
      roomLabel: `${biomeName(this.runBiome)} · ${isBossRoom(this.runRoom) ? 'BOSS' : 'ROOM ' + this.runRoom}`,
    });
  }

  /* ---- shrine of dawn (hub meta) ---- */

  buyUpgrade(id: string): void {
    const st = this.store.getState();
    const up = SHRINE_UPGRADES.find((u) => u.id === id);
    if (!up || st.unlocked[id] || st.dawn < up.cost) return;
    const meta = { dawn: st.dawn - up.cost, unlocked: { ...st.unlocked, [id]: true } };
    saveMeta(meta);
    this.store.getState().set(meta);
    this.audio.shrine();
    this.store.getState().pushToast(`${up.name} UNLOCKED`, 'gold');
  }

  /** bank dawn + best at run end (death or victory) */
  private finishRun(won: boolean): void {
    const dawn = dawnEarned(this.sim.score, this.roomsCleared, this.bossesKilled, won);
    const st = this.store.getState();
    const meta = { dawn: st.dawn + dawn, unlocked: st.unlocked };
    saveMeta(meta);
    const rec = { score: this.sim.score, wave: this.sim.wave };
    const best = { score: Math.max(rec.score, st.best), wave: Math.max(rec.wave, st.bestWave) };
    saveBest(best);
    this.store.getState().set({
      dawn: meta.dawn,
      dawnEarned: dawn,
      won,
      best: best.score,
      bestWave: best.wave,
      sun: won ? 1 : starEnergy(this.sim.score),
      ...(won ? { phase: 'dead' as const } : {}),
    });
  }

  pause(): void {
    if (this.store.getState().phase !== 'playing') return;
    this.store.getState().set({ phase: 'paused' });
    this.audio.uiClick();
  }

  resume(): void {
    if (this.store.getState().phase !== 'paused') return;
    this.store.getState().set({ phase: 'playing' });
    this.audio.unlock();
    this.audio.uiClick();
  }

  abandon(): void {
    this.sim.reset();
    this.store.getState().set({ phase: 'title', banner: null });
    this.rig.setTitleMode();
    this.audio.uiClick();
  }

  toggleMute(): void {
    const m = !this.store.getState().muted;
    this.store.getState().set({ muted: m });
    this.audio.setMuted(m);
  }

  queueThrow(): void {
    this.input.queueThrow();
  }
  queueDash(): void {
    this.input.queueDash();
  }
  setTouchMove(x: number, y: number): void {
    this.input.touchMoveX = x;
    this.input.touchMoveY = y;
  }

  dispose(): void {
    this.disposed = true;
    if (active === this) active = null;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.audio.dispose();
    this.view.dispose();
    this.fx.dispose();
    this.rings.dispose();
    this.scene.renderer.dispose();
    this.scene.sun.dispose();
  }

  /* ---------------------------------------------------------------- */
  /* sim events → fx / audio / store                                   */
  /* ---------------------------------------------------------------- */

  private makeEvents(): SimEvents {
    return {
      onThrow: (x, z) => {
        this.audio.throwShard();
        this.rig.addShake(FEEL.traumaThrow);
        this.rig.addFovKick(1);
        this.fx.burst(x, z, 14, 9, { color: SHARD_C, life: 0.4, size: 0.5, up: 0.2 });
      },
      onBounce: (x, z, chain) => {
        this.audio.ricochet(chain - 1);
        this.fx.burst(x, z, 40, 13, { color: SHARD_C, life: 0.5, size: 0.55, up: 0.3 });
        this.rings.fire(x, z, 3.4, 0.34, 0xffd27a);
      },
      onCatch: (x, z) => {
        this.audio.catchShard();
        this.fx.burst(x, z, 10, 6, { color: SHARD_C, life: 0.3, size: 0.45 });
      },
      onKill: (kind, x, z) => {
        this.audio.kill();
        this.hitstop = Math.min(FEEL.hitstopMax, this.hitstop + (kind === 'warden' ? FEEL.hitstopWarden : FEEL.hitstopKill));
        this.rig.addShake(kind === 'warden' ? FEEL.traumaWarden : FEEL.traumaKill);
        this.rig.addFovKick(FEEL.fovKickKill);
        this.fx.burst(x, z, BURST[kind], kind === 'warden' ? 24 : 15, {
          color: kind === 'warden' ? WARDEN_C : FOE_C,
          life: kind === 'warden' ? 1.4 : 0.95,
          size: 0.45,
          spiral: 15,
          up: 0.3,
        });
        this.rings.fire(x, z, kind === 'warden' ? 16 : 8, 0.6, 0xff8a5c);
        this.scene.floorPulse(x, z);
      },
      onGraze: (x, z) => {
        this.audio.graze();
        this.fx.spawn(x, 1, z, (Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 4, { life: 0.3, size: 0.4, color: WHITE_C });
      },
      onHurt: (x, z) => {
        this.audio.hurt();
        this.rig.addShake(FEEL.traumaHurt);
        this.fx.burst(x, z, 180, 20, { color: FOE_C, life: 0.8, size: 0.6 });
        this.store.getState().set({ embers: Math.max(0, this.sim.embers) });
      },
      onDash: (x, z) => {
        this.audio.dash();
        this.rig.addFovKick(FEEL.fovKickDash);
        this.fx.burst(x, z, 26, 12, { color: EMBER_C, life: 0.4, size: 0.5, up: 0.1 });
      },
      onWardenSpawn: (x, z) => {
        this.audio.wardenSpawn();
        this.rig.addShake(0.4);
        this.store.getState().showBanner(bossName(this.runBiome), 'IT KEEPS THE LIGHT', 'boss');
      },
      onWardenDie: (x, z) => {
        this.audio.wardenDie();
        this.rings.fire(x, z, 24, 0.9, 0xffc766);
        this.scene.floorPulse(x, z);
        this.bossesKilled += 1;
        this.store.getState().pushToast(`${bossName(this.runBiome)} FELLED — SHARD OF THE SUN +1`, 'gold');
      },
      onWaveStart: (n) => {
        void n;
        const st = this.store.getState();
        if (isBossRoom(this.runRoom)) {
          // boss banner fires from onWardenSpawn
        } else {
          st.showBanner(`ROOM ${this.runRoom}`, biomeName(this.runBiome), 'room');
        }
      },
      onWaveClear: () => {
        this.audio.waveClear();
        this.roomsCleared += 1;
        const st = this.store.getState();
        st.set({ sun: starEnergy(this.sim.score) });
        if (this.runBiome === 2 && isBossRoom(this.runRoom)) {
          // THE HEART rekindles — run won
          this.finishRun(true);
          return;
        }
        st.pushToast(isBossRoom(this.runRoom) ? 'WARDEN FELLED' : 'ROOM CLEARED', 'gold');
        this.openReward();
      },
      onRecall: (x, z) => {
        this.audio.recall();
        this.fx.burst(x, z, 26, 12, { color: SHARD_C, life: 0.4, size: 0.5, up: 0.2 });
      },
      onShieldBreak: (x, z) => {
        this.audio.shieldBreak();
        this.fx.burst(x, z, 60, 14, { color: GOLD_C, life: 0.5, size: 0.5, up: 0.3 });
        this.rings.fire(x, z, 3.2, 0.35, 0xffe9a0);
      },
      onBossPhase: (x, z, phase) => {
        this.audio.bossPhase();
        this.rig.addShake(0.35);
        this.hitstop = Math.min(FEEL.hitstopMax, this.hitstop + 0.12);
        this.rings.fire(x, z, 14 + phase * 4, 0.8, 0xff7a2d);
        this.store.getState().pushToast(`THE WARDEN RAGES — PHASE ${phase}`, 'red');
      },
      onRevive: (x, z) => {
        this.audio.revive();
        this.rig.addShake(0.5);
        this.fx.burst(x, z, 300, 20, { color: EMBER_C, life: 1.1, size: 0.6, spiral: 16, up: 0.4 });
        this.rings.fire(x, z, 18, 0.9, 0xffe9bd);
        this.store.getState().showBanner('SECOND DAWN', 'THE SHRINE REMEMBERS YOU', 'overdrive');
      },
      onOverdriveStart: () => {
        this.audio.overdriveStart();
        this.rig.addFovKick(FEEL.fovKickOverdrive);
        this.store.getState().showBanner('OVERDRIVE', 'THE WORLD SLOWS — YOU DO NOT', 'overdrive');
      },
      onShardGain: () => {
        this.audio.shardGain();
      },
      onDeath: () => {
        this.audio.death();
        this.rig.addShake(1);
        this.slowT = 1.3;
        this.deathT = 1.35;
        this.fx.burst(this.sim.px, this.sim.pz, 700, 24, { color: EMBER_C, life: 1.6, size: 0.55, spiral: 18, up: 0.5 });
        this.rings.fire(this.sim.px, this.sim.pz, 26, 1.1, 0xffe9bd);
        this.finishRun(false);
      },
      onSpawnMark: (x, z) => {
        this.rings.fire(x, z, 2.2, 0.8, 0xff2d4e);
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* main loop                                                         */
  /* ---------------------------------------------------------------- */

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dtReal = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const phase = this.store.getState().phase;

    if (phase === 'title') {
      this.scene.update(dtReal);
      this.rig.update(dtReal, this.scene.camera, 0, 0, 0, 0, false, false);
      this.view.sync(this.sim, 0, 0, false, dtReal);
      this.rings.update(dtReal);
      this.fx.update(dtReal);
      this.scene.render();
      return;
    }

    if (phase === 'paused' || phase === 'dead' || phase === 'reward') {
      this.scene.render();
      return;
    }

    // ---- playing (or dying) ----

    // edges consumed once per frame
    if (this.input.consumePause()) {
      this.pause();
    }

    if (this.sim.over) {
      // dying: no sim steps — let the death burst settle, then show the overlay
      this.deathT -= dtReal;
      this.acc = 0;
      this.rings.update(dtReal);
      this.fx.update(dtReal);
      this.scene.update(dtReal * 0.45);
      this.rig.setVelocity(0, 0);
      this.rig.update(dtReal, this.scene.camera, this.sim.px, this.sim.pz, 0, 0, false, false);
      this.view.sync(this.sim, this.aim.x, this.aim.z, false, dtReal);
      this.scene.render();
      if (this.deathT <= 0) {
        this.store.getState().set({ phase: 'dead' });
      }
      return;
    }

    // aim (mouse → arena plane; touch → auto-aim)
    this.updateAim();

    const wantThrow = this.input.consumeThrow();
    const wantDash = this.input.consumeDash();
    const mx = this.input.moveX;
    const my = this.input.moveY;

    this.acc += dtReal;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      let dt = STEP;
      if (this.hitstop > 0) {
        this.hitstop -= STEP;
        dt = 0;
      }
      let enemyDt = dt * (this.sim.odActive ? OVERDRIVE.enemyTimeScale : 1);
      if (this.slowT > 0) {
        this.slowT -= STEP;
        dt *= 0.35;
        enemyDt *= 0.35;
      }
      this.sim.update(dt, enemyDt, mx, my, this.aim.x, this.aim.z, wantThrow, wantDash);
      this.acc -= STEP;
      steps++;
    }
    if (steps === 5) this.acc = 0;

    // visuals follow the sim
    const st = this.store.getState();
    const energy = starEnergy(this.sim.score);
    this.scene.setEnergy(energy);
    this.scene.floorMat.uniforms.uPlayer.value.set(this.sim.px, this.sim.pz);
    this.scene.bloom.strength = 1.0 + (this.sim.odActive ? 0.22 : 0) + energy * 0.1;
    this.scene.update(dtReal);
    this.rig.setVelocity(this.sim.pvx, this.sim.pvz);
    this.rig.update(dtReal, this.scene.camera, this.sim.px, this.sim.pz, this.sim.pvx, this.sim.pvz, this.sim.odActive, false);
    this.view.sync(this.sim, this.aim.x, this.aim.z, !st.touch, dtReal);
    this.rings.update(dtReal);
    this.fx.update(dtReal);
    this.audio.setOverdrive(this.sim.odActive, this.sim.odActive ? 1 - this.sim.odT / OVERDRIVE.duration : 0);

    // danger ambience + heartbeat at one ember
    let nearest = 99;
    for (const f of this.sim.foes) {
      const d = Math.hypot(f.x - this.sim.px, f.z - this.sim.pz);
      if (d < nearest) nearest = d;
    }
    this.audio.setDanger(1 - Math.min(1, nearest / 16));
    if (this.sim.embers === 1) {
      this.heartT -= dtReal;
      if (this.heartT <= 0) {
        this.heartT = 0.95;
        this.audio.heartbeat();
      }
    }

    // HUD at ~12Hz
    this.hudT += dtReal;
    if (this.hudT > 0.085) {
      this.hudT = 0;
      const boss = this.sim.foes.find((f) => f.boss);
      const boonLabels = Object.entries(this.boonsTaken).map(([id, n]) => {
        const def = BOONS.find((b) => b.id === id);
        return def ? (n > 1 ? `${def.name.split(' ')[0]}×${n}` : def.name.split(' ')[0]) : '';
      }).filter(Boolean);
      this.store.getState().set({
        score: this.sim.score,
        mult: this.sim.mult,
        wave: this.sim.wave,
        enemiesLeft: this.sim.enemiesLeft,
        shards: this.sim.shardCount,
        embers: this.sim.embers,
        dashReady: Math.max(0, Math.min(1, 1 - this.sim.dashCd / PLAYER.dashCooldown)),
        overdrive: this.sim.odActive ? Math.max(0, this.sim.odT / OVERDRIVE.duration) : this.sim.odCharge / OVERDRIVE.max,
        overdriveActive: this.sim.odActive,
        sun: energy,
        roomLabel: `${biomeName(this.runBiome)} · ${isBossRoom(this.runRoom) ? 'BOSS' : 'ROOM ' + this.runRoom}`,
        bossBar: boss ? { name: bossName(this.runBiome), frac: Math.max(0, boss.hp / boss.maxHp) } : null,
        boonsTaken: boonLabels,
      });
    }

    this.scene.render();
  };

  private updateAim(): void {
    const st = this.store.getState();
    if (st.touch || !this.input.hasMouseAim) {
      // auto-aim at nearest foe; otherwise straight ahead of the ember
      let best: { x: number; z: number } | null = null;
      let bestD = 42;
      for (const f of this.sim.foes) {
        if (f.spawnT > 0) continue;
        const d = Math.hypot(f.x - this.sim.px, f.z - this.sim.pz);
        if (d < bestD) {
          bestD = d;
          best = { x: f.x, z: f.z };
        }
      }
      if (best) {
        this.aim.set(best.x, 0, best.z);
      } else {
        const len = Math.hypot(this.sim.pvx, this.sim.pvz);
        if (len > 1) this.aim.set(this.sim.px + (this.sim.pvx / len) * 8, 0, this.sim.pz + (this.sim.pvz / len) * 8);
        else this.aim.set(this.sim.px, 0, this.sim.pz - 8);
      }
      return;
    }
    this.ndc.set((this.input.mouseX / window.innerWidth) * 2 - 1, -(this.input.mouseY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.scene.camera);
    const dir = this.raycaster.ray.direction;
    const origin = this.raycaster.ray.origin;
    if (Math.abs(dir.y) > 1e-4) {
      const t = -origin.y / dir.y;
      this.aim.copy(origin).addScaledVector(dir, t);
      const d = Math.hypot(this.aim.x, this.aim.z);
      if (d > ARENA.radius) {
        const s = ARENA.radius / d;
        this.aim.x *= s;
        this.aim.z *= s;
      }
    }
  }

  private onResize = (): void => {
    this.scene.resize();
  };

  private onVisibility = (): void => {
    if (document.hidden && this.store.getState().phase === 'playing') {
      this.pause();
    }
  };
}

const SHARD_C = new THREE.Color(0xffd27a);
const FOE_C = new THREE.Color(0xff5a3c);
const WARDEN_C = new THREE.Color(0xff7a2d);
const EMBER_C = new THREE.Color(0xffe9bd);
const WHITE_C = new THREE.Color(0xffffff);
const GOLD_C = new THREE.Color(0xffe9a0);
