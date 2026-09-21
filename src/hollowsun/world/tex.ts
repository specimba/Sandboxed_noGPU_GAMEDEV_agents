import * as THREE from "three/webgpu";

/**
 * HOLLOW SUN — procedural canvas textures (zero assets, C2 owned).
 * All glow-ish textures are painted on OPAQUE black so additive blending
 * "just works" (black contributes nothing) and canvas premultiplication
 * can never muddy the RGB.
 */

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size, size);
  return [c, ctx];
}

function toTex(c: HTMLCanvasElement, srgb: boolean, repeat: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Hex-grid tile for the arena floor: gridline #2a1f3d on near-black. */
export function makeHexGridTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = makeCanvas(S);
  // pointy-top hex tiling; cell radius chosen so the tile repeats seamlessly
  const r = S / 8; // 8 hex rows per tile
  const w = Math.sqrt(3) * r; // horizontal pitch
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = "#2a1f3d";
  const hexPath = (cx: number, cy: number, rr: number) => {
    ctx.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6; // flat-top offset
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  // draw one extra ring so wrap seams stay covered
  for (let row = -1; row <= 9; row++) {
    for (let col = -1; col <= 9; col++) {
      const cx = col * w + (row % 2 === 0 ? 0 : w / 2);
      const cy = row * r * 0.75;
      hexPath(cx, cy, r * 0.96);
    }
  }
  // faint interior sheen inside some cells (very low, keeps floor alive)
  ctx.globalAlpha = 0.05;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row * 7 + col * 13) % 5 !== 0) continue;
      const cx = col * w + (row % 2 === 0 ? 0 : w / 2) + w / 2;
      const cy = row * r * 0.75 + r * 0.75;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.7);
      g.addColorStop(0, "#241a38");
      g.addColorStop(1, "#000000");
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
  ctx.globalAlpha = 1;
  return toTex(c, true, true);
}

/** Rune glyph sheet cell (drawn centered, used by boundary glyph planes). */
function drawRune(ctx: CanvasRenderingContext2D, S: number, seed: number): void {
  // deterministic pseudo-random from seed
  const rnd = (n: number) => {
    const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const R = S * 0.36;
  const cx = S / 2;
  const cy = S / 2;
  ctx.strokeStyle = "#ffb454";
  ctx.lineCap = "round";
  ctx.lineWidth = S * 0.028;
  ctx.shadowColor = "#ff8a3d";
  ctx.shadowBlur = S * 0.05;
  // circle + inner spokes + ticks: arcane-but-geometric
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  const spokes = 3 + Math.floor(rnd(1) * 4);
  for (let k = 0; k < spokes; k++) {
    const a0 = (k / spokes) * Math.PI * 2 + rnd(2) * 0.8;
    const a1 = a0 + 0.7 + rnd(3) * 1.6;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * R * 0.25, cy + Math.sin(a0) * R * 0.25);
    ctx.lineTo(cx + Math.cos(a1) * R * (0.72 + rnd(4) * 0.25), cy + Math.sin(a1) * R * (0.72 + rnd(4) * 0.25));
    ctx.stroke();
  }
  const ticks = 2 + Math.floor(rnd(5) * 3);
  for (let k = 0; k < ticks; k++) {
    const a = rnd(6) * Math.PI * 2;
    const rr = R * (0.3 + rnd(7) * 0.5);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * rr - S * 0.05, cy + Math.sin(a) * rr);
    ctx.lineTo(cx + Math.cos(a) * rr + S * 0.05, cy + Math.sin(a) * rr);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

/** One rune texture per call — Arena builds 6 variants and reuses them. */
export function makeRuneTexture(seed: number): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = makeCanvas(S);
  drawRune(ctx, S, seed);
  return toTex(c, true, false);
}

/**
 * 4×4 atlas of 16 distinct rune glyphs (512²) — Arena's 48 boundary planes
 * pick a cell per instance via iU/iV instanced attributes → ONE draw call.
 */
