import * as THREE from 'three';
import { WAVE } from './constants';

/**
 * ECHOVOID shader library.
 *
 * The signature effect: the world is (almost) pitch black. Every echo pulse
 * pushes an expanding spherical wavefront through the scene. Geometry lights
 * up as the front passes through it, then smolders out like embers.
 *
 * Recent pulses live in a shared ring-buffer uniform (vec4 xyz=origin, w=start
 * time) referenced by every reveal-lit material, so a single JS write updates
 * the whole world.
 */

export type PulseArray = THREE.Vector4[];

export function createPulseBuffer(): { uniform: { value: PulseArray }; pulses: PulseArray } {
  const pulses: PulseArray = Array.from(
    { length: WAVE.maxPulses },
    () => new THREE.Vector4(0, 0, 0, -1),
  );
  return { uniform: { value: pulses }, pulses };
}

/** GLSL: shared wavefront math. Expects `uPulses`, `uTime`, `uWaveSpeed` in scope. */
const PULSE_GLSL = /* glsl */ `
uniform vec4 uPulses[${WAVE.maxPulses}];
uniform float uTime;
uniform float uWaveSpeed;

float waveBrightness(vec3 wp) {
  float best = 0.0;
  for (int i = 0; i < ${WAVE.maxPulses}; i++) {
    vec4 p = uPulses[i];
    if (p.w < 0.0) continue;
    float t = uTime - p.w;
    if (t < 0.0 || t > 6.0) continue;
    float d = distance(wp, p.xyz);
    float r = t * uWaveSpeed;
    float band = exp(-pow((d - r) / 2.4, 2.0)) * exp(-t * 0.55);
    float since = t - d / uWaveSpeed;
    float after = since > 0.0 ? exp(-since * 0.55) : 0.0;
    best = max(best, max(band * 2.2, after * 0.7));
  }
  return best;
}

/** separates the hot traveling rim (allowed to bloom) from the ember base (not) */
void waveComponents(vec3 wp, out float band, out float after) {
  band = 0.0;
  after = 0.0;
  for (int i = 0; i < ${WAVE.maxPulses}; i++) {
    vec4 p = uPulses[i];
    if (p.w < 0.0) continue;
    float t = uTime - p.w;
    if (t < 0.0 || t > 6.0) continue;
    float d = distance(wp, p.xyz);
    float r = t * uWaveSpeed;
    float b = exp(-pow((d - r) / 2.4, 2.0)) * exp(-t * 0.55);
    float since = t - d / uWaveSpeed;
    float a = since > 0.0 ? exp(-since * 0.55) : 0.0;
    band = max(band, b);
    after = max(after, a);
  }
}
`;

/* ------------------------------------------------------------------ */
/* Static world reveal material                                        */
/* ------------------------------------------------------------------ */

const REVEAL_VERT = /* glsl */ `
attribute float aGlow;
varying vec3 vWorld;
varying vec3 vColor;
varying float vGlow;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vColor = color;
  vGlow = aGlow;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const REVEAL_FRAG = /* glsl */ `
uniform vec3 uPlayerPos;
uniform float uPlayerGlow;
uniform float uAmbient;
varying vec3 vWorld;
varying vec3 vColor;
varying float vGlow;

${PULSE_GLSL}

void main() {
  float band, after;
  waveComponents(vWorld, band, after);
  // gentle proximity shimmer so the player never feels fully blind up close
  float prox = exp(-distance(vWorld, uPlayerPos) * 0.6) * uPlayerGlow;
  // ember base clamps below bloom range; only the thin traveling rim may
  // exceed 1.0 and bloom — that ring IS the pulse
  float base = min(uAmbient + after * 0.7 * vGlow + prox, 0.85);
  float e = base + band * 2.4 * vGlow;
  float flick = 1.0 + 0.12 * sin(uTime * 2.3 + vWorld.x * 2.9 + vWorld.z * 1.7);
  vec3 col = vColor * e * flick;
  // manual black fog — the abyss swallows distance
  col *= exp(-distance(vWorld, cameraPosition) * 0.016);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createRevealMaterial(pulseUniform: { value: PulseArray }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: REVEAL_VERT,
    fragmentShader: REVEAL_FRAG,
    vertexColors: true,
    uniforms: {
      uPulses: pulseUniform,
      uTime: { value: 0 },
      uWaveSpeed: { value: WAVE.speed },
      uPlayerPos: { value: new THREE.Vector3() },
      uPlayerGlow: { value: 0.4 },
      uAmbient: { value: 0.03 },
    },
  });
}

/* ------------------------------------------------------------------ */
/* Expanding shockwave sphere                                          */
/* ------------------------------------------------------------------ */

const WAVE_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  vNormal = normalMatrix * normal;
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const WAVE_FRAG = /* glsl */ `
uniform float uAge;
uniform vec3 uColor;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 3.5);
  float a = fres * exp(-uAge * 2.0) * 0.3;
  gl_FragColor = vec4(uColor * (0.6 + fres), a);
}
`;

