import * as THREE from 'three';

/** Shared procedurally-generated sprite/glow textures (no image assets). */

let glowTex: THREE.CanvasTexture | null = null;

export function getGlowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export function makeGlowSprite(color: THREE.ColorRepresentation, scale: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(scale);
  return s;
}
