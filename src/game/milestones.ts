/**
 * HOLLOW SUN — MILESTONES OF THE DESCENT (sprint 20-4a).
 * PURE TypeScript (no DOM, no three, no sim, no store) — headless-testable.
 *
 * 16 persistent deeds evaluated from ENGINE-side observables only (the same
 * optional-notify channel bounties ride). The engine holds a working copy of
 * the save (loaded from hollowsun.meta), feeds events, and persists whenever
 * something new completes — additive schema, old saves never break.
 *
 * Pure evaluator law: applyMilestoneEvent(event, save) mutates the passed
 * save (life counters + done flags) and returns the ids completed NOW.
 */

/* ------------------------------------------------------------------ */
/* lifetime counters — the additive meta schema (hollowsun.meta.life)  */
/* ------------------------------------------------------------------ */

export interface MilestoneLife {
  kills: number;
  grazes: number;
  wins: number;
  bosses: number;
  crowns: number; // rime/cinder crowned fells
  biomeClears: number;
  bestChain: number; // max sim.chain reached in any run
  bestRoomStrikes: number; // max mid-dash fells in one room
  bestRoomGrazes: number;
  fastestRoomSec: number; // 0 = none yet
  bestHurtlessRooms: number; // most rooms cleared in one run without a wound
  kindsKilled: string[]; // bestiary — FoeKind names
  ritesWonWith: string[]; // distinct rite ids carried to a win
}

export interface MilestoneSave {
  done: Record<string, boolean>;
  life: MilestoneLife;
}

export function emptyMilestoneLife(): MilestoneLife {
  return {
    kills: 0,
    grazes: 0,
    wins: 0,
    bosses: 0,
    crowns: 0,
    biomeClears: 0,
    bestChain: 0,
    bestRoomStrikes: 0,
    bestRoomGrazes: 0,
    fastestRoomSec: 0,
    bestHurtlessRooms: 0,
    kindsKilled: [],
    ritesWonWith: [],
  };
}

export function emptyMilestoneSave(): MilestoneSave {
  return { done: {}, life: emptyMilestoneLife() };
}

/** defensive copy of a persisted save — the engine works on this, never on
 *  the object loadMeta() returned (meta may be re-saved independently) */
export function cloneMilestoneSave(s: MilestoneSave): MilestoneSave {
  return {
    done: { ...s.done },
    life: { ...s.life, kindsKilled: [...s.life.kindsKilled], ritesWonWith: [...s.life.ritesWonWith] },
  };
}

/* ------------------------------------------------------------------ */
/* the 16 deeds — named in the game's voice                            */
/* ------------------------------------------------------------------ */

export interface MilestoneDef {
  id: string;
  /** the toast line: "MILESTONE — <name>" */
  name: string;
  desc: string;
  test: (life: MilestoneLife) => boolean;
}

