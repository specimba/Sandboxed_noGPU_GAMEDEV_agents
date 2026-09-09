/**
 * HOLLOW SUN control harness (QA pipeline step) — the engine-side laws,
 * unit-driven headless. The owner directive: "any input-suppressing state
 * must carry a hard timeout that force-clears it. The player is never
 * unresponsively locked for more than the longest designed CC duration."
 *
 * Covers: CC failsafe clamps (pRootT / pSlowT AND the sprint-18 veilT
 * repair), dash-buffer law, design-time constants, the sprint-18 crown
 * record pins (RIME / CINDER / CROWN_DENSITY / FIRST_VOICE / biome-4 data),
 * and the sim-side root + veil semantics the engine watchdog relies on.
 *   bun run scripts/simdrive-controls.ts
 */
import { CC, CINDER, CROWN_DENSITY, FEEL, FIRST_VOICE, HEX, PLAYER, RIME, RUN, WAVES } from '../src/game/constants';
import { ccFailsafe, dashBufferStep } from '../src/game/control';
import { Sim, type SimEvents } from '../src/game/sim';

const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}

/* ---- design-time constants law ---- */
assert(FEEL.dashBuffer === 0.12, `FEEL.dashBuffer drifted to ${FEEL.dashBuffer}`);
assert(CC.rootMax === 0.8, `CC.rootMax drifted to ${CC.rootMax}`);
assert(CC.slowMax === 2.0, `CC.slowMax drifted to ${CC.slowMax}`);
assert(CC.failsafeFactor === 2, `CC.failsafeFactor drifted to ${CC.failsafeFactor}`);
assert(CC.veilTime === 1.4, `CC.veilTime drifted to ${CC.veilTime}`);
assert(CC.veilCap === 1.6, `CC.veilCap drifted to ${CC.veilCap}`);
assert(FEEL.hitstopMax >= 0.16, `FEEL.hitstopMax below the law ceiling (${FEEL.hitstopMax})`);
assert(HEX.rootDur === CC.rootMax, 'HEX.rootDur and CC.rootMax must stay in lockstep');
assert(HEX.telegraph > PLAYER.dashTime, 'the hex telegraph must outlast a dash (escape law)');

/* ---- sprint 18 crown record pins (data-driven affix + endgame data) ---- */
assert(RIME.radius === 5.5, `RIME.radius drifted to ${RIME.radius}`);
assert(RIME.hpMult === 1.4, `RIME.hpMult drifted to ${RIME.hpMult}`);
assert(RIME.rim === 0x9adfff, `RIME.rim drifted to ${RIME.rim}`);
assert(CINDER.maxPatches === 3, `CINDER.maxPatches drifted to ${CINDER.maxPatches}`);
assert(CINDER.life === 2.6, `CINDER.life drifted to ${CINDER.life}`);
assert(CINDER.radius === 1.5, `CINDER.radius drifted to ${CINDER.radius}`);
assert(CINDER.tick === 0.55, `CINDER.tick drifted to ${CINDER.tick}`);
assert(CINDER.interval === 0.8, `CINDER.interval drifted to ${CINDER.interval}`);
assert(CINDER.moveGate === 0.5, `CINDER.moveGate drifted to ${CINDER.moveGate}`);
assert(CINDER.hpMult === 1.4, `CINDER.hpMult drifted to ${CINDER.hpMult}`);
assert(CINDER.rim === 0xff7a3d, `CINDER.rim drifted to ${CINDER.rim}`);
assert(
  CROWN_DENSITY.length === 4 && CROWN_DENSITY[0] === 0 && CROWN_DENSITY[1] === 0.22 && CROWN_DENSITY[2] === 0.4 && CROWN_DENSITY[3] === 0.55,
  `CROWN_DENSITY drifted to [${CROWN_DENSITY.join(', ')}]`,
);
assert(
  FIRST_VOICE.dashCd === 12 && FIRST_VOICE.telegraph === 0.7 && FIRST_VOICE.dashSpeed === 30 && FIRST_VOICE.dashTime === 0.45 && FIRST_VOICE.exposedTime === 1.2,
  `FIRST_VOICE drifted: ${JSON.stringify(FIRST_VOICE)}`,
);
assert(RUN.biomes.length === 4 && RUN.biomes[3] === 'THE PALE CHOIR', `RUN.biomes drifted to [${RUN.biomes.join(', ')}]`);
assert(RUN.bossNames.length === 4 && RUN.bossNames[3] === 'THE FIRST VOICE', `RUN.bossNames drifted to [${RUN.bossNames.join(', ')}]`);
assert(WAVES.bossHp.length === 4 && WAVES.bossHp[3] === 73, `WAVES.bossHp drifted to [${WAVES.bossHp.join(', ')}] (+13/biome law → 73)`);

