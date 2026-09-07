import { RUN, WAVES } from './constants';
import type { Rng } from './rng';

/**
 * HOLLOW SUN run layer — PURE TypeScript (no DOM, no three).
 * Run structure, boon catalog, Mods stacking, shrine meta ladder and the
 * dawn-ember economy all live here so they stay headless-testable.
 */

/* ------------------------------------------------------------------ */
/* Mods — the single struct every build modifier writes into           */
/* ------------------------------------------------------------------ */

export interface Mods {
  dmg: number; // shard damage bonus (added to base 1)
  bounces: number; // extra ricochets per throw
  shardSpeed: number; // shard speed multiplier
  graze: number; // graze radius multiplier
  speed: number; // ember move multiplier
  maxEmbers: number; // starting max embers
  throwCd: number; // throw cooldown multiplier
  dashCd: number; // dash cooldown multiplier
  splash: number; // splash dmg on chain bounces
  odOnKill: number; // extra overdrive per kill
  odCatch: number; // extra overdrive per shard catch
  dashStrike: number; // dash-strike damage
  dashKnock: number; // dash knockback multiplier
  odDuration: number; // overdrive duration bonus (s)
  revive: boolean; // Second Dawn
  startShards: number; // extra starting shards (shrine)
  burn: number; // EMBER ROT stacks applied per direct hit
  spark: number; // CHAINSPARK arcs per kill
}

