// NEXUS ARMOR — 2D math helpers for the simulation (ground plane: x/z, y is up).

export const TAU = Math.PI * 2

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** shortest signed difference b-a in (-PI, PI] */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return d
}

/** rotate `from` toward `to` by at most `maxStep` radians (shortest path) */
export function rotateToward(from: number, to: number, maxStep: number): number {
  const d = angleDiff(from, to)
  if (Math.abs(d) <= maxStep) return to
  return from + Math.sign(d) * maxStep
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  return dx * dx + dz * dz
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt(dist2(ax, az, bx, bz))
}