/* ---- ccFailsafe: the hard-timeout law ---- */
{
  const t = { pRootT: 99, pSlowT: 99 };
  const fired = ccFailsafe(t);
  assert(fired.includes('pRootT') && fired.includes('pSlowT'), 'ccFailsafe did not report both runaway timers');
  assert(t.pRootT === CC.rootMax * CC.failsafeFactor, `pRootT clamped to ${t.pRootT}, expected 1.6`);
  assert(t.pSlowT === CC.slowMax * CC.failsafeFactor, `pSlowT clamped to ${t.pSlowT}, expected 4.0`);

  const ok = { pRootT: 0.5, pSlowT: 1.0 };
  const firedOk = ccFailsafe(ok);
  assert(firedOk.length === 0, 'ccFailsafe fired on in-range timers');
  assert(ok.pRootT === 0.5 && ok.pSlowT === 1.0, 'ccFailsafe mutated in-range timers');

  const partial = { pRootT: 50 };
  const firedPartial = ccFailsafe(partial);
  assert(firedPartial.length === 1 && firedPartial[0] === 'pRootT', 'partial timer set misfired');
  assert(partial.pRootT === 1.6, 'partial clamp wrong');

  // sprint 18 REPAIR — the veil is watched under its real name: the player
  // slow field is sim.veilT, and the rime aura writes it too, so the
  // seatbelt must clamp it at CC.veilCap × factor
  const vt = { veilT: 99 };
  const firedVeil = ccFailsafe(vt);
  assert(firedVeil.length === 1 && firedVeil[0] === 'veilT', 'ccFailsafe did not fire on a runaway veilT');
  assert(vt.veilT === CC.veilCap * CC.failsafeFactor, `veilT clamped to ${vt.veilT}, expected ${CC.veilCap * CC.failsafeFactor}`);

  const okVeil = { pRootT: 0.2, pSlowT: 1.0, veilT: CC.veilCap };
  assert(ccFailsafe(okVeil).length === 0, 'ccFailsafe fired on an in-range veilT');
  assert(okVeil.veilT === CC.veilCap, 'ccFailsafe mutated an in-range veilT');
}

/* ---- dashBufferStep: the edge is never silently eaten ---- */
{
  // a) edge while cd ∈ (0, 0.12]: buffered, not delivered (the buffer starts
  //    ticking the frame it's set, so its value is already < 0.12)
  let st = dashBufferStep(0, 0.05, true, 1 / 60);
  assert(st.bufT > 0 && st.bufT <= 0.12 && !st.wantDash, 'edge inside the buffer window was not buffered');

  // b) buffered + cd clears → auto-fire exactly once
  st = dashBufferStep(0.12, 0, false, 1 / 60);
  assert(st.wantDash && st.bufT === 0, 'buffered dash did not fire when the cooldown cleared');

  // c) edge while cd far from ready → passes through (sim guard owns it)
  st = dashBufferStep(0, 0.5, true, 1 / 60);
  assert(st.wantDash && st.bufT === 0, 'edge far from ready was swallowed by the buffer');

  // d) buffer expires without a ready dash
  st = dashBufferStep(0.12, 0.09, false, 0.2);
  assert(st.bufT === 0 && !st.wantDash, 'stale buffer fired or lingered');
}

/* ---- sim integration: the root the watchdog guards ---- */
{
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
  };
  const s = new Sim(ev, {});
  s.reset();
  s.setSeed(1);
  s.startRoom(0, 1);

  // the engine force-feeds a runaway bind (simulated defect upstream)
  s.pRootT = 99;
  const fired = ccFailsafe(s);
  assert(fired.length === 1 && fired[0] === 'pRootT', 'engine watchdog failed to fire on the sim');
  assert(s.pRootT === 1.6, 'watchdog clamp did not write back to the sim');

  // sprint 18: the watchdog guards the VEIL under its real name too — a
  // runaway rime aura / herald chime can never outlive cap × factor
  s.veilT = 99;
  const firedVeil = ccFailsafe(s);
  assert(firedVeil.includes('veilT'), 'watchdog ignored sim.veilT');
  assert(s.veilT === CC.veilCap * CC.failsafeFactor, 'veil clamp did not write back to the sim');

  // the root ticks on PLAYER time and expires naturally
  s.pRootT = 0.8;
  for (let i = 0; i < 60; i++) s.update(1 / 60, 1 / 60, 1, 0, s.px + 4, s.pz, false, true);
  assert(s.pRootT === 0, `root did not expire under player time (${s.pRootT})`);

  // room transitions wipe CC state
  s.pRootT = 0.8;
  s.hexes.push({ x: 1, z: 1, t: 0.5, weaverId: 99 });
  s.startRoom(0, 1);
  assert(s.pRootT === 0 && s.hexes.length === 0, 'startRoom left CC state behind');
}

console.log('=== HOLLOW SUN control harness (failsafe + dash buffer + root law + sprint-18 crown pins) ===');
if (failures.length > 0) {
  console.log('\nFAIL:');
  for (const f of failures) console.log(` ✗ ${f}`);
  process.exit(1);
}
console.log('PASS: constants + crown records pinned, failsafe clamps (root/slow/veil), dash buffer law, root lifecycle clean.');
