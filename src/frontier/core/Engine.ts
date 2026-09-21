/** Fixed-timestep 60 Hz sim + interpolated render, hitstop, timeScale, spiral guard. */
export type SimStep = (dt: number) => void;
export type RenderFrame = (alpha: number, frameDt: number) => void;

export class Engine {
  readonly stepDt = 1 / 60;
  fps = 60;
  frameMs = 16;
  hitstop = 0;
  timeScale = 1;
  onFrameEnd: ((fps: number) => void) | null = null;

  private acc = 0;
  private last = 0;
  private rafId = 0;
  private running = false;

  constructor(private sim: SimStep, private render: RenderFrame) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  private loop = (t: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (dt > 0.25) dt = 0.25;
    if (dt <= 0) return;

    this.fps += (1 / dt - this.fps) * 0.06;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.06;

    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      this.render(1, dt);
      if (this.onFrameEnd) this.onFrameEnd(this.fps);
      return;
    }
    this.acc += dt * this.timeScale;
    const h = this.stepDt;
    let steps = 0;
    while (this.acc >= h && steps < 5) {
      this.sim(h);
      this.acc -= h;
      steps++;
    }
    if (steps === 5) this.acc = 0;
    this.render(this.acc / h, dt);
    if (this.onFrameEnd) this.onFrameEnd(this.fps);
  };
}
