/**
 * HOLLOW SUN — C4 screens (internal): Title · Pause · GameOver.
 * Copy is EXACT per DESIGN_C.md §19. Palette per §2. No blue/indigo.
 */

import type { UIPhase, UIState } from '../types';
import { el, fmtScore, fmtTime } from './style';
import type { UICallbacks } from './UI';

const LEGEND = 'WASD MOVE \u00b7 LMB LAUNCH SHARD \u00b7 SPACE DASH \u00b7 Q OVERDRIVE \u00b7 ESC PAUSE';
const NOTICE = 'BEST ON DESKTOP \u00b7 KEYBOARD + MOUSE';

const BTN =
  'flex items-center justify-between px-6 py-2 border border-[#ff8a3d]/40 text-[#ffb454] ' +
  'hover:bg-[#ff8a3d]/10 transition uppercase tracking-[0.25em] text-sm cursor-pointer bg-transparent';

export class Menus {
  readonly title: HTMLDivElement;
  readonly pause: HTMLDivElement;
  readonly over: HTMLDivElement;

  private bestEl: HTMLDivElement;
  private noticeEl: HTMLDivElement;
  private newBestEl: HTMLDivElement;
  private soundLabel: HTMLSpanElement;
  private statEls = new Map<string, HTMLDivElement>();

  private bestShown = -1;
  private mutedShown: boolean | null = null;
  private statsSig = '';

  constructor(cb: UICallbacks, narrow: boolean) {
    // ---------------- TITLE ----------------
    const veil = el(
      'div',
      'absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(5,4,8,0)_28%,rgba(5,4,8,0.82)_100%)]',
    );
    // faint ember halo behind the type — the star-heart breathes behind it in 3D
    const halo = el(
      'div',
      'hs-breathe absolute left-1/2 top-[58%] -translate-x-1/2 -translate-y-1/2 w-[72vmin] h-[72vmin] rounded-full ' +
        'bg-[radial-gradient(circle,rgba(255,138,61,0.10)_0%,rgba(255,138,61,0.04)_38%,rgba(255,138,61,0)_70%)]',
    );
    this.bestEl = el(
      'div',
      'absolute top-6 right-8 text-xs tracking-[0.3em] tabular-nums uppercase text-[#fff7ea]/50',
      'BEST 0',
    );
    const stack = el('div', 'relative h-full flex flex-col items-center justify-end pb-[15vh]');
    const h1 = el(
      'h1',
      'hs-glow text-6xl md:text-8xl font-black tracking-[0.3em] -mr-[0.3em] bg-gradient-to-r ' +
        'from-[#ff8a3d] to-[#ffb454] bg-clip-text text-transparent whitespace-nowrap text-center uppercase',
      'HOLLOW SUN',
    );
    const tagline = el(
      'div',
      'mt-5 text-sm tracking-[0.25em] uppercase text-[#fff7ea]/60 text-center',
      'the last ember feeds the dead star',
    );
    const cta = el(
      'div',
      'hs-pulse mt-12 text-sm tracking-[0.35em] uppercase text-[#ffb454]',
      'CLICK TO IGNITE',
    );
    this.noticeEl = el(
      'div',
      `${narrow ? '' : 'hidden '}mt-6 text-[10px] tracking-[0.3em] uppercase text-[#fff7ea]/70 border border-[#ff8a3d]/30 px-3 py-1.5`,
      NOTICE,
    );
    const legend = el(
      'div',
      'mt-5 text-xs tracking-wide uppercase text-[#fff7ea]/45 text-center',
      LEGEND,
    );
    stack.append(h1, tagline, cta, this.noticeEl, legend);
    this.title = el('div', 'absolute inset-0 pointer-events-auto cursor-pointer');
    this.title.append(veil, halo, this.bestEl, stack);
    this.title.addEventListener('click', () => cb.onStart());

    // ---------------- PAUSE ----------------
    const pausePanel = el('div', 'flex flex-col items-center');
    pausePanel.append(
      el(
        'div',
        'text-2xl md:text-3xl font-black tracking-[0.4em] -mr-[0.4em] uppercase text-[#fff7ea]',
        'PAUSED',
      ),
    );
    const btnCol = el('div', 'mt-8 flex flex-col gap-3 w-60');
    const mkBtn = (key: string, label: string, fn: () => void): HTMLButtonElement => {
      const b = el('button', BTN);
      b.append(el('span', 'text-[10px] text-[#fff7ea]/35', key), el('span', '', label));
      b.addEventListener('click', fn);
      return b;
    };
    btnCol.append(
      mkBtn('1', 'RESUME', () => cb.onResume()),
      mkBtn('2', 'RESTART', () => cb.onRestart()),
    );
    const soundBtn = el('button', BTN);
    this.soundLabel = el('span', '', 'SOUND: ON');
    soundBtn.append(el('span', 'text-[10px] text-[#fff7ea]/35', '3'), this.soundLabel);
    soundBtn.addEventListener('click', () => cb.onToggleMute());
    btnCol.append(soundBtn);
    pausePanel.append(btnCol);
    this.pause = el(
      'div',
      'absolute inset-0 bg-[#050408]/70 flex items-center justify-center pointer-events-auto',
    );
    this.pause.append(pausePanel);

    // ---------------- GAME OVER ----------------
    this.over = el(
      'div',
      'absolute inset-0 pointer-events-auto cursor-pointer flex items-center justify-center ' +
        'bg-[radial-gradient(ellipse_at_center,rgba(5,4,8,0.45)_0%,rgba(5,4,8,0.92)_100%)]',
    );
    const overStack = el('div', 'flex flex-col items-center gap-7 px-6');
    overStack.append(
      el(
        'div',
        'hs-flicker text-3xl md:text-5xl font-black tracking-[0.25em] -mr-[0.25em] text-[#ff3b5c] text-center uppercase',
        'THE STAR GOES DARK',
      ),
    );
    this.newBestEl = el(
      'div',
      'hidden text-[10px] tracking-[0.35em] text-[#ffb454] border border-[#ffb454]/50 px-3 py-1 uppercase',
      'NEW BEST',
    );
    overStack.append(this.newBestEl);
    const grid = el('div', 'grid grid-cols-3 gap-x-12 gap-y-5 text-center');
    const cell = (label: string): void => {
      const wrap = el('div');
      wrap.append(
        el('div', 'text-[10px] tracking-[0.25em] uppercase text-[#fff7ea]/50', label),
      );
      const val = el('div', 'mt-1 text-lg text-[#ffb454] tabular-nums font-semibold', '0');
      wrap.append(val);
      this.statEls.set(label, val);
      grid.append(wrap);
    };
    cell('SCORE');
    cell('BEST');
    cell('WAVE');
    cell('MAX COMBO');
    cell('GRAZES');
    cell('TIME');
    overStack.append(grid);
    overStack.append(
      el(
        'div',
        'hs-pulse text-sm tracking-[0.35em] uppercase text-[#ffb454]/90',
        'CLICK TO REIGNITE',
      ),
    );
    this.over.append(overStack);
    this.over.addEventListener('click', () => cb.onRestart());
  }

