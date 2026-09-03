/**
 * HOLLOW SUN headless QA — drives the pure sim under bun (no DOM, no three).
 * Proves: seed determinism, mutator application, bulwark block + backstab,
 * caster heavy shots, new-foe room composition, full-run room ladder.
 */
import { Sim, type SimEvents } from '../src/game/sim';
import { BOONS, isBossRoom, rollMutator } from '../src/game/run';
import { mulberry32 } from '../src/game/rng';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = ''): void {
  if (ok) {
    pass++;
    console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`);
  }
}

function silentEvents(): SimEvents {
  return {
    onThrow: () => {}, onBounce: () => {}, onCatch: () => {}, onKill: () => {},
    onGraze: () => {}, onHurt: () => {}, onDash: () => {}, onRecall: () => {},
    onShieldBreak: () => {}, onBlock: () => {}, onHeavyShot: () => {},
    onBossPhase: () => {}, onRevive: () => {}, onWardenSpawn: () => {},
    onWardenDie: () => {}, onWaveStart: () => {}, onWaveClear: () => {},
    onOverdriveStart: () => {}, onShardGain: () => {}, onDeath: () => {},
    onSpawnMark: () => {},
  };
}

const STEP = 1 / 60;

function runSteps(sim: Sim, steps: number, mx = 0, my = 0): void {
  for (let i = 0; i < steps; i++) sim.update(STEP, STEP, mx, my, sim.px, sim.pz - 5, false, false);
}

console.log('== 1. seed determinism ==');
{
  const a = new Sim(silentEvents());
  const b = new Sim(silentEvents());
  a.setSeed(4242); a.reset(); a.startRoom(1, 1);
  b.setSeed(4242); b.reset(); b.startRoom(1, 1);
  const sameQueue = JSON.stringify(a['spawnQueue']) === JSON.stringify(b['spawnQueue']);
  check('same seed → same spawn queue', sameQueue, `${a['spawnQueue'].length} foes`);
  check('same seed → same mutator', a.mutator.id === b.mutator.id, a.mutator.id || '(none)');
  const c = new Sim(silentEvents());
  c.setSeed(777); c.reset(); c.startRoom(1, 1);
  check('different seed → different structure', JSON.stringify(a['spawnQueue']) !== JSON.stringify(c['spawnQueue']) || a.mutator.id !== c.mutator.id);
}

console.log('== 2. mutator mods apply ==');
{
  let found = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const m = rollMutator(mulberry32(seed), 6);
    if (m.id) {
      found++;
      if (m.id === 'richveins') check('richveins score ×1.5', Math.abs(m.mods.score - 1.5) < 1e-9);
      if (m.id === 'glassrain') check('glassrain flag', m.mods.glassRain);
    }
  }
  check('mutators roll across seeds', found > 40, `${found}/400 rooms carry one`);
  // apply through a live sim
  const s = new Sim(silentEvents());
  s.setSeed(9); s.reset();
  s.startRoom(0, 1);
  const multBefore = s.mutator.mods.score;
  check('room 1 has clean weather (depth<3)', multBefore === 1 && !s.mutator.mods.glassRain);
}

console.log('== 3. bulwark blocks the front, dies to the back ==');
{
  const s = new Sim(silentEvents());
  s.setSeed(5); s.reset();
  // spawn bulwark right below the ember, facing it
  s['spawnFoe']('bulwark', 0, 6);
  const bw = s.foes[0];
  // burn the 0.7s spawn fade so contact damage is live
  runSteps(s, 50);
  // pin the armor facing +z (away from the incoming shard path)
  bw.face = 0;
  // frontal: shard flies from the ember side toward the armor face → dir ≈ (0,-1)
  s['shards'][0].state = 'fly';
  s['shards'][0].x = 0; s['shards'][0].z = bw.z + 4;
  s['shards'][0].vx = 0; s['shards'][0].vz = -47;
  s['shards'][0].flown = 0;
  s['shards'][0].targetId = -1;
  const hpBefore = bw.hp;
  runSteps(s, 20);
  check('frontal hit blocked (hp unchanged)', bw.hp === hpBefore, `hp ${hpBefore}→${bw.hp}`);
  check('block still feeds the chain', s.chain >= 1, `chain=${s.chain}`);
  // backstab: armor still facing +z, shard comes from behind (−z side) moving +z
  bw.face = 0;
  s['shards'][1].state = 'fly';
  s['shards'][1].x = 0; s['shards'][1].z = bw.z - 4;
  s['shards'][1].vx = 0; s['shards'][1].vz = 47;
  s['shards'][1].flown = 0;
  s['shards'][1].targetId = -1;
  runSteps(s, 30);
  check('backstab deals damage', bw.hp < hpBefore, `hp ${hpBefore}→${bw.hp}`);
}

console.log('== 4. caster locks, telegraphs, fires heavy ==');
{
  const s = new Sim(silentEvents());
  s.setSeed(11); s.reset();
  s['spawnFoe']('caster', -14, -8);
  runSteps(s, 35); // burn the 0.45s spawn fade
  const caster = s.foes[0];
  caster.timer = 0.01; // fire almost immediately
  runSteps(s, 20); // enter telegraph
  check('caster entered telegraph', caster.state === 1, `state=${caster.state}`);
  check('caster locked a target', caster.tx !== 0 || caster.tz !== 0, `lock=(${caster.tx.toFixed(1)},${caster.tz.toFixed(1)})`);
  runSteps(s, 60); // telegraph 0.5s + fire windup
  const heavy = s.bullets.find((b) => b.heavy);
  check('heavy lance in flight', !!heavy, heavy ? `v=${Math.hypot(heavy.vx, heavy.vz).toFixed(1)}u/s` : 'none');
  check('heavy is fast (21u/s)', !!heavy && Math.abs(Math.hypot(heavy.vx, heavy.vz) - 21) < 0.01);
}

console.log('== 5. deep rooms field the new families ==');
{
  const s = new Sim(silentEvents());
  s.setSeed(31337); s.reset();
  s.startRoom(2, 1); // global depth 7 — caster floor active
  check('depth 7 includes casters', s['spawnQueue'].includes('caster'), s['spawnQueue'].join(','));
  const s2 = new Sim(silentEvents());
  s2.setSeed(808); s2.reset();
  s2.startRoom(2, 2); // depth 8 — bulwark floor active
  check('depth 8 includes bulwarks', s2['spawnQueue'].includes('bulwark'), s2['spawnQueue'].join(','));
}

console.log('== 6. seeded boon drafts are reproducible ==');
{
  const taken: Record<string, number> = {};
  const a = BOONS.length; // touch import
  void a;
  const r1 = mulberry32(12345);
  const r2 = mulberry32(12345);
  const poolA = [0, 1, 2].map(() => { const i = Math.floor(r1() * BOONS.length); return BOONS[i].id; });
  const poolB = [0, 1, 2].map(() => { const i = Math.floor(r2() * BOONS.length); return BOONS[i].id; });
  check('twin rng streams match', JSON.stringify(poolA) === JSON.stringify(poolB));
  check('boon catalog intact', BOONS.length >= 12, `${BOONS.length} boons`);
  void taken;
}

console.log('== 7. full ladder smoke — seeded run to victory ==');
{
  const s = new Sim(silentEvents());
  s.setSeed(2024); s.reset();
  s.startRoom(0, 1);
  let roomsCleared = 0;
  let bossFights = 0;
  let guard = 0;
  while (roomsCleared < 9 && guard < 40000) {
    guard++;
    if (!s.waveActive && !s.over) {
      // engine would open the reward; pick boon 0 then advance
      const boon = BOONS[guard % BOONS.length];
      s.applyBoon(boon);
      roomsCleared++;
      const room = s.room + 1;
      let biome = s.biome;
      if (room > 3) { biome++; }
      if (biome > 2) break;
      s.startRoom(biome, room > 3 ? 1 : room);
    }
    // auto-kill everything via dash-strike pressure (player sits still, shards home)
    for (const f of s.foes.slice()) s['damageFoe'](f, 3);
    runSteps(s, 6);
    if (s.foes.some((f) => f.boss)) bossFights++;
    if (s.over) break;
  }
  check('ladder clears 9 rooms', roomsCleared >= 9, `cleared=${roomsCleared} guard=${guard}`);
  check('bosses appeared', bossFights > 0, `boss-frames=${bossFights}`);
  check('seed stayed locked', s.seed === 2024);
}

console.log(`\n== RESULT: ${pass} pass, ${fail} fail ==`);
if (fail > 0) process.exit(1);
