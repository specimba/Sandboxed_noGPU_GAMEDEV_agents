/**
 * HOLLOW SUN — C4 UI root (binding contract).
 * class UI { static create(root, cb) · showPhase · update · banner · toast · dispose }
 * Appends ONE overlay <div class="hs-ui-root"> (fixed inset-0 z-40, pointer-events-none;
 * interactive screens are pointer-events-auto). Pure DOM/Tailwind — no canvas, no deps.
 */

import type { UIPhase, UIState } from '../types';
import { BannerLayer } from './Banner';
import { HUD } from './HUD';
import { Menus } from './Menus';
import { ToastLayer } from './Toasts';
import { el, injectHSStyle } from './style';

export interface UICallbacks {
  onStart(): void;
  onResume(): void;
  onRestart(): void;
  onToggleMute(): void;
}

export class UI {
  private cb: UICallbacks;
  private rootEl: HTMLDivElement;
  private hud: HUD;
  private menus: Menus;
  private banners: BannerLayer;
  private toasts: ToastLayer;

  private phase: UIPhase = 'title';
  private lastState: UIState | null = null;
  private lastHearts = -1;
  private lastOd = -1;
  private disposed = false;

  private readonly onKey = (e: KeyboardEvent): void => {
    if (this.disposed || e.repeat) return;
    const k = e.key;
    if (this.phase === 'title' || this.phase === 'over') {
      if (k === 'Enter' || k === ' ') {
        e.preventDefault();
        if (this.phase === 'title') this.cb.onStart();
        else this.cb.onRestart();
      }
    } else if (this.phase === 'pause') {
      if (k === '1') this.cb.onResume();
      else if (k === '2') this.cb.onRestart();
      else if (k === '3') this.cb.onToggleMute();
    }
  };

  constructor(root: HTMLElement, cb: UICallbacks) {
    this.cb = cb;
    injectHSStyle();

    this.rootEl = el(
      'div',
      'hs-ui-root fixed inset-0 z-40 overflow-hidden pointer-events-none select-none',
    );
    this.hud = new HUD(
      typeof window !== 'undefined' && /fps=1/.test(window.location.search),
    );
    this.banners = new BannerLayer();
    this.toasts = new ToastLayer();
    this.menus = new Menus(cb, typeof window !== 'undefined' && window.innerWidth < 768);

    // paint order: HUD → screens (backdrops cover HUD) → banners/toasts on top
    this.rootEl.append(
      this.hud.node,
      this.hud.vignette,
      this.menus.title,
      this.menus.pause,
      this.menus.over,
      this.banners.node,
      this.toasts.node,
    );
    root.appendChild(this.rootEl);
    this.showPhase('title'); // also hides HUD on title
    window.addEventListener('keydown', this.onKey);
  }

  static create(root: HTMLElement, cb: UICallbacks): UI {
    return new UI(root, cb);
  }

  showPhase(p: UIPhase): void {
    if (this.disposed) return;
    this.phase = p;
    this.menus.showPhase(p, this.lastState);
    this.hud.setVisible(p === 'run' || p === 'pause');
    if (p !== 'run') this.hud.setVignette(false);
  }

  update(s: UIState, _realDt: number): void {
    if (this.disposed) return;
    this.lastState = s;
    if (s.phase !== this.phase) this.showPhase(s.phase);

    this.menus.tick(s);
    this.hud.update(s, this.phase, _realDt);

    // edge-triggered toasts (DESIGN_C.md §19 copy, exact)
    if (this.phase === 'run') {
      if (this.lastHearts > 1 && s.hearts === 1) this.toasts.push('THE EMBER FADES', 'red');
      if (this.lastOd < 1 && s.od >= 1 && !s.odActive) {
        this.toasts.push('OVERDRIVE READY \u2014 Q', 'gold');
      }
    }
    this.lastHearts = s.hearts;
    this.lastOd = s.od;
  }

  banner(text: string, sub?: string): void {
    if (this.disposed) return;
    this.banners.push(text, sub);
  }

  toast(text: string): void {
    if (this.disposed) return;
    this.toasts.push(text);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKey);
    this.banners.dispose();
    this.toasts.dispose();
    this.rootEl.remove();
  }
}
