import type { UpgradeDef } from "@/frontier/sim/Upgrades";
import type { QualityTier } from "@/frontier/core/Quality";

/**
 * MENUS CONTRACT (specialist S4 art pass).
 * showTitle/hideTitle/showUpgrades/hideUpgrades/showPause/hidePause/
 * showGameOver/hideGameOver/setBest/setQualityOptions/dispose
 * Art direction: cinematic dusk-amber title (tracked type, thin amber rule, glow DEPLOY),
 * notched clip-path cards with hover-lift + level pips + 1/2/3 keyboard picks,
 * dotted stat rows on game over with NEW RECORD pulse. Mint is reserved for lock-ons (HUD only).
 * New in S4: quality tier buttons (hooks.onQuality) + mute button (hooks.onToggleMute)
 * + setMuted(m) label sync + keyboard 1/2/3 upgrade selection.
 */
export interface MenuHooks {
  onStart: () => void;
  onUpgradePick: (id: string) => void;
  onRestart: () => void;
  onResume: () => void;
  onQuality: (t: QualityTier) => void;
  onToggleMute: () => void;
}

export interface UpgradeCardView {
  id: string;
  name: string;
  desc: string;
  level: number;
  maxLevel: number;
}

const TIERS: QualityTier[] = ["low", "medium", "high", "ultra"];

export class Menus {
  private root: HTMLElement;
  private hooks: MenuHooks;
  private upgIds: string[] = [];
  private upgVisible = false;
  private muted = false;

