import type { QualityTier } from "@/frontier/core/Quality";

/**
 * HUD CONTRACT (specialist S4 art pass).
 * setStats every frame (10Hz DOM writes inside); crosshair follows mouse.
 * Art direction: dusk amber #ffb469/#ffcf9a on near-black glass, steel neutrals,
 * danger #ff4a30, mint #7affd4 ONLY for lock-ons. ui-monospace, thin rules, notched corners.
 * New in S4: showBanner(title, sub, dur) top-center wave banner · setSpread(px) dynamic
 * crosshair spread · hull segment ticks + damage flash + critical pulse · mint lock pips.
 */
export interface HudStats {
  hp: number;
  maxHp: number;
  wave: number;
  score: number;
  enemies: number;
  lockCount: number;
  missileCd: number; // 0..1 ready fraction
  fps: number;
  quality: QualityTier;
  backend: string;
  muted: boolean;
}

export class Hud {
  private root: HTMLElement;
  private crosshair: HTMLElement;
  private vignette: HTMLElement;
  private banner: HTMLElement;
  private bannerTitle: HTMLElement;
  private bannerSub: HTMLElement;
  private hullWrap: HTMLElement;
  private hullFill: HTMLElement;
  private hullFlash: HTMLElement;
  private visible = true;
  private acc = 0;
  private dmgPulse = 0;
  private bannerT = 0;
  private bannerDur = 2.6;
  private lastWave = 0;
  private crit = false;
  private lockState = false;
  private spreadWired = false;
  private spreadPx = 12;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <style>
        .sf-hud { position:absolute; inset:0; font-family:ui-monospace, monospace; color:#e8dfd2; z-index:5; user-select:none; }
        .sf-top { position:absolute; top:14px; left:18px; font-size:12px; letter-spacing:.16em; text-shadow:0 1px 0 rgba(0,0,0,.7); }
        .sf-top b { color:#ffb469; font-weight:700; }
        .sf-perf { position:absolute; top:14px; right:18px; font-size:9px; letter-spacing:.1em; opacity:.4; }
        .sf-hp { position:absolute; left:18px; bottom:18px; width:240px; }
        .sf-hp .lab { font-size:10px; letter-spacing:.24em; opacity:.75; margin-bottom:4px; display:flex; justify-content:space-between; }
        .sf-hp .lab b { color:#ffcf9a; font-weight:700; letter-spacing:.1em; }
        .sf-hp.crit .lab b { color:#ff4a30; }
        .sf-hp .bar { position:relative; height:10px; border:1px solid #3a342c; background:rgba(0,0,0,.55); box-shadow:inset 0 0 8px rgba(0,0,0,.7); }
        .sf-hp .fill { height:100%; background:linear-gradient(90deg,#ff7a30,#ffc46a); transition:width .15s; box-shadow:0 0 10px rgba(255,140,50,.35); }
        .sf-hp .seg { position:absolute; inset:0; pointer-events:none; background-image:repeating-linear-gradient(90deg, transparent 0, transparent calc(10% - 1px), rgba(6,4,2,.85) calc(10% - 1px), rgba(6,4,2,.85) 10%); }
        .sf-hp .flash { position:absolute; inset:0; pointer-events:none; opacity:0; mix-blend-mode:screen; background:linear-gradient(90deg,#ff4a30,#ffd9a0); }
        .sf-hp.crit .bar { border-color:#ff4a30; animation:sf-crit .9s ease-in-out infinite; }
        @keyframes sf-crit { 0%,100% { box-shadow:inset 0 0 8px rgba(255,40,20,.25); } 50% { box-shadow:inset 0 0 14px rgba(255,40,20,.7); } }
        .sf-msl { position:absolute; right:18px; bottom:18px; text-align:right; font-size:11px; letter-spacing:.2em; }
        .sf-msl .pips { display:flex; gap:3px; justify-content:flex-end; margin-top:4px; }
        .sf-msl .pip { width:14px; height:5px; background:#3a342c; }
        .sf-msl .pip.on { background:#ffb469; box-shadow:0 0 6px rgba(255,150,60,.8); }
        .sf-msl .pip.lk { background:#7affd4; box-shadow:0 0 8px rgba(122,255,212,.9); }
        .sf-xh { position:absolute; width:34px; height:34px; margin:-17px 0 0 -17px; pointer-events:none; z-index:6; --sp:12px; }
        .sf-xh:before, .sf-xh:after { content:''; position:absolute; background:#ffcf9a; box-shadow:0 0 4px rgba(255,150,60,.9); }
        .sf-xh:before { left:50%; top:0; width:1px; height:100%; transform:translateX(-50%); }
        .sf-xh:after { top:50%; left:0; height:1px; width:100%; transform:translateY(-50%); }
        .sf-xh .dot { position:absolute; left:50%; top:50%; width:4px; height:4px; margin:-2px; background:#ffb469; }
        .sf-xh .br { position:absolute; width:7px; height:7px; border:0 solid rgba(255,207,154,.85); transition:left .09s ease, top .09s ease; filter:drop-shadow(0 0 3px rgba(255,150,60,.7)); }
        .sf-xh .b1 { left:calc(50% - var(--sp) - 7px); top:calc(50% - var(--sp) - 7px); border-left-width:1px; border-top-width:1px; }
        .sf-xh .b2 { left:calc(50% + var(--sp)); top:calc(50% - var(--sp) - 7px); border-right-width:1px; border-top-width:1px; }
        .sf-xh .b3 { left:calc(50% - var(--sp) - 7px); top:calc(50% + var(--sp)); border-left-width:1px; border-bottom-width:1px; }
        .sf-xh .b4 { left:calc(50% + var(--sp)); top:calc(50% + var(--sp)); border-right-width:1px; border-bottom-width:1px; }
        .sf-xh.lock:before, .sf-xh.lock:after { background:#7affd4; box-shadow:0 0 6px rgba(122,255,212,.9); }
        .sf-xh.lock .dot { background:#7affd4; box-shadow:0 0 6px rgba(122,255,212,.9); }
        .sf-xh.lock .br { border-color:rgba(122,255,212,.9); filter:drop-shadow(0 0 4px rgba(122,255,212,.8)); }
        .sf-xh .ring { position:absolute; inset:4px; border:1px solid transparent; border-radius:50%; }
        .sf-xh.lock .ring { border-color:rgba(122,255,212,.8); animation:sf-spin 1.2s linear infinite; }
        @keyframes sf-spin { to { transform:rotate(360deg); } }
        .sf-banner { position:absolute; top:16%; left:0; right:0; text-align:center; pointer-events:none; opacity:0; }
        .sf-banner .bn-rule { width:150px; height:1px; margin:10px auto; background:linear-gradient(90deg, transparent, rgba(255,180,105,.85), transparent); }
        .sf-banner .bn-t { font-size:30px; letter-spacing:.55em; text-indent:.55em; color:#ffcf9a; text-shadow:0 0 26px rgba(255,140,50,.45), 0 2px 0 rgba(0,0,0,.6); }
        .sf-banner .bn-s { font-size:10px; letter-spacing:.46em; text-indent:.46em; color:#c9a37a; margin-top:8px; opacity:.9; }
        .sf-vig { position:absolute; inset:0; pointer-events:none; box-shadow:inset 0 0 120px rgba(255,40,20,0); transition:box-shadow .12s; }
      </style>
      <div class="sf-hud">
        <div class="sf-top">WAVE <b data-wave>1</b> · SCORE <b data-score>0</b> · HOSTILES <b data-en>0</b></div>
        <div class="sf-perf" data-perf></div>
        <div class="sf-banner" data-banner>
          <div class="bn-rule"></div>
          <div class="bn-t" data-bt>WAVE 1</div>
          <div class="bn-s" data-bs>HOSTILES INBOUND</div>
          <div class="bn-rule"></div>
        </div>
        <div class="sf-hp" data-hpwrap>
          <div class="lab">HULL INTEGRITY <b data-hpnum>100</b></div>
          <div class="bar"><div class="fill" data-hp style="width:100%"></div><div class="seg"></div><div class="flash" data-hpflash></div></div>
        </div>
        <div class="sf-msl"><div>HYDRA <span data-lock>0</span> LOCKED</div><div class="pips" data-pips></div></div>
        <div class="sf-vig" data-vig></div>
        <div class="sf-boss" data-boss style="visibility:hidden"><div class="lab">COLOSSUS</div><div class="bbar"><div class="bfill" data-bossfill></div></div></div>
        <style>
          .sf-boss { position:absolute; top:52px; left:0; right:0; text-align:center; }
          .sf-boss .lab { font-size:10px; letter-spacing:.42em; color:#ff6a4a; margin-bottom:5px; }
          .sf-boss .bbar { width:420px; max-width:70vw; height:7px; margin:0 auto; border:1px solid #4a2a22; background:rgba(0,0,0,.55); }
          .sf-boss .bfill { height:100%; width:100%; background:linear-gradient(90deg,#ff3b30,#ff9a50); transition:width .2s; }
        </style>
        <div class="sf-boss sf-hidden" data-boss><div class="lab" data-bosslab>COLOSSUS</div><div class="bbar"><div class="bfill" data-bossfill></div></div></div>
        <div class="sf-xh" data-xh>
          <div class="br b1"></div><div class="br b2"></div><div class="br b3"></div><div class="br b4"></div>
          <div class="ring"></div><div class="dot"></div>
        </div>
      </div>`;
    this.crosshair = root.querySelector("[data-xh]") as HTMLElement;
    this.vignette = root.querySelector("[data-vig]") as HTMLElement;
    this.banner = root.querySelector("[data-banner]") as HTMLElement;
    this.bannerTitle = root.querySelector("[data-bt]") as HTMLElement;
    this.bannerSub = root.querySelector("[data-bs]") as HTMLElement;
    this.hullWrap = root.querySelector("[data-hpwrap]") as HTMLElement;
    this.hullFill = root.querySelector("[data-hp]") as HTMLElement;
    this.hullFlash = root.querySelector("[data-hpflash]") as HTMLElement;
    const pips = root.querySelector("[data-pips]") as HTMLElement;
    for (let i = 0; i < 6; i++) {
      const pip = document.createElement("div");
      pip.className = "pip";
      pips.appendChild(pip);
    }
    window.addEventListener("mousemove", this.onMove);
  }

  private onMove = (e: MouseEvent): void => {
    this.crosshair.style.left = `${e.clientX}px`;
    this.crosshair.style.top = `${e.clientY}px`;
  };

  flashDamage(): void {
    this.dmgPulse = 1;
  }

  setLocking(on: boolean): void {
    this.lockState = on;
    this.crosshair.classList.toggle("lock", on);
  }

  /** Dynamic crosshair spread in px (Game wires later; auto-driven from lock state until then). */
  setSpread(px: number): void {
    this.spreadWired = true;
    this.spreadPx = Math.max(2, Math.min(60, px));
    this.crosshair.style.setProperty("--sp", `${this.spreadPx}px`);
  }

  /** Top-center wave banner. dt-driven envelope — no timers. */
  showBanner(title: string, sub: string, dur = 2.6): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.bannerDur = Math.max(0.6, dur);
    this.bannerT = this.bannerDur + 0.45;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    (this.root.firstElementChild as HTMLElement).style.visibility = v ? "visible" : "hidden";
    this.crosshair.style.visibility = v ? "visible" : "hidden";
  }

  setStats(s: HudStats, dt: number): void {
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    const set = (sel: string, v: string) => {
      const el = this.root.querySelector(sel);
      if (el && el.textContent !== v) el.textContent = v;
    };
    set("[data-wave]", String(s.wave));
    set("[data-score]", String(s.score));
    set("[data-en]", String(s.enemies));
    set("[data-lock]", String(s.lockCount));
    set("[data-hpnum]", String(Math.max(0, Math.round(s.hp))));
    if (s.wave > this.lastWave) {
      this.lastWave = s.wave;
      this.showBanner(`WAVE ${s.wave}`, s.wave % 5 === 0 ? "HEAVY SIGNATURE INBOUND" : "HOSTILES INBOUND", 2.4);
    }
    const frac = Math.max(0, s.hp / s.maxHp);
    this.hullFill.style.width = `${frac * 100}%`;
    this.hullFill.style.background = frac < 0.3
      ? "linear-gradient(90deg,#ff3b30,#ff7a30)"
      : "linear-gradient(90deg,#ff7a30,#ffc46a)";
    const crit = frac < 0.3;
    if (crit !== this.crit) {
      this.crit = crit;
      this.hullWrap.classList.toggle("crit", crit);
    }
    const pips = this.root.querySelectorAll("[data-pips] .pip");
    const ready = Math.round(s.missileCd * 6);
    pips.forEach((p, i) => {
      const lockMode = s.lockCount > 0;
      p.classList.toggle("lk", lockMode && i < s.lockCount);
      p.classList.toggle("on", !lockMode && i < ready);
    });
    // default spread behavior until Game wires setSpread
    if (!this.spreadWired) {
      const target = this.lockState ? 7 : 12;
      if (target !== this.spreadPx) {
        this.spreadPx = target;
        this.crosshair.style.setProperty("--sp", `${target}px`);
      }
    }
    const perf = this.root.querySelector("[data-perf]");
    if (perf) perf.textContent = `${s.fps.toFixed(0)} FPS · ${s.quality.toUpperCase()} · ${s.backend}${s.muted ? " · MUTED" : ""}`;
  }

  /** Per-frame vignette decay, damage flash + hull shake, banner envelope. */
  /** Boss health bar: frac 0..1, or -1 to hide. */
  setBoss(frac: number): void {
    const el = this.root.querySelector("[data-boss]") as HTMLElement | null;
    if (!el) return;
    if (frac < 0) {
      el.style.visibility = "hidden";
      return;
    }
    el.style.visibility = "visible";
    const fill = this.root.querySelector("[data-bossfill]") as HTMLElement | null;
    if (fill) fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }

  tick(dt: number): void {
    if (this.dmgPulse > 0) {
      this.dmgPulse = Math.max(0, this.dmgPulse - dt * 2.4);
      this.vignette.style.boxShadow = `inset 0 0 120px rgba(255,40,20,${this.dmgPulse * 0.55})`;
    }
    if (!this.visible) return;
    this.hullFlash.style.opacity = (this.dmgPulse * 0.85).toFixed(3);
    this.hullWrap.style.transform = this.dmgPulse > 0.02
      ? `translateX(${((Math.random() - 0.5) * 5 * this.dmgPulse).toFixed(2)}px)`
      : "";
    if (this.bannerT > 0) {
      this.bannerT = Math.max(0, this.bannerT - dt);
      const elapsed = this.bannerDur + 0.45 - this.bannerT;
      const a = Math.min(elapsed / 0.3, 1, this.bannerT / 0.45);
      this.banner.style.opacity = Math.max(0, a).toFixed(3);
      const tr = 0.62 - 0.18 * Math.min(1, elapsed / 0.9);
      this.bannerTitle.style.letterSpacing = `${tr.toFixed(3)}em`;
    }
  }

  dispose(): void {
    window.removeEventListener("mousemove", this.onMove);
  }
}
