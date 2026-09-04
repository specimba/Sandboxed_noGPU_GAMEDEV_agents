'use client';

import { useEffect } from 'react';
import { getEngine } from '@/game/engine';
import { useGameStore } from '@/game/store';
import { TIER_COLOR } from '@/game/run';

export default function Overlays() {
  const phase = useGameStore((s) => s.phase);
  const webglError = useGameStore((s) => s.webglError);
  const score = useGameStore((s) => s.score);
  const best = useGameStore((s) => s.best);
  const bestWave = useGameStore((s) => s.bestWave);
  const wave = useGameStore((s) => s.wave);
  const muted = useGameStore((s) => s.muted);
  const boonChoices = useGameStore((s) => s.boonChoices);
  const won = useGameStore((s) => s.won);
  const dawnEarned = useGameStore((s) => s.dawnEarned);
  const dawn = useGameStore((s) => s.dawn);
  const embers = useGameStore((s) => s.embers);
  const embersMax = useGameStore((s) => s.embersMax);
  const seed = useGameStore((s) => s.seed);

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

  if (phase === 'reward') {
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 px-4 backdrop-blur-[2px]">
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
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 px-4 backdrop-blur-[2px]">
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
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 px-4 backdrop-blur-[2px]">
        <div className="hs-frame hs-panel flex w-full max-w-sm flex-col items-center px-6 py-8 text-center sm:px-8">
          <span aria-hidden="true" className="hs-c" />
          <h2
            className={`hs-tracking text-2xl font-bold sm:text-3xl ${won ? 'text-[#ffc766]' : 'text-[#ff5a4a]'}`}
          >
            {won ? 'THE SUN REKINDLES' : 'THE EMBER FADES'}
          </h2>
          <span aria-hidden="true" className="hs-hairline my-5 w-full" />
          <div
            className="text-4xl font-bold tabular-nums text-[#f2e6cf] sm:text-5xl"
            style={{ textShadow: '0 0 8px rgba(255,190,90,0.3)' }}
          >
            {score.toLocaleString()}
          </div>
          <div className="mt-5 flex w-full flex-col text-left">
            <div className="flex items-baseline justify-between border-b border-[rgba(255,196,120,0.12)] py-2">
              <span className="hs-tracking text-[9px] text-[#f2e6cf]/45">WAVE REACHED</span>
              <span className="text-xs tabular-nums text-[#f2e6cf]/85">{wave}</span>
            </div>
            <div className="flex items-baseline justify-between border-b border-[rgba(255,196,120,0.12)] py-2">
              <span className="hs-tracking text-[9px] text-[#f2e6cf]/45">BRIGHTEST EMBER</span>
              <span className="text-xs tabular-nums text-[#f2e6cf]/85">
                {best.toLocaleString()} · WAVE {bestWave}
              </span>
            </div>
            {seed > 0 && (
              <div className="flex items-baseline justify-between border-b border-[rgba(255,196,120,0.12)] py-2">
                <span className="hs-tracking text-[9px] text-[#f2e6cf]/45">SEED</span>
                <span className="text-xs tabular-nums text-[#f2e6cf]/60">{seed}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between py-2">
              <span className="hs-tracking text-[9px] text-[#f2e6cf]/45">DAWN EMBERS</span>
              <span className="hs-tracking text-[10px] text-[#ffc766]">
                +{dawnEarned} · {dawn.toLocaleString()} BANKED
              </span>
            </div>
          </div>
          {isBest && !won && (
            <span className="hs-pulse hs-tracking mt-1 text-xs text-[#ffc766]">★ BRIGHTEST EMBER YET ★</span>
          )}
          <button
            type="button"
            onClick={() => getEngine()?.restart()}
            className="hs-frame hs-btn hs-tracking relative mt-5 w-full px-8 text-sm sm:text-base"
          >
            <span aria-hidden="true" className="hs-c" />
            {won ? 'REKINDLE AGAIN' : 'REKINDLE'}
          </button>
          <p className="hs-tracking mt-4 text-[9px] text-[#f2e6cf]/30">
            ENTER — REKINDLE · SPEND DAWN AT THE SHRINE
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
