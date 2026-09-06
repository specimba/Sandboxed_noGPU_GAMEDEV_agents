/**
 * AFTERGLOW M0 headless drive harness (QA pipeline step).
 * Drives a deterministic bot through the fresh sim core and asserts the M0
 * contract: determinism, divergence, no-NaN, progression, draft integrity,
 * telegraph law, entity bounds, pillar law and the death path.
 *
 * Usage: bun scripts/simdrive-afterglow.ts [--waves N] [--seeds a,b,c]
 * Prints PASS/FAIL per assertion; exits 1 on any failure.
 */
import { Sim, type AfterglowEvents } from '../src/game/afterglow/sim';
import { ARENA_RADIUS, CAPS } from '../src/game/afterglow/constants';

const SUB = 1 / 60;
const TAIL_SUBSTEPS = 300; // 5s past the target wave: exercises pick + breather + next intro
const DEATH_CAP_SEC = 15 * 60; // no-input run must die within 15 sim-minutes

interface DriveOpts {
  waves: number;
  noInput: boolean;
  capSec: number;
}

interface DriveRec {
  seed: number;
  boundaryStrings: string[];
  boundaryHashes: string[];
  endHash: string;
  wavesCleared: number;
  waveStarts: number;
  waveClearEvents: number;
  offerEvents: number;
  offersBad: number;
  picks: number;
  modsDeltas: boolean[];
  dashEvents: number;
  teleViolations: number;
  chargeStarts: number;
  maxFoes: number;
  maxProjectiles: number;
  maxMotes: number;
  maxArcs: number;
  maxTrails: number;
  pillarViolations: number;
  nanViolations: number;
  over: boolean;
  finalTime: number;
  finalWave: number;
  kills: number;
  light: number;
  substeps: number;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------ */
/* bot — deterministic, mildly skilled: flee weighted danger, collect  */
/* motes, respect the wall, dash out of crunches and incoming charges  */
/* ------------------------------------------------------------------ */

function bot(sim: Sim): void {
  const p = sim.player;
  let fx = 0;
  let fz = 0;
  let nearest = Infinity;
  let chargeThreat = false;
  for (const f of sim.foes) {
    if (f.state === 'spawn') continue;
    const dx = p.x - f.x;
    const dz = p.z - f.z;
    const d = Math.hypot(dx, dz) || 0.001;
    if (d < nearest) nearest = d;
    const w = 1 / (d * d); // weighted danger: close foes scream loudest
    fx += (dx / d) * w;
    fz += (dz / d) * w;
    if (f.kind === 'husk' && (f.state === 'windup' || f.state === 'charge') && d < 8) chargeThreat = true;
  }
  let mDx = 0;
  let mDz = 0;
  let mBest = 8;
  for (const m of sim.motes) {
    const dx = m.x - p.x;
    const dz = m.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < mBest) {
      mBest = d;
      if (d > 0.01) {
        mDx = dx / d;
        mDz = dz / d;
      }
    }
  }
  let mx = 0;
  let mz = 0;
  const fl = Math.hypot(fx, fz);
  if (fl > 1e-6) {
    mx += fx / fl;
    mz += fz / fl;
  }
  if (mBest < 8 && mBest > 0.01) {
    mx += mDx * 0.7;
    mz += mDz * 0.7;
  }
  const cd = Math.hypot(p.x, p.z);
  if (cd > ARENA_RADIUS - 6) {
    mx -= (p.x / cd) * 1.2;
    mz -= (p.z / cd) * 1.2;
  }
  const ml = Math.hypot(mx, mz);
  if (ml > 0.05) sim.setMove(mx / ml, mz / ml);
  else sim.setMove(0, 0);
  if ((nearest < 2.5 || chargeThreat) && p.dashCd <= 0 && p.dashT <= 0) sim.requestDash();
}

/* ------------------------------------------------------------------ */
/* drive — one full run under a fixed policy, fully sampled            */
/* ------------------------------------------------------------------ */