  /** Toggle screens for a phase and refresh their static content. */
  showPhase(p: UIPhase, s: UIState | null): void {
    this.title.classList.toggle('hidden', p !== 'title');
    this.pause.classList.toggle('hidden', p !== 'pause');
    this.over.classList.toggle('hidden', p !== 'over');
    if (s) this.tick(s);
  }

  /** Cheap per-frame refresh (all internally diffed). */
  tick(s: UIState): void {
    const best = Math.max(0, Math.floor(s.best));
    if (best !== this.bestShown) {
      this.bestShown = best;
      this.bestEl.textContent = `BEST ${best}`;
    }
    if (s.muted !== this.mutedShown) {
      this.mutedShown = s.muted;
      this.soundLabel.textContent = s.muted ? 'SOUND: OFF' : 'SOUND: ON';
    }
    const st = s.stats;
    const sig = `${s.best}|${st.score}|${st.wave}|${st.maxCombo}|${st.grazes}|${st.time}|${st.newBest}`;
    if (sig === this.statsSig) return;
    this.statsSig = sig;
    this.setStat('SCORE', fmtScore(st.score));
    this.setStat('BEST', fmtScore(s.best));
    this.setStat('WAVE', String(Math.max(0, st.wave)));
    this.setStat('MAX COMBO', String(Math.max(0, st.maxCombo)));
    this.setStat('GRAZES', String(Math.max(0, st.grazes)));
    this.setStat('TIME', fmtTime(st.time));
    this.newBestEl.classList.toggle('hidden', !st.newBest);
  }

  private setStat(label: string, text: string): void {
    const node = this.statEls.get(label);
    if (node && node.textContent !== text) node.textContent = text;
  }
}
