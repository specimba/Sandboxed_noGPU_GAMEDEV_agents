/**
 * Input: WASD move, mouse-aim (NDC), LMB cannon, RMB missile lock, Space dash,
 * Esc pause, R restart. One preallocated polled snapshot; gamepad optional.
 */
export interface InputSnapshot {
  moveX: number;
  moveZ: number;
  ndcX: number;
  ndcY: number;
  fireHeld: boolean;
  missileHeld: boolean; // charge / lock
  missileReleased: boolean; // edge
  dashPressed: boolean;
  pausePressed: boolean;
  restartPressed: boolean;
  confirmPressed: boolean;
  gamepad: boolean;
}

export class Input {
  uiActive = false;
  private snap: InputSnapshot;
  private ndcX = 0;
  private ndcY = 0;
  private lmb = false;
  private rmb = false;
  private prevRmb = false;
  private keys = new Set<string>();
  private pauseEdge = false;
  private restartEdge = false;
  private confirmEdge = false;
  private prevPause = false;
  private prevRestart = false;
  private prevConfirm = false;

  constructor() {
    this.snap = {
      moveX: 0, moveZ: 0, ndcX: 0, ndcY: 0,
      fireHeld: false, missileHeld: false, missileReleased: false,
      dashPressed: false, pausePressed: false, restartPressed: false,
      confirmPressed: false, gamepad: false,
    };
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.code === "Space") { this.confirmEdge = true; e.preventDefault(); }
    if (e.code === "Enter") this.confirmEdge = true;
    if (e.code === "KeyR") this.restartEdge = true;
    if (e.code === "Escape" || e.code === "KeyP") this.pauseEdge = true;
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private onMouseMove = (e: MouseEvent): void => {
    this.ndcX = (e.clientX / window.innerWidth) * 2 - 1;
    this.ndcY = -((e.clientY / window.innerHeight) * 2 - 1);
  };
  private onMouseDown = (e: MouseEvent): void => {
    if (this.uiActive) return;
    if (e.button === 0) this.lmb = true;
    if (e.button === 2) this.rmb = true;
  };
  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.lmb = false;
    if (e.button === 2) this.rmb = false;
  };
  private onContext = (e: Event): void => { e.preventDefault(); };
  private onBlur = (): void => {
    this.lmb = false; this.rmb = false; this.keys.clear();
  };

  attach(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("contextmenu", this.onContext);
    window.addEventListener("blur", this.onBlur);
  }
  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("contextmenu", this.onContext);
    window.removeEventListener("blur", this.onBlur);
  }

  poll(): InputSnapshot {
    const s = this.snap;
    const k = this.keys;
    s.moveX = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    s.moveZ = (k.has("KeyS") ? 1 : 0) - (k.has("KeyW") ? 1 : 0);
    s.ndcX = this.ndcX;
    s.ndcY = this.ndcY;
    s.fireHeld = !this.uiActive && this.lmb;
    s.missileHeld = !this.uiActive && this.rmb;
    s.missileReleased = this.prevRmb && !this.rmb && !this.uiActive;
    s.dashPressed = k.has("Space");
    s.pausePressed = this.pauseEdge && !this.prevPause;
    s.restartPressed = this.restartEdge && !this.prevRestart;
    s.confirmPressed = (this.confirmEdge && !this.prevConfirm) || this.pauseEdge;
    this.prevRmb = this.rmb;
    this.prevPause = this.pauseEdge;
    this.prevRestart = this.restartEdge;
    this.prevConfirm = this.confirmEdge;
    this.pauseEdge = false;
    this.restartEdge = false;
    this.confirmEdge = false;
    return s;
  }
}
