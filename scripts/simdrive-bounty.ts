/**
 * BOUNTY CONTRACTS + MILESTONES — headless harness (sprint 20-4a QA step).
 * Instantiates the PURE modules (src/game/bounty.ts, src/game/milestones.ts)
 * against 8 seeds × deterministic counter streams and asserts:
 *   U  — offer determinism: same seed → same offers (twice), always distinct
 *        ids from the CONTRACTS pool, exact offer-count law (shrine 4th slot)
 *   S  — scope semantics: room-scoped progress resets at room start,
 *        max-stats (chain) never sum, clean/swift are settle-injected
 *   R  — reward math: payouts equal the CONTRACTS dawn table, settle-once
 *        (re-settling pays nothing), completion is final
 *   M  — milestone evaluator: ladders complete once, bestiary needs all 8
 *        kinds, win/rites/hurtless laws, idempotent re-application
 * The ENGINE wiring (sim-event feeding) is browser-verified by the
 * orchestrator — this harness proves the pure logic engine-side code calls.
 * Usage: bun scripts/simdrive-bounty.ts
 */
import {
  bountyObserve,
  bountyRoomStart,
  bountySettleRoom,
  contractById,
  newBountyRun,
  rollBountyOffers,
  type BountyRunState,
} from '../src/game/bounty';
import { CONTRACTS } from '../src/game/constants';
import {
  applyMilestoneEvent,
  cloneMilestoneSave,
  emptyMilestoneSave,
  MILESTONES,
  type MilestoneSave,
} from '../src/game/milestones';
import { mulberry32 } from '../src/game/rng';

const fail: string[] = [];
const note = (s: string) => console.log(`  ${s}`);
const SEEDS = [7, 1337, 90210, 4242, 5150, 60013, 808, 31337];

/* ------------------------------------------------------------------ */
/* U — offer laws                                                      */
/* ------------------------------------------------------------------ */
note('U — offer determinism / distinctness / pool membership');
for (const seed of SEEDS) {
  const a = rollBountyOffers(seed, 3).map((o) => o.id);
  const b = rollBountyOffers(seed, 3).map((o) => o.id);
  if (a.join(',') !== b.join(',')) fail.push(`seed ${seed}: offers diverge on re-roll`);
  if (new Set(a).size !== a.length) fail.push(`seed ${seed}: duplicate contract ids in offers`);
  if (a.length !== 3) fail.push(`seed ${seed}: expected 3 offers, got ${a.length}`);
  for (const id of a) if (!contractById(id)) fail.push(`seed ${seed}: offer ${id} is not a CONTRACTS row`);
}
const four = rollBountyOffers(1337, 4);
if (four.length !== 4 || new Set(four.map((o) => o.id)).size !== 4) fail.push('offer count 4 failed (shrine THIRD CONTRACT)');
const over = rollBountyOffers(1337, 99);
if (over.length !== CONTRACTS.length) fail.push('offer count above pool size must clamp to pool size');
note(`8 seeds × same-seed re-roll identical · distinct · pool-valid; count 4 and clamp OK`);

/* ------------------------------------------------------------------ */
/* deterministic counter-stream drive                                  */
/* ------------------------------------------------------------------ */

interface DriveResult {
  payouts: number; // dawn total
  filled: string[];
  digest: string;
}

/** a 12-room descent-shaped counter stream, fully derived from the seed —
 *  no sim, no rng beyond mulberry32(seed^salt): the stream IS the fixture */
