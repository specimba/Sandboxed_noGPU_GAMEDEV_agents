/**
 * HOLLOW SUN — C4 UI shared style helpers (internal).
 * ONE injected <style id="hs-style"> carries every hs-* keyframe/helper class.
 * No new fonts, no images, no deps. Palette locked to DESIGN_C.md §2.
 */

export const HS_STYLE_ID = 'hs-style';

const CSS = `
.hs-ui-root {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
/* gradient text-safe glow (drop-shadow, not text-shadow — bg-clip:text) */
.hs-glow {
  filter: drop-shadow(0 0 14px rgba(255, 138, 61, 0.5)) drop-shadow(0 0 44px rgba(255, 138, 61, 0.25));
}
.hs-pulse { animation: hs-pulse 1.6s ease-in-out infinite; }
.hs-breathe { animation: hs-breathe 3.4s ease-in-out infinite; }
.hs-flicker { animation: hs-flicker 3.2s linear infinite; }
.hs-heartbeat { animation: hs-heartbeat 1.15s ease-in-out infinite; }
.hs-od-pulse { animation: hs-od-pulse 1.05s ease-in-out infinite; }
.hs-pop { animation: hs-pop 0.18s cubic-bezier(0.2, 0.8, 0.3, 1); }
.hs-toast-anim { animation: hs-float-up 2.4s ease-out forwards; }
.hs-banner-anim { animation: hs-banner 2.2s cubic-bezier(0.16, 0.75, 0.3, 1) forwards; }
.hs-banner-sub-anim { animation: hs-banner-sub 2.2s ease-out forwards; }

@keyframes hs-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
@keyframes hs-breathe {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
@keyframes hs-flicker {
  0%, 100% { opacity: 1; }
  38% { opacity: 1; }
  39% { opacity: 0.55; }
  40% { opacity: 1; }
  44% { opacity: 0.75; }
  45% { opacity: 1; }
  74% { opacity: 1; }
  75% { opacity: 0.45; }
  76% { opacity: 1; }
  77% { opacity: 0.8; }
  78% { opacity: 1; }
}
@keyframes hs-heartbeat {
  0%, 100% { opacity: 0.55; }
  12% { opacity: 1; }
  24% { opacity: 0.6; }
  36% { opacity: 0.95; }
  56% { opacity: 0.55; }
}
@keyframes hs-od-pulse {
  0%, 100% { box-shadow: 0 0 8px 1px rgba(255, 180, 84, 0.35); }
  50% { box-shadow: 0 0 20px 5px rgba(255, 180, 84, 0.8); }
}
@keyframes hs-pop {
  0% { transform: scale(1.6); }
  100% { transform: scale(1); }
}
@keyframes hs-float-up {
  0% { opacity: 0; transform: translateY(10px); }
  12% { opacity: 1; transform: translateY(0); }
  72% { opacity: 1; transform: translateY(-6px); }
  100% { opacity: 0; transform: translateY(-16px); }
}
@keyframes hs-banner {
  0% { opacity: 0; letter-spacing: 0.95em; }
  16% { opacity: 1; letter-spacing: 0.4em; }
  80% { opacity: 1; letter-spacing: 0.4em; }
  100% { opacity: 0; letter-spacing: 0.35em; }
}
@keyframes hs-banner-sub {
  0%, 10% { opacity: 0; transform: translateY(6px); }
  24% { opacity: 1; transform: translateY(0); }
  80% { opacity: 1; }
  100% { opacity: 0; }
}
`;

/** Inject the single hs-style sheet once (idempotent, SSR-safe). */
export function injectHSStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(HS_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HS_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** Tiny element factory — all text via textContent, never innerHTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** Integer score/best formatting (tabular-nums friendly). */
export function fmtScore(v: number): string {
  return String(Math.max(0, Math.floor(v)));
}

/** Run time m:ss. */
export function fmtTime(t: number): string {
  const safe = Math.max(0, t);
  const m = Math.floor(safe / 60);
  const sec = Math.floor(safe - m * 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Clamp helper for meter-style values. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
