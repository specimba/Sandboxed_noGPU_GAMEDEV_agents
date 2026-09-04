import * as THREE from 'three';

/**
 * HOLLOW SUN — "EMBER RITE" material system.
 *
 * One stylized shader powers every solid in the game: chiseled obsidian
 * shells lit by a single warm key light, a fresnel rim that carries the
 * entity's identity color, and an emissive heart that can pulse.
 * Facet normals come from screen-space derivatives, so ANY mesh reads as
 * hand-cut stone — the flat "glow ball" look is gone by construction.
 *
 * Canvas textures provide diamond/streak bullet sprites instead of round
 * glow dots. The sun rig can retune rim strength per material at runtime.
 */

const STYLIZED_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vView;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  vView = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const STYLIZED_FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uLit;
uniform vec3 uRim;
uniform vec3 uEmis;
uniform float uEmisK;
uniform float uRimK;
uniform float uRimPow;
uniform float uTopK;
uniform float uPulse;
uniform float uTime;
varying vec3 vPos;
varying vec3 vView;
#include <fog_pars_fragment>
void main() {
  // hand-cut facets: face normal from screen-space derivatives
  vec3 N = normalize(cross(dFdx(vPos), dFdy(vPos)));
  vec3 V = normalize(vView);
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(vec3(0.30, 0.85, 0.42));
  // chiseled key light — dark shell + facet highlight
  float ndl = dot(N, L) * 0.5 + 0.5;
  vec3 col = uBase + uLit * pow(ndl, 1.7);
  // identity rim — the silhouette edge carries the color coding
  float fres = pow(1.0 - abs(dot(N, V)), uRimPow);
  col += uRim * fres * uRimK;
  // top kiss so silhouettes read against the bright floor
  col += uRim * smoothstep(0.55, 1.0, N.y) * uTopK;
  // emissive heart
  float pulse = 1.0 + uPulse * 0.45 * sin(uTime * 5.2);
  col += uEmis * uEmisK * pulse;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

const stylizedMats = new Set<THREE.ShaderMaterial>();

export interface StylizedOpts {
  /** dark shell color (obsidian default) */
  base?: number;
  /** facet highlight tint */
  lit?: number;
  /** rim identity color — the color-coding channel */
  rim?: number;
  /** emissive heart color */
  emis?: number;
  /** emissive strength 0..2 */
  emisK?: number;
  /** rim strength */
  rimK?: number;
  /** rim falloff power (1.4 wide … 4 tight) */
  rimPow?: number;
  /** top-light kiss strength */
  topK?: number;
  /** emissive pulse amount 0..1 */
  pulse?: number;
  /** scene fog aware (default true) */
  fog?: boolean;
}

export function stylizedMaterial(o: StylizedOpts = {}): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uBase: { value: new THREE.Color(o.base ?? 0x191009) },
      uLit: { value: new THREE.Color(o.lit ?? 0x3a2a1a) },
      uRim: { value: new THREE.Color(o.rim ?? 0xffb454) },
      uEmis: { value: new THREE.Color(o.emis ?? 0xffb454) },
      uEmisK: { value: o.emisK ?? 0 },
      uRimK: { value: o.rimK ?? 0.8 },
      uRimPow: { value: o.rimPow ?? 2.6 },
      uTopK: { value: o.topK ?? 0.16 },
      uPulse: { value: o.pulse ?? 0 },
      uTime: { value: 0 },
    },
  ]);
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: STYLIZED_VERT,
    fragmentShader: STYLIZED_FRAG,
    fog: o.fog ?? true,
  });
  stylizedMats.add(m);
  return m;
}

/** tick every stylized material — call once per render frame */
export function updateStylized(t: number): void {
  for (const m of stylizedMats) m.uniforms.uTime.value = t;
}

/** runtime rim retune (sun energy, states) */
export function setRimK(m: THREE.ShaderMaterial, k: number): void {
  if (m.uniforms.uRimK) m.uniforms.uRimK.value = k;
}

/** pure emissive heart material (unlit) */
export function coreMaterial(color: number, fog = true): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, fog });
}

/* ------------------------------------------------------------------ */
/* canvas sprite textures — bullets are shards, not round glow dots    */
/* ------------------------------------------------------------------ */

/** sharp 4-point diamond — standard foe fire */
export function makeDiamondTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(48, 48, 0, 48, 48, 46);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(48, 2);
  ctx.lineTo(78, 48);
  ctx.lineTo(48, 94);
  ctx.lineTo(18, 48);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.moveTo(48, 14);
  ctx.lineTo(68, 48);
  ctx.lineTo(48, 82);
  ctx.lineTo(28, 48);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** elongated streak — heavy lances */
export function makeStreakTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(96, 32, 0, 96, 32, 80);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(4, 32);
  ctx.lineTo(112, 6);
  ctx.lineTo(188, 32);
  ctx.lineTo(112, 58);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.moveTo(36, 32);
  ctx.lineTo(118, 14);
  ctx.lineTo(176, 32);
  ctx.lineTo(118, 50);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
