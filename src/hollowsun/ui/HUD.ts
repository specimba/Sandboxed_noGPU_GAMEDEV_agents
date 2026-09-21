/**
 * HOLLOW SUN — C4 HUD (internal).
 * Hearts (rotated diamonds) · wave chip · score + combo pop + sun gauge ·
 * Overdrive conic ring · dash pips · ?fps=1 readout · low-HP heartbeat vignette.
 * All per-frame work is cheap diffs (textContent / style.width / conic angle);
 * DOM is rebuilt only on real state changes (hearts).
 */

import type { UIPhase, UIState } from '../types';
import { clamp01, el, fmtScore } from './style';

const HEART_ALIVE = 'w-3.5 h-3.5 rotate-45 bg-[#ff8a3d] shadow-[0_0_10px_rgba(255,138,61,0.75)]';
const HEART_LOST = 'w-3.5 h-3.5 rotate-45 border border-[#ff8a3d]/30';
const PIP_READY = 'w-2.5 h-2.5 rotate-45 bg-[#ffb454] shadow-[0_0_8px_rgba(255,180,84,0.6)]';
const PIP_DIM = 'w-2.5 h-2.5 rotate-45 bg-[#ffb454]/30';

/** Overdrive duration in seconds (DESIGN_C.md §18) — for the drain countdown. */
const OD_DUR = 4;

type OdState = 'idle' | 'ready' | 'active';

export class HUD {
  readonly node: HTMLDivElement;
  readonly vignette: HTMLDivElement;

  private heartsBox: HTMLDivElement;
  private waveEl: HTMLDivElement;
  private scoreEl: HTMLDivElement;
  private comboEl: HTMLDivElement;
  private sunFill: HTMLDivElement;
  private odRing: HTMLDivElement;
  private odLabel: HTMLDivElement;
  private pips: HTMLDivElement[] = [];
  private fpsEl: HTMLDivElement;

  private fpsEnabled: boolean;
  private odElapsed = 0;
  private wasActive = false;
  private hearts = -1;
  private maxHearts = -1;
  private wave = -1;
  private score = -1;
  private combo = -1;
  private sun = -1;
  private odState: OdState = 'idle';
  private odFrac = -1;
  private dashFrac = -1;
  private fps = -1;
  private vignetteOn = false;

  constructor(fpsEnabled: boolean) {
    this.fpsEnabled = fpsEnabled;

    // top-left: hearts
    this.heartsBox = el('div', 'absolute top-5 left-6 flex items-center gap-2.5');

    // top-center: wave chip
    this.waveEl = el(
      'div',
      'absolute top-6 left-1/2 -translate-x-1/2 text-xs tracking-[0.3em] uppercase text-[#fff7ea]/70',
      'WAVE 1',
    );

    // top-right: score / combo / sun gauge
    const right = el('div', 'absolute top-4 right-6 flex flex-col items-end');
    this.scoreEl = el('div', 'text-2xl font-black tabular-nums leading-none text-[#ffb454]', '0');
    this.comboEl = el('div', 'mt-1 text-sm tabular-nums text-[#ff8a3d] origin-right', '\u00d70');
    this.comboEl.style.opacity = '0';
    const gauge = el('div', 'mt-2 w-40 h-[3px] bg-[#ffb454]/10 overflow-hidden');
    this.sunFill = el('div', 'h-full w-0 bg-gradient-to-r from-[#ff8a3d] to-[#ffb454]');
    gauge.append(this.sunFill);
    right.append(this.scoreEl, this.comboEl, gauge);

    // bottom-left: overdrive ring
    const odWrap = el('div', 'absolute bottom-6 left-6 flex flex-col items-center');
    this.odRing = el('div', 'relative w-14 h-14 rounded-full');
    this.odRing.style.background = 'conic-gradient(#ffb454 0deg, rgba(255,180,84,0.12) 0deg)';
    const odInner = el(
      'div',
      'absolute inset-[5px] rounded-full bg-[#050408]/85 flex items-center justify-center',
    );
    this.odLabel = el('div', 'text-[9px] font-bold tracking-[0.15em] text-[#ffb454]', 'Q');
    odInner.append(this.odLabel);
    this.odRing.append(odInner);
    odWrap.append(this.odRing);

    // bottom-right: dash pips + SPACE
    const dash = el('div', 'absolute bottom-7 right-6 flex items-center gap-2.5');
    const pipRow = el('div', 'flex items-center gap-2');
    const pip1 = el('div', PIP_READY);
    const pip2 = el('div', PIP_READY);
    this.pips.push(pip1, pip2);
    pipRow.append(pip1, pip2);
    dash.append(pipRow, el('div', 'text-[10px] tracking-[0.25em] uppercase text-[#fff7ea]/40', 'SPACE'));

    // bottom-right corner: fps (?fps=1)
    this.fpsEl = el(
      'div',
      'absolute bottom-1.5 right-2 text-[10px] leading-none tabular-nums text-[#fff7ea]/40',
    );
    if (!fpsEnabled) this.fpsEl.classList.add('hidden');

    this.node = el('div', 'absolute inset-0 pointer-events-none');
    this.node.append(this.heartsBox, this.waveEl, right, odWrap, dash, this.fpsEl);

    // low-HP red vignette (screen edge heartbeat)
    this.vignette = el('div', 'absolute inset-0 pointer-events-none hs-heartbeat hidden');
    this.vignette.style.boxShadow = 'inset 0 0 140px 48px rgba(255, 59, 92, 0.34)';
  }