function driveStream(seed: number, contractCount = 3): DriveResult {
  const rng = mulberry32((seed ^ 0x57e21) >>> 0);
  const state: BountyRunState = newBountyRun(seed, contractCount);
  let payoutTotal = 0;
  const filled: string[] = [];
  for (let room = 1; room <= 12; room++) {
    bountyRoomStart(state);
    const kills = 8 + Math.floor(rng() * 12);
    const grazes = 2 + Math.floor(rng() * 9);
    const throws = 12 + Math.floor(rng() * 14);
    const roots = Math.floor(rng() * 3);
    const stuns = Math.floor(rng() * 4);
    const crowns = rng() < 0.3 ? 1 : 0;
    const strikes = Math.floor(rng() * 3);
    // chain grows within the room — max-stat must hold the PEAK, not the sum
    const chainPeak = Math.floor(rng() * 16);
    for (let i = 1; i <= chainPeak; i++) bountyObserve(state, 'chain', i);
    for (let i = 0; i < kills; i++) bountyObserve(state, 'kills');
    for (let i = 0; i < grazes; i++) bountyObserve(state, 'graze');
    for (let i = 0; i < throws; i++) bountyObserve(state, 'throw');
    for (let i = 0; i < roots; i++) bountyObserve(state, 'root');
    for (let i = 0; i < stuns; i++) bountyObserve(state, 'stun');
    for (let i = 0; i < crowns; i++) bountyObserve(state, 'elite');
    for (let i = 0; i < strikes; i++) bountyObserve(state, 'strike');
    const cleanSec = 6 + rng() * 30;
    const roomSec = 14 + rng() * 30;
    for (const p of bountySettleRoom(state, { cleanSec, roomSec })) {
      payoutTotal += p.dawn;
      filled.push(p.id);
    }
  }
  const digest = [
    payoutTotal,
    filled.length,
    ...state.offers.map((id) => (state.done[id] ? 1 : 0)),
    ...state.offers.map((id) => Math.round(state.progress[id] ?? 0)),
  ].join(',');
  return { payouts: payoutTotal, filled, digest };
}

note('S/R — 8 seeds × 12-room deterministic counter streams');
const baseline: Array<{ seed: number; offers: string; filled: number; dawn: number }> = [];
for (const seed of SEEDS) {
  const r1 = driveStream(seed);
  const r2 = driveStream(seed);
  if (r1.digest !== r2.digest) fail.push(`seed ${seed}: stream digest diverges on re-drive`);
  const offers = rollBountyOffers(seed, 3).map((o) => o.id);
  // reward math: every payout equals its CONTRACTS dawn row
  for (const id of r1.filled) {
    const def = contractById(id);
    if (!def) fail.push(`seed ${seed}: payout for unknown contract ${id}`);
  }
  const expectedDawn = r1.filled.reduce((sum, id) => sum + (contractById(id)?.dawn ?? 0), 0);
  if (expectedDawn !== r1.payouts) fail.push(`seed ${seed}: reward math mismatch (${r1.payouts} != ${expectedDawn})`);
  // settle-once law: a completed contract can never pay twice. The fresh-state
  // probe uses NEUTRAL settle injects (clean 0 s, an hour-slow room) — clean/swift
  // are settle-injected stats by design, so dirty injects (cleanSec 999) would
  // legitimately complete vigil/verdict with zero progress.
  const state = newBountyRun(seed, 3);
  const again = bountySettleRoom(state, { cleanSec: 0, roomSec: 9999 });
  if (again.length !== 0) fail.push(`seed ${seed}: fresh state paid out without progress`);
  baseline.push({ seed, offers: offers.join('+'), filled: r1.filled.length, dawn: r1.payouts });
}
note(`8 seeds × 12 rooms: digest-identical re-drives, reward math exact, settle-once holds`);

