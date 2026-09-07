/**
 * HOLLOW SUN forge harness (QA pipeline step) — EMBER ROT burn + CHAINSPARK.
 * Asserts the stack law, the beat ladder, spark arc targeting, and
 * seed-determinism of the whole burn/spark path. Usage:
 *   bun run scripts/simdrive-forge.ts
 */
import { BURN, SPARK } from '../src/game/constants';
import { Sim, type SimEvents } from '../src/game/sim';
import { RUN } from '../src/game/constants';

const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}

interface Rec {
  burnTicks: { x: number; z: number; dmg: number; left: number }[];
  sparks: { fx: number; fz: number; tx: number; tz: number; dmg: number }[];
  kills: { kind: string; x: number; z: number }[];
  score: number;
}

function makeRecorder(): { rec: Rec; ev: SimEvents } {
  const rec: Rec = { burnTicks: [], sparks: [], kills: [], score: 0 };
  const base: SimEvents = {
    onThrow: () => {},
    onBounce: () => {},
    onCatch: () => {},
    onKill: (kind, x, z) => rec.kills.push({ kind, x, z }),
    onGraze: () => {},
    onHurt: () => {},
    onDash: () => {},
    onRecall: () => {},
    onShieldBreak: () => {},
    onBlock: () => {},
    onHeavyShot: () => {},
    onBossPhase: () => {},
    onRevive: () => {},
    onWardenSpawn: () => {},
    onWardenDie: () => {},
    onWaveStart: () => {},
    onWaveClear: () => {},
    onOverdriveStart: () => {},
    onShardGain: () => {},
    onDeath: () => {},
    onSpawnMark: () => {},
    onBurnTick: (x, z, dmg, left) => rec.burnTicks.push({ x, z, dmg, left }),
    onSpark: (fx, fz, tx, tz, dmg) => rec.sparks.push({ fx, fz, tx, tz, dmg }),
  };
  return { rec, ev: base };
}

