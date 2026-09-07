import * as THREE from 'three';
import { ARENA_RADIUS } from './constants';
import { mulberry32, rngRange } from '../rng';

/**
 * AFTERGLOW — baked arena floor DETAIL MASK (llvmpipe-safe dressing).
 *
 * NOT an albedo map. Empirical bisection (see materials.ts STYLIZED_MAP)
 * proved the ACES + linear->sRGB output chain inflates raw albedo ~2x past
 * authored intent, painting the obsidian floor mid-orange. So this canvas is
 * authored as a MID-GRAY MULTIPLIER: 128/255 sampled raw and scaled by 2.1 in
 * the shader ≈ 1.05 (neutral). Darker canvas regions darken the floor (baked
 * AO vignette toward the rim), lighter regions pick out engraved detail.
 * Sampled with default NoColorSpace — raw bytes, no decode ambiguity.
 *
 * Contents: radial AO vignette, faint hex-tile grid (~2.6 world-unit spacing),
 * hairline engraved circles at r = 2.8 / 10 / 17 / 23.5, ember cracks, sparse
 * speckle noise.
 *
 * Deterministic: fixed-seed mulberry32 — the layout never changes between
 * reloads or runs. Module-cached: built once per page load.
 */

const TEX = 1024;
/** the floor mesh spans ±(ARENA_RADIUS + 0.6) — texture maps 1:1 onto it */
const FLOOR_R = ARENA_RADIUS + 0.6;

let cached: THREE.CanvasTexture | null = null;

export function getArenaTexture(): THREE.CanvasTexture {
  if (cached) return cached;

  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const ctx = c.getContext('2d')!;
  const C = TEX / 2;
  const px = C / FLOOR_R; // pixels per world unit
  const rng = mulberry32(0x0c0ff1e5); // fixed seed — deterministic layout

  // 1. neutral mid-gray base — multiplier ≈ 1.0 (shader scales by 2.1)
  ctx.fillStyle = '#7d7d7d';
  ctx.fillRect(0, 0, TEX, TEX);

  // 2. baked vignette = fake ambient occlusion darkening toward the rim
  const vig = ctx.createRadialGradient(C, C, C * 0.4, C, C, C);
  vig.addColorStop(0, 'rgba(255,255,255,0.05)');
  vig.addColorStop(0.7, 'rgba(0,0,0,0.06)');
  vig.addColorStop(0.88, 'rgba(0,0,0,0.22)');
  vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, TEX, TEX);

  // 3. faint hex-tile grid, ~2.6 world-unit flat-to-flat spacing, slight lift
  ctx.strokeStyle = 'rgba(255,255,255,0.055)';
  ctx.lineWidth = 1;
  const hexA = 1.5 * px; // circumradius so sqrt(3)*A ≈ 2.6u across
  const hexW = Math.sqrt(3) * hexA;
  const hexH = 1.5 * hexA;
  const rows = Math.ceil(C / hexH) + 1;
  const cols = Math.ceil(C / hexW) + 1;
  for (let row = -rows; row <= rows; row++) {
    for (let col = -cols; col <= cols; col++) {
      const hx = C + col * hexW + (row % 2 !== 0 ? hexW / 2 : 0);
      const hy = C + row * hexH;
      if (Math.hypot(hx - C, hy - C) > C - hexA) continue;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k / 6) * Math.PI * 2; // pointy-top
        const vx = hx + Math.cos(a) * hexA * 0.96;
        const vy = hy + Math.sin(a) * hexA * 0.96;
        if (k === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  // 4. hairline engraved circles — r 2.8 / 10 / 17 / 23.5 world units
  const circles: Array<[number, number]> = [
    [2.8, 0.16],
    [10, 0.1],
    [17, 0.08],
    [23.5, 0.12],
  ];
  for (const [r, a] of circles) {
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(C, C, r * px, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 5. ember cracks — jagged light veins
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) {
    const a0 = rngRange(rng, 0, Math.PI * 2);
    const d0 = rngRange(rng, 0.3, 0.85) * C;
    let x = C + Math.cos(a0) * d0;
    let y = C + Math.sin(a0) * d0;
    let ang = a0 + Math.PI + rngRange(rng, -0.6, 0.6);
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 5 + Math.floor(rng() * 5);
    for (let s = 0; s < segs; s++) {
      ang += rngRange(rng, -0.7, 0.7);
      const len = rngRange(rng, 18, 40);
      x += Math.cos(ang) * len;
      y += Math.sin(ang) * len;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 6. speckle — sparse light dust + dark pits
  for (let i = 0; i < 900; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * C;
    ctx.fillStyle = `rgba(255,255,255,${(0.02 + rng() * 0.07).toFixed(3)})`;
    const s = 0.6 + rng() * 1.4;
    ctx.fillRect(C + Math.cos(a) * d, C + Math.sin(a) * d, s, s);
  }
  for (let i = 0; i < 500; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * C;
    ctx.fillStyle = `rgba(0,0,0,${(0.08 + rng() * 0.2).toFixed(3)})`;
    const s = 1 + rng() * 2.4;
    ctx.fillRect(C + Math.cos(a) * d, C + Math.sin(a) * d, s, s);
  }

  const tex = new THREE.CanvasTexture(c);
  // deliberately NOT SRGBColorSpace — sampled raw as a linear multiplier
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