  setVisible(v: boolean): void {
    this.node.classList.toggle('hidden', !v);
  }

  setVignette(v: boolean): void {
    if (v === this.vignetteOn) return;
    this.vignetteOn = v;
    this.vignette.classList.toggle('hidden', !v);
  }

  update(s: UIState, phase: UIPhase, realDt: number): void {
    // overdrive countdown is accumulated locally (UIState carries no odT)
    if (s.odActive) {
      this.odElapsed = this.wasActive ? this.odElapsed + realDt : 0;
    } else {
      this.odElapsed = 0;
    }
    this.wasActive = s.odActive;

    // hearts — rebuild only on change
    if (s.hearts !== this.hearts || s.maxHearts !== this.maxHearts) {
      this.hearts = s.hearts;
      this.maxHearts = s.maxHearts;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < s.maxHearts; i++) {
        frag.appendChild(el('div', i < s.hearts ? HEART_ALIVE : HEART_LOST));
      }
      this.heartsBox.replaceChildren(frag);
    }

    // wave
    if (s.wave !== this.wave) {
      this.wave = s.wave;
      this.waveEl.textContent = `WAVE ${Math.max(1, s.wave)}`;
    }

    // score
    const score = Math.max(0, Math.floor(s.score));
    if (score !== this.score) {
      this.score = score;
      this.scoreEl.textContent = fmtScore(score);
    }

    // combo (pop on increase, fade with decay timer)
    if (s.combo !== this.combo) {
      const grew = this.combo >= 0 && s.combo > this.combo;
      this.combo = s.combo;
      this.comboEl.textContent = `\u00d7${s.combo}`;
      if (grew && s.combo >= 2) {
        this.comboEl.classList.remove('hs-pop');
        void this.comboEl.offsetWidth; // restart animation
        this.comboEl.classList.add('hs-pop');
      }
    }
    this.comboEl.style.opacity =
      s.combo >= 2 ? String(0.35 + 0.65 * clamp01(s.comboT)) : '0';

    // sun gauge
    if (s.sun !== this.sun) {
      this.sun = s.sun;
      this.sunFill.style.width = `${(clamp01(s.sun) * 100).toFixed(2)}%`;
    }

    // overdrive ring
    this.updateOd(s);

    // dash pips
    const dash = clamp01(s.dash);
    if (Math.abs(dash - this.dashFrac) > 0.01) {
      this.dashFrac = dash;
      const ready = dash >= 0.999;
      for (const pip of this.pips) {
        pip.className = ready ? PIP_READY : PIP_DIM;
        pip.style.opacity = ready ? '1' : String(0.25 + 0.75 * dash);
      }
    }

    // fps readout
    if (this.fpsEnabled) {
      const f = Math.max(0, Math.round(s.fps));
      if (f !== this.fps) {
        this.fps = f;
        this.fpsEl.textContent = String(f);
      }
    }

    // low-HP heartbeat vignette (run phase only)
    this.setVignette(phase === 'run' && s.hearts === 1);
  }

  private updateOd(s: UIState): void {
    const state: OdState = s.odActive ? 'active' : s.od >= 1 ? 'ready' : 'idle';
    const remaining = Math.max(0, OD_DUR - this.odElapsed);
    const remainingStr = remaining.toFixed(1);
    if (state !== this.odState) {
      this.odState = state;
      this.odRing.classList.toggle('hs-od-pulse', state === 'ready');
      this.odRing.style.boxShadow = state === 'active' ? '0 0 16px 2px rgba(255,180,84,0.45)' : '';
      if (state === 'ready') this.odLabel.textContent = 'Q READY';
      else if (state === 'active') this.odLabel.textContent = remainingStr;
      else this.odLabel.textContent = 'Q';
    } else if (state === 'active') {
      if (remainingStr !== this.odLabel.textContent) this.odLabel.textContent = remainingStr;
    }

    const frac =
      state === 'active' ? clamp01(remaining / OD_DUR) : state === 'ready' ? 1 : clamp01(s.od);
    if (Math.abs(frac - this.odFrac) > 0.002) {
      this.odFrac = frac;
      const deg = (frac * 360).toFixed(1);
      this.odRing.style.background = `conic-gradient(#ffb454 ${deg}deg, rgba(255,180,84,0.12) ${deg}deg)`;
    }
  }
}