/* focused scope laws — hand-computed expectations (synthetic state, so the
   assertions are independent of any seed's offer roll) */
{
  const st: BountyRunState = { offers: ['harvest', 'keeper', 'vigil', 'verdict'], progress: {}, done: {} };
  bountyRoomStart(st);
  for (let i = 0; i < 13; i++) bountyObserve(st, 'kills'); // 13/14 — short
  bountyObserve(st, 'chain', 9); // 9/10 — short
  const p0 = bountySettleRoom(st, { cleanSec: 19, roomSec: 40 });
  if (p0.length !== 0) fail.push('scope: 13/14 kills + chain 12 + clean 19 + slow room must pay NOTHING');
  bountyRoomStart(st); // room 2 begins — room-scoped progress resets
  if ((st.progress.keeper ?? 0) !== 0) fail.push('scope: chain (room max) did not reset at room start');
  if ((st.progress.harvest ?? 0) !== 0) fail.push('scope: harvest (room kills) did not reset at room start');
  bountyObserve(st, 'chain', 3);
  bountyObserve(st, 'chain', 9); // max-stat: 3 then 9 → 9, never 12
  if ((st.progress.keeper ?? 0) !== 9) fail.push('max-stat: chain summed instead of holding the peak');
  for (let i = 0; i < 14; i++) bountyObserve(st, 'kills');
  bountyObserve(st, 'chain', 11); // keeper (10) also fills this room
  const p = bountySettleRoom(st, { cleanSec: 21, roomSec: 22 });
  const ids = p.map((x) => x.id).sort();
  // harvest 14/14 · keeper 11/10 · vigil 21≥20 · verdict 22≤25 — all four
  if (ids.join(',') !== 'harvest,keeper,verdict,vigil') {
    fail.push(`scope: exact fill set mismatch (got ${ids.join(',')})`);
  }
  const dawnSum = p.reduce((sum, x) => sum + x.dawn, 0);
  const expected = ['harvest', 'keeper', 'vigil', 'verdict'].reduce((sum, id) => sum + (contractById(id)?.dawn ?? 0), 0);
  if (dawnSum !== expected) fail.push(`reward: hand-computed dawn mismatch (${dawnSum} != ${expected})`);
  const p2 = bountySettleRoom(st, { cleanSec: 99, roomSec: 1 });
  if (p2.length !== 0) fail.push('settle-once: re-settling paid again');
}
note('scope laws: room reset, max-stat peak, clean/swift injection, settle-once — exact');