  constructor(root: HTMLElement, hooks: MenuHooks) {
    this.root = root;
    this.hooks = hooks;
    root.innerHTML = `
      <style>
        .sf-menu { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-family:ui-monospace, monospace; pointer-events:none; z-index:8; }
        .sf-dim { background:rgba(6,4,3,.45); backdrop-filter:blur(2px); }
        .sf-card { text-align:center; color:#e8dfd2; pointer-events:auto; background:rgba(10,8,6,.78); border:1px solid #3a342c; padding:38px 56px; backdrop-filter:blur(4px); filter:drop-shadow(0 18px 40px rgba(0,0,0,.45)); clip-path:polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px); }
        .sf-kick { font-size:9px; letter-spacing:.5em; text-indent:.5em; color:#8a7c6a; margin-bottom:14px; }
        .sf-title { font-size:54px; letter-spacing:.3em; text-indent:.3em; color:#ffcf9a; margin:0; font-weight:700; text-shadow:0 0 30px rgba(255,140,50,.4), 0 2px 0 rgba(0,0,0,.55); }
        .sf-rule { width:280px; height:1px; margin:16px auto 12px; background:linear-gradient(90deg, transparent, #ffb469 45%, #ffb469 55%, transparent); box-shadow:0 0 8px rgba(255,150,60,.5); }
        .sf-sub { font-size:10px; letter-spacing:.44em; text-indent:.44em; color:#9a8b78; margin:0 0 30px; }
        .sf-btn { display:inline-block; padding:14px 58px; border:1px solid #6b5a44; color:#ffcf9a; letter-spacing:.34em; text-indent:.34em; font-size:14px; cursor:pointer; background:linear-gradient(180deg, rgba(40,26,12,.7), rgba(20,14,8,.7)); transition:box-shadow .15s, border-color .15s, color .15s; }
        .sf-btn:hover { border-color:#ffb469; color:#fff3dd; box-shadow:0 0 24px rgba(255,150,60,.35), inset 0 0 12px rgba(255,150,60,.12); text-shadow:0 0 10px rgba(255,180,105,.8); }
        .sf-legend { display:flex; gap:14px; justify-content:center; flex-wrap:wrap; margin-top:26px; font-size:9px; letter-spacing:.14em; color:#8a7c6a; }
        .sf-legend b { color:#c9b9a0; font-weight:700; border:1px solid #4c5158; background:rgba(76,81,88,.15); padding:1px 5px; margin-right:4px; }
        .sf-meta { display:flex; align-items:center; justify-content:center; gap:14px; margin-top:24px; padding-top:16px; border-top:1px solid rgba(76,81,88,.35); }
        .sf-best { font-size:10px; letter-spacing:.24em; color:#8a7c6a; }
        .sf-best b { color:#ffcf9a; }
        .sf-qlab { font-size:9px; letter-spacing:.2em; color:#6d6459; }
        .sf-qb { font-size:9px; letter-spacing:.16em; color:#9a8b78; border:1px solid #3a342c; background:rgba(14,10,6,.5); padding:4px 9px; cursor:pointer; transition:border-color .12s, color .12s, box-shadow .12s; }
        .sf-qb:hover { border-color:#6b5a44; color:#ffcf9a; }
        .sf-qb.on { border-color:#ffb469; color:#ffb469; background:rgba(255,150,60,.08); box-shadow:0 0 10px rgba(255,150,60,.2); }
        .sf-qgrp { display:flex; gap:6px; align-items:center; }
        .sf-hidden { display:none !important; }
        .sf-upg { display:flex; gap:14px; justify-content:center; margin-top:8px; }
        .sf-u { position:relative; width:212px; border:1px solid #3a342c; background:linear-gradient(180deg, rgba(20,14,8,.92), rgba(10,8,6,.92)); padding:20px 16px 14px; cursor:pointer; text-align:left; transition:transform .14s ease, border-color .14s, box-shadow .14s; clip-path:polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px); }
        .sf-u:hover { transform:translateY(-4px); border-color:#ffb469; box-shadow:0 10px 26px rgba(0,0,0,.55), 0 0 20px rgba(255,150,60,.18); }
        .sf-u h3 { font-size:13px; letter-spacing:.14em; color:#ffcf9a; margin:0 0 8px; }
        .sf-u p { font-size:11px; color:#a89a86; margin:0 0 12px; line-height:1.55; min-height:34px; }
        .sf-pips { display:flex; gap:4px; margin-bottom:2px; }
        .sf-pips i { width:16px; height:4px; background:#2c2822; border:1px solid #3a342c; }
        .sf-pips i.f { background:#ffb469; border-color:#ffb469; box-shadow:0 0 6px rgba(255,150,60,.5); }
        .sf-pips i.nx { border-color:#ffb469; animation:sf-nx 1.1s ease-in-out infinite; }
        @keyframes sf-nx { 0%,100% { background:rgba(255,150,60,.05); } 50% { background:rgba(255,150,60,.4); } }
        .sf-key { position:absolute; top:8px; right:10px; font-size:9px; color:#6d6459; border:1px solid #3a342c; padding:1px 6px; letter-spacing:.1em; }
        .sf-upgh { letter-spacing:.34em; text-indent:.34em; font-size:16px; color:#ffcf9a; margin:0 0 4px; }
        .sf-upgs { font-size:9px; letter-spacing:.34em; text-indent:.34em; color:#9a8b78; margin:0 0 18px; }
        .sf-ph { letter-spacing:.4em; text-indent:.4em; font-size:22px; margin:0 0 22px; color:#e8dfd2; }
        .sf-hint { margin-top:14px; font-size:9px; letter-spacing:.3em; color:#6d6459; }
        .sf-oh { letter-spacing:.4em; text-indent:.4em; font-size:20px; color:#ff4a30; margin:0 0 6px; text-shadow:0 0 22px rgba(255,60,30,.4); }
        .sf-big { font-size:44px; letter-spacing:.1em; color:#ffcf9a; margin:12px 0 18px; text-shadow:0 0 24px rgba(255,140,50,.35); }
        .sf-rows { width:280px; margin:0 auto; }
        .sf-dotted { display:flex; align-items:baseline; gap:10px; font-size:11px; letter-spacing:.16em; color:#a89a86; margin:8px 0; }
        .sf-dotted i { flex:1; border-bottom:1px dotted #4c5158; transform:translateY(-3px); }
        .sf-dotted span:last-child { color:#ffcf9a; }
        .sf-rec { font-size:10px; letter-spacing:.34em; text-indent:.34em; color:#ffb469; margin:12px 0 2px; min-height:14px; text-shadow:0 0 12px rgba(255,150,60,.8); animation:sf-rec 1s ease-in-out infinite; }
        @keyframes sf-rec { 0%,100% { opacity:.55; } 50% { opacity:1; } }
      </style>
      <div class="sf-menu" data-title>
        <div class="sf-card">
          <div class="sf-kick">SECTOR 7 — DUSK OUTPOST</div>
          <h1 class="sf-title">STEEL FRONTIER</h1>
          <div class="sf-rule"></div>
          <p class="sf-sub">DUSK OUTPOST — HOLD THE LINE</p>
          <div class="sf-btn" data-start>DEPLOY</div>
          <div class="sf-legend">
            <span><b>WASD</b> MOVE</span><span><b>MOUSE</b> AIM</span><span><b>LMB</b> CANNON</span><span><b>RMB</b> HYDRA LOCK</span><span><b>SPACE</b> DASH</span>
          </div>
          <div class="sf-meta">
            <div class="sf-best">BEST <b data-best>0</b></div>
            <div class="sf-qgrp"><span class="sf-qlab">GFX</span><span class="sf-qb" data-q="low">LOW</span><span class="sf-qb" data-q="medium">MED</span><span class="sf-qb" data-q="high">HIGH</span><span class="sf-qb" data-q="ultra">ULTRA</span></div>
            <div class="sf-qb" data-mute>SOUND ON</div>
          </div>
        </div>
      </div>
      <div class="sf-menu sf-dim sf-hidden" data-upg>
        <div class="sf-card" style="padding:28px 40px">
          <h2 class="sf-upgh" data-upgh>WAVE CLEARED</h2>
          <p class="sf-upgs">REFIT — CHOOSE ONE · PRESS 1 / 2 / 3</p>
          <div class="sf-upg" data-upgc></div>
        </div>
      </div>
      <div class="sf-menu sf-dim sf-hidden" data-pause>
        <div class="sf-card" style="padding:34px 60px"><h2 class="sf-ph">PAUSED</h2><div class="sf-btn" data-resume>RESUME</div><div class="sf-hint">ESC TO RESUME</div></div>
      </div>
      <div class="sf-menu sf-dim sf-hidden" data-over>
        <div class="sf-card">
          <h2 class="sf-oh">OUTPOST LOST</h2>
          <div class="sf-big" data-oscore>0</div>
          <div class="sf-rows">
            <div class="sf-dotted"><span>WAVE REACHED</span><i></i><span data-owave>1</span></div>
            <div class="sf-dotted"><span>KILLS</span><i></i><span data-okills>0</span></div>
            <div class="sf-dotted"><span>BEST</span><i></i><span data-obest>0</span></div>
          </div>
          <div class="sf-rec" data-orec></div>
          <div class="sf-btn" data-restart style="margin-top:16px">REDEPLOY</div>
        </div>
      </div>`;

    const click = (sel: string, fn: () => void) => {
      const el = root.querySelector(sel);
      if (el) el.addEventListener("click", fn);
    };
    click("[data-start]", hooks.onStart);
    click("[data-resume]", hooks.onResume);
    click("[data-restart]", hooks.onRestart);
    click("[data-mute]", () => {
      this.muted = !this.muted;
      const el = this.root.querySelector("[data-mute]");
      if (el) el.textContent = this.muted ? "SOUND OFF" : "SOUND ON";
      this.hooks.onToggleMute();
    });
    root.querySelectorAll<HTMLElement>("[data-q]").forEach((el) => {
      el.addEventListener("click", () => {
        const t = el.dataset.q as QualityTier | undefined;
        if (!t || !TIERS.includes(t)) return;
        this.setQualityOptions(t);
        this.hooks.onQuality(t);
      });
    });
    document.addEventListener("keydown", this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.upgVisible) return;
    const idx = ["1", "2", "3"].indexOf(e.key);
    if (idx < 0 || idx >= this.upgIds.length) return;
    const id = this.upgIds[idx];
    if (!id) return;
    this.upgVisible = false; // single-fire; Game hides the panel via hideUpgrades
    this.hooks.onUpgradePick(id);
  };