export const MILESTONES: MilestoneDef[] = [
  { id: 'firstblood', name: 'FIRST BLOOD OF THE CHOIR', desc: 'Fell your first foe', test: (l) => l.kills >= 1 },
  { id: 'firstboss', name: 'A WARDEN FALLS', desc: 'Felled your first boss', test: (l) => l.bosses >= 1 },
  { id: 'firstcrown', name: 'CROWNBREAKER', desc: 'Felled a crowned foe (RIMEBOUND / CINDERBOUND)', test: (l) => l.crowns >= 1 },
  { id: 'firstbiome', name: 'DEEPER STILL', desc: 'Cleared your first biome', test: (l) => l.biomeClears >= 1 },
  { id: 'k25', name: 'LIGHTSEEKER', desc: '25 lifetime kills', test: (l) => l.kills >= 25 },
  { id: 'k100', name: 'RADIANT HUNDRED', desc: '100 lifetime kills', test: (l) => l.kills >= 100 },
  { id: 'k250', name: 'SUNBOUND', desc: '250 lifetime kills', test: (l) => l.kills >= 250 },
  { id: 'chain25', name: 'THE SUN WATCHES', desc: 'Reach a chain of 25 in a run', test: (l) => l.bestChain >= 25 },
  { id: 'strike6', name: 'ORCHARD SWEEP', desc: 'Fell 6 foes mid-dash in one room', test: (l) => l.bestRoomStrikes >= 6 },
  { id: 'win', name: 'REKINDLED', desc: 'Won a descent', test: (l) => l.wins >= 1 },
  { id: 'lawsinger', name: 'LAWSINGER', desc: 'Won with 4 different rites', test: (l) => l.ritesWonWith.length >= 4 },
  { id: 'graze3000', name: 'STAREDOWN ADEPT', desc: '3000 lifetime grazes', test: (l) => l.grazes >= 3000 },
  { id: 'untouched5', name: 'THE UNTOUCHED DESCENT', desc: 'Clear 5 rooms in one run without a wound', test: (l) => l.bestHurtlessRooms >= 5 },
  { id: 'bestiary', name: 'READER OF THE ROSTER', desc: 'Fell every foe kind', test: (l) => l.kindsKilled.length >= 8 },
  { id: 'swiftroom', name: 'SWIFT VERDICT', desc: 'Cleared a room in under 25 s', test: (l) => l.fastestRoomSec > 0 && l.fastestRoomSec < 25 },
  { id: 'graze60', name: 'GRAZE DANCER', desc: '60 grazes in one room', test: (l) => l.bestRoomGrazes >= 60 },
];

/* ------------------------------------------------------------------ */
/* the pure evaluator                                                  */
/* ------------------------------------------------------------------ */

export type MilestoneEvent =
  | { t: 'kill'; kind: string; crown: boolean }
  | { t: 'boss' }
  | { t: 'grazes'; n: number } // batched at room settle (bullet-graze spam law)
  | { t: 'roomClear'; roomSec: number; grazes: number; strikes: number; hurtlessStreak: number; biomeCleared: boolean }
  | { t: 'chain'; chain: number }
  | { t: 'finishRun'; won: boolean; rites: string[]; hurtlessRooms: number };

/** apply one engine event to the working save; returns ids completed NOW
 *  (in MILESTONES table order — the toast order is stable). Mutates `save`.
 *  Pure over its inputs: the engine owns ALL run-scoped bookkeeping (the
 *  hurtless-room streak arrives pre-computed as hurtlessStreak). */
export function applyMilestoneEvent(ev: MilestoneEvent, save: MilestoneSave): string[] {
  const life = save.life;
  switch (ev.t) {
    case 'kill': {
      life.kills += 1;
      if (ev.crown) life.crowns += 1;
      if (!life.kindsKilled.includes(ev.kind)) life.kindsKilled.push(ev.kind);
      break;
    }
    case 'boss':
      life.bosses += 1;
      break;
    case 'grazes':
      life.grazes += ev.n;
      break;
    case 'roomClear': {
      life.grazes += ev.grazes;
      life.bestRoomGrazes = Math.max(life.bestRoomGrazes, ev.grazes);
      life.bestRoomStrikes = Math.max(life.bestRoomStrikes, ev.strikes);
      if (ev.roomSec > 0 && (life.fastestRoomSec === 0 || ev.roomSec < life.fastestRoomSec)) {
        life.fastestRoomSec = ev.roomSec;
      }
      if (ev.biomeCleared) life.biomeClears += 1;
      life.bestHurtlessRooms = Math.max(life.bestHurtlessRooms, ev.hurtlessStreak);
      break;
    }
    case 'chain':
      life.bestChain = Math.max(life.bestChain, ev.chain);
      break;
    case 'finishRun': {
      if (ev.won) {
        life.wins += 1;
        for (const r of ev.rites) {
          if (!life.ritesWonWith.includes(r)) life.ritesWonWith.push(r);
        }
      }
      life.bestHurtlessRooms = Math.max(life.bestHurtlessRooms, ev.hurtlessRooms);
      break;
    }
  }
  const newly: string[] = [];
  for (const def of MILESTONES) {
    if (!save.done[def.id] && def.test(life)) {
      save.done[def.id] = true;
      newly.push(def.id);
    }
  }
  return newly;
}

