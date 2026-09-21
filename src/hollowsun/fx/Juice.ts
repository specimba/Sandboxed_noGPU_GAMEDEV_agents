import { EV, type FXState, type SimEvent, type Snap } from "@/hollowsun/types";

/**
 * HOLLOW SUN — Juice (DESIGN_C §10). The FEEL layer.
 *
 * WRITES the shared FXState (never decays hitstop — core/Loop consumes it):
 *   KILL    hitstop +0.03 (clamped 0.09 total), trauma +0.12, score popup
 *   RICOCHET trauma +0.05
 *   HURT    flash = 1, trauma +0.5, red vignette pulse
 *   DASH    trauma +0.08
 *   BOSSDIE slow-mo: timeScale 0.35 ramping back to 1 over 1s, trauma +0.5
 *   SUNRANK golden pulse 0.6
 * update(realDt, snap) decays trauma 1.6/s + flash ~8/s + red pulse, drives the
 * Overdrive envelope from snap.odActive (chroma -> 0.004, golden -> 1,
 * timeScale -> 0.55; else -> 1, or 0.35 while bossdie slow-mo is active), and
 * animates the DOM layer: white flash, red damage vignette, score popups.
 *
 * Popups project kill world-positions through the projector installed by Game
 * (setProjector). Without one they stack above the OD ring area (bottom-left).
 * Cap 32 popups, 0.7s float-up + fade each.
 */

const HITSTOP_MAX = 0.09;
const TRAUMA_DECAY = 1.6; // per second
const FLASH_DECAY = 8.0; // exponential per second
const RED_DECAY = 3.2;
const POPUP_LIFE = 0.7;
const POPUP_CAP = 32;
const BOSSDIE_S = 1.0;
const OD_TIME_SCALE = 0.55;

interface Popup {
  el: HTMLSpanElement;
  wx: number;
  wy: number;
  t: number;
  jitter: number;
}

export type Projector = (x: number, y: number) => { sx: number; sy: number };

export class Juice {
  private fx: FXState;
  private layer: HTMLDivElement | null = null;
  private flashEl: HTMLDivElement | null = null;
  private vignEl: HTMLDivElement | null = null;
  private popLayer: HTMLDivElement | null = null;
  private popups: Popup[] = [];
  private project: Projector | null = null;
  private redPulse = 0;
  private golden = 0;
  private bossdieT = 0;
  private odWas = false;

  constructor(fx: FXState, root: HTMLElement) {
    this.fx = fx;
    if (typeof document === "undefined") return;
    try {
      const layer = document.createElement("div");
      layer.style.cssText =
        "position:absolute;inset:0;pointer-events:none;z-index:30;overflow:hidden;";

      const vign = document.createElement("div");
      vign.style.cssText =
        "position:absolute;inset:0;box-shadow:inset 0 0 140px 52px rgba(255,59,92,0.9);opacity:0;";
      const flash = document.createElement("div");
      flash.style.cssText = "position:absolute;inset:0;background:#fff7ea;opacity:0;";
      const pops = document.createElement("div");
      pops.style.cssText = "position:absolute;inset:0;";

      layer.append(vign, flash, pops);
      root.appendChild(layer);
      this.layer = layer;
      this.vignEl = vign;
      this.flashEl = flash;
      this.popLayer = pops;
    } catch {
      /* DOM unavailable — fx writing still works */
    }
  }

  /** Game calls this once the camera exists: world (x,y) -> screen px. */
  setProjector(fn: Projector): void {
    this.project = fn;
  }

  handleEvent(ev: SimEvent): void {
    const fx = this.fx;
    switch (ev.type) {
      case EV.KILL:
        fx.hitstop = Math.min(HITSTOP_MAX, fx.hitstop + 0.03);
        fx.trauma = Math.min(1, fx.trauma + 0.12);
        this.spawnPopup(ev.x, ev.y, `+${Math.max(0, Math.round(ev.b))}`);
        break;
      case EV.RICOCHET:
        fx.trauma = Math.min(1, fx.trauma + 0.05);
        break;
      case EV.HURT:
        fx.flash = 1;
        fx.trauma = Math.min(1, fx.trauma + 0.5);
        this.redPulse = 1;
        break;
      case EV.DASH:
        fx.trauma = Math.min(1, fx.trauma + 0.08);
        break;
      case EV.BOSSDIE:
        this.bossdieT = BOSSDIE_S;
        fx.trauma = Math.min(1, fx.trauma + 0.5);
        break;
      case EV.SUNRANK:
        this.golden = Math.max(this.golden, 0.6);
        break;
      default:
        break;
    }
  }

