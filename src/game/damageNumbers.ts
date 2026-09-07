import * as THREE from 'three';

/**
 * HOLLOW SUN — pooled DOM damage numbers (view-side only).
 *
 * Consumes the sim's optional onFoeHurt notifications (survived hits only —
 * kills speak through onKill's burst). Numbers rise 0.8 world-units over
 * 0.6s (easeOutCubic), fade over the final 0.25s, scale-pop 1 -> 1.15 in
 * the first 80ms. Chain (ricochet) hits render at 0.8x. Pool capped at 32;
 * the oldest entry is recycled when saturated. All timing is wall-clock and
 * framerate-independent. Perspective projection works from the orbit rig at
 * any angle; scale carries a distance clamp so far hits stay legible and
 * near hits never dominate the frame.
 */

const POOL = 32;
const LIFE = 0.6;
const RISE = 0.8;
const POP_T = 0.08;
const FADE_T = 0.25;

interface FloatEntry {
  el: HTMLDivElement;
  x: number;
  z: number;
  t: number; // age in seconds
  value: number;
  chain: boolean;
}

export class DamageNumbers {
  private pool: FloatEntry[] = [];
  private cursor = 0;
  private host: HTMLDivElement | null = null;
  private tmp = new THREE.Vector3();

  constructor() {
    if (typeof document === 'undefined') return; // headless safety
    this.host = document.createElement('div');
    this.host.setAttribute('aria-hidden', 'true');
    this.host.style.cssText =
      'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:12;';
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'hs-dmg-plate'; // obsidian chip — digits never camouflage
      el.style.cssText =
        'position:absolute;left:0;top:0;font-weight:700;font-variant-numeric:tabular-nums;' +
        'letter-spacing:0.02em;color:#ffd98f;padding:1px 5px;' +
        'text-shadow:0 0 6px rgba(255,150,60,0.75),0 1px 2px rgba(0,0,0,0.8);' +
        'transform:translate(-50%,-50%);opacity:0;will-change:transform,opacity;';
      el.textContent = '';
      this.host.appendChild(el);
      this.pool.push({ el, x: 0, z: 0, t: LIFE + 1, value: 0, chain: false });
    }
    document.body.appendChild(this.host);
  }

  /** fire one number at a world position (sim notification event) */
  spawn(x: number, z: number, value: number, chain: boolean): void {
    if (!this.pool.length) return;
    const e = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    e.x = x + (Math.random() - 0.5) * 0.5;
    e.z = z + (Math.random() - 0.5) * 0.5;
    e.t = 0;
    e.value = Math.max(1, Math.round(value));
    e.chain = chain;
    e.el.textContent = String(e.value);
    e.el.style.color = chain ? '#f2c99a' : '#ffd98f';
  }

  /** per-frame projection + animation (wall-clock dt) */
  update(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.pool.length) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const e of this.pool) {
      if (e.t > LIFE) {
        if (e.el.style.opacity !== '0') e.el.style.opacity = '0';
        continue;
      }
      e.t += dt;
      const k = Math.min(1, e.t / LIFE);
      // easeOutCubic rise
      const rise = 1 - Math.pow(1 - k, 3);
      const y = 1.0 + rise * RISE;
      this.tmp.set(e.x, y, e.z);
      // distance clamp — far hits stay legible, near hits never dominate
      const dist = this.tmp.distanceTo(camera.position);
      const dScale = THREE.MathUtils.clamp(30 / Math.max(1, dist), 0.85, 1.25);
      this.tmp.project(camera);
      if (this.tmp.z > 1 || this.tmp.z < -1) {
        e.el.style.opacity = '0';
        continue;
      }
      const sx = (this.tmp.x * 0.5 + 0.5) * w;
      const sy = (-this.tmp.y * 0.5 + 0.5) * h;
      // pop 1 -> 1.15 in the first POP_T, then settle
      const pop = e.t < POP_T ? 1 + 0.15 * (e.t / POP_T) : 1.15 - 0.15 * Math.min(1, (e.t - POP_T) / (LIFE - POP_T));
      const scale = (e.chain ? 0.8 : 1) * pop * dScale;
      // fade over the final FADE_T
      const fade = k > 1 - FADE_T / LIFE ? (1 - k) / (FADE_T / LIFE) : 1;
      e.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%,-50%) scale(${scale.toFixed(3)})`;
      e.el.style.opacity = fade.toFixed(2);
    }
  }

  dispose(): void {
    if (this.host) this.host.remove();
    this.pool = [];
  }
}
