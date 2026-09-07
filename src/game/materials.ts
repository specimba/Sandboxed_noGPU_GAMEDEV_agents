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
 *
 * M0 visual elevation: large flat grounds may opt into a BAKED albedo map
 * (STYLIZED_MAP) — plain uv interpolation, no screen-space derivatives in
 * that path (the llvmpipe seam bug came from derivative-normal
 * reconstruction on huge coplanar tris, NOT smooth uv sampling). A cheap
 * hash dither kills 8-bit gradient banding in every stylized surface.
 */

const STYLIZED_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vView;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vUv = uv;
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
uniform vec3 uTint;
uniform sampler2D uMap;
uniform float uMapMix;
uniform float uEmisK;
uniform float uRimK;
uniform float uRimPow;
uniform float uTopK;
uniform float uPulse;
uniform float uTime;
varying vec3 vPos;
varying vec3 vView;
varying vec2 vUv;
#include <fog_pars_fragment>
float hsHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  // fragment->camera vector in WORLD space — matches N's space. The old
  // view-space vView silently mismatched every world-space term below
  // (fresnel collapsed to ~1 everywhere = the orange-wash bug).
  vec3 V = normalize(cameraPosition - vPos);
  #ifdef FLAT_GROUND
  // flat surfaces: exact up normal — screen-space derivatives of a huge
  // coplanar primitive misbehave on software GL (scanline seam artifacts)
  vec3 N = vec3(0.0, 1.0, 0.0);
  #else
  // hand-cut facets: face normal from screen-space derivatives
  vec3 N = normalize(cross(dFdx(vPos), dFdy(vPos)));
  if (dot(N, V) < 0.0) N = -N;
  #endif
  vec3 L = normalize(vec3(0.30, 0.85, 0.42));
  // chiseled key light — dark shell + facet highlight
  float ndl = dot(N, L) * 0.5 + 0.5;
  vec3 col = uBase + uLit * pow(ndl, 1.7);
  #ifdef STYLIZED_MAP
  // baked detail mask (arena floor): MODULATES the lit term instead of
  // replacing it. Empirically bisected on llvmpipe: ACES + linear->sRGB
  // inflate raw albedo ~2x past authored intent (intended #1e130e rendered
  // mid-orange), so the canvas is a mid-gray multiplier around 1.0
  // (128/255 * 2.1 ≈ 1.05) sampled raw (NoColorSpace). uMapMix = kill-switch.
  col *= mix(vec3(1.0), texture2D(uMap, vUv).rgb * 2.1 * uTint, uMapMix);
  #endif
  // identity rim — the silhouette edge carries the color coding.
  // SINGLE-SPACE FIX (V hoisted above): the old dot(vView, N) crossed
  // view-space with world-space, collapsed toward 0 under the steep rig,
  // and fres ≈ 1.0 EVERYWHERE — the whole floor painted itself with the
  // rim color (the orange wash). World-space V makes fresnel geometric:
  // edge-on lights up, face-on stays dark.
  float fres = pow(1.0 - abs(dot(V, N)), uRimPow);
  col += uRim * fres * uRimK;
  // top kiss so silhouettes read against the bright floor
  col += uRim * smoothstep(0.55, 1.0, N.y) * uTopK;
  // emissive heart
  float pulse = 1.0 + uPulse * 0.45 * sin(uTime * 5.2);
  col += uEmis * uEmisK * pulse;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
  // 8-bit banding killer — one-step ordered noise
  gl_FragColor.rgb += (hsHash(gl_FragCoord.xy) - 0.5) / 255.0;
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
  /** exact up-normal path for large flat grounds — no derivative artifacts */
  flat?: boolean;
  /** baked albedo map (large flat grounds) — swaps the lit term for texture */
  map?: THREE.Texture;
  /** 0..1 baked-map mix — the kill-switch: 0 disables the texture path */
  mapMix?: number;
  /** tint multiplied into the baked map */
  tint?: number;
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
      uTint: { value: new THREE.Color(o.tint ?? 0xffffff) },
      uMap: { value: null as THREE.Texture | null },
      uMapMix: { value: o.mapMix ?? 1 },
    },
  ]);
  const defines: Record<string, string> = {};
  if (o.flat) defines.FLAT_GROUND = '';
  if (o.map) defines.STYLIZED_MAP = '';
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: STYLIZED_VERT,
    fragmentShader: STYLIZED_FRAG,
    fog: o.fog ?? true,
    ...(Object.keys(defines).length > 0 ? { defines } : {}),
  });
  // set the texture AFTER the uniform merge — UniformsUtils.clone would copy it
  if (o.map) m.uniforms.uMap.value = o.map;
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
