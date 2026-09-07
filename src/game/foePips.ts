import * as THREE from 'three';

/**
 * HOLLOW SUN — pooled DOM off-screen threat pips (engine-side loop).
 *
 * Foes outside the viewport clamp to the screen edge as small warm-amber
 * diamonds, loudest = nearest to the ember. Pool of 8 (stateless — pips are
 * re-assigned every frame nearest-first), z-index 9 = under the HUD (z-10)
 * so panels always win. Hidden in boss rooms (warden + escorts strobe the
 * edges otherwise). Behind-camera foes mirror their NDC so they clamp to a
 * sensible edge instead of a mirrored one. Zero CSS animation — per-frame
 * transform only, reduced-motion compliant by construction.
 */

const POOL = 8;
const MAX_DIST = 44; // pips fade to min opacity at this range from the ember
const EDGE = 20; // px margin kept from the viewport edge
const BASE = 10; // pip size in px (8 on ≤420px screens)

interface Cand {
  x: number;
  z: number;
  d: number; // distance to the ember (threat ordering)
}

export class FoePips {
  private pool: HTMLDivElement[] = [];
  private host: HTMLDivElement | null = null;
  private tmp = new THREE.Vector3();
  private rel = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private cand: Cand[] = [];

  constructor() {
    if (typeof document === 'undefined') return; // headless safety
    this.host = document.createElement('div');
    this.host.setAttribute('aria-hidden', 'true');
    this.host.style.cssText =
      'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:9;';
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'hs-threat-pip';
      el.style.cssText =
        'position:absolute;left:0;top:0;' +
        `width:${BASE}px;height:${BASE}px;` +
        'transform:translate(-50%,-50%);opacity:0;will-change:transform,opacity;';
      this.host.appendChild(el);
      this.pool.push(el);
    }
    document.body.appendChild(this.host);
  }

  /** per-frame edge projection (camera + sim; bossRoom hides the pool) */
  update(camera: THREE.PerspectiveCamera, sim: SimLike, bossRoom: boolean): void {
    if (!this.pool.length) return;
    if (bossRoom) {
      this.hideAll();
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const k = w <= 420 ? 0.8 : 1;
    camera.getWorldDirection(this.dir);

    // gather + distance-sort (mirrors the engine's danger pass — no allocs
    // beyond the reused scratch list)
    this.cand.length = 0;
    for (const f of sim.foes) {
      if (f.spawnT > 0) continue;
      this.cand.push({ x: f.x, z: f.z, d: Math.hypot(f.x - sim.px, f.z - sim.pz) });
    }
    this.cand.sort((a, b) => a.d - b.d);

    let used = 0;
    for (const c of this.cand) {
      if (used >= POOL) break;
      this.tmp.set(c.x, 1.0, c.z);
      this.rel.copy(this.tmp).sub(camera.position);
      const behind = this.rel.dot(this.dir) < 0;
      this.tmp.project(camera);
      let nx = this.tmp.x;
      let ny = this.tmp.y;
      if (behind) {
        nx = -nx;
        ny = -ny;
      }
      if (Math.abs(nx) <= 1 && Math.abs(ny) <= 1) continue; // on-screen — no pip
      // clamp along the threat direction, then to the px margin box
      const m = Math.max(Math.abs(nx), Math.abs(ny)) || 1;
      nx /= m;
      ny /= m;
      const sxRaw = (nx * 0.5 + 0.5) * w;
      const syRaw = (-ny * 0.5 + 0.5) * h;
      const sx = Math.min(w - EDGE, Math.max(EDGE, sxRaw));
      const sy = Math.min(h - EDGE, Math.max(EDGE, syRaw));
      // point outward from the screen center; diamond base is the CSS square
      const ang = Math.PI / 4 + Math.atan2(syRaw - h / 2, sxRaw - w / 2);
      const op = THREE.MathUtils.clamp(1.1 - c.d / MAX_DIST, 0.3, 0.95);
      const el = this.pool[used++];
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%,-50%) rotate(${ang.toFixed(3)}rad) scale(${k})`;
      el.style.opacity = op.toFixed(2);
    }
    for (let i = used; i < this.pool.length; i++) {
      if (this.pool[i].style.opacity !== '0') this.pool[i].style.opacity = '0';
    }
  }

  /** clear without disposing (death / run start / abandon) */
  clear(): void {
    this.hideAll();
  }

  dispose(): void {
    if (this.host) this.host.remove();
    this.pool = [];
  }

  private hideAll(): void {
    for (const el of this.pool) {
      if (el.style.opacity !== '0') el.style.opacity = '0';
    }
  }
}

/** minimal structural sim contract (avoids importing the full Sim type) */
interface SimLike {
  px: number;
  pz: number;
  foes: { x: number; z: number; spawnT: number }[];
}
