/**
 * UPGRADES CONTRACT — specialist S2 owns the 12-card pool. Byte-stable API:
 *   UPGRADES: UpgradeDef[] · rollChoices(rng, levels, n): UpgradeDef[] ·
 *   UpgradeDef { id, name, desc, maxLevel, apply(stats) } · PlayerStatsLike
 *
 * ORCHESTRATOR WIRING (Game + Player.stats — required for cards 7-12):
 *   1. DEFAULTS: Player.stats (and its reset()) must init pierce = 0,
 *      scoreMul = 1, maxHpBonus = 0. apply() is ??-guarded so it is safe
 *      even before the defaults land, but the sim reads these every frame.
 *   2. pierce     → "slug": cannon shots punch through N extra enemies.
 *      Game.fireCannon must forward stats.pierce into Projectiles.
 *   3. scoreMul   → "scavenger": multiply every score gain (kills, wave
 *      bonus) — Game.score updates read stats.scoreMul.
 *   4. maxHpBonus → "hull": Game.applyUpgrade, after def.apply(), must do
 *      player.maxHp = MAX_HP_BASE + (stats.maxHpBonus ?? 0) and
 *      player.hp += 25 (desc promises "and repairs 25").
 *   5. id "nano"  → apply() is a deliberate no-op; Game.applyUpgrade
 *      special-cases it: player.hp += (player.maxHp - player.hp) * 0.5.
 *   Suggested hook: applyUpgrade(id) { def.apply(stats); switch(id) hull/nano }.
 *
 * rollChoices: n distinct cards, never above maxLevel, weighted by remaining
 *   levels — maxed cards are excluded from the pool entirely, near-maxed
 *   cards are downweighted (weight = max(1, maxLevel - level)).
 */
import type { Rng } from "@/frontier/core/Rng";

export interface PlayerStatsLike {
  damageMul: number;
  fireRateMul: number;
  speedMul: number;
  dashCdMul: number;
  missileCount: number;
  missileDmgMul: number;
  lockRange: number;
  /** S2→orchestrator: default 0 in Player.stats. Cannon pierce count ("slug"). */
  pierce?: number;
  /** S2→orchestrator: default 1 in Player.stats. Score multiplier ("scavenger"). */
  scoreMul?: number;
  /** S2→orchestrator: default 0 in Player.stats. Bonus max HP ("hull"). */
  maxHpBonus?: number;
}

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  maxLevel: number;
  apply: (s: PlayerStatsLike) => void;
}

export const UPGRADES: UpgradeDef[] = [
  { id: "dmg", name: "MACHINED ROUNDS", desc: "+25% cannon damage", maxLevel: 5, apply: (s) => { s.damageMul += 0.25; } },
  { id: "rate", name: "AUTOLOADER", desc: "+20% fire rate", maxLevel: 5, apply: (s) => { s.fireRateMul += 0.2; } },
  { id: "spd", name: "OVERDRIVEN TREADS", desc: "+12% move speed", maxLevel: 4, apply: (s) => { s.speedMul += 0.12; } },
  { id: "dash", name: "AFTERBURN VENTS", desc: "-25% dash cooldown", maxLevel: 4, apply: (s) => { s.dashCdMul *= 0.75; } },
  { id: "mcount", name: "HYDRA PODS", desc: "+1 missile per volley", maxLevel: 4, apply: (s) => { s.missileCount += 1; } },
  { id: "mdmg", name: "HEAVY WARHEADS", desc: "+30% missile damage", maxLevel: 4, apply: (s) => { s.missileDmgMul += 0.3; } },
  { id: "hull", name: "REINFORCED HULL", desc: "+25 max HP and repairs 25", maxLevel: 4, apply: (s) => { s.maxHpBonus = (s.maxHpBonus ?? 0) + 25; } },
  { id: "slug", name: "SLUG ROUNDS", desc: "Cannon shots pierce +1 enemy", maxLevel: 3, apply: (s) => { s.pierce = (s.pierce ?? 0) + 1; } },
  { id: "coolant", name: "COOLANT FLUSH", desc: "+12% fire rate, dash cooldown -10%", maxLevel: 3, apply: (s) => { s.fireRateMul += 0.12; s.dashCdMul *= 0.9; } },
  { id: "targeting", name: "TARGETING SUITE", desc: "+8 lock range, +1 missile per volley", maxLevel: 3, apply: (s) => { s.lockRange += 8; s.missileCount += 1; } },
  { id: "scavenger", name: "SCAVENGER", desc: "+20% score gain", maxLevel: 3, apply: (s) => { s.scoreMul = (s.scoreMul ?? 1) + 0.2; } },
  {
    id: "nano", name: "NANO-REPAIR", desc: "Instantly repair 50% of missing HP", maxLevel: 3,
    // No-op here on purpose: Game.applyUpgrade special-cases this id and does
    // player.hp += (player.maxHp - player.hp) * 0.5 (stats can't reach Player.hp).
    apply: () => {
      /* see note above */
    },
  },
];

// Module-level scratch: rollChoices runs once per intermission, but keep it alloc-free anyway.
const POOL_IDX = new Int32Array(UPGRADES.length);
const POOL_W = new Float64Array(UPGRADES.length);

export function rollChoices(rng: Rng, levels: Record<string, number>, n: number): UpgradeDef[] {
  let poolSize = 0;
  let totalW = 0;
  for (let i = 0; i < UPGRADES.length; i++) {
    const u = UPGRADES[i];
    const level = levels[u.id] ?? 0;
    if (level >= u.maxLevel) continue; // maxed cards never offered
    const w = Math.max(1, u.maxLevel - level); // near-maxed downweighted
    POOL_IDX[poolSize] = i;
    POOL_W[poolSize] = w;
    totalW += w;
    poolSize++;
  }
  const out: UpgradeDef[] = [];
  while (out.length < n && poolSize > 0) {
    let roll = rng.next() * totalW;
    let pick = poolSize - 1;
    for (let k = 0; k < poolSize; k++) {
      roll -= POOL_W[k];
      if (roll < 0) {
        pick = k;
        break;
      }
    }
    out.push(UPGRADES[POOL_IDX[pick]]);
    totalW -= POOL_W[pick];
    POOL_IDX[pick] = POOL_IDX[poolSize - 1]; // swap-remove (no dupes)
    POOL_W[pick] = POOL_W[poolSize - 1];
    poolSize--;
  }
  return out;
}