export function createWaveMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: WAVE_VERT,
    fragmentShader: WAVE_FRAG,
    uniforms: { uAge: { value: 0 }, uColor: { value: new THREE.Color('#6ff2df') } },
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
  });
}

/* ------------------------------------------------------------------ */
/* Reactive void dust (points)                                         */
/* ------------------------------------------------------------------ */

const DUST_VERT = /* glsl */ `
attribute float aSeed;
uniform float uPix;
uniform vec3 uPlayerPos;
varying float vA;
varying vec3 vC;

${PULSE_GLSL}

void main() {
  vec3 p = position;
  float bright = waveBrightness(p);
  // motes get shoved outward as the front passes
  p += normalize(p - uPlayerPos + vec3(0.001)) * bright * 0.9;
  p.y += sin(uTime * 0.3 + aSeed * 17.0) * 0.7;
  p.x += sin(uTime * 0.21 + aSeed * 29.0) * 0.55;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = max(0.1, -mv.z);
  gl_PointSize = min((1.6 + aSeed * 2.4) * uPix * (64.0 / dist), 26.0 * uPix);
  vA = (0.04 + bright * 0.7) * smoothstep(0.5, 2.4, dist);
  vC = mix(vec3(0.30, 0.75, 0.70), vec3(1.0, 1.0, 0.95), min(1.0, bright * 1.4));
  gl_Position = projectionMatrix * mv;
}
`;

const DUST_FRAG = /* glsl */ `
varying float vA;
varying vec3 vC;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d) * vA;
  gl_FragColor = vec4(vC * a, a);
}
`;

export interface DustField {
  points: THREE.Points;
  uniforms: Record<string, THREE.IUniform>;
  dispose(): void;
}

export function createDust(pulseUniform: { value: PulseArray }, count: number): DustField {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // spread dust through a tall cylinder around the origin (the level fits inside)
    const r = Math.sqrt(Math.random()) * 75;
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = -30 + Math.random() * 55;
    pos[i * 3 + 2] = Math.sin(a) * r;
    seed[i] = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

  const uniforms: Record<string, THREE.IUniform> = {
    uPulses: pulseUniform,
    uTime: { value: 0 },
    uWaveSpeed: { value: WAVE.speed },
    uPix: { value: 1 },
    uPlayerPos: { value: new THREE.Vector3() },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  return {
    points,
    uniforms,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Fresnel rim material (listeners, wisp shell)                        */
/* ------------------------------------------------------------------ */

const RIM_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  vNormal = normalMatrix * normal;
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const RIM_FRAG = /* glsl */ `
uniform float uReveal;
uniform float uState;
uniform vec3 uColor;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.1);
  float vis = uReveal * 1.35 + uState * 0.5;
  vec3 col = uColor * vis * (0.28 + fres);
  float alpha = clamp(uReveal + uState * 0.7, 0.0, 1.0) * (0.22 + fres * 0.9);
  gl_FragColor = vec4(col, alpha);
}
`;

export function createRimMaterial(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: RIM_VERT,
    fragmentShader: RIM_FRAG,
    uniforms: {
      uReveal: { value: 1 },
      uState: { value: 1 },
      uColor: { value: new THREE.Color(color) },
    },
    transparent: true,
    depthWrite: false,
  });
}

/* ------------------------------------------------------------------ */
/* CPU particle pool shader                                            */
/* ------------------------------------------------------------------ */

const PARTICLE_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aSize;
uniform float uPix;
varying vec3 vC;
varying float vA;
void main() {
  vC = aColor;
  vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(0.1, -mv.z);
  gl_PointSize = min(aSize * uPix * (150.0 / dist), 44.0 * uPix);
  vA *= smoothstep(0.25, 1.1, dist);
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAG = /* glsl */ `
varying vec3 vC;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.08, d) * vA;
  gl_FragColor = vec4(vC * a, a);
}
`;

export function createParticleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    uniforms: { uPix: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/* ------------------------------------------------------------------ */
/* Post-processing vignette / hurt / alert / fade pass                 */
/* ------------------------------------------------------------------ */

export const VIGNETTE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uHurt: { value: 0 },
    uAlert: { value: 0 },
    uFade: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uHurt;
    uniform float uAlert;
    uniform float uFade;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = vUv - 0.5;
      float d = length(p) * 1.414;
      // breathing darkness at the edges — the abyss leans in
      float vig = smoothstep(0.62, 1.32, d);
      c.rgb *= mix(1.0, 0.16, vig);
      float edge = smoothstep(0.34, 0.95, d);
      // damage flash
      c.rgb = mix(c.rgb, vec3(0.85, 0.10, 0.14), edge * uHurt * 0.55);
      // listener-proximity dread, softly pulsing
      float dread = edge * uAlert * 0.30 * (0.65 + 0.35 * sin(uTime * 5.2));
      c.rgb = mix(c.rgb, vec3(0.42, 0.04, 0.07), dread);
      c.rgb *= (1.0 - uFade);
      gl_FragColor = c;
    }
  `,
};