  update(realDt: number, snap: Snap): void {
    const fx = this.fx;
    const dt = Math.min(0.1, Math.max(0, realDt));

    // Decay envelopes.
    fx.trauma = Math.max(0, Math.min(1, fx.trauma - TRAUMA_DECAY * dt));
    fx.flash = fx.flash > 0.002 ? fx.flash * Math.exp(-FLASH_DECAY * dt) : 0;
    this.redPulse = this.redPulse > 0.002 ? this.redPulse * Math.exp(-RED_DECAY * dt) : 0;

    // Overdrive envelope from snapshot (chroma / golden / timeScale).
    const od = snap.odActive;
    if (od) this.golden = Math.min(1, this.golden + dt * 3.5);
    else this.golden = Math.max(0, this.golden - dt * 1.1);
    fx.golden = Math.max(0, Math.min(1, this.golden));

    if (od) fx.chroma += (0.004 - fx.chroma) * Math.min(1, dt * 4);
    else fx.chroma += (0 - fx.chroma) * Math.min(1, dt * 3);

    // World time scale: bossdie slow-mo > overdrive > normal.
    if (this.bossdieT > 0) {
      this.bossdieT = Math.max(0, this.bossdieT - dt);
      fx.timeScale = 0.35 + 0.65 * (1 - this.bossdieT / BOSSDIE_S);
    } else if (od) {
      fx.timeScale += (OD_TIME_SCALE - fx.timeScale) * Math.min(1, dt * 8);
    } else {
      fx.timeScale += (1 - fx.timeScale) * Math.min(1, dt * 6);
    }

    // Overdrive ignite kick.
    if (od && !this.odWas) {
      fx.flash = Math.max(fx.flash, 0.45);
      fx.trauma = Math.min(1, fx.trauma + 0.15);
    }
    this.odWas = od;

    // DOM layer.
    if (this.flashEl) this.flashEl.style.opacity = fx.flash.toFixed(3);
    if (this.vignEl) this.vignEl.style.opacity = this.redPulse.toFixed(3);
    this.updatePopups(dt);
  }

  dispose(): void {
    for (const p of this.popups) p.el.remove();
    this.popups.length = 0;
    this.layer?.remove();
    this.layer = null;
    this.flashEl = null;
    this.vignEl = null;
    this.popLayer = null;
    this.project = null;
  }

  // ---------- popups ----------

  private spawnPopup(wx: number, wy: number, text: string): void {
    if (!this.popLayer || typeof document === "undefined") return;
    try {
      const el = document.createElement("span");
      el.textContent = text;
      el.style.cssText =
        "position:absolute;left:0;top:0;white-space:nowrap;color:#ffb454;" +
        "font-weight:800;font-size:15px;line-height:1;letter-spacing:0.5px;" +
        "text-shadow:0 0 10px rgba(255,180,84,0.85),0 0 2px #fff7ea;" +
        "opacity:0;will-change:transform,opacity;pointer-events:none;";
      this.popLayer.appendChild(el);
      if (this.popups.length >= POPUP_CAP) {
        const old = this.popups.shift();
        old?.el.remove();
      }
      this.popups.push({ el, wx, wy, t: 0, jitter: Math.random() });
    } catch {
      /* no-op */
    }
  }

  private updatePopups(dt: number): void {
    if (this.popups.length === 0) return;
    const pr = this.project;
    let stack = 0;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += dt;
      if (p.t >= POPUP_LIFE) {
        p.el.remove();
        this.popups.splice(i, 1);
        continue;
      }
      const k = p.t / POPUP_LIFE;
      const rise = (1 - (1 - k) * (1 - k)) * 46; // ease-out float up
      const scale = 1.18 - 0.18 * Math.min(1, p.t * 4);
      const op = k < 0.12 ? k / 0.12 : Math.max(0, 1 - (k - 0.12) / 0.88);
      const el = p.el;
      el.style.opacity = op.toFixed(3);
      if (pr) {
        const s = pr(p.wx, p.wy);
        el.style.left = `${s.sx}px`;
        el.style.top = `${s.sy}px`;
        el.style.bottom = "auto";
        el.style.transform = `translate(-50%,-50%) translateY(${-rise}px) scale(${scale.toFixed(3)})`;
      } else {
        // Fallback: stack above the OD ring area (bottom-left).
        el.style.left = `${104 + p.jitter * 28}px`;
        el.style.top = "auto";
        el.style.bottom = `${148 + stack * 26}px`;
        el.style.transform = `translate(-50%,0) translateY(${-rise}px) scale(${scale.toFixed(3)})`;
        stack++;
      }
    }
  }
}
