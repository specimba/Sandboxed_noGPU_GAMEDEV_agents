import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { draftById } from './draft';
import { AfterglowView } from './view';
import { ParticlePool, RingPool } from '../fx';
import { CameraRig } from './cameraRig';
import { Input } from './input';
import { ARENA_RADIUS } from './constants';
import { Sim, type AfterglowEvents } from './sim';
import { useAfterglowStore } from './store';
import { AfterglowAudio } from './audio';
import { DamageNumbers } from './damageNumbers';

/**
 * AFTERGLOW engine — fixed-timestep orchestrator for the new sim.
 * The sim owns the fixed clock (it substeps internally at 1/60); the engine
 * accumulates real dt (cap 0.1s) and feeds it through, then the view re-syncs
 * from public sim state and the composer renders. Phases: title (slow orbit
 * attract) → playing → draft (sim wave.phase) → dead.
 */

const STEP = 1 / 60;
const MAX_STEPS = 6; // 0.1s cap ≈ 6 substeps — matches the dt clamp

/* ------------------------------------------------------------------ */
/* perf instrumentation — feeds the __hollowsun debug hook            */
/* module-level + preallocated so the frame loop allocates nothing     */
/* (exact house pattern from src/game/engine.ts)                       */
/* ------------------------------------------------------------------ */

interface PerfSnapshot {
  render: { calls: number; triangles: number };
  memory: { geometries: number; textures: number };
  programs: number;
  fps: number;
  frameMs: { ema: number; p95: number };
  drawCallsPeak: number;
  uptimeSec: number;
}

const PERF_RING = 120; // ~2s of frame samples at 60fps
const perfRing = new Float32Array(PERF_RING);
let perfRingAt = 0;
let perfRingLen = 0;
let perfBootAt = 0;
let perfFpsEma = 0;
let perfMsEma = 0;
let perfDrawPeak = 0;
const perfScratch: number[] = []; // reused by perfSnapshot's p95 sort

let active: AfterglowEngine | null = null;
export function getAfterglowEngine(): AfterglowEngine | null {
  return active;
}

const EMBER_C = new THREE.Color(0xffe9bd);
const FOE_C = new THREE.Color(0xff7a4a);
const HOT_C = new THREE.Color(0xff5a2d);
const BOLT_C = new THREE.Color(0xffd98f);
const EMBER_UP_C = new THREE.Color(0xffb454);
const SMOKE_C = new THREE.Color(0x241410);

const BURST: Record<string, number> = { wisp: 40, husk: 120, cinder: 28 };

