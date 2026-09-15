import type { Rng } from './rng';

/**
 * HOLLOW SUN — RITES OF THE MANY SUNS (sprint 19-a).
 * PURE TypeScript (no DOM, no three) — headless-testable like run.ts.
 *
 * Rites are player-picked RUN-WARPING LAWS: where boons bend stats, a rite
 * rewrites the rules of the descent. One rite is offered at the start of
 * every biome (1 of 3, seeded offers); up to 4 laws stack across a run.
 *
 * DETERMINISM LAW: the merged RiteLaws struct is consumed by the sim at
 * fixed points; every rite BEHAVIOR (detonation queues, fork counters,
 * meteor cadence, phantom scripts) runs on counters + enemy-time timers
 * with ZERO new rng. Same seed → byte-identical digests.
 */

/* ------------------------------------------------------------------ */
/* RiteLaws — the single struct every taken rite merges into           */
/* ------------------------------------------------------------------ */

export interface RiteLaws {
  /** × player-dealt impact damage (shard contact, forks, dash strike) */
  dmgDealt: number;
  /** × embers lost per wound (round, min 1) — GLASS BELL makes every hit cost 2 */
  dmgTaken: number;
  /** × all score gains (kills + grazes; meteor kills pay ×1.5 on top) */
  score: number;
  /** × run-end dawn payout (the bank itself is engine-side) */
  dawn: number;
  /** × all foe movement/action speed */
  foeSpeed: number;
  /** × wave budget (1.4 = LONG NIGHT's +40% bodies) */
  waveBudget: number;
  /** × overdrive graze charge */
  grazeCharge: number;
  /** × dash cooldown */
  dashCd: number;
  /** × dash knockback impulse */
  dashKnock: number;
  /** + dash-strike damage */
  dashStrike: number;
  /** dawn burned off the run bank per wound (EMBER DEBT: 15, min 0) */
  hurtDawnBurn: number;
  /* behavior flags — 0/1; a rite's mechanics are active iff its flag is 1 */
  tide: number; // EMBER TIDE — slain foes detonate
  twin: number; // TWIN SUN — every 2nd throw forks
  sunfall: number; // SUNFALL — the sky answers every 7s
  orchard: number; // IRON ORCHARD — wall-impact slams
  choir: number; // MIRROR CHOIR — phantoms every 5th kill
}

export function baseRites(): RiteLaws {
  return {
    dmgDealt: 1,
    dmgTaken: 1,
    score: 1,
    dawn: 1,
    foeSpeed: 1,
    waveBudget: 1,
    grazeCharge: 1,
    dashCd: 1,
    dashKnock: 1,
    dashStrike: 0,
    hurtDawnBurn: 0,
    tide: 0,
    twin: 0,
    sunfall: 0,
    orchard: 0,
    choir: 0,
  };
}

/** merge a list of taken rite ids into one laws struct — multiplicative
 *  laws compound, additive laws stack, behavior flags OR together */
export function mergeRites(ids: string[]): RiteLaws {
  const r = baseRites();
  for (const id of ids) {
    const def = RITES.find((d) => d.id === id);
    if (!def?.laws) continue;
    const l = def.laws;
    r.dmgDealt *= l.dmgDealt ?? 1;
    r.dmgTaken *= l.dmgTaken ?? 1;
    r.score *= l.score ?? 1;
    r.dawn *= l.dawn ?? 1;
    r.foeSpeed *= l.foeSpeed ?? 1;
    r.waveBudget *= l.waveBudget ?? 1;
    r.grazeCharge *= l.grazeCharge ?? 1;
    r.dashCd *= l.dashCd ?? 1;
    r.dashKnock *= l.dashKnock ?? 1;
    r.dashStrike += l.dashStrike ?? 0;
    r.hurtDawnBurn += l.hurtDawnBurn ?? 0;
    r.tide = Math.max(r.tide, l.tide ?? 0);
    r.twin = Math.max(r.twin, l.twin ?? 0);
    r.sunfall = Math.max(r.sunfall, l.sunfall ?? 0);
    r.orchard = Math.max(r.orchard, l.orchard ?? 0);
    r.choir = Math.max(r.choir, l.choir ?? 0);
  }
  return r;
}

/* ------------------------------------------------------------------ */
/* Rite catalog — 8 laws, named in the game's voice                    */
/* ------------------------------------------------------------------ */

export interface RiteDef {
  id: string;
  name: string;
  desc: string;
  /** one-word law reminder for the HUD chip row */
  chip: string;
  /** the merged-law summary line for the pick panel */
  lawLine: string;
  laws?: Partial<RiteLaws>;
}