function drive(seed: number, opts: DriveOpts): DriveRec {
  const rec: DriveRec = {
    seed,
    boundaryStrings: [],
    boundaryHashes: [],
    endHash: '',
    wavesCleared: 0,
    waveStarts: 0,
    waveClearEvents: 0,
    offerEvents: 0,
    offersBad: 0,
    picks: 0,
    modsDeltas: [],
    dashEvents: 0,
    teleViolations: 0,
    chargeStarts: 0,
    maxFoes: 0,
    maxProjectiles: 0,
    maxMotes: 0,
    maxArcs: 0,
    maxTrails: 0,
    pillarViolations: 0,
    nanViolations: 0,
    over: false,
    finalTime: 0,
    finalWave: 0,
    kills: 0,
    light: 0,
    substeps: 0,
  };

  const windupAcc = new Map<number, number>();
  const prevFoeState = new Map<number, string>();
  let prevPhase: string = 'idle';
  let tail = -1;
  let nanTick = 0;

  const events: AfterglowEvents = {
    onFoeDie: () => {},
    onHurt: () => {},
    onDash: () => { rec.dashEvents++; },
    onWaveStart: () => { rec.waveStarts++; },
    onWaveClear: () => { rec.waveClearEvents++; },
    onDraftOffer: () => { rec.offerEvents++; },
    onDraftPick: () => { rec.picks++; },
    onSpawn: () => {},
    onDeath: () => {},
    onMote: () => {},
    onPickup: () => {},
  };

  const sim = new Sim(seed, events);
  sim.start();

  while (true) {
    if (opts.noInput) sim.setMove(0, 0);
    else bot(sim);

    // deterministic draft pick — bot AND no-input runs must pick or the sim stalls at draft
    if (sim.wave.phase === 'draft' && sim.offers.length > 0) {
      if (sim.offers.length !== 3 || new Set(sim.offers).size !== 3) rec.offersBad++;
      const modsBefore = JSON.stringify(sim.mods);
      const stateBefore = sim.serializeState();
      if (sim.pickDraft(sim.offers[0])) {
        rec.modsDeltas.push(JSON.stringify(sim.mods) !== modsBefore && sim.serializeState() !== stateBefore);
      }
    }

    sim.step(SUB);
    rec.substeps++;

    // wave-clear boundary snapshot (pre-pick state of the just-cleared wave)
    if (prevPhase === 'combat' && sim.wave.phase === 'draft') {
      rec.wavesCleared = sim.wave.n;
      const s = sim.serializeState();
      rec.boundaryStrings.push(s);
      rec.boundaryHashes.push(fnv1a(s));
    }
    prevPhase = sim.wave.phase;

    // entity bounds sampling (every substep)
    rec.maxFoes = Math.max(rec.maxFoes, sim.foes.length);
    rec.maxProjectiles = Math.max(rec.maxProjectiles, sim.projectiles.length);
    rec.maxMotes = Math.max(rec.maxMotes, sim.motes.length);
    rec.maxArcs = Math.max(rec.maxArcs, sim.arcs.length);
    rec.maxTrails = Math.max(rec.maxTrails, sim.trails.length);

    // pillar law: player center never inside a pillar interior
    for (const pil of sim.pillars) {
      const d = Math.hypot(sim.player.x - pil.x, sim.player.z - pil.z);
      if (d <= pil.r - 0.01) {
        rec.pillarViolations++;
        break;
      }
    }

    // telegraph law: every husk charge preceded by >= 0.75s of windup
    const seen = new Set<number>();
    for (const f of sim.foes) {
      seen.add(f.id);
      const prev = prevFoeState.get(f.id) ?? f.state;
      if (f.state === 'windup') {
        windupAcc.set(f.id, (windupAcc.get(f.id) ?? 0) + SUB);
      } else if (f.state === 'charge' && prev !== 'charge') {
        rec.chargeStarts++;
        if ((windupAcc.get(f.id) ?? 0) < 0.75 - 1e-9) rec.teleViolations++;
      }
      prevFoeState.set(f.id, f.state);
      if (f.state !== 'windup' && f.state !== 'charge') windupAcc.delete(f.id);
    }
    for (const id of [...prevFoeState.keys()]) {
      if (!seen.has(id)) {
        prevFoeState.delete(id);
        windupAcc.delete(id);
      }
    }

    // no-NaN batch check (1s of substeps)
    if (++nanTick >= 60) {
      nanTick = 0;
      const bad = (v: number) => !Number.isFinite(v);
      let dirty = bad(sim.time) || bad(sim.kills) || bad(sim.light) || bad(sim.player.x) || bad(sim.player.z) || bad(sim.player.hp);
      if (!dirty) for (const f of sim.foes) if (bad(f.x) || bad(f.z) || bad(f.hp)) { dirty = true; break; }
      if (!dirty) for (const q of sim.projectiles) if (bad(q.x) || bad(q.z)) { dirty = true; break; }
      if (!dirty) for (const m of sim.motes) if (bad(m.x) || bad(m.z)) { dirty = true; break; }
      if (dirty) rec.nanViolations++;
    }

    // end conditions
    if (sim.over) {
      rec.over = true;
      break;
    }
    if (!opts.noInput && rec.wavesCleared >= opts.waves) {
      if (tail < 0) tail = TAIL_SUBSTEPS;
      if (--tail <= 0) break;
    }
    if (sim.time >= opts.capSec) break;
  }

  rec.endHash = fnv1a(sim.serializeState());
  rec.finalTime = sim.time;
  rec.finalWave = sim.wave.n;
  rec.kills = sim.kills;
  rec.light = sim.light;
  return rec;
}