  private show(sel: string): void { (this.root.querySelector(sel) as HTMLElement | null)?.classList.remove("sf-hidden"); }
  private hide(sel: string): void { (this.root.querySelector(sel) as HTMLElement | null)?.classList.add("sf-hidden"); }

  showTitle(best: number): void { this.setBest(best); this.show("[data-title]"); }
  hideTitle(): void { this.hide("[data-title]"); }

  showUpgrades(cards: UpgradeCardView[], wave: number): void {
    const h = this.root.querySelector("[data-upgh]");
    if (h) h.textContent = `WAVE ${wave} CLEARED`;
    const c = this.root.querySelector("[data-upgc]") as HTMLElement;
    c.innerHTML = "";
    this.upgIds = cards.map((u) => u.id);
    this.upgVisible = true;
    cards.forEach((u, i) => {
      const d = document.createElement("div");
      d.className = "sf-u";
      const pips: string[] = [];
      for (let p = 0; p < u.maxLevel; p++) {
        if (p < u.level) pips.push('<i class="f"></i>');
        else if (p === u.level) pips.push('<i class="nx"></i>');
        else pips.push("<i></i>");
      }
      d.innerHTML =
        `<span class="sf-key">${i + 1}</span><h3>${u.name}</h3><p>${u.desc}</p>` +
        `<div class="sf-pips">${pips.join("")}</div>` +
        `<div class="lv">LV ${u.level} → ${u.level + 1} / ${u.maxLevel}</div>`;
      d.addEventListener("click", () => {
        this.upgVisible = false;
        this.hooks.onUpgradePick(u.id);
      });
      c.appendChild(d);
    });
    this.show("[data-upg]");
  }
  hideUpgrades(): void { this.upgVisible = false; this.hide("[data-upg]"); }

