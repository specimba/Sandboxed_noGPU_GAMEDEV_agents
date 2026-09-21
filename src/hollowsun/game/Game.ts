/**
 * HOLLOW SUN — Game: finite-state machine + wiring of sim/world/fx/ui.
 *
 * Phases: title → run ⇄ pause → over → (restart) run.
 * The Loop always runs; sim only steps during 'run'. World/post/juice/UI
 * keep animating in every phase (title shows the live arena behind the UI).
 */
import { Vector3 } from "three/webgpu";
import { Loop } from "../core/Loop";
import { Input } from "../core/Input";
import { Sim } from "../sim/Sim";
import { SIM_HZ } from "../sim/tuning";
import { WorldView } from "../world/WorldView";
import { PostStack } from "../fx/PostStack";
import { Juice } from "../fx/Juice";
import { AudioEngine } from "../fx/AudioEngine";
import { UI } from "../ui/UI";
import {
  EV,
  type FXState,
  type SimEvent,
  type SimInput,
  type Snap,
  type UIPhase,
  type UIState,
} from "../types";

const BEST_KEY = "hs_best";
const BANNER_SUBS = [
  "THE HUNGER GROWS",
  "THE VOID BREATHES",
  "THEY REMEMBER THE LIGHT",
  "FEED THE STAR",
  "DARKNESS ANSWERS",
];

export interface GameDeps {
  container: HTMLElement;
  fx: FXState;
  world: WorldView;
  post: PostStack;
}

export class Game {
  private readonly container: HTMLElement;
  private readonly fx: FXState;
  private readonly world: WorldView;
  private readonly post: PostStack;
  private readonly sim: Sim;
  private readonly input: Input;
  private readonly juice: Juice;
  private readonly audio: AudioEngine;
  private readonly ui: UI;
  private readonly loop: Loop;

  private phase: UIPhase = "title";
  private readonly si: SimInput = {
    mvx: 0,
    mvy: 0,
    aimX: 1,
    aimY: 0,
    fireHeld: false,
    fireEdge: false,
    dashEdge: false,
    odEdge: false,
  };
  private readonly aim = { x: 1, y: 0 };
  private readonly uiState: UIState = {
    phase: "title",
    hearts: 3,
    maxHearts: 3,
    score: 0,
    best: 0,
    combo: 0,
    comboT: 0,
    sun: 0,
    od: 0,
    odActive: false,
    dash: 1,
    wave: 0,
    muted: false,
    fps: 60,
    stats: { score: 0, wave: 0, maxCombo: 0, grazes: 0, kills: 0, time: 0, newBest: false },
  };

  private best = 0;
  private bestAtStart = 0;
  private fpsEma = 60;
  private lowFpsFrames = 0;
  private qualityDropped = false;
  private disposed = false;
  private dbg: HTMLDivElement | null = null;

