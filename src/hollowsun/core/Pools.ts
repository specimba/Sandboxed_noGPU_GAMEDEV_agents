/**
 * HOLLOW SUN — preallocated pools & structures (DESIGN_C.md §15 C1).
 *  - EventRing: SimEvent ring buffer, capacity 256, overwrites oldest when full.
 *    drain() hands back a REUSED array (no per-frame allocation).
 *  - SpatialHash: fixed-grid hash (cell 4u) over the arena, zero allocation;
 *    used by the sim for shard×enemy and bullet×player broad-phase.
 */
import type { EventTypeId, SimEvent } from "../types";

/** Ring capacity (binding: 256). */
export const EVENT_CAP = 256;

export class EventRing {
  private readonly cap: number;
  private readonly evs: SimEvent[] = [];
  private readonly out: SimEvent[] = [];
  private head = 0; // next write slot
  private tail = 0; // oldest slot
  private count = 0;

  constructor(cap: number = EVENT_CAP) {
    this.cap = cap;
    for (let i = 0; i < cap; i++) {
      this.evs.push({ type: 0 as EventTypeId, x: 0, y: 0, vx: 0, vy: 0, a: 0, b: 0 });
    }
  }

  /** Push an event; when full the oldest event is silently overwritten. */
  push(type: EventTypeId, x: number, y: number, vx: number, vy: number, a: number, b: number): void {
    const e = this.evs[this.head];
    e.type = type;
    e.x = x;
    e.y = y;
    e.vx = vx;
    e.vy = vy;
    e.a = a;
    e.b = b;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
    else this.tail = (this.tail + 1) % this.cap;
  }

  /** Return pushed events (FIFO) in a reused array and reset the ring. */
  drain(): SimEvent[] {
    this.out.length = 0;
    for (let i = 0; i < this.count; i++) {
      this.out.push(this.evs[(this.tail + i) % this.cap]);
    }
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    return this.out;
  }
}

/**
 * Fixed spatial hash over [-extent, extent]². Entities are inserted by index;
 * queries walk raw head/next chains (callers loop without closures → zero alloc).
 * scratch of length 4 receives [cx0, cx1, cy0, cy1] cell bounds for a circle.
 */
export class SpatialHash {
  readonly dim: number;
  readonly head: Int32Array;
  readonly next: Int32Array;
  private readonly invCell: number;
  private readonly extent: number;

  constructor(cap: number, cell = 4, extent = 44) {
    this.dim = Math.ceil((extent * 2) / cell);
    this.invCell = 1 / cell;
    this.extent = extent;
    this.head = new Int32Array(this.dim * this.dim).fill(-1);
    this.next = new Int32Array(cap);
  }

  clear(): void {
    this.head.fill(-1);
  }

  insert(i: number, x: number, y: number): void {
    const c = this.cellOf(x, y);
    this.next[i] = this.head[c];
    this.head[c] = i;
  }

  /** Cell bounds covering the circle (x,y,r) → scratch [cx0, cx1, cy0, cy1]. */
  queryCells(x: number, y: number, r: number, scratch: Int32Array): void {
    const d = this.dim;
    let cx0 = (((x - r + this.extent) * this.invCell) | 0) - 1;
    let cx1 = (((x + r + this.extent) * this.invCell) | 0) + 1;
    let cy0 = (((y - r + this.extent) * this.invCell) | 0) - 1;
    let cy1 = (((y + r + this.extent) * this.invCell) | 0) + 1;
    if (cx0 < 0) cx0 = 0;
    if (cy0 < 0) cy0 = 0;
    if (cx1 > d - 1) cx1 = d - 1;
    if (cy1 > d - 1) cy1 = d - 1;
    scratch[0] = cx0;
    scratch[1] = cx1;
    scratch[2] = cy0;
    scratch[3] = cy1;
  }

  private cellOf(x: number, y: number): number {
    const d = this.dim;
    let cx = ((x + this.extent) * this.invCell) | 0;
    let cy = ((y + this.extent) * this.invCell) | 0;
    if (cx < 0) cx = 0;
    else if (cx > d - 1) cx = d - 1;
    if (cy < 0) cy = 0;
    else if (cy > d - 1) cy = d - 1;
    return cy * d + cx;
  }
}
