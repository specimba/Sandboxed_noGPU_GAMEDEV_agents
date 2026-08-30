/**
 * Unified input: keyboard + mouse (orbit / pulse) + touch (joystick handled by
 * React TouchControls, canvas drags handled here).
 *
 * Edge-triggered actions are consumed once per frame by the engine.
 */
export class Input {
  private down = new Set<string>();
  private edgePulse = false;
  private edgeDash = false;
  private edgeJump = false;
  private edgePause = false;
  private edgeBegin = false;

  /** analog move from touch joystick, -1..1 (x = strafe, y = forward) */
  touchMoveX = 0;
  touchMoveY = 0;
  touchJumpHeld = false;

  /** accumulated look delta since last frame (pixels) */
  lookX = 0;
  lookY = 0;
  /** wheel zoom steps this frame */
  zoom = 0;

  private canvas: HTMLCanvasElement;
  private dragStart: { x: number; y: number } | null = null;
  private dragMoved = 0;
  private lastMX = 0;
  private lastMY = 0;
  private touchLookId = -1;
  private touchLastX = 0;
  private touchLastY = 0;
  private disposeFns: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const w = window;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) {
        if (e.code === 'Space') e.preventDefault();
        return;
      }
      this.down.add(e.code);
      switch (e.code) {
        case 'KeyF':
        case 'KeyE':
          this.edgePulse = true;
          break;
        case 'Space':
          this.edgeJump = true;
          e.preventDefault();
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.edgeDash = true;
          break;
        case 'Escape':
          this.edgePause = true;
          break;
        case 'Enter':
          this.edgeBegin = true;
          break;
        default:
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => this.down.delete(e.code);
    const onBlur = () => this.down.clear();

    const onMouseDown = (e: MouseEvent) => {
      if (e.target !== this.canvas) return;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.dragMoved = 0;
      this.lastMX = e.clientX;
      this.lastMY = e.clientY;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (this.dragStart === null) return;
      const dx = e.clientX - this.lastMX;
      const dy = e.clientY - this.lastMY;
      this.lastMX = e.clientX;
      this.lastMY = e.clientY;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      this.lookX += dx;
      this.lookY += dy;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (this.dragStart === null) return;
      // treat as a click (echo pulse) only if the pointer barely moved
      if (this.dragMoved < 5 && e.target === this.canvas && e.button === 0) {
        this.edgePulse = true;
      }
      this.dragStart = null;
    };
    const onContext = (e: Event) => {
      if (e.target === this.canvas) e.preventDefault();
    };
    const onWheel = (e: WheelEvent) => {
      if (e.target !== this.canvas) return;
      this.zoom += Math.sign(e.deltaY);
      e.preventDefault();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.target !== this.canvas) return;
      const t = e.changedTouches[0];
      if (!t) return;
      if (this.touchLookId === -1) {
        this.touchLookId = t.identifier;
        this.touchLastX = t.clientX;
        this.touchLastY = t.clientY;
      }
      e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.touchLookId) {
          this.lookX += (t.clientX - this.touchLastX) * 1.6;
          this.lookY += (t.clientY - this.touchLastY) * 1.6;
          this.touchLastX = t.clientX;
          this.touchLastY = t.clientY;
        }
      }
      e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.touchLookId) this.touchLookId = -1;
      }
    };

    w.addEventListener('keydown', onKeyDown);
    w.addEventListener('keyup', onKeyUp);
    w.addEventListener('blur', onBlur);
    this.canvas.addEventListener('mousedown', onMouseDown);
    w.addEventListener('mousemove', onMouseMove);
    w.addEventListener('mouseup', onMouseUp);
    this.canvas.addEventListener('contextmenu', onContext);
    this.canvas.addEventListener('wheel', onWheel, { passive: false });
    this.canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', onTouchEnd);
    this.canvas.addEventListener('touchcancel', onTouchEnd);

    this.disposeFns = [
      () => w.removeEventListener('keydown', onKeyDown),
      () => w.removeEventListener('keyup', onKeyUp),
      () => w.removeEventListener('blur', onBlur),
      () => this.canvas.removeEventListener('mousedown', onMouseDown),
      () => w.removeEventListener('mousemove', onMouseMove),
      () => w.removeEventListener('mouseup', onMouseUp),
      () => this.canvas.removeEventListener('contextmenu', onContext),
      () => this.canvas.removeEventListener('wheel', onWheel),
      () => this.canvas.removeEventListener('touchstart', onTouchStart),
      () => this.canvas.removeEventListener('touchmove', onTouchMove),
      () => this.canvas.removeEventListener('touchend', onTouchEnd),
      () => this.canvas.removeEventListener('touchcancel', onTouchEnd),
    ];
  }

  /** keyboard + touch merged move axes; y = forward, x = strafe */
  get moveX(): number {
    let x = 0;
    if (this.down.has('KeyA')) x -= 1;
    if (this.down.has('KeyD')) x += 1;
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

  get jumpHeld(): boolean {
    return this.down.has('Space') || this.touchJumpHeld;
  }

  get rotateAxis(): number {
    let r = 0;
    if (this.down.has('KeyQ')) r -= 1;
    if (this.down.has('KeyR')) r += 1;
    return r;
  }

  consumePulse(): boolean {
    const v = this.edgePulse;
    this.edgePulse = false;
    return v;
  }
  consumeDash(): boolean {
    const v = this.edgeDash;
    this.edgeDash = false;
    return v;
  }
  consumeJump(): boolean {
    const v = this.edgeJump;
    this.edgeJump = false;
    return v;
  }
  consumePause(): boolean {
    const v = this.edgePause;
    this.edgePause = false;
    return v;
  }
  consumeBegin(): boolean {
    const v = this.edgeBegin;
    this.edgeBegin = false;
    return v;
  }

  /** queue from touch UI buttons */
  queuePulse() {
    this.edgePulse = true;
  }
  queueDash() {
    this.edgeDash = true;
  }

  clearFrame() {
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = 0;
  }

  dispose() {
    for (const fn of this.disposeFns) fn();
    this.disposeFns = [];
    this.down.clear();
  }
}
