import { CC, FEEL } from './constants';

/**
 * HOLLOW SUN control laws — pure functions, zero imports beyond constants.
 *
 * The owner's law: the player is never unresponsively locked longer than the
 * longest designed CC duration. These helpers are the enforcement side:
 *
 *  - ccFailsafe: any CC timer on the sim that exceeds max × failsafeFactor is
 *    clamped back to the bound and reported. Normal play never trips this —
 *    it is the seatbelt around every current and future CC source.
 *
 *  - dashBufferStep: a dash edge pressed while the cooldown is nearly ready
 *    (≤ FEEL.dashBuffer) is buffered instead of eaten, and auto-fires the
 *    frame the cooldown clears. Engine-side only — the sim stays unchanged.
 *
 * Kept pure so scripts/simdrive-controls.ts can unit-drive them headless.
 */

export interface CcTimers {
  /** structural: consumers may carry only the timers they use */
  pRootT?: number;
  pSlowT?: number;
}

const CC_BOUNDS = {
  pRootT: CC.rootMax,
  pSlowT: CC.slowMax,
} as const;

/** Clamp runaway CC timers to max × failsafeFactor; returns the fired keys. */
export function ccFailsafe(timers: CcTimers): (keyof CcTimers)[] {
  const fired: (keyof CcTimers)[] = [];
  for (const key of ['pRootT', 'pSlowT'] as const) {
    const t = timers[key];
    if (t === undefined) continue;
    const bound = CC_BOUNDS[key] * CC.failsafeFactor;
    if (t > bound) {
      timers[key] = bound;
      fired.push(key);
    }
  }
  return fired;
}

export interface DashBufferState {
  bufT: number;
  wantDash: boolean;
}

/**
 * Advance the dash buffer one wall-clock frame. Feed the freshly consumed
 * edge plus the sim's current dash cooldown; get back the edge that should
 * reach the sim this frame and the new buffer state.
 */
export function dashBufferStep(
  bufT: number,
  dashCd: number,
  edge: boolean,
  dtReal: number,
): DashBufferState {
  let nextBuf = bufT;
  let wantDash = edge;
  if (edge && dashCd > 0 && dashCd <= FEEL.dashBuffer) {
    nextBuf = FEEL.dashBuffer; // buffered, not eaten
    wantDash = false;
  }
  if (nextBuf > 0) {
    nextBuf = Math.max(0, nextBuf - dtReal);
    if (dashCd <= 0) {
      wantDash = true;
      nextBuf = 0;
    }
  }
  return { bufT: nextBuf, wantDash };
}
