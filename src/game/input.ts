/**
 * HOLLOW SUN input: WASD/twin-stick movement, mouse aim (raycast to the arena
 * plane happens in the engine), click/F throws shards, Shift/Space dashes.
 * Touch: React joystick writes touchMove*, buttons queue edges here.
 */
export class Input {
  private down = new Set<string>();
  private edgeThrow = false;
  private edgeDash = false;
  private edgePause = false;
  private edgeBegin = false;

  /** analog move from touch joystick, -1..1 (x = strafe, y = forward) */
  touchMoveX = 0;
  touchMoveY = 0;

  /** latest mouse position in client pixels (aim raycast source) */
  mouseX = 0;
  mouseY = 0;
  private mouseSeen = false;

  private canvas: HTMLCanvasElement;
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
        case 'KeyJ':
          this.edgeThrow = true;
          break;
        case 'Space':
        case 'ShiftLeft':
        case 'ShiftRight':
          this.edgeDash = true;
          e.preventDefault();
          break;
        case 'Escape':
        case 'KeyP':
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
    const onBlur = () => this.clearAll();
    // some OS overlays / task switchers swallow the keyup WITHOUT a blur —
    // hiding the document always drops held keys so a strafe can never stick
    const onVis = () => {
      if (document.hidden) this.clearAll();
    };

    const onMouseMove = (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseSeen = true;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.target !== this.canvas) return;
      if (e.button === 0) this.edgeThrow = true;
    };
    const onContext = (e: Event) => {
      if (e.target === this.canvas) e.preventDefault();
    };

    w.addEventListener('keydown', onKeyDown);
    w.addEventListener('keyup', onKeyUp);
    w.addEventListener('blur', onBlur);
    w.addEventListener('mousemove', onMouseMove);
    document.addEventListener('visibilitychange', onVis);
    this.canvas.addEventListener('mousedown', onMouseDown);
    this.canvas.addEventListener('contextmenu', onContext);

    this.disposeFns = [
      () => w.removeEventListener('keydown', onKeyDown),
      () => w.removeEventListener('keyup', onKeyUp),
      () => w.removeEventListener('blur', onBlur),
      () => w.removeEventListener('mousemove', onMouseMove),
      () => document.removeEventListener('visibilitychange', onVis),
      () => this.canvas.removeEventListener('mousedown', onMouseDown),
      () => this.canvas.removeEventListener('contextmenu', onContext),
    ];
  }

  /** keyboard + touch merged move axes; y = forward (screen up), x = strafe */
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

  get hasMouseAim(): boolean {
    return this.mouseSeen;
  }

  consumeThrow(): boolean {
    const v = this.edgeThrow;
    this.edgeThrow = false;
    return v;
  }
  consumeDash(): boolean {
    const v = this.edgeDash;
    this.edgeDash = false;
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

  /** queued from touch UI buttons */
  queueThrow() {
    this.edgeThrow = true;
  }
  queueDash() {
    this.edgeDash = true;
  }

  /** drop every queued edge (phase transitions, overlays, focus loss) — a
   *  stale edge must never fire on re-entry into play */
  clearEdges(): void {
    this.edgeThrow = false;
    this.edgeDash = false;
    this.edgePause = false;
    this.edgeBegin = false;
  }

  /** keys + edges — the full safe-state for blur / visibility / resume */
  clearAll(): void {
    this.down.clear();
    this.clearEdges();
  }

  /** live edge state for the ?debug=1 forensics snapshot (no mutation) */
  debugEdges(): { throw: boolean; dash: boolean; pause: boolean; begin: boolean; downCount: number } {
    return {
      throw: this.edgeThrow,
      dash: this.edgeDash,
      pause: this.edgePause,
      begin: this.edgeBegin,
      downCount: this.down.size,
    };
  }

  dispose() {
    for (const fn of this.disposeFns) fn();
    this.disposeFns = [];
    this.down.clear();
  }

  get canvasElement(): HTMLCanvasElement {
    return this.canvas;
  }
}