export class AfterglowEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private fx: ParticlePool;
  private smoke: ParticlePool;
  private rings: RingPool;
  private view: AfterglowView;
  private rig = new CameraRig();
  private input: Input;
  private sim: Sim;
  private audio: AfterglowAudio;
  private damage: DamageNumbers;
  private store = useAfterglowStore;

  private raf = 0;
  private lastT = 0;
  private acc = 0;
  private hudT = 0;
  private deathT = -1;
  private prevPX = 0;
  private prevPZ = 0;
  private velX = 0;
  private velZ = 0;
  private disposed = false;
  // engine-side hit-stop: view/engine-owned time dilation (14-b spec)
  private hitStopT = 0;
  private hitStopCd = 0;

  constructor(canvas: HTMLCanvasElement) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    active = this;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070403);
    // warm smoke haze — slightly lifted so silhouettes read off the void
    this.scene.fog = new THREE.FogExp2(0x120906, 0.011);

    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 220);
    this.camera.position.set(0, 20, 24);

    // post: restrained bloom over the ember palette IS the look here
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.38, 0.62));
    this.composer.addPass(new OutputPass());

    this.fx = new ParticlePool(this.scene, 2048);
    // dark smoke puffs (husk deaths) — NormalBlending, the second pool tone
    this.smoke = new ParticlePool(this.scene, 256, { blending: THREE.NormalBlending });
    this.rings = new RingPool(this.scene, 14, 0xffb454);
    this.view = new AfterglowView(this.scene, this.fx, this.rings);
    this.input = new Input();

    this.sim = new Sim(this.makeSeed(), this.makeEvents());
    this.view.syncPillars(this.sim);
    this.audio = new AfterglowAudio();
    this.audio.attach(this.sim);
    this.damage = new DamageNumbers();

    this.store.getState().set({
      phase: 'title',
      muted: false,
      touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
      offers: [],
      lastPick: null,
      runStats: { wave: 0, kills: 0, light: 0, time: 0 },
    });

    this.rig.setTitleMode();

    window.addEventListener('resize', this.onResize);

    // QA instrumentation: one perf window per frame spanning every composer
    // pass — samplePerf() reads + resets info at frame start.
    this.renderer.info.autoReset = false;
    perfBootAt = performance.now();
    perfRingAt = 0;
    perfRingLen = 0;
    perfFpsEma = 0;
    perfMsEma = 0;
    perfDrawPeak = 0;

    this.prevPX = this.sim.player.x;
    this.prevPZ = this.sim.player.z;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);

    this.installHook();
  }

  /* ---------------------------------------------------------------- */
  /* public API used by React                                          */
  /* ---------------------------------------------------------------- */

  begin(): void {
    const p = this.store.getState().phase;
    if (p !== 'title' && p !== 'dead') return;
    this.audio.unlock(); // gesture law: first click creates/resumes audio ctx
    this.startRun();
  }

  pickDraft(id: string): void {
    if (this.store.getState().phase !== 'draft') return;
    if (this.sim.pickDraft(id)) {
      const def = draftById(id);
      this.store.getState().set({
        phase: 'playing',
        offers: [],
        lastPick: id,
      });
      if (def) this.store.getState().pushToast(`+ ${def.name}`, 'gold');
    }
  }

  requestDash(): void {
    this.input.queueDash();
  }

  setTouchMove(x: number, y: number): void {
    this.input.touchMoveX = x;
    this.input.touchMoveY = y;
  }

  toggleMute(): void {
    const m = !this.store.getState().muted;
    this.store.getState().set({ muted: m });
    this.audio.setMuted(m);
  }

  /** draft card hover blip (rate-limited inside the audio adapter) */
  draftHover(): void {
    this.audio.hover();
  }

  dispose(): void {
    this.disposed = true;
    if (active === this) active = null;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.view.dispose();
    this.audio.dispose();
    this.damage.dispose();
    this.fx.dispose();
    this.smoke.dispose();
    this.rings.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  /* ---------------------------------------------------------------- */
  /* run lifecycle                                                     */
  /* ---------------------------------------------------------------- */

  private makeSeed(): number {
    return (Date.now() ^ Math.floor(Math.random() * 0xffffff)) % 100000;
  }

  private startRun(): void {
    // fresh sim = fresh seed = fresh pillar layout (deterministic per seed)
    this.sim = new Sim(this.makeSeed(), this.makeEvents());
    this.audio.attach(this.sim); // BEFORE start() so wave-1 start chime fires
    this.sim.start();
    this.view.syncPillars(this.sim);
    this.prevPX = this.sim.player.x;
    this.prevPZ = this.sim.player.z;
    this.velX = 0;
    this.velZ = 0;
    this.acc = 0;
    this.deathT = -1;
    this.rig.engage(this.sim.player.x, this.sim.player.z);
    this.store.getState().set({
      phase: 'playing',
      wave: 1,
      wavePhase: 'intro',
      foesLeft: 0,
      hp: this.sim.player.hp,
      maxHp: this.sim.player.maxHp,
      shield: 0,
      wardMax: 0,
      light: 0,
      kills: 0,
      dashReady: 1,
      volleys: 1,
      time: 0,
      offers: [],
      lastPick: null,
      runStats: { wave: 0, kills: 0, light: 0, time: 0 },
      banner: null,
    });
    this.installHook();
  }

  private makeEvents(): AfterglowEvents {
    return {
      onFoeHurt: (kind, x, z, dmg, src) => {
        // damage numbers on discrete hits; burn DoT ticks are filtered out
        // (they'd strobe every frame) — view-side only, sim untouched
        if (src !== 'burn') this.damage.spawn(x, z, dmg, src === 'chain');
        void kind;
      },
      onFoeDie: (kind, x, z) => {
        // engine-side hit-stop on every kill — husks land harder
        this.tryHitStop(kind === 'husk' ? 0.11 : 0.07);
        this.fx.burst(x, z, BURST[kind] ?? 40, kind === 'husk' ? 16 : 12, {
          color: FOE_C,
          life: 0.8,
          size: 0.5,
          up: 0.3,
        });
        if (kind === 'husk') {
          // dark smoke puffs — the wedge brute dies heavy
          this.smoke.burst(x, z, 5, 2.2, { color: SMOKE_C, life: 1.4, size: 1.7, up: 0.9, drag: 1.0 });
        } else {
          // wisp/cinder: ember column rising out of the kill
          for (let i = 0; i < 12; i++) {
            this.fx.spawn(x, 0.7 + Math.random() * 0.5, z, (Math.random() - 0.5) * 1.1, 2.5 * (0.6 + Math.random() * 0.7), (Math.random() - 0.5) * 1.1, {
              life: 0.75,
              size: 0.45,
              color: EMBER_UP_C,
              drag: 0.7,
            });
          }
        }
        this.rings.fire(x, z, kind === 'husk' ? 6 : 3.4, 0.45, 0xff8a5c);
        this.pushHud();
      },
      onHurt: (x, z, hp) => {
        // husk charge connecting — the heaviest hit-stop in the game
        for (const f of this.sim.foes) {
          if ((f.state === 'windup' || f.state === 'charge') && Math.hypot(f.x - x, f.z - z) < 4) {
            this.tryHitStop(0.12);
            break;
          }
        }
        this.rig.addShake(0.5);
        this.view.flashHurt();
        this.fx.burst(x, z, 60, 14, { color: HOT_C, life: 0.6, size: 0.55, up: 0.3 });
        this.store.getState().set({ hp });
      },
      onDash: (x, z) => {
        this.rig.addFovKick(3.5);
        this.fx.burst(x, z, 24, 10, { color: EMBER_C, life: 0.4, size: 0.5, up: 0.1 });
        this.rings.fire(x, z, 2.2, 0.3, 0xffdca0);
      },
      onWaveStart: (n) => {
        this.store.getState().showBanner(`WAVE ${n}`, n === 1 ? 'THEY COME FOR THE LIGHT' : 'THE DARK SENDS MORE');
      },
      onWaveClear: (n) => {
        this.store.getState().pushToast(`WAVE ${n} CLEARED`, 'gold');
        // kindle ring sweeping from the player — the arena exhales
        this.rings.fire(this.sim.player.x, this.sim.player.z, ARENA_RADIUS * 0.4, 1.2, 0xffb454);
      },
      onDraftOffer: (_n, choices) => {
        this.store.getState().set({ offers: [...choices] });
      },
      onDraftPick: () => {
        // store flip handled in pickDraft
      },
      onSpawn: (kind, x, z) => {
        void kind;
        this.rings.fire(x, z, 2.0, 0.5, 0xff5a3d);
      },
      onDeath: (x, z, wave, kills, light) => {
        this.rig.addShake(0.8);
        this.fx.burst(x, z, 320, 20, { color: EMBER_C, life: 1.4, size: 0.55, spiral: 14, up: 0.4 });
        this.rings.fire(x, z, 24, 1.0, 0xffe9bd);
        this.deathT = 1.35;
        this.store.getState().set({
          runStats: { wave, kills, light, time: this.sim.time },
          offers: [],
        });
      },
      onMote: () => {
        /* motes render from sim state */
      },
      onPickup: () => {
        const p = this.sim.player;
        this.fx.spawn(p.x, 1.0, p.z, (Math.random() - 0.5) * 2, 1.8, (Math.random() - 0.5) * 2, {
          life: 0.3,
          size: 0.4,
          color: BOLT_C,
        });
      },
      onPillar: (x, z) => {
        this.fx.burst(x, z, 8, 7, { color: BOLT_C, life: 0.25, size: 0.4, up: 0.2 });
      },
    };
  }

  private installHook(): void {
    (window as unknown as Record<string, unknown>).__hollowsun = {
      engine: this,
      sim: this.sim,
      store: this.store,
      perf: () => this.perfSnapshot(),
      perfSnapshot: () => this.perfSnapshot(),
    };
  }

  /* ---------------------------------------------------------------- */
  /* main loop                                                         */
  /* ---------------------------------------------------------------- */

  /** engine-side hit-stop with a 150ms retrigger cooldown */
  private tryHitStop(seconds: number): void {
    if (this.hitStopCd > 0) return;
    this.hitStopT = seconds;
    this.hitStopCd = 0.15;
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dtReal = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    this.samplePerf(dtReal);
    const phase = this.store.getState().phase;

    if (phase === 'title') {
      // attract mode: slow orbit over the idle arena (sim not started)
      this.rig.update(dtReal, this.camera, 0, 0, 0, 0, false);
      this.view.sync(this.sim, dtReal);
      this.fx.update(dtReal);
      this.smoke.update(dtReal);
      this.rings.update(dtReal);
      this.render();
      return;
    }

    if (phase === 'dead') {
      this.rig.update(dtReal, this.camera, this.sim.player.x, this.sim.player.z, 0, 0, false);
      this.view.sync(this.sim, dtReal);
      this.audio.update(this.sim); // keeps danger drone decaying after death
      this.damage.update(this.camera, dtReal);
      this.fx.update(dtReal);
      this.smoke.update(dtReal);
      this.rings.update(dtReal);
      this.render();
      return;
    }

    // ---- playing / draft ----

    if (this.input.consumeDash()) this.sim.requestDash();
    this.sim.setMove(this.input.moveX, -this.input.moveY); // screen up = −Z

    // engine-side hit-stop: the sim crawls at 12%, fx/rings breathe at 40%,
    // camera + HUD keep real time — time-based, framerate-independent
    this.hitStopT = Math.max(0, this.hitStopT - dtReal);
    this.hitStopCd = Math.max(0, this.hitStopCd - dtReal);
    const slow = this.hitStopT > 0;
    const simDt = slow ? dtReal * 0.12 : dtReal;
    const fxDt = slow ? dtReal * 0.4 : dtReal;

    // fixed clock: accumulate real dt, step the sim per 1/60 substep
    this.acc += simDt;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS && !this.sim.over) {
      this.sim.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;

    // draft phase is driven by the sim (single source of truth)
    const st = this.store.getState();
    if (this.sim.wave.phase === 'draft' && st.phase === 'playing') {
      st.set({ phase: 'draft', offers: [...this.sim.offers] });
    } else if (this.sim.wave.phase !== 'draft' && st.phase === 'draft') {
      st.set({ phase: 'playing', offers: [] });
    }

    // death settle: let the burst breathe, then raise the overlay
    if (this.sim.over && this.deathT > 0) {
      this.deathT -= dtReal;
      if (this.deathT <= 0) this.store.getState().set({ phase: 'dead' });
    }

    // velocity estimate for the camera lead (sim exposes positions only)
    if (dtReal > 0.0001) {
      const vx = (this.sim.player.x - this.prevPX) / dtReal;
      const vz = (this.sim.player.z - this.prevPZ) / dtReal;
      const k = Math.min(1, dtReal * 12);
      this.velX += (vx - this.velX) * k;
      this.velZ += (vz - this.velZ) * k;
    }
    this.prevPX = this.sim.player.x;
    this.prevPZ = this.sim.player.z;

    this.rig.update(dtReal, this.camera, this.sim.player.x, this.sim.player.z, this.velX, this.velZ, false);
    this.view.sync(this.sim, fxDt);
    this.audio.update(this.sim); // husk windup screams / heartbeat / danger
    this.damage.update(this.camera, dtReal); // numbers keep real time
    this.fx.update(fxDt);
    this.smoke.update(fxDt);
    this.rings.update(fxDt);

    // HUD at ~10Hz
    this.hudT += dtReal;
    if (this.hudT > 0.1) {
      this.hudT = 0;
      this.pushHud();
    }

    this.render();
  };

  private pushHud(): void {
    this.store.getState().set({
      wave: this.sim.wave.n,
      wavePhase: this.sim.wave.phase,
      foesLeft: this.sim.foes.length,
      hp: this.sim.player.hp,
      maxHp: this.sim.player.maxHp,
      shield: this.sim.player.shield,
      wardMax: this.sim.mods.wardMax,
      light: this.sim.light,
      kills: this.sim.kills,
      dashReady: Math.max(0, Math.min(1, 1 - this.sim.player.dashCd / (2.5 * this.sim.mods.dashCdMul))),
      volleys: 1 + this.sim.mods.volleys,
      time: this.sim.time,
    });
  }

  private render(): void {
    this.composer.render();
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  };

  /* ---------------------------------------------------------------- */
  /* perf sampling — once per frame, zero allocations in the hot path  */
  /* ---------------------------------------------------------------- */

  private samplePerf(dtReal: number): void {
    const info = this.renderer.info;
    if (info.render.calls > perfDrawPeak) perfDrawPeak = info.render.calls;
    info.reset();

    const ms = dtReal * 1000;
    perfRing[perfRingAt] = ms;
    perfRingAt = (perfRingAt + 1) % PERF_RING;
    if (perfRingLen < PERF_RING) perfRingLen += 1;
    if (ms > 0) {
      perfFpsEma += ((1000 / ms) - perfFpsEma) * 0.05;
      perfMsEma += (ms - perfMsEma) * 0.05;
    }
  }

  private perfSnapshot(): PerfSnapshot {
    const info = this.renderer.info;
    perfScratch.length = 0;
    for (let i = 0; i < perfRingLen; i++) {
      perfScratch.push(perfRing[(perfRingAt - perfRingLen + i + PERF_RING) % PERF_RING]);
    }
    perfScratch.sort((a, b) => a - b);
    const p95 = perfRingLen > 0 ? perfScratch[Math.min(perfRingLen - 1, Math.floor(perfRingLen * 0.95))] : 0;

    const snap: PerfSnapshot = {
      render: { calls: info.render.calls, triangles: info.render.triangles },
      memory: { geometries: info.memory.geometries, textures: info.memory.textures },
      programs: info.programs !== null ? info.programs.length : 0,
      fps: Math.round(perfFpsEma * 100) / 100,
      frameMs: { ema: Math.round(perfMsEma * 100) / 100, p95: Math.round(p95 * 100) / 100 },
      drawCallsPeak: perfDrawPeak,
      uptimeSec: perfBootAt > 0 ? Math.round(((performance.now() - perfBootAt) / 1000) * 1000) / 1000 : 0,
    };
    perfDrawPeak = info.render.calls;
    return snap;
  }
}
