/**
 * HOLLOW SUN — fixed-step game loop (DESIGN_C.md §15 C1).
 *
 * Fixed 60Hz accumulator. Reads the shared FXState each frame:
 *  - fx.hitstop > 0  → sim clock FROZEN: hitstop counts down in real time,
 *    accumulator untouched, render() still called with the unchanged alpha
 *    (world keeps drawing, interpolated exactly where it was).
 *  - otherwise       → accumulate realDt * fx.timeScale and run as many fixed
 *    tick(1/stepHz) steps as fit, clamped to 5 per frame (spiral-of-death guard;
 *    backlog beyond the clamp is dropped).
 *
 * Zero allocation per frame.
 */
import type { FXState } from "../types";

export interface LoopOpts {
  stepHz: number;
  fx: FXState;
  tick: (dt: number) => void;
  render: (alpha: number, realDt: number) => void;
}

const MAX_STEPS = 5;
const MAX_FRAME = 0.25; // clamp tab-switch / stall spikes (seconds)

export class Loop {
  private readonly stepDt: number;
  private readonly fx: FXState;
  private readonly tickCb: (dt: number) => void;
  private readonly renderCb: (alpha: number, realDt: number) => void;

  private acc = 0;
  private alpha = 0;
  private raf = 0;
  private last = 0;
  private running = false;

  constructor(opts: LoopOpts) {
    this.stepDt = 1 / opts.stepHz;
    this.fx = opts.fx;
    this.tickCb = opts.tick;
    this.renderCb = opts.render;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.raf !== 0) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  dispose(): void {
    this.stop();
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);

    let realDt = (now - this.last) / 1000;
    this.last = now;
    if (!(realDt > 0)) realDt = 0;
    else if (realDt > MAX_FRAME) realDt = MAX_FRAME;

    if (this.fx.hitstop > 0) {
      // Freeze: burn hitstop in real time, keep alpha pinned so the world
      // holds perfectly still while C3's flash/trauma read.
      this.fx.hitstop -= realDt;
      if (this.fx.hitstop < 0) this.fx.hitstop = 0;
      this.renderCb(this.alpha, realDt);
      return;
    }

    const ts = this.fx.timeScale;
    this.acc += realDt * (ts > 0 ? ts : 0);

    let steps = 0;
    while (this.acc >= this.stepDt && steps < MAX_STEPS) {
      this.tickCb(this.stepDt);
      this.acc -= this.stepDt;
      steps++;
    }
    // Drop backlog beyond the 5-step clamp (never spiral).
    if (this.acc > this.stepDt) this.acc = this.stepDt;

    this.alpha = this.acc / this.stepDt; // stepDt-bounded → already 0..1
    this.renderCb(this.alpha, realDt);
  };
}