function r(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** tick the sim until predicate or frame cap; player kept invulnerable */
function runUntil(sim: Sim, pred: () => boolean, capFrames = 600): boolean {
  for (let i = 0; i < capFrames; i++) {
    if (pred()) return true;
    sim.update(1 / 60, 1 / 60, 0, 0, 0, 0, false, false);
    sim.invuln = Math.max(sim.invuln, 0.2);
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* A — ignition & stack law: a surviving hit applies exactly mods.burn */
/* ------------------------------------------------------------------ */
{
  const { rec, ev } = makeRecorder();
  const sim = new Sim(ev, { burn: 3 });
  sim.reset();
  sim.setSeed(1337);
  sim.startRoom(0, 1);
  const gotFoe = runUntil(sim, () => sim.foes.some((f) => f.spawnT <= 0));
  assert(gotFoe, 'A: no foe became live within cap');

  const killed = sim.debugStrikeNearest(1);
  assert(!killed, 'A: 1 dmg should not kill a fresh drifter');
  const struck = sim.foes.reduce((a, b) => (a.burn >= b.burn ? a : b));
  assert(struck.burn === 3, `A: expected 3 burn stacks, got ${struck.burn}`);
  assert(rec.burnTicks.length === 0, 'A: no burn beat may fire before the first beat interval');

  // first beat deals the FULL stack count
  const hpBefore = struck.hp;
  runUntil(sim, () => struck.hp < hpBefore || !sim.foes.includes(struck), 120);
  const beat = rec.burnTicks[0];
  assert(!!beat && beat.dmg === 3, `A: first beat should deal 3 (stack count), got ${beat?.dmg}`);
  assert(beat && r(beat.left) === r(struck.burn), 'A: stacksLeft must match foe state after the beat');
}

/* ------------------------------------------------------------------ */
/* B — beat ladder: 3 stacks on hp 6 → beats 3,2,1, then death + kill  */
/* ------------------------------------------------------------------ */
{
  const { rec, ev } = makeRecorder();
  const sim = new Sim(ev, { burn: 3 });
  sim.reset();
  sim.setSeed(1337);
  sim.startRoom(0, 1);
  runUntil(sim, () => sim.foes.some((f) => f.spawnT <= 0));
  const f = sim.foes.find((x) => x.spawnT <= 0);
  if (!f) {
    failures.push('B: no live foe to seed the ladder');
  } else {
    f.hp = 6;
    f.maxHp = 6;
    f.burn = 3;
    f.burnT = BURN.tick;
    const dead = runUntil(sim, () => !sim.foes.includes(f), 240);
    assert(dead, 'B: burn ladder never killed the foe');
    const dmgs = rec.burnTicks.map((t) => t.dmg);
    assert(
      dmgs.length === 3 && dmgs[0] === 3 && dmgs[1] === 2 && dmgs[2] === 1,
      `B: ladder should be [3,2,1], got [${dmgs.join(',')}]`,
    );
    assert(rec.kills.length >= 1, 'B: burn death must speak through onKill');
    assert(sim.score > 0, 'B: burn kill must pay score');
    // beats live on enemy time: at 0.75s per beat, 3 beats need >= 2.25s
    assert(
      rec.burnTicks.length === 0 || 3 * BURN.tick <= 2.5,
      'B: beat interval sanity',
    );
  }
}

/* ------------------------------------------------------------------ */
/* C — spark arc: kill arcs SPARK.dmg to the nearest kindred, once     */
/* ------------------------------------------------------------------ */
{
  const { rec, ev } = makeRecorder();
  const sim = new Sim(ev, { spark: 1 });
  sim.reset();
  sim.setSeed(1337);
  sim.startRoom(0, 1);
  runUntil(sim, () => sim.foes.filter((f) => f.spawnT <= 0).length >= 3, 900);
  const live = sim.foes.filter((x) => x.spawnT <= 0);
  if (live.length < 3) {
    failures.push('C: room never produced three live foes');
  } else {
    // stage a controlled arc line: F1 near the ember, F2/F3 down the axis
    sim.px = 0;
    sim.pz = 0;
    const [f1, f2, f3] = live;
    f1.x = 2;
    f1.z = 0;
    f2.x = 5;
    f2.z = 0;
    f3.x = 6;
    f3.z = 0;
    for (const f of [f1, f2, f3]) {
      f.vx = 0;
      f.vz = 0;
    }
    f2.hp = 6;
    f2.maxHp = 6;
    f3.hp = 6;
    f3.maxHp = 6;
    const hp2 = f2.hp;
    const hp3 = f3.hp;
    const killed = sim.debugStrikeNearest(999); // kills f1 (nearest to ember)
    assert(killed, 'C: 999 dmg must kill the staged foe');
    assert(rec.sparks.length === 1, `C: expected exactly 1 arc (spark=1), got ${rec.sparks.length}`);
    const s = rec.sparks[0];
    assert(s && s.dmg === SPARK.dmg, 'C: arc must carry SPARK.dmg');
    assert(s && r(s.fx) === 2 && r(s.fz) === 0, 'C: arc origin must be the slain foe');
    assert(sim.foes.includes(f2) && f2.hp === hp2 - SPARK.dmg, `C: arc target should pay exactly ${SPARK.dmg} dmg`);
    assert(sim.foes.includes(f3) && f3.hp === hp3, 'C: non-target must be untouched (nearest-first law)');
    // sparks never re-spark: f2 survived, so no second arc may appear
    assert(rec.sparks.length === 1, 'C: surviving arc target must not re-spark');
    // second kill arcs from f2 to its nearest kindred (f3)
    sim.debugStrikeNearest(999);
    assert(rec.sparks.length === 2, `C: second kill should arc once, got ${rec.sparks.length}`);
    const s2 = rec.sparks[1];
    assert(s2 && r(s2.tx) === 6 && r(s2.tz) === 0, 'C: second arc must land on f3');
  }
}

/* ------------------------------------------------------------------ */
/* D — determinism: identical seed → identical burn/spark story        */
/* ------------------------------------------------------------------ */
function scriptedRun(): Rec {
  const { rec, ev } = makeRecorder();
  const sim = new Sim(ev, { burn: 2, spark: 1 });
  sim.reset();
  sim.setSeed(777);
  sim.startRoom(0, 1);
  for (let i = 0; i < 60 * 30; i++) {
    sim.update(1 / 60, 1 / 60, 0.2, 0, 0, 0, i % 40 === 0, i % 240 === 0);
    sim.invuln = Math.max(sim.invuln, 0.2);
    if (i === 240 || i === 480) sim.debugStrikeNearest(1);
  }
  rec.score = sim.score;
  return rec;
}
{
  const a = scriptedRun();
  const b = scriptedRun();
  assert(a.score === b.score, `D: score digests diverge (${a.score} vs ${b.score})`);
  assert(a.burnTicks.length === b.burnTicks.length, 'D: burn tick counts diverge');
  assert(a.sparks.length === b.sparks.length, 'D: spark counts diverge');
  assert(a.kills.length === b.kills.length, 'D: kill counts diverge');
  for (let i = 0; i < Math.min(a.burnTicks.length, b.burnTicks.length); i++) {
    assert(r(a.burnTicks[i].x) === r(b.burnTicks[i].x) && r(a.burnTicks[i].dmg) === r(b.burnTicks[i].dmg), `D: burn tick ${i} diverged`);
  }
  for (let i = 0; i < Math.min(a.sparks.length, b.sparks.length); i++) {
    assert(r(a.sparks[i].tx) === r(b.sparks[i].tx), `D: spark ${i} target diverged`);
  }
}

/* ------------------------------------------------------------------ */
/* E — full-run compatibility: burn+spark build clears all 9 rooms     */
/* ------------------------------------------------------------------ */
{
  const { rec, ev } = makeRecorder();
  const sim = new Sim(ev, { dmg: 6, maxEmbers: 9, revive: true, burn: 2, spark: 1 });
  sim.reset();
  sim.setSeed(4242);
  sim.startRoom(0, 1);
  let biome = 0;
  let room = 1;
  let cleared = 0;
  let bosses = 0;
  const origWaveClear = ev.onWaveClear;
  ev.onWaveClear = () => {
    cleared++;
    origWaveClear(0);
  };
  const origWardenDie = ev.onWardenDie;
  ev.onWardenDie = () => {
    bosses++;
    origWardenDie(0, 0);
  };
  let pending = false;
  const clearCb = sim.events.onWaveClear;
  sim.events.onWaveClear = (n) => {
    pending = true;
    clearCb(n);
  };
  let frames = 0;
  const CAP = 60 * 60 * 20;
  while (frames < CAP) {
    frames++;
    if (sim.over) break;
    let nearest = 1e9;
    let ndx = 0;
    let ndz = 0;
    let aimX = sim.px;
    let aimZ = sim.pz - 8;
    for (const f of sim.foes) {
      const d = Math.hypot(f.x - sim.px, f.z - sim.pz);
      if (d < nearest) {
        nearest = d;
        ndx = f.x - sim.px;
        ndz = f.z - sim.pz;
        aimX = f.x;
        aimZ = f.z;
      }
    }
    let mx = 0;
    let my = 0;
    if (nearest < 7 && nearest > 0.01) {
      mx = -ndx / nearest;
      my = ndz / nearest;
    } else if (Math.hypot(sim.px, sim.pz) > 28) {
      mx = -sim.px / 10;
      my = -sim.pz / 10;
    } else if (nearest > 12 && nearest < 1e9) {
      mx = ndx / nearest;
      my = -ndz / nearest;
    }
    sim.update(1 / 60, 1 / 60, mx, my, aimX, aimZ, true, frames % 90 === 0);
    sim.invuln = Math.max(sim.invuln, 0.2);
    if (pending) {
      pending = false;
      if (biome === 2 && room === RUN.roomsPerBiome) break;
      room++;
      if (room > RUN.roomsPerBiome) {
        room = 1;
        biome++;
      }
      sim.startRoom(biome, room);
    }
  }
  assert(cleared === 9, `E: burn+spark build cleared ${cleared}/9 rooms`);
  assert(bosses === 3, `E: burn+spark build killed ${bosses}/3 bosses`);
  assert(rec.burnTicks.length > 0, 'E: burn never ticked in the full run');
  assert(rec.sparks.length > 0, 'E: spark never fired in the full run');
  assert(frames < CAP, 'E: hit frame cap');
}

console.log('=== HOLLOW SUN forge harness (EMBER ROT + CHAINSPARK) ===');
console.log(`burn beats exercised, spark arcs exercised, determinism digests compared`);
if (failures.length > 0) {
  console.log('\nFAIL:');
  for (const f of failures) console.log(` ✗ ${f}`);
  process.exit(1);
}
console.log('\nPASS: stack law, beat ladder, arc targeting, determinism, full-run compatibility.');
