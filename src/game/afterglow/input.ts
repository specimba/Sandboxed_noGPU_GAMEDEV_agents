/**
 * AFTERGLOW input: WASD/arrows move, Space/Shift dash.
 * Touch: React joystick writes touchMove* (forward = +y), buttons queue edges.
 * Light copy of the house input pattern (src/game/input.ts) — afterglow needs
 * no mouse aim (GLIMMER auto-fires at the nearest foe).
 */
export class Input {
  private down = new Set<string>();
  private edgeDash = false;

  /** analog move from touch joystick, -1..1 (x = strafe, y = forward) */
  touchMoveX = 0;
  touchMoveY = 0;

  private disposeFns: (() => void)[] = [];

  constructor() {
    const w = window;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) {
        if (e.code === 'Space') e.preventDefault();
        return;
      }
      this.down.add(e.code);
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.edgeDash = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => this.down.delete(e.code);
    const onBlur = () => this.down.clear();

    w.addEventListener('keydown', onKeyDown);
    w.addEventListener('keyup', onKeyUp);
    w.addEventListener('blur', onBlur);

    this.disposeFns = [
      () => w.removeEventListener('keydown', onKeyDown),
      () => w.removeEventListener('keyup', onKeyUp),
      () => w.removeEventListener('blur', onBlur),
    ];
  }

  /** keyboard + touch merged move axes; y = forward (screen up) */
  get moveX(): number {
    let x = 0;
    if (this.down.has('KeyA') || this.down.has('ArrowLeft')) x -= 1;
    if (this.down.has('KeyD') || this.down.has('ArrowRight')) x += 1;
    x += this.touchMoveX;
    return Math.max(-1, Math.min(1, x));
  }

  get moveY(): number {
    let y = 0;
    if (this.down.has('KeyW') || this.down.has('ArrowUp')) y += 1;
    if (this.down.has('KeyS') || this.down.has('ArrowDown')) y -= 1;
    y += this.touchMoveY;
    return Math.max(-1, Math.min(1, y));
  }

  consumeDash(): boolean {
    const v = this.edgeDash;
    this.edgeDash = false;
    return v;
  }

  /** queued from the touch UI */
  queueDash(): void {
    this.edgeDash = true;
  }

  dispose(): void {
    for (const fn of this.disposeFns) fn();
    this.disposeFns = [];
    this.down.clear();
  }
}