  private readonly onResize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.world.resize(w, h);
    this.post.setSize(w, h);
  };

  private readonly onVisibility = (): void => {
    if (document.hidden && this.phase === "run") this.pause();
  };

  constructor(deps: GameDeps) {
    this.container = deps.container;
    this.fx = deps.fx;
    this.world = deps.world;
    this.post = deps.post;

    this.sim = new Sim((Date.now() & 0xffff) | 1);
    this.input = new Input(this.container);
    this.input.attach();
    this.juice = new Juice(this.fx, this.container);
    this.audio = new AudioEngine();
    this.ui = UI.create(this.container, {
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onRestart: () => this.startRun(),
      onToggleMute: () => this.toggleMute(),
    });

    // World → screen projector for score popups (kill positions).
    const projV = { sx: 0, sy: 0 };
    const projVec = new Vector3();
    this.juice.setProjector((x: number, y: number): { sx: number; sy: number } => {
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      projVec.set(x, 1.2, y).project(this.world.camera);
      projV.sx = (projVec.x * 0.5 + 0.5) * w;
      projV.sy = (-projVec.y * 0.5 + 0.5) * h;
      return projV;
    });

    try {
      const raw = window.localStorage.getItem(BEST_KEY);
      this.best = raw ? Math.max(0, Math.floor(Number(raw) || 0)) : 0;
    } catch {
      this.best = 0;
    }

    // Dev forensics: ?debug=1 shows live sim counters (DOM-readable).
    if (typeof window !== "undefined" && /debug=1/.test(window.location.search)) {
      this.dbg = document.createElement("div");
      this.dbg.style.cssText =
        "position:fixed;left:8px;bottom:8px;z-index:60;color:#fff7ea;opacity:0.5;" +
        "font:10px/1.4 monospace;pointer-events:none;white-space:pre;";
      document.body.appendChild(this.dbg);
    }

    this.loop = new Loop({ stepHz: SIM_HZ, fx: this.fx, tick: this.tick, render: this.render });
    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.loop.dispose();
    this.input.detach();
    this.ui.dispose();
    this.juice.dispose();
    this.audio.dispose();
    this.post.dispose();
    this.world.dispose();
  }

  // ---------------------------------------------------------------- phases

  private startRun(): void {
    this.audio.unlock();
    // Enable gameplay input from the first run onward (Input boots disabled
    // for the title screen; Esc-pause keeps it enabled — sim simply skips).
    this.input.setEnabled(true);
    this.sim.reset((Date.now() & 0xffff) | 1);
    this.bestAtStart = this.best;
    this.uiState.stats.newBest = false;
    this.phase = "run";
  }

  private pause(): void {
    if (this.phase !== "run") return;
    this.phase = "pause";
  }

  private resume(): void {
    if (this.phase !== "pause") return;
    this.audio.unlock();
    this.phase = "run";
  }

  private toggleMute(): void {
    this.audio.setMuted(!this.audio.muted);
  }

  // ---------------------------------------------------------------- loop

  private tick = (dt: number): void => {
    const st = this.input.state;
    if (this.phase !== "run") {
      this.clearActionEdges();
      return;
    }
    this.si.mvx = st.mvx;
    this.si.mvy = st.mvy;
    this.si.aimX = this.aim.x;
    this.si.aimY = this.aim.y;
    this.si.fireHeld = st.fireHeld;
    this.si.fireEdge = st.fireEdge;
    this.si.dashEdge = st.dashEdge;
    this.si.odEdge = st.odEdge;
    this.sim.step(dt, this.si);
    this.routeEvents();
    // Consume edges exactly once even if multiple fixed steps ran this frame.
    this.clearActionEdges();
  };

  private clearActionEdges(): void {
    const st = this.input.state;
    st.fireEdge = false;
    st.dashEdge = false;
    st.odEdge = false;
  }

  private routeEvents(): void {
    const events: SimEvent[] = this.sim.drain();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      this.world.handleEvent(ev);
      this.juice.handleEvent(ev);
      this.audio.handleEvent(ev);
      if (ev.type === EV.WAVE) {
        this.ui.banner(`WAVE ${ev.a}`, BANNER_SUBS[(ev.a - 1) % BANNER_SUBS.length]);
      } else if (ev.type === EV.DIE) {
        this.onDeath();
      }
    }
  }

  private onDeath(): void {
    const snap: Snap = this.sim.snap(1);
    const score = Math.floor(snap.score);
    const newBest = score > this.bestAtStart && score > 0;
    if (newBest) {
      this.best = score;
      try {
        window.localStorage.setItem(BEST_KEY, String(score));
      } catch {
        /* storage unavailable — best stays session-only */
      }
    }
    this.uiState.stats.newBest = newBest;
    this.phase = "over";
  }

  // ---------------------------------------------------------------- render

  private render = (alpha: number, realDt: number): void => {
    const st = this.input.state;

    // Frame-level edges (handled here so they work in every phase).
    if (st.pauseEdge) {
      st.pauseEdge = false;
      if (this.phase === "run") this.pause();
      else if (this.phase === "pause") this.resume();
    }
    if (st.muteEdge) {
      st.muteEdge = false;
      this.toggleMute();
    }

    // Aim for the NEXT tick (camera matrices are from the last render — 1-frame latency, imperceptible).
    this.world.aimRay(st.ndcX, st.ndcY, this.aim);

    // FPS EMA + one-shot auto quality downgrade.
    if (realDt > 0) this.fpsEma = this.fpsEma * 0.92 + (1 / realDt) * 0.08;
    if (!this.qualityDropped) {
      if (this.fpsEma < 45) {
        this.lowFpsFrames++;
        if (this.lowFpsFrames > 240) {
          this.world.setQuality(0.5);
          this.qualityDropped = true;
        }
      } else {
        this.lowFpsFrames = 0;
      }
    }

    const snap: Snap = this.sim.snap(alpha);
    this.world.update(realDt, snap);
    this.post.update(realDt, this.fx);
    this.post.render();
    this.juice.update(realDt, snap);

    if (this.dbg) {
      let flying = 0;
      for (let i = 0; i < snap.sCount; i++) if (snap.sState[i] !== 0) flying++;
      this.dbg.textContent =
        `fps ${this.fpsEma.toFixed(0)} | ph ${this.phase} rt ${snap.runTime.toFixed(1)}` +
        ` | e ${snap.eCount} b ${snap.bCount} sh ${flying}/${snap.sCount}` +
        ` | hp ${snap.hearts} | sc ${Math.floor(snap.score)} w ${snap.wave} sun ${snap.sun.toFixed(2)}` +
        ` | p${snap.px.toFixed(0)},${snap.py.toFixed(0)}`;
    }

    // UI state (cheap per-frame diff inside UI).
    const u = this.uiState;
    u.phase = this.phase;
    u.hearts = snap.hearts;
    u.maxHearts = snap.maxHearts;
    u.score = Math.floor(snap.score);
    u.best = this.best;
    u.combo = snap.combo;
    u.comboT = snap.comboT;
    u.sun = snap.sun;
    u.od = snap.od;
    u.odActive = snap.odActive;
    u.dash = snap.dashCd;
    u.wave = snap.wave;
    u.muted = this.audio.muted;
    u.fps = Math.round(this.fpsEma);
    u.stats.score = Math.floor(snap.score);
    u.stats.wave = snap.wave;
    u.stats.maxCombo = snap.maxCombo;
    u.stats.grazes = snap.grazes;
    u.stats.kills = snap.kills;
    u.stats.time = snap.runTime;
    this.ui.update(u, realDt);

    this.input.update();
  };
}
