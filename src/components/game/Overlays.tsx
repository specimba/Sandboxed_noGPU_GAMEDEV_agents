'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { getEngine } from '@/game/engine';
import { useGameStore, type RunRecap } from '@/game/store';
import { TIER_COLOR } from '@/game/run';
import { BUILD } from '@/game/version';

/** payout count-up — rewards TICK up, they don't teleport (sprint 17);
 *  sprint 20-4a adds an optional delay so recap rows stage in sequence */
function useCountUp(target: number, active: boolean, dur = 900, delay = 0): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let timer = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      // ease-out cubic — fast start, gentle settle
      setVal(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    if (delay > 0) {
      timer = window.setTimeout(() => {
        raf = requestAnimationFrame(tick);
      }, delay);
    } else {
      raf = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(raf);
      if (timer) window.clearTimeout(timer);
    };
  }, [target, active, dur, delay]);
  return active ? val : 0;
}

/** staged text row — fades in after `delay` ms (no new CSS classes needed:
 *  an inline transition over the existing opacity vocabulary) */
function Staged({ delay, children }: { delay: number; children: ReactNode }) {
  const [on, setOn] = useState(delay === 0);
  useEffect(() => {
    if (delay === 0) return;
    const t = window.setTimeout(() => setOn(true), delay);
    return () => window.clearTimeout(t);
  }, [delay]);
  return (
    <span className="transition-opacity duration-500" style={{ opacity: on ? 1 : 0 }}>
      {children}
    </span>
  );
}

/** RUN RECAP (sprint 20-4a) — the descent, recounted in staged count-ups */
function RunRecapRows({ recap }: { recap: RunRecap }) {
  const rooms = useCountUp(recap.rooms, true, 500, 200);
  const bosses = useCountUp(recap.bosses, true, 500, 500);
  return (
    <div className="mt-5 w-full">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="hs-hairline flex-1" />
        <span className="hs-tracking text-[9px] text-[#f2e6cf]/45">THE DESCENT, RECOUNTED</span>
        <span aria-hidden="true" className="hs-hairline flex-1" />
      </div>
      <div className="mt-2.5 grid w-full grid-cols-1 gap-y-2 text-left">
        <div className="flex items-baseline justify-between border-b border-[rgba(255,196,120,0.12)] pb-2">
          <span className="hs-tracking text-[9px] text-[#f2e6cf]/45">ROOMS CLEARED</span>
          <span className="text-xs tabular-nums text-[#f2e6cf]/85">{rooms}</span>
        </div>
        <div className="flex items-baseline justify-between border-b border-[rgba(255,196,120,0.12)] pb-2">
          <span className="hs-tracking text-[9px] text-[#f2e6cf]/45">BOSSES FELLED</span>
          <span className="text-xs tabular-nums text-[#f2e6cf]/85">{bosses}</span>
        </div>
        {recap.contracts > 0 && (
          <Staged delay={800}>
            <div className="flex items-baseline justify-between border-b border-[rgba(255,196,120,0.12)] pb-2">
              <span className="hs-tracking text-[9px] text-[#f2e6cf]/45">CONTRACTS FILLED</span>
              <span className="hs-tracking text-[10px] text-[#ffc766]">✓ {recap.contracts}</span>
            </div>
          </Staged>
        )}
        {recap.boons.length > 0 && (
          <Staged delay={1050}>
            <div className="flex items-baseline justify-between gap-3 border-b border-[rgba(255,196,120,0.12)] pb-2">
              <span className="hs-tracking shrink-0 text-[9px] text-[#f2e6cf]/45">BOONS TAKEN</span>
              <span className="hs-tracking max-w-[190px] text-right text-[9px] leading-4 text-[#ffc766]/70 sm:max-w-none sm:text-[10px]">
                {recap.boons.join(' · ')}
              </span>
            </div>
          </Staged>
        )}
        {recap.rites.length > 0 && (
          <Staged delay={1300}>
            <div className="flex items-baseline justify-between gap-3 border-b border-[rgba(255,196,120,0.12)] pb-2">
              <span className="hs-tracking shrink-0 text-[9px] text-[#f2e6cf]/45">RITES CARRIED</span>
              <span className="hs-tracking max-w-[190px] text-right text-[9px] leading-4 text-[#ffc766]/70 sm:max-w-none sm:text-[10px]">
                {recap.rites.join(' · ')}
              </span>
            </div>
          </Staged>
        )}
      </div>
    </div>
  );
}