/* ------------------------------------------------------------------ */
/* main — assertions + receipts                                        */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
let targetWaves = 8;
let seeds = [7, 1234, 90210];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--waves') targetWaves = parseInt(args[i + 1] ?? '8', 10) || 8;
  if (args[i] === '--seeds') {
    const parsed = (args[i + 1] ?? '').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
    if (parsed.length >= 3) seeds = parsed;
  }
}

console.log(`=== AFTERGLOW M0 headless drive (waves=${targetWaves}, seeds=[${seeds.join(', ')}]) ===`);
const t0 = performance.now();

const recA = drive(seeds[0], { waves: targetWaves, noInput: false, capSec: 3600 });
const recB = drive(seeds[0], { waves: targetWaves, noInput: false, capSec: 3600 });
const recC = drive(seeds[1], { waves: targetWaves, noInput: false, capSec: 3600 });
const recD = drive(seeds[2], { waves: targetWaves, noInput: false, capSec: 3600 });

// assertion 9 — death path: no input, never dash, but drafts must be picked
let deathSeed = -1;
let deathTime = 0;
let deathWave = 0;
const deathRecs: DriveRec[] = [];
for (let s = 1; s <= 15 && deathSeed < 0; s++) {
  const r = drive(s, { waves: 999, noInput: true, capSec: DEATH_CAP_SEC });
  deathRecs.push(r);
  if (r.over) {
    deathSeed = s;
    deathTime = r.finalTime;
    deathWave = r.finalWave;
  }
}

const wallSec = (performance.now() - t0) / 1000;

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string): void => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
};

// 1. DETERMINISM — same seed twice: identical boundary states + end state
let detOk = recA.boundaryStrings.length === recB.boundaryStrings.length && recA.endHash === recB.endHash;
if (detOk) for (let i = 0; i < recA.boundaryStrings.length; i++) {
  if (recA.boundaryStrings[i] !== recB.boundaryStrings[i]) {
    detOk = false;
    break;
  }
}
check(
  '1 DETERMINISM',
  detOk,
  `seed ${seeds[0]} x2: ${recA.boundaryStrings.length} wave-clear boundaries + end identical (end hash ${recA.endHash})`,
);

// 2. DIVERGENCE — seed 7 vs seed 1234 differ by the wave-3 boundary
const divOk = recA.boundaryHashes.length > 2 && recC.boundaryHashes.length > 2 && recA.boundaryHashes[2] !== recC.boundaryHashes[2];
check(
  '2 DIVERGENCE  ',
  divOk,
  `wave-3 boundary: seed ${seeds[0]}=${recA.boundaryHashes[2] ?? '—'} vs seed ${seeds[1]}=${recC.boundaryHashes[2] ?? '—'}`,
);

// 3. NO-NAN — all positions/hp finite at every 1s batch in every run
const allRecs = [recA, recB, recC, recD, ...deathRecs];
const nanTotal = allRecs.reduce((n, r) => n + r.nanViolations, 0);
check('3 NO-NAN      ', nanTotal === 0, `${nanTotal} NaN violations across ${allRecs.length} runs / ${allRecs.reduce((n, r) => n + r.substeps, 0)} substeps`);

// 4. PROGRESSION — bot reaches wave >= target on seed 7
check(
  '4 PROGRESSION ',
  recA.wavesCleared >= targetWaves,
  `seed ${seeds[0]} cleared ${recA.wavesCleared} waves (target ${targetWaves}), final wave ${recA.finalWave}, ${recA.over ? 'DIED' : 'alive'} at t=${recA.finalTime.toFixed(0)}s`,
);