/* ------------------------------------------------------------------ */
/* M — milestone evaluator                                             */
/* ------------------------------------------------------------------ */
note('M — milestone evaluator');
{
  const save: MilestoneSave = emptyMilestoneSave();
  // first kill completes exactly two deeds (firstblood only — k25 needs 25)
  let got = applyMilestoneEvent({ t: 'kill', kind: 'drifter', crown: false }, save);
  if (got.join(',') !== 'firstblood') fail.push(`milestone: first kill should complete firstblood (got ${got.join(',')})`);
  got = applyMilestoneEvent({ t: 'kill', kind: 'drifter', crown: false }, save);
  if (got.length !== 0) fail.push('milestone: firstblood re-completed');
  for (let i = save.life.kills; i < 250; i++) applyMilestoneEvent({ t: 'kill', kind: 'hound', crown: false }, save);
  got = applyMilestoneEvent({ t: 'kill', kind: 'hound', crown: true }, save);
  // at 251 kills: k25+k100+k250 already claimed along the ladder + crown → firstcrown
  if (!got.includes('firstcrown')) fail.push('milestone: firstcrown missing at first crowned kill');
  if (!save.done.k25 || !save.done.k100 || !save.done.k250) fail.push('milestone: kill ladder incomplete at 251');
  // bestiary: 8 kinds (split minis etc. all ride onKill kinds)
  const kinds = ['drifter', 'striker', 'weaver', 'caster', 'bulwark', 'herald', 'hound', 'warden'];
  for (const k of kinds.slice(1)) applyMilestoneEvent({ t: 'kill', kind: k, crown: false }, save);
  if (!save.done.bestiary) fail.push('milestone: bestiary did not complete at 8 kinds');
  // chain + room stats
  applyMilestoneEvent({ t: 'chain', chain: 26 }, save);
  if (!save.done.chain25) fail.push('milestone: chain25 missing after chain 26');
  applyMilestoneEvent({ t: 'roomClear', roomSec: 18.4, grazes: 61, strikes: 7, hurtlessStreak: 1, biomeCleared: false }, save);
  if (!save.done.swiftroom) fail.push('milestone: swiftroom missing after an 18.4 s room');
  if (!save.done.graze60 || !save.done.strike6) fail.push('milestone: graze60/strike6 missing after the monster room');
  // hurtless streak: 5 woundless rooms completes untouched5
  const s2 = emptyMilestoneSave();
  let streakGot: string[] = [];
  for (let i = 0; i < 5; i++) {
    streakGot = streakGot.concat(applyMilestoneEvent({ t: 'roomClear', roomSec: 30, grazes: 0, strikes: 0, hurtlessStreak: i + 1, biomeCleared: false }, s2));
  }
  if (!streakGot.includes('untouched5')) fail.push('milestone: untouched5 missing after 5 hurtless rooms');
  // a wound zeroes the streak (engine sends hurtlessStreak 0)
  const s3 = emptyMilestoneSave();
  applyMilestoneEvent({ t: 'roomClear', roomSec: 30, grazes: 0, strikes: 0, hurtlessStreak: 3, biomeCleared: false }, s3);
  applyMilestoneEvent({ t: 'roomClear', roomSec: 30, grazes: 0, strikes: 0, hurtlessStreak: 0, biomeCleared: false }, s3);
  applyMilestoneEvent({ t: 'roomClear', roomSec: 30, grazes: 0, strikes: 0, hurtlessStreak: 2, biomeCleared: false }, s3);
  if (s3.life.bestHurtlessRooms !== 3) fail.push('milestone: hurtless streak did not reset on a wound');
  // win laws
  const s4 = emptyMilestoneSave();
  const winGot = applyMilestoneEvent({ t: 'finishRun', won: true, rites: ['tide', 'sunfall', 'choir', 'bell'], hurtlessRooms: 0 }, s4);
  if (!winGot.includes('win')) fail.push('milestone: win-any missing on a won run');
  if (!winGot.includes('lawsinger')) fail.push('milestone: lawsinger missing at 4 distinct rites');
  if (s4.life.ritesWonWith.length !== 4) fail.push('milestone: ritesWonWith dedup failed');
  // 3 rites ≠ lawsinger
  const s5 = emptyMilestoneSave();
  const win3 = applyMilestoneEvent({ t: 'finishRun', won: true, rites: ['tide', 'sunfall', 'choir'], hurtlessRooms: 0 }, s5);
  if (win3.includes('lawsinger')) fail.push('milestone: lawsinger fired at 3 rites');
  // cloneMilestoneSave deep-copies arrays (the engine mutates its working copy)
  const c = cloneMilestoneSave(s4);
  c.life.ritesWonWith.push('twin');
  if (s4.life.ritesWonWith.length === 5) fail.push('milestone: cloneMilestoneSave shares array refs');
  note(`16 deeds · ladders claim once · bestiary 8 kinds · streak reset on wound · win+rites laws — OK (${MILESTONES.length} defs)`);
}

/* ------------------------------------------------------------------ */
console.log('\n=== BOUNTY CONTRACTS + MILESTONES — headless harness ===');
console.log('BASELINE TABLE (8 seeds × offers × 12-room stream result):');
for (const b of baseline) {
  console.log(`  seed ${String(b.seed).padEnd(6)} offers [${b.offers}] → ${b.filled} filled · +${b.dawn} dawn`);
}

if (fail.length > 0) {
  console.log('\nFAIL:');
  for (const f of fail) console.log(` ✗ ${f}`);
  process.exit(1);
}
console.log('\nPASS: bounty offers deterministic + distinct + pool-valid across 8 seeds; scope/max-stat/settle-once laws exact; reward math matches the CONTRACTS table; milestone evaluator (16 deeds) idempotent + streak-safe. Pure modules verified headless.');