/** the run payout, counted up in stages: score → dawn */
function DeathPayout() {
  const score = useGameStore((s) => s.score);
  const dawnEarned = useGameStore((s) => s.dawnEarned);
  const shownScore = useCountUp(score, true, 850);
  const shownDawn = useCountUp(dawnEarned, true, 650);
  return (
    <>
      <div
        className="mt-1 text-3xl font-bold tabular-nums text-[#f2e6cf] sm:text-4xl"
        style={{ textShadow: '0 0 8px rgba(255,190,90,0.3)' }}
      >
        {shownScore.toLocaleString()}
      </div>
      <div className="mt-1 h-4">
        {shownScore >= score && shownDawn < dawnEarned && (
          <span className="hs-tracking text-[10px] text-[#ffc766]">DAWN +{shownDawn}</span>
        )}
        {shownDawn >= dawnEarned && dawnEarned > 0 && (
          <span className="hs-pulse hs-tracking text-[10px] text-[#ffc766]">DAWN +{dawnEarned}</span>
        )}
      </div>
    </>
  );
}

export default function Overlays() {
  const phase = useGameStore((s) => s.phase);
  const webglError = useGameStore((s) => s.webglError);
  const score = useGameStore((s) => s.score);
  const best = useGameStore((s) => s.best);
  const bestWave = useGameStore((s) => s.bestWave);
  const wave = useGameStore((s) => s.wave);
  const muted = useGameStore((s) => s.muted);
  const boonChoices = useGameStore((s) => s.boonChoices);
  const riteChoices = useGameStore((s) => s.riteChoices);
  const won = useGameStore((s) => s.won);
  const dawnEarned = useGameStore((s) => s.dawnEarned);
  const dawn = useGameStore((s) => s.dawn);
  const embers = useGameStore((s) => s.embers);
  const embersMax = useGameStore((s) => s.embersMax);
  const seed = useGameStore((s) => s.seed);
  const recap = useGameStore((s) => s.recap);

  // keyboard: 1-3 pick boons, H heals
  useEffect(() => {
    if (phase !== 'reward') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Digit1') getEngine()?.chooseBoon(0);
      else if (e.code === 'Digit2') getEngine()?.chooseBoon(1);
      else if (e.code === 'Digit3') getEngine()?.chooseBoon(2);
      else if (e.code === 'KeyH' || e.code === 'Digit4') getEngine()?.chooseHeal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  // keyboard: 1-3 pick rites (sprint 19-a)
  useEffect(() => {
    if (phase !== 'rite') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Digit1') getEngine()?.chooseRite(0);
      else if (e.code === 'Digit2') getEngine()?.chooseRite(1);
      else if (e.code === 'Digit3') getEngine()?.chooseRite(2);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  if (phase === 'rite') {
    return (
      <div className="hs-overlay-scrim absolute inset-0 z-30 flex items-center justify-center px-4">
        <div className="flex w-full max-w-3xl flex-col items-center gap-5">
          {/* header between hairlines */}
          <div className="flex w-full items-center gap-4">
            <span aria-hidden="true" className="hs-hairline flex-1" />
            <h2 className="hs-tracking whitespace-nowrap text-sm text-[#ffc766] sm:text-base">
              RITE OF THE MANY SUNS
            </h2>
            <span aria-hidden="true" className="hs-hairline flex-1" />
          </div>
          <p className="hs-tracking text-center text-[9px] text-[#f2e6cf]/50">
            CHOOSE THE LAW THAT REWRITES THIS DESCENT — IT HOLDS UNTIL THE RUN ENDS
          </p>

          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
            {riteChoices.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => getEngine()?.chooseRite(i)}
                className="hs-frame hs-frame--lurk hs-panel relative flex flex-col gap-2 p-4 text-left transition-colors hover:border-[rgba(255,196,120,0.45)] hover:bg-[rgba(255,199,102,0.05)]"
              >
                <span aria-hidden="true" className="hs-c" />
                <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[2px]" style={{ background: '#ffc766' }} />
                <span className="flex items-center justify-between gap-2">
                  <span className="hs-tracking text-[9px] uppercase text-[#ffc766]">RITE</span>
                  <span className="hs-tracking rounded-[2px] border border-[#ffc76655] px-1.5 py-0.5 text-[9px] text-[#ffc766]">
                    [{i + 1}]
                  </span>
                </span>
                <span className="hs-tracking text-sm text-[#f2e6cf]">{r.name}</span>
                <span className="hs-tracking text-[9px] text-[#ffc766]/90">{r.law}</span>
                <span className="text-[11px] leading-4 text-[#f2e6cf]/60">{r.desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'reward') {
    return (
      <div className="hs-overlay-scrim absolute inset-0 z-30 flex items-center justify-center px-4">
        <div className="flex w-full max-w-3xl flex-col items-center gap-5">
          {/* header between hairlines */}
          <div className="flex w-full items-center gap-4">
            <span aria-hidden="true" className="hs-hairline flex-1" />
            <h2 className="hs-tracking whitespace-nowrap text-sm text-[#f2e6cf] sm:text-base">
              THE SHRINE OF DAWN
            </h2>
            <span aria-hidden="true" className="hs-hairline flex-1" />
          </div>

          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
            {boonChoices.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => getEngine()?.chooseBoon(i)}
                className="hs-frame hs-frame--lurk hs-panel relative flex flex-col gap-2 p-4 text-left transition-colors hover:border-[rgba(255,196,120,0.45)] hover:bg-[rgba(255,199,102,0.05)]"
              >
                <span aria-hidden="true" className="hs-c" />
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-[2px]"
                  style={{ background: TIER_COLOR[b.tier] }}
                />
                <span className="flex items-center justify-between gap-2">
                  <span className="hs-tracking text-[9px] uppercase" style={{ color: TIER_COLOR[b.tier] }}>
                    {b.tier}
                  </span>
                  <span
                    className="hs-tracking rounded-[2px] border px-1.5 py-0.5 text-[9px]"
                    style={{ borderColor: `${TIER_COLOR[b.tier]}55`, color: TIER_COLOR[b.tier] }}
                  >
                    [{i + 1}]
                  </span>
                </span>
                <span className="hs-tracking text-sm text-[#f2e6cf]">{b.name}</span>
                <span className="text-[11px] leading-4 text-[#f2e6cf]/60">{b.desc}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => getEngine()?.chooseHeal()}
            disabled={embers >= embersMax}
            className="hs-frame hs-btn hs-btn--quiet hs-tracking relative px-8 py-3 text-xs"
          >
            <span aria-hidden="true" className="hs-c" />
            MEND AN EMBER · [H]
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'paused') {
    return (
      <div className="hs-overlay-scrim absolute inset-0 z-30 flex items-center justify-center px-4">
        <div className="hs-frame hs-panel flex w-full max-w-xs flex-col items-center p-6 text-center">
          <span aria-hidden="true" className="hs-c" />
          <h2 className="hs-tracking text-lg text-[#f2e6cf] sm:text-xl">THE EMBER RESTS</h2>
          <span aria-hidden="true" className="hs-hairline my-5 w-full" />
          <button
            type="button"
            onClick={() => getEngine()?.resume()}
            className="hs-frame hs-btn hs-tracking relative w-full px-6 text-sm"
          >
            <span aria-hidden="true" className="hs-c" />
            RESUME
          </button>
          <button
            type="button"
            onClick={() => getEngine()?.restart()}
            className="hs-btn hs-btn--quiet hs-tracking mt-2.5 w-full px-6 text-sm"
          >
            RESTART RUN
          </button>
          <button
            type="button"
            onClick={() => getEngine()?.toggleMute()}
            className="hs-btn hs-btn--quiet hs-tracking mt-2.5 w-full px-6 text-sm"
          >
            SOUND — {muted ? 'OFF' : 'ON'}
          </button>
          <button
            type="button"
            onClick={() => getEngine()?.abandon()}
            className="hs-btn hs-btn--danger hs-tracking mt-2.5 w-full px-6 text-xs"
          >
            ABANDON TO TITLE
          </button>
          <p className="hs-tracking mt-4 text-[9px] text-[#f2e6cf]/30">ESC — RESUME</p>
        </div>
      </div>
    );
  }

  if (phase === 'dead') {
    const isBest = score >= best && score > 0;
    return (
      <div className="hs-overlay-scrim absolute inset-0 z-30 flex items-center justify-center px-4">
        <div className="hs-frame hs-panel flex w-full max-w-sm flex-col items-center px-6 py-8 text-center sm:px-8">
          <span aria-hidden="true" className="hs-c" />
          {/* hierarchy law: title > score > CTA > stats (was: giant score
              shouting down the title while REKINDLE drowned under the wall) */}
          <h2
            className={`hs-tracking text-2xl font-bold sm:text-3xl ${won ? 'text-[#ffc766]' : 'text-[#ff5a4a]'}`}
          >
            {won ? 'THE SUN REKINDLES' : 'THE EMBER FADES'}
          </h2>
          {/* sprint-20-4a — the killer is named in one breath */}
          {recap && !won && recap.killer && (
            <span className="hs-tracking mt-1 text-[10px] text-[#ff8a7a]/80 sm:text-[11px]">
              FELLED BY {recap.killer}
            </span>
          )}
          <span aria-hidden="true" className="hs-hairline my-4 w-full" />
          <span className="hs-tracking text-[9px] text-[#f2e6cf]/45">FINAL SCORE</span>
          <DeathPayout />
          {isBest && !won && (
            <span className="hs-pulse hs-tracking mt-1.5 text-xs text-[#ffc766]">★ BRIGHTEST EMBER YET ★</span>
          )}
          <button
            type="button"
            onClick={() => getEngine()?.restart()}
            className="hs-frame hs-btn hs-tracking relative mt-5 w-full px-8 text-sm sm:text-base"
          >
            <span aria-hidden="true" className="hs-c" />
            {won ? 'REKINDLE AGAIN' : 'REKINDLE'}
          </button>
          {won && (
            <p className="hs-tracking mt-2 text-[9px] text-[#ffc766]/70">
              THE CHOIR WAITS BELOW — 12 ROOMS NOW STAND BETWEEN YOU AND DAWN.
            </p>
          )}
          <div className="mt-5 grid w-full grid-cols-1 gap-y-2.5 text-left">
            <div className="flex items-baseline justify-between border-b border-[rgba(255,196,120,0.12)] pb-2">
              <span className="hs-tracking text-[9px] text-[#f2e6cf]/45">WAVE REACHED</span>
              <span className="text-xs tabular-nums text-[#f2e6cf]/85">{wave}</span>
            </div>
            <div className="flex items-baseline justify-between border-b border-[rgba(255,196,120,0.12)] pb-2">
              <span className="hs-tracking text-[9px] text-[#f2e6cf]/45">BRIGHTEST EMBER</span>
              <span className="text-xs tabular-nums text-[#f2e6cf]/85">
                {best.toLocaleString()} · WAVE {bestWave}
              </span>
            </div>
            {seed > 0 && (
              <div className="flex items-baseline justify-between border-b border-[rgba(255,196,120,0.12)] pb-2">
                <span className="hs-tracking text-[9px] text-[#f2e6cf]/45">SEED</span>
                <span className="text-xs tabular-nums text-[#f2e6cf]/60">{seed}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between">
              <span className="hs-tracking text-[9px] text-[#f2e6cf]/45">DAWN EMBERS</span>
              <span className="hs-tracking text-[10px] text-[#ffc766]">
                +{dawnEarned} · {dawn.toLocaleString()} BANKED
              </span>
            </div>
          </div>
          {recap && <RunRecapRows recap={recap} />}
          <p className="hs-tracking mt-4 text-[9px] text-[#f2e6cf]/30">
            ENTER — REKINDLE · SPEND DAWN AT THE SHRINE
          </p>
          <p className="hs-tracking mt-2 text-[8px] text-[#f2e6cf]/25">
            {BUILD.tag} · BASE {BUILD.base}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black p-6 text-center">
        <div className="flex max-w-md flex-col items-center gap-4">
          <h2 className="hs-tracking text-base text-[#ff5a4a] sm:text-lg">THE DARK CONSUMES ALL LIGHT</h2>
          <span aria-hidden="true" className="hs-hairline w-40" />
          <p className="text-sm leading-6 text-[#f2e6cf]/65">
            {webglError
              ? 'WebGL could not start on this device or browser. Try a hardware-accelerated browser (Chrome / Edge / Safari) with hardware acceleration enabled.'
              : 'Something went wrong while waking the star.'}
          </p>
        </div>
      </div>
    );
  }

  return null;
}
