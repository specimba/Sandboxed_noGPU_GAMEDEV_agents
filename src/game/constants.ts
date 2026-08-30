import * as THREE from 'three';

/**
 * ECHOVOID — shared tuning constants.
 * All gameplay-affecting numbers live here (data-driven adjustability).
 */

export const COLORS = {
  bg: 0x030508,
  /** teal — revealed world geometry */
  rock: new THREE.Color('#5fe8d4'),
  rockDim: new THREE.Color('#1f6b62'),
  /** amber — echo shards & crystals */
  crystal: new THREE.Color('#ffb85c'),
  /** crimson — listeners & hazards */
  hazard: new THREE.Color('#ff3b4e'),
  /** gold — the gate */
  gate: new THREE.Color('#ffd27a'),
  /** wisp */
  player: new THREE.Color('#cffff4'),
};

export const WAVE = {
  speed: 30, // units / second
  life: 6.0, // seconds a pulse stays in the shader ring buffer
  maxPulses: 8,
  revealRadius: 85,
  stunRadius: 11, // pulse emitted this close STUNS a listener
  alertRadius: 30, // pulse emitted within this ALERTS listeners
  cooldown: 1.35,
};

export const PLAYER = {
  radius: 0.55,
  accel: 46,
  maxSpeed: 9.5,
  frictionGround: 10,
  frictionAir: 1.8,
  gravity: -26,
  jumpVel: 10.5,
  hoverFall: -2.6, // terminal fall speed while holding jump
  dashSpeed: 24,
  dashTime: 0.18,
  dashCooldown: 1.5,
  killY: -42,
};

export const CAMERA = {
  dist: 9.5,
  minDist: 5.5,
  maxDist: 14,
  minPitch: -0.15,
  maxPitch: 1.15,
  sens: 0.0042,
  touchSens: 0.006,
  fov: 62,
};

export const GAME = {
  shardsNeeded: 3,
  heartsMax: 3,
  metersPerDepth: 120,
};

export const HUNTER = {
  senseRadius: 13, // hears your movement
  speedBase: 5.6,
  speedPerDepth: 0.45,
  lingerTime: 2.6,
  stunTime: 3.0,
  scatterTime: 1.5,
  damageRadius: 1.45,
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'] as const;

export function depthRoman(depth: number): string {
  return depth >= 1 && depth <= 10 ? ROMAN[depth - 1] : String(depth);
}

export function depthMeters(depth: number): number {
  return depth * GAME.metersPerDepth;
}