export function baseMods(): Mods {
  return {
    dmg: 1,
    bounces: 0,
    shardSpeed: 1,
    graze: 1,
    speed: 1,
    maxEmbers: 3,
    throwCd: 1,
    dashCd: 1,
    splash: 0,
    odOnKill: 0,
    odCatch: 0,
    dashStrike: 1,
    dashKnock: 1,
    odDuration: 0,
    revive: false,
    startShards: 0,
    burn: 0,
    spark: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Boons — in-run reward cards                                         */
/* ------------------------------------------------------------------ */

export type Tier = 'common' | 'rare' | 'sun';

export interface BoonDef {
  id: string;
  name: string;
  desc: string;
  tier: Tier;
  maxStacks?: number;
  apply(m: Mods): void;
}

export const BOONS: BoonDef[] = [
  { id: 'sharpened', name: 'SHARPENED LIGHT', desc: 'Shard damage +1', tier: 'common', apply: (m) => { m.dmg += 1; } },
  { id: 'prism', name: 'SPLIT PRISM', desc: '+1 ricochet bounce', tier: 'common', apply: (m) => { m.bounces += 1; } },
  { id: 'swift', name: 'SWIFT RETURN', desc: 'Shard speed +20%', tier: 'common', apply: (m) => { m.shardSpeed += 0.2; } },
  { id: 'widegraze', name: 'WIDE GRAZE', desc: 'Graze radius +25%', tier: 'common', apply: (m) => { m.graze += 0.25; } },
  { id: 'cadence', name: 'TWIN CADENCE', desc: 'Throw cooldown −30%', tier: 'common', apply: (m) => { m.throwCd *= 0.7; } },
  { id: 'pace', name: 'KINDLED PACE', desc: 'Move speed +12%', tier: 'common', apply: (m) => { m.speed += 0.12; } },
  { id: 'searing', name: 'SEARING CHAIN', desc: 'Ricochets splash 1 dmg nearby', tier: 'rare', apply: (m) => { m.splash += 1; } },
  { id: 'comet', name: 'COMET CATCH', desc: 'Catching a shard grants +6 Overdrive', tier: 'rare', apply: (m) => { m.odCatch += 6; } },
  { id: 'heatshell', name: 'HEAT SHELL', desc: 'Dash strike +2 dmg, knockback ×1.5', tier: 'rare', apply: (m) => { m.dashStrike += 2; m.dashKnock += 0.5; } },
  { id: 'ward', name: 'EMBER WARD', desc: '+1 max ember, heal 1', tier: 'rare', maxStacks: 2, apply: (m) => { m.maxEmbers += 1; } },
  { id: 'dawning', name: 'DAWNING WRATH', desc: 'Kills charge +5 Overdrive', tier: 'rare', apply: (m) => { m.odOnKill += 5; } },
  { id: 'emberrot', name: 'EMBER ROT', desc: 'Hits ignite foes — burning light eats 1 beat at a time', tier: 'rare', maxStacks: 3, apply: (m) => { m.burn += 1; } },
  { id: 'chainspark', name: 'CHAINSPARK', desc: 'Slain foes arc 2 dmg of death-light to the nearest kindred', tier: 'rare', maxStacks: 2, apply: (m) => { m.spark += 1; } },
  { id: 'patience', name: "SUN'S PATIENCE", desc: 'Overdrive lasts +2 s', tier: 'sun', maxStacks: 1, apply: (m) => { m.odDuration += 2; } },
];

/** offer N distinct boons weighted by tier; respects maxStacks; depth raises rarity.
 *  pass an Rng for seeded runs — deterministic drafts per seed. */
export function rollBoons(taken: Record<string, number>, n: number, depth: number, rng: Rng = Math.random): BoonDef[] {
  const out: BoonDef[] = [];
  const pool = BOONS.filter((b) => (taken[b.id] ?? 0) < (b.maxStacks ?? 99));
  const sunW = 0.05 + Math.min(0.06, depth * 0.012);
  const rareW = 0.33 + Math.min(0.06, depth * 0.012);
  for (let i = 0; i < n && pool.length > out.length; i++) {
    const roll = rng();
    let cand = pool.filter((b) => b.tier === 'sun' && !out.includes(b));
    if (roll < sunW && cand.length > 0) {
      out.push(cand[Math.floor(rng() * cand.length)]);
      continue;
    }
    cand = pool.filter((b) => b.tier === 'rare' && !out.includes(b));
    if (roll < sunW + rareW && cand.length > 0) {
      out.push(cand[Math.floor(rng() * cand.length)]);
      continue;
    }
    cand = pool.filter((b) => b.tier === 'common' && !out.includes(b));
    if (cand.length === 0) cand = pool.filter((b) => !out.includes(b));
    if (cand.length === 0) break;
    out.push(cand[Math.floor(rng() * cand.length)]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Room mutators — per-room weather that bends the rules               */
/* ------------------------------------------------------------------ */

export interface RoomMods {
  foeSpeed: number; // multiplier
  shardSpeed: number; // multiplier
  odCharge: number; // multiplier on overdrive gains
  budget: number; // extra budget fraction
  score: number; // score multiplier
  glassRain: boolean; // opening ring of bullets
}

export function defaultRoomMods(): RoomMods {
  return { foeSpeed: 1, shardSpeed: 1, odCharge: 1, budget: 0, score: 1, glassRain: false };
}

interface MutatorDef {
  id: string;
  name: string;
  desc: string;
  minDepth: number;
  weight: number;
  apply(m: RoomMods): void;
}

const MUTATOR_DEFS: MutatorDef[] = [
  { id: 'swiftshadows', name: 'SWIFT SHADOWS', desc: 'Foes drift 18% faster', minDepth: 3, weight: 3, apply: (m) => { m.foeSpeed *= 1.18; } },
  { id: 'thinlight', name: 'THIN LIGHT', desc: 'Shards fly 15% slower', minDepth: 3, weight: 3, apply: (m) => { m.shardSpeed *= 0.85; } },
  { id: 'drought', name: 'EMBER DROUGHT', desc: 'Overdrive charges 25% slower', minDepth: 4, weight: 2, apply: (m) => { m.odCharge *= 0.75; } },
  { id: 'glassrain', name: 'GLASS RAIN', desc: 'The room opens under a bullet ring', minDepth: 4, weight: 2, apply: (m) => { m.glassRain = true; } },
  { id: 'richveins', name: 'RICH VEINS', desc: 'Score ×1.5 — the dark pays better', minDepth: 5, weight: 2, apply: (m) => { m.score *= 1.5; m.budget += 0.3; } },
];

export interface RoomMutator {
  id: string;
  name: string;
  desc: string;
  mods: RoomMods;
}

/** deterministic per seed: 60% of rooms past depth 2 carry a mutator */
export function rollMutator(rng: Rng, depth: number): RoomMutator {
  if (depth < 3 || rng() >= 0.6) {
    return { id: '', name: '', desc: '', mods: defaultRoomMods() };
  }
  const pool = MUTATOR_DEFS.filter((m) => depth >= m.minDepth);
  let total = 0;
  for (const m of pool) total += m.weight;
  let roll = rng() * total;
  for (const m of pool) {
    roll -= m.weight;
    if (roll <= 0) {
      const mods = defaultRoomMods();
      m.apply(mods);
      return { id: m.id, name: m.name, desc: m.desc, mods };
    }
  }
  return { id: '', name: '', desc: '', mods: defaultRoomMods() };
}

/* ------------------------------------------------------------------ */
/* Shrine of Dawn — meta ladder (hub, persists between runs)           */
/* ------------------------------------------------------------------ */

export interface ShrineUpgrade {
  id: string;
  name: string;
  desc: string;
  cost: number;
  apply(m: Mods): void;
}

export const SHRINE_UPGRADES: ShrineUpgrade[] = [
  { id: 'warmember', name: 'WARM EMBER', desc: '+1 starting max ember', cost: 40, apply: (m) => { m.maxEmbers += 1; } },
  { id: 'spark', name: 'STARTING SPARK', desc: 'Begin each run with 4 shards', cost: 60, apply: (m) => { m.startShards += 1; } },
  { id: 'kinsight', name: 'KIN SIGHT', desc: '+15% graze radius', cost: 30, apply: (m) => { m.graze += 0.15; } },
  { id: 'ashwalk', name: 'ASH WALK', desc: '−20% dash cooldown', cost: 50, apply: (m) => { m.dashCd *= 0.8; } },
  { id: 'prism', name: 'PRISM MEMORY', desc: '+1 shard bounce', cost: 80, apply: (m) => { m.bounces += 1; } },
  { id: 'seconddawn', name: 'SECOND DAWN', desc: 'Revive once per run at 1 ember', cost: 150, apply: (m) => { m.revive = true; } },
];

/** stack every purchased shrine upgrade into fresh Mods */
export function metaMods(unlocked: Record<string, boolean>): Mods {
  const m = baseMods();
  for (const u of SHRINE_UPGRADES) if (unlocked[u.id]) u.apply(m);
  return m;
}

/* ------------------------------------------------------------------ */
/* Dawn economy                                                        */
/* ------------------------------------------------------------------ */

export function dawnEarned(score: number, roomsCleared: number, bossesKilled: number, won: boolean): number {
  return Math.round(RUN.dawnPerRoom * roomsCleared + RUN.dawnPerBoss * bossesKilled + score * RUN.dawnPerScore + (won ? RUN.dawnWinBonus : 0));
}

/* ------------------------------------------------------------------ */
/* Room helpers                                                        */
/* ------------------------------------------------------------------ */

export function biomeName(b: number): string {
  return RUN.biomes[Math.min(RUN.biomes.length - 1, b)];
}

export function isBossRoom(r: number): boolean {
  return r >= RUN.roomsPerBiome;
}

export function bossName(b: number): string {
  return RUN.bossNames[Math.min(RUN.bossNames.length - 1, b)];
}

export function bossHp(b: number): number {
  return WAVES.bossHp[Math.min(WAVES.bossHp.length - 1, b)];
}

export function bossScore(b: number): number {
  return WAVES.wardenScore * (b + 1);
}

/** combat-room wave budget by biome+room (1-based room) */
export function roomBudget(b: number, r: number): number {
  const depth = b * RUN.roomsPerBiome + r;
  return Math.round(WAVES.budgetBase + WAVES.budgetPerWave * depth * 1.5);
}

export function eliteChance(b: number): number {
  return b <= 0 ? 0 : b === 1 ? 0.25 : 0.35;
}

export const TIER_COLOR: Record<Tier, string> = {
  common: '#d8c9a8',
  rare: '#ffb35c',
  sun: '#fff3d6',
};
