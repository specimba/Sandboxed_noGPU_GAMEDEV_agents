/**
 * HOLLOW SUN headless sim drive (QA pipeline step).
 * Runs a bot through a full 3-biome run, asserting run structure, elites,
 * boss phases, boons and the dawn economy. Usage: bun run scripts/simdrive.ts
 */
import { Sim, type SimEvents } from '../src/game/sim';
import { dawnEarned, rollBoons, type BoonDef } from '../src/game/run';
import { RUN } from '../src/game/constants';

const ARENA_SAFE = 28;

interface DriveResult {
  roomsCleared: number;
  bossesKilled: number;
  phasesSeen: Set<number>;
  elitesSeen: Set<string>;
  boonsTaken: Record<string, number>;
  score: number;
  won: boolean;
  errors: string[];
}

function drive(seedMods: { dmg: number; maxEmbers: number; revive: boolean }): DriveResult {
  const res: DriveResult = {
    roomsCleared: 0,
    bossesKilled: 0,
    phasesSeen: new Set(),
    elitesSeen: new Set(),
    boonsTaken: {},
    score: 0,
    won: false,
    errors: [],
  };
  let biome = 0;
  let room = 1;
  let pendingAdvance = false;

  const ev: SimEvents = {
    onThrow: () => {},
    onBounce: () => {},
    onCatch: () => {},
    onKill: () => {},
    onGraze: () => {},
    onHurt: () => {},
    onDash: () => {},
    onRecall: () => {},
    onShieldBreak: () => {},
    onBossPhase: (_x, _z, p) => res.phasesSeen.add(p),
    onRevive: () => {},
    onWardenSpawn: () => {},
    onWardenDie: () => res.bossesKilled++,
    onWaveStart: () => {},
    onWaveClear: () => {
      res.roomsCleared++;
      pendingAdvance = true;
    },
    onOverdriveStart: () => {},
    onShardGain: () => {},
    onDeath: () => {},
    onSpawnMark: () => {},
  };

  const sim = new Sim(ev, seedMods);
  sim.reset();
  sim.startRoom(0, 1);

  let frames = 0;
  const MAX_FRAMES = 60 * 60 * 20; // 20 sim-minutes hard cap

  while (frames < MAX_FRAMES) {
    frames++;
    if (sim.over) break;

    // bot: aim at nearest foe, keep ~7u distance, throw on cooldown, dash periodically
    let aimX = sim.px;
    let aimZ = sim.pz - 8;
    let nearest = 1e9;
    let ndx = 0;
    let ndz = 0;
    for (const f of sim.foes) {
      const d = Math.hypot(f.x - sim.px, f.z - sim.pz);
      if (d < nearest) {
        nearest = d;
        ndx = f.x - sim.px;
        ndz = f.z - sim.pz;
        aimX = f.x;
        aimZ = f.z;
      }
      if (f.elite) res.elitesSeen.add(f.elite);
    }
    let mx = 0;
    let my = 0;
    if (nearest < 7 && nearest > 0.01) {
      mx = -ndx / nearest;
      my = ndz / nearest;
    } else if (Math.hypot(sim.px, sim.pz) > ARENA_SAFE) {
      mx = -sim.px / 10;
      my = -sim.pz / 10;
    } else if (nearest > 12 && nearest < 1e9) {
      mx = ndx / nearest;
      my = -ndz / nearest;
    }
    const wantDash = frames % 90 === 0;

    sim.update(1 / 60, 1 / 60, mx, my, aimX, aimZ, true, wantDash);

    // god-mode: the bot is unskilled by design — systems, not skill, are under test
    sim.invuln = Math.max(sim.invuln, 0.2);

    // NaN watchdog
    if (!Number.isFinite(sim.px) || !Number.isFinite(sim.score) || !Number.isFinite(sim.embers)) {
      res.errors.push(`NaN at frame ${frames}`);
      break;
    }

    if (pendingAdvance) {
      pendingAdvance = false;
      const choices: BoonDef[] = rollBoons(res.boonsTaken, 3, biome * 3 + room);
      if (choices.length > 0) {
        sim.applyBoon(choices[0]);
        res.boonsTaken[choices[0].id] = (res.boonsTaken[choices[0].id] ?? 0) + 1;
      }
      if (biome === 2 && room === RUN.roomsPerBiome) {
        res.won = true;
        break;
      }
      room++;
      if (room > RUN.roomsPerBiome) {
        room = 1;
        biome++;
      }
      sim.startRoom(biome, room);
    }
  }

  if (frames >= MAX_FRAMES) res.errors.push('hit frame cap (stuck run)');
  res.score = sim.score;
  return res;
}

// boosted bot build — this drive verifies SYSTEMS, not balance
const result = drive({ dmg: 6, maxEmbers: 9, revive: true });
const dawn = dawnEarned(result.score, result.roomsCleared, result.bossesKilled, result.won);

console.log('=== HOLLOW SUN headless run drive ===');
console.log(`rooms cleared: ${result.roomsCleared}/9`);
console.log(`bosses killed: ${result.bossesKilled}/3`);
console.log(`boss phases seen: [${[...result.phasesSeen].sort().join(', ')}]`);
console.log(`elite affixes encountered: [${[...result.elitesSeen].sort().join(', ')}]`);
console.log(`boons taken: ${JSON.stringify(result.boonsTaken)}`);
console.log(`final score: ${result.score}  won: ${result.won}  dawn earned: ${dawn}`);

const fail: string[] = [];
if (result.roomsCleared !== 9) fail.push('did not clear all 9 rooms');
if (result.bossesKilled !== 3) fail.push('did not kill all 3 bosses');
if (!result.phasesSeen.has(2) || !result.phasesSeen.has(3)) fail.push('boss phases 2/3 never triggered');
if (result.elitesSeen.size === 0) fail.push('no elite variants encountered');
if (Object.keys(result.boonsTaken).length === 0) fail.push('no boons applied');
if (dawn <= 0) fail.push('dawn economy produced nothing');
if (result.errors.length > 0) fail.push(...result.errors);

if (fail.length > 0) {
  console.log('\nFAIL:');
  for (const f of fail) console.log(` ✗ ${f}`);
  process.exit(1);
}
console.log('\nPASS: run structure, elites, boss phases, boons, economy — all verified headless.');
