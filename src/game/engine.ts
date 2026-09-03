import * as THREE from 'three';
import {
  ARENA,
  FEEL,
  OVERDRIVE,
  PLAYER,
  SHARD,
  WAVES,
  starEnergy,
} from './constants';
import { AudioEngine } from './audio';
import { CameraRig } from './cameraRig';
import { ParticlePool, RingPool } from './fx';
import { Input } from './input';
import { Scene } from './scene';
import { Sim, type FoeKind, type SimEvents } from './sim';
import { loadBest, saveBest, useGameStore } from './store';
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
    this.store.getState().set({
      phase: 'title',
      best: best.score,
      bestWave: best.wave,
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
    this.audio.unlock();
    this.audio.uiClick();
    this.sim.reset();
    this.deathT = -1;
    this.hitstop = 0;
    this.slowT = 0;
    this.rig.engage(this.sim.px, this.sim.pz);
    this.store.getState().set({
      phase: 'playing',
      score: 0,
      wave: 0,
      embers: this.sim.embers,
      shards: this.sim.shardCount,
      mult: 1,
      overdrive: 0,
      overdriveActive: false,
      sun: 0,
      banner: null,
    });
  }

  restart(): void {
    if (this.store.getState().phase !== 'paused' && this.store.getState().phase !== 'dead') return;
    this.audio.uiClick();
    this.sim.reset();
    this.deathT = -1;
    this.hitstop = 0;
    this.slowT = 0;
    this.rig.snap(this.sim.px, this.sim.pz);
    this.store.getState().set({ phase: 'playing', banner: null, mult: 1 });
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
        this.store.getState().showBanner('THE WARDEN', 'IT KEEPS THE LIGHT', 'warden');
      },
      onWardenDie: (x, z) => {
        this.audio.wardenDie();
        this.rings.fire(x, z, 24, 0.9, 0xffc766);
        this.scene.floorPulse(x, z);
        this.store.getState().pushToast('WARDEN FELLED — SHARD OF THE SUN +1', 'gold');
      },
      onWaveStart: (n) => {
        this.audio.waveStart(n);
        const warden = n % WAVES.wardenEvery === 0;
        this.store.getState().showBanner(`WAVE ${n}`, warden ? 'SOMETHING STIRS IN THE DARK' : 'THEY HEARD YOU', 'wave');
        this.store.getState().set({ wave: n });
      },
      onWaveClear: (n) => {
        this.audio.waveClear();
        this.store.getState().pushToast(`WAVE ${n} CLEARED`, 'gold');
        this.store.getState().set({ sun: starEnergy(this.sim.score) });
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
        // commit best
        const s = this.store.getState();
        const rec = { score: this.sim.score, wave: this.sim.wave };
        if (rec.score > s.best || rec.wave > s.bestWave) {
          saveBest({ score: Math.max(rec.score, s.best), wave: Math.max(rec.wave, s.bestWave) });
          this.store.getState().set({ best: Math.max(rec.score, s.best), bestWave: Math.max(rec.wave, s.bestWave) });
        }
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

    if (phase === 'paused' || phase === 'dead') {
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