export function makeRuneAtlasTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = makeCanvas(S);
  for (let k = 0; k < 16; k++) {
    const cx = (k % 4) * 128;
    const cy = Math.floor(k / 4) * 128;
    ctx.save();
    ctx.translate(cx, cy);
    drawRune(ctx, 128, k + 1);
    ctx.restore();
  }
  return toTex(c, true, false);
}

/**
 * Star-heart crack EMISSIVE map (1024²): near-black charred rock with molten
 * crack veins (ember→gold). Applied as emissiveNode so intensity 0.4→3.2
 * makes the star look like it is re-igniting.
 */
export function makeCrackTexture(): THREE.CanvasTexture {
  const S = 1024;
  const [c, ctx] = makeCanvas(S);
  // charred rock mottling
  for (let k = 0; k < 26; k++) {
    const cx = Math.random() * S;
    const cy = Math.random() * S;
    const r = 120 + Math.random() * 260;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const v = 8 + Math.floor(Math.random() * 10);
    g.addColorStop(0, `rgb(${v},${v - 2},${v + 3})`);
    g.addColorStop(1, "rgb(0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  // dark plates (facet shading feel)
  ctx.globalAlpha = 0.5;
  for (let k = 0; k < 40; k++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const s = 60 + Math.random() * 160;
    ctx.fillStyle = "rgb(5,4,7)";
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * Math.PI);
    ctx.fillRect(-s / 2, -s / 2, s, s * (0.4 + Math.random() * 0.8));
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // molten crack veins: random walks with ember→gold gradient glow
  const vein = (x0: number, y0: number, steps: number, baseA: number) => {
    let x = x0;
    let y = y0;
    let a = baseA + Math.random() * 0.6 - 0.3;
    ctx.lineCap = "round";
    for (let s = 0; s < steps; s++) {
      a += Math.random() * 0.9 - 0.45;
      const len = 8 + Math.random() * 26;
      const nx = x + Math.cos(a) * len;
      const ny = y + Math.sin(a) * len;
      const t = s / steps;
      // depth along the vein drives heat: gold near spawn, ember at tail
      const heat = Math.max(0, 1 - t * 1.15);
      const w = 1.4 + heat * 4.5;
      ctx.strokeStyle = `rgba(255,${Math.floor(120 + 100 * heat)},${Math.floor(40 + 70 * heat)},${0.35 + heat * 0.6})`;
      ctx.lineWidth = w * 2.6;
      ctx.shadowColor = "rgba(255,140,50,0.9)";
      ctx.shadowBlur = w * 5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      // branch
      if (Math.random() < 0.16) {
        const ba = a + (Math.random() < 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.7);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(ba) * len * 1.4, y + Math.sin(ba) * len * 1.4);
        ctx.stroke();
      }
      x = nx;
      y = ny;
      if (x < -40 || x > S + 40 || y < -40 || y > S + 40) break;
    }
  };
  for (let k = 0; k < 15; k++) {
    vein(Math.random() * S, Math.random() * S, 24 + Math.floor(Math.random() * 30), Math.random() * Math.PI * 2);
  }
  // a few hot nodes (pockets of magma)
  for (let k = 0; k < 26; k++) {
    const cx = Math.random() * S;
    const cy = Math.random() * S;
    const r = 6 + Math.random() * 16;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "rgba(255,236,180,0.95)");
    g.addColorStop(0.4, "rgba(255,150,60,0.6)");
    g.addColorStop(1, "rgba(255,110,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.shadowBlur = 0;
  return toTex(c, true, true);
}

/** Soft radial light disc (opaque black bg, white core → transparent edge in RGB). */
export function makeLightDiscTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgb(255,225,180)");
  g.addColorStop(0.35, "rgb(255,170,90)");
  g.addColorStop(0.75, "rgb(120,60,28)");
  g.addColorStop(1, "rgb(0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTex(c, true, false);
}
