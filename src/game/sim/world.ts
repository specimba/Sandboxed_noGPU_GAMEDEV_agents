// NEXUS ARMOR — collision world: AABB cover + circular bodies + LOS raycasts.
// Deliberately engine-free and allocation-free in hot paths (see docs/ARCHITECTURE.md DR-03).

import { clamp } from './vec'

export interface AABB {
  x: number // center
  z: number
  hx: number // half extent x
  hz: number // half extent z
}

export interface CircleBody {
  x: number
  z: number
  r: number
}

export class SimWorld {
  /** half-size of the square arena (walls at ±half) */
  half: number
  props: AABB[] = []

  constructor(size: number) {
    this.half = size / 2
  }

  addProp(box: AABB): void {
    this.props.push(box)
  }

  /** circle vs props + arena bounds resolution; returns true if pushed */
  resolveCircle(c: CircleBody): boolean {
    let pushed = false
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i]
      const cx = clamp(c.x, p.x - p.hx, p.x + p.hx)
      const cz = clamp(c.z, p.z - p.hz, p.z + p.hz)
      let dx = c.x - cx
      let dz = c.z - cz
      let d2 = dx * dx + dz * dz
      if (d2 < c.r * c.r) {
        if (d2 < 1e-8) {
          // center inside the box: push out along the shallowest axis
          const px = p.hx + c.r - Math.abs(c.x - p.x)
          const pz = p.hz + c.r - Math.abs(c.z - p.z)
          if (px < pz) c.x += Math.sign(c.x - p.x || 1) * px
          else c.z += Math.sign(c.z - p.z || 1) * pz
        } else {
          const d = Math.sqrt(d2)
          const push = (c.r - d) / d
          c.x += dx * push
          c.z += dz * push
        }
        pushed = true
      }
      dx = 0
      dz = 0
      d2 = 0
    }
    // arena bounds (walls handled as soft clamp; visual walls exist too)
    const lim = this.half - 1.2 - c.r
    if (c.x < -lim) {
      c.x = -lim
      pushed = true
    }
    if (c.x > lim) {
      c.x = lim
      pushed = true
    }
    if (c.z < -lim) {
      c.z = -lim
      pushed = true
    }
    if (c.z > lim) {
      c.z = lim
      pushed = true
    }
    return pushed
  }

  /** segment vs AABB (2D slab test); t out in [0,1] along segment */
  segmentHitsBox(x0: number, z0: number, x1: number, z1: number, b: AABB): boolean {
    const dx = x1 - x0
    const dz = z1 - z0
    const inv1 = dx !== 0 ? 1 / dx : Infinity
    const inv2 = dz !== 0 ? 1 / dz : Infinity
    let tmin = 0
    let tmax = 1
    // x slab
    let t1 = (b.x - b.hx - x0) * inv1
    let t2 = (b.x + b.hx - x0) * inv1
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
    }
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return false
    // z slab
    t1 = (b.z - b.hz - z0) * inv2
    t2 = (b.z + b.hz - z0) * inv2
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
    }
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    return tmin <= tmax
  }

  /** true if nothing blocks the segment */
  hasLOS(x0: number, z0: number, x1: number, z1: number): boolean {
    for (let i = 0; i < this.props.length; i++) {
      if (this.segmentHitsBox(x0, z0, x1, z1, this.props[i])) return false
    }
    return true
  }

  /** first blocking distance fraction [0..1] of a segment, or 1 if clear */
  blockedFraction(x0: number, z0: number, x1: number, z1: number): number {
    const dx = x1 - x0
    const dz = z1 - z0
    const inv1 = dx !== 0 ? 1 / dx : Infinity
    const inv2 = dz !== 0 ? 1 / dz : Infinity
    let best = 1
    for (let i = 0; i < this.props.length; i++) {
      const b = this.props[i]
      let tmin = 0
      let tmax = 1
      let t1 = (b.x - b.hx - x0) * inv1
      let t2 = (b.x + b.hx - x0) * inv1
      if (t1 > t2) {
        const tmp = t1
        t1 = t2
        t2 = tmp
      }
      tmin = Math.max(tmin, t1)
      tmax = Math.min(tmax, t2)
      if (tmin > tmax) continue
      t1 = (b.z - b.hz - z0) * inv2
      t2 = (b.z + b.hz - z0) * inv2
      if (t1 > t2) {
        const tmp = t1
        t1 = t2
        t2 = tmp
      }
      tmin = Math.max(tmin, t1)
      tmax = Math.min(tmax, t2)
      if (tmin > tmax) continue
      if (tmin < best) best = tmin
    }
    return best
  }

  /** segment vs circle; returns t in [0,1] of first contact or -1 */
  segmentHitsCircle(x0: number, z0: number, x1: number, z1: number, c: CircleBody): number {
    const dx = x1 - x0
    const dz = z1 - z0
    const fx = x0 - c.x
    const fz = z0 - c.z
    const a = dx * dx + dz * dz
    if (a < 1e-9) return -1
    const b = 2 * (fx * dx + fz * dz)
    const cc = fx * fx + fz * fz - c.r * c.r
    let disc = b * b - 4 * a * cc
    if (disc < 0) return -1
    disc = Math.sqrt(disc)
    const t = (-b - disc) / (2 * a)
    if (t >= 0 && t <= 1) return t
    // started inside?
    if (cc < 0) return 0
    return -1
  }
}