  showPause(): void { this.show("[data-pause]"); }
  hidePause(): void { this.hide("[data-pause]"); }

  showGameOver(score: number, wave: number, kills: number, best: number, record: boolean): void {
    const g = (sel: string) => this.root.querySelector(sel);
    if (g("[data-oscore]")) g("[data-oscore]")!.textContent = String(score);
    if (g("[data-owave]")) g("[data-owave]")!.textContent = String(wave);
    if (g("[data-okills]")) g("[data-okills]")!.textContent = String(kills);
    if (g("[data-obest]")) g("[data-obest]")!.textContent = String(best);
    if (g("[data-orec]")) g("[data-orec]")!.textContent = record ? "NEW RECORD" : "";
    this.show("[data-over]");
  }
  hideGameOver(): void { this.hide("[data-over]"); }

  setBest(best: number): void {
    const el = this.root.querySelector("[data-best]");
    if (el) el.textContent = String(best);
  }

  /** Highlight the active quality tier (also called by Game on autoscale changes). */
  setQualityOptions(tier: QualityTier): void {
    this.root.querySelectorAll<HTMLElement>("[data-q]").forEach((el) => {
      el.classList.toggle("on", el.dataset.q === tier);
    });
  }

  /** Sync mute button label if the orchestrator changes mute state elsewhere. */
  setMuted(m: boolean): void {
    this.muted = m;
    const el = this.root.querySelector("[data-mute]");
    if (el) el.textContent = m ? "SOUND OFF" : "SOUND ON";
  }

  dispose(): void {
    document.removeEventListener("keydown", this.onKey);
  }
}