// 5. DRAFT INTEGRITY — one offer per clear, 3 distinct, pick changes mods + state
let draftOk = true;
const diag: string[] = [];
for (const r of [recA, recC, recD]) {
  const evOk = r.offerEvents === r.wavesCleared && r.waveClearEvents === r.wavesCleared;
  const distOk = r.offersBad === 0;
  const deltaOk = r.modsDeltas.length === r.picks && r.modsDeltas.every((v) => v);
  diag.push(`s${r.seed}[ev=${r.offerEvents}/${r.wavesCleared}/${r.waveClearEvents} bad=${r.offersBad} picks=${r.picks} deltas=${r.modsDeltas.filter((v) => v).length}]`);
  if (!evOk || !distOk || !deltaOk) draftOk = false;
}
check(
  '5 DRAFT       ',
  draftOk,
  `seed ${seeds[0]}: ${recA.wavesCleared} clears, ${recA.offerEvents} offers, ${recA.picks} picks, ${recA.modsDeltas.filter((v) => v).length} stat deltas | ${diag.join(' ')}`,
);

// 6. TELEGRAPH LAW — every husk charge preceded by >= 0.75s windup
const teleViol = allRecs.reduce((n, r) => n + r.teleViolations, 0);
const charges = allRecs.reduce((n, r) => n + r.chargeStarts, 0);
check('6 TELEGRAPH   ', teleViol === 0 && charges > 0, `${charges} husk charges observed, ${teleViol} windup violations (<0.75s)`);

// 7. ENTITIES BOUNDED — leak check across every run
const gMax = {
  foes: Math.max(...allRecs.map((r) => r.maxFoes)),
  projectiles: Math.max(...allRecs.map((r) => r.maxProjectiles)),
  motes: Math.max(...allRecs.map((r) => r.maxMotes)),
  arcs: Math.max(...allRecs.map((r) => r.maxArcs)),
  trails: Math.max(...allRecs.map((r) => r.maxTrails)),
};
const capsOk = gMax.foes <= CAPS.foes && gMax.projectiles <= CAPS.projectiles && gMax.motes <= CAPS.motes;
check(
  '7 ENTITIES    ',
  capsOk,
  `max foes ${gMax.foes}/${CAPS.foes}, projectiles ${gMax.projectiles}/${CAPS.projectiles}, motes ${gMax.motes}/${CAPS.motes} (arcs ${gMax.arcs}/${CAPS.arcs}, trails ${gMax.trails}/${CAPS.trails})`,
);

// 8. PILLARS — player center never inside pillar interior
const pilViol = allRecs.reduce((n, r) => n + r.pillarViolations, 0);
check('8 PILLARS     ', pilViol === 0, `${pilViol} interior violations across ${allRecs.length} runs`);

// 9. DEATH PATH — stationary, never dashing runner must die on some seed <= 15 within 15 sim-min
check(
  '9 DEATH PATH  ',
  deathSeed > 0,
  deathSeed > 0
    ? `seed ${deathSeed} died at wave ${deathWave}, t=${deathTime.toFixed(0)}s (cap ${DEATH_CAP_SEC}s); danger confirmed`
    : `no death on seeds 1-15 within ${DEATH_CAP_SEC}s — balance too safe`,
);

/* receipts */

console.log('\n=== AFTERGLOW M0 drive receipts ===');
const line = (label: string, r: DriveRec): void => {
  console.log(
    `seed ${String(r.seed).padEnd(6)} ${label.padEnd(10)} waves ${String(r.wavesCleared).padEnd(3)} kills ${String(r.kills).padEnd(5)} light ${String(r.light).padEnd(5)} ${r.over ? 'DIED ' : 'alive'} t=${r.finalTime.toFixed(0)}s substeps=${r.substeps}`,
  );
};
line('bot run A', recA);
line('bot run B', recB);
line('bot run C', recC);
line('bot run D', recD);
for (let i = 0; i < deathRecs.length; i++) line('no-input', deathRecs[i]);
console.log(`dash events (run A): ${recA.dashEvents}, wave starts: ${recA.waveStarts}`);
console.log(`wall time: ${wallSec.toFixed(2)}s`);

const passCount = results.filter((r) => r.pass).length;
console.log(`\n${passCount}/${results.length} assertions PASS`);
if (passCount !== results.length) {
  console.log('FAIL: AFTERGLOW M0 drive has failing assertions.');
  process.exit(1);
}
console.log('PASS: determinism, divergence, no-NaN, progression, draft, telegraph, bounds, pillars, death path — all verified headless.');
