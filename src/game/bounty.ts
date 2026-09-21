import { CONTRACTS, type BountyDef, type BountyStat } from './constants';
import { type Rng, mulberry32 } from './rng';

/**
 * HOLLOW SUN — BOUNTY CONTRACTS (sprint 20-4a).
 * PURE TypeScript (no DOM, no three, no sim) — headless-testable like
 * run.ts / rites.ts. The engine rolls 3 seeded offers at startRun, feeds
 * engine-side observables through bountyObserve(), and settles completed
 * contracts at every room clear (payouts join the run's dawn ledger in
 * finishRun — the dawnDebt precedent, additive side).
 *
 * DETERMINISM LAW: offer selection is mulberry32(seed ^ SALT) — the exact
 * openRiteGate pattern (engine.ts) — and evaluation is pure arithmetic over
 * engine-fed counters. ZERO rng anywhere else, ZERO sim access.
 */

/** seed salt for the run-start offer roll (distinct from 0x51ce rites) */
export const BOUNTY_SALT = 0xb0a7e5 >>> 0;

/** contracts live per run — never re-rolled mid-run */
export interface BountyRunState {
  /** offered contract ids, in HUD order */
  offers: string[];
  /** live progress: run-scoped accumulate, room-scoped reset each room */
  progress: Record<string, number>;
  /** completed ids — flipped ONLY at a room settle */
  done: Record<string, boolean>;
}

export function contractById(id: string): BountyDef | undefined {
  return CONTRACTS.find((c) => c.id === id);
}

/** deterministic seeded offers: partial Fisher–Yates over the CONTRACTS
 *  pool with mulberry32(seed ^ BOUNTY_SALT) — same seed → same offers,
 *  always distinct ids, never more than the pool. */
export function rollBountyOffers(seed: number, count = 3): BountyDef[] {
  const rng: Rng = mulberry32((seed ^ BOUNTY_SALT) >>> 0);
  const pool = CONTRACTS.slice();
  const n = Math.max(1, Math.min(count, pool.length));
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

export function newBountyRun(seed: number, count = 3): BountyRunState {
  const offers = rollBountyOffers(seed, count);
  const progress: Record<string, number> = {};
  const done: Record<string, boolean> = {};
  for (const o of offers) {
    progress[o.id] = 0;
    done[o.id] = false;
  }
  return { offers: offers.map((o) => o.id), progress, done };
}

/** feed one engine-observed datapoint. `value` is a delta for additive
 *  stats and the live value for max-stats (chain). clean/swift are injected
 *  at settle time and ignored here. */
export function bountyObserve(state: BountyRunState, stat: BountyStat, value = 1): void {
  if (stat === 'clean') return; // engine timer, judged at settle
  for (const id of state.offers) {
    const def = contractById(id);
    if (!def || def.stat !== stat || state.done[id]) continue;
    if (stat === 'chain') {
      // max-stat: the best chain reached counts, never the sum
      state.progress[id] = Math.max(state.progress[id] ?? 0, value);
    } else {
      state.progress[id] = (state.progress[id] ?? 0) + value;
    }
  }
}

/** a new room begins: room-scoped progress resets (run-scoped carries) */
export function bountyRoomStart(state: BountyRunState): void {
  for (const id of state.offers) {
    const def = contractById(id);
    if (def && def.scope === 'room') state.progress[id] = 0;
  }
}

export interface BountySettleValues {
  /** seconds the ember went unwounded in the settling room (engine timer) */
  cleanSec: number;
  /** seconds the settling room took to clear (engine room clock) */
  roomSec: number;
}

export interface BountyPayout {
  id: string;
  title: string;
  dawn: number;
}

/** room-clear settlement — the ONLY place a contract completes. Returns the
 *  payouts the engine should toast + bank into its run dawn ledger. */
export function bountySettleRoom(state: BountyRunState, vals: BountySettleValues): BountyPayout[] {
  const payouts: BountyPayout[] = [];
  for (const id of state.offers) {
    if (state.done[id]) continue;
    const def = contractById(id);
    if (!def) continue;
    const prog = state.progress[id] ?? 0;
    let ok = false;
    if (def.stat === 'clean') {
      ok = vals.cleanSec >= def.target;
    } else if (def.stat === 'swift') {
      ok = vals.roomSec > 0 && vals.roomSec <= def.target;
    } else {
      // room max-counters (kills, chain) were reset at room start; run
      // additives accumulated all run — both are plain threshold reads
      ok = prog >= def.target;
    }
    if (ok) {
      state.done[id] = true;
      payouts.push({ id, title: def.title, dawn: def.dawn });
    }
  }
  return payouts;
}
