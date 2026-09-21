/**
 * HOLLOW SUN — C4 toast layer (internal).
 * Bottom-center small notices. hs-float-up 2.4s, then removed.
 */

import { el } from './style';

export type ToastTone = 'plain' | 'gold' | 'red';

const MAX_LIVE = 4;

export class ToastLayer {
  readonly node: HTMLDivElement;
  private disposed = false;

  constructor() {
    this.node = el(
      'div',
      'absolute bottom-[14vh] left-0 right-0 flex flex-col items-center gap-2 pointer-events-none',
    );
  }

  push(text: string, tone: ToastTone = 'plain'): void {
    if (this.disposed || !text) return;
    const tint =
      tone === 'gold' ? 'text-[#ffb454]/90' : tone === 'red' ? 'text-[#ff3b5c]/85' : 'text-[#fff7ea]/70';
    const toast = el(
      'div',
      `hs-toast-anim text-xs tracking-[0.2em] whitespace-nowrap uppercase ${tint}`,
      text.toUpperCase(),
    );
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    this.node.append(toast);
    while (this.node.childElementCount > MAX_LIVE) this.node.firstElementChild?.remove();
  }

  dispose(): void {
    this.disposed = true;
    this.node.replaceChildren();
  }
}