export const RITES: RiteDef[] = [
  {
    id: 'tide',
    name: 'EMBER TIDE',
    desc: 'Slain foes detonate after a breath: a 3u burst of 3 dmg + 2 burn stacks washes over kindred. A foe killed by a detonation detonates too — the tide crests at 8 deep.',
    chip: 'DETONATE',
    lawLine: 'CORPSES BURST · CHAINS ×8 DEEP',
    laws: { tide: 1 },
  },
  {
    id: 'twin',
    name: 'TWIN SUN',
    desc: 'Every 2nd throw forks two shards at ±0.42 rad, each paying half damage. Forks fly, ricochet, return — and vanish into your hand. Never more than 8 live: past the ceiling the fork skips that throw.',
    chip: 'FORK',
    lawLine: 'EVERY 2ND THROW FORKS ×2 · 50% DMG',
    laws: { twin: 1 },
  },
  {
    id: 'sunfall',
    name: 'SUNFALL',
    desc: 'Every 7s the sky falls: three telegraphed meteors — two on the heaviest foes, one 3u off your heels. 0.9s to read the ring. The blast is 4.5u, 4 dmg, and it does not know friend from ember. Meteor kills pay +50% score.',
    chip: 'METEOR',
    lawLine: 'SKYFALL /7s ×3 · HITS ALL · SCORE +50%',
    laws: { sunfall: 1 },
  },
  {
    id: 'orchard',
    name: 'IRON ORCHARD',
    desc: 'Dash strike +2 dmg, knockback ×3.5, cooldown −25%. Foes hurled past the arena wall take 1 dmg and eat a 0.5s stun — the orchard is harvested on stone.',
    chip: 'SLAM',
    lawLine: 'KNOCK ×3.5 · STRIKE +2 · DASH −25%',
    laws: { dashKnock: 3.5, dashStrike: 2, dashCd: 0.75, orchard: 1 },
  },
  {
    id: 'bell',
    name: 'GLASS BELL',
    desc: 'Your light hits like a falling cathedral: damage ×1.6, score ×1.25, dawn ×1.25. The bell rings both ways — every wound costs 2 embers.',
    chip: '×1.6 / ×2',
    lawLine: 'DMG ×1.6 · SCORE ×1.25 · HITS COST 2 EMBERS',
    laws: { dmgDealt: 1.6, dmgTaken: 2, score: 1.25, dawn: 1.25 },
  },
  {
    id: 'night',
    name: 'LONG NIGHT',
    desc: 'The dark crawls: foe speed ×0.82, graze charge ×1.25 — but the night is DENSE. Wave budgets +40%. You will not be chased. You will be surrounded.',
    chip: 'DENSE',
    lawLine: 'FOES ×0.82 · WAVES +40% · GRAZE ×1.25',
    laws: { foeSpeed: 0.82, waveBudget: 1.4, grazeCharge: 1.25 },
  },
  {
    id: 'choir',
    name: 'MIRROR CHOIR',
    desc: 'Every 5th kill sings a phantom into being (max 2, 6s life): it orbits you at 2.5u and lances a light bolt at the nearest foe every 1.2s — 2 dmg, no ricochet, no mercy.',
    chip: 'PHANTOM',
    lawLine: 'PHANTOM /5 KILLS · BOLTS /1.2s · 2 DMG',
    laws: { choir: 1 },
  },
  {
    id: 'debt',
    name: 'EMBER DEBT',
    desc: 'Dawn pays ×1.4 at run\u2019s end — but every wound burns 15 dawn straight off the bank. The dark lends generously. It collects on impact.',
    chip: 'DAWN DEBT',
    lawLine: 'DAWN ×1.4 · −15 DAWN PER WOUND',
    laws: { dawn: 1.4, hurtDawnBurn: 15 },
  },
];

/** deterministic seeded offers: excludes taken rites, never fewer than 1.
 *  The pool is rotated by biomeIdx (zero extra rng — per-biome flavor
 *  ordering) then partial-Fisher–Yates'd with the caller's rng. */
export function rollRiteOffers(taken: string[], count: number, biomeIdx: number, rng: Rng): RiteDef[] {
  let pool = RITES.filter((d) => !taken.includes(d.id));
  if (pool.length === 0) pool = RITES.slice(); // fallback refill: never offer 0
  const rot = ((biomeIdx % pool.length) + pool.length) % pool.length;
  pool = pool.slice(rot).concat(pool.slice(0, rot));
  const n = Math.max(1, Math.min(count, pool.length));
  const out: RiteDef[] = [];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    out.push(pool[i]);
  }
  return out;
}
