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
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/65 backdrop-blur-[2px]">
        <div className="flex w-full max-w-3xl flex-col items-center gap-5 px-4">
          <h2
            className="hs-tracking text-center text-xl text-amber-50 sm:text-2xl"
            style={{ textShadow: '0 0 24px rgba(255,190,90,0.4)' }}
          >
            THE SHRINE OF DAWN
          </h2>
          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
            {boonChoices.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => getEngine()?.chooseBoon(i)}
                className="group flex flex-col gap-2 border bg-black/50 p-4 text-left transition-all hover:bg-amber-200/10 hover:shadow-[0_0_24px_rgba(255,190,90,0.25)]"
                style={{ borderColor: `${TIER_COLOR[b.tier]}55` }}
              >
                <span className="hs-tracking text-[9px] uppercase" style={{ color: TIER_COLOR[b.tier] }}>
                  {b.tier} · [{i + 1}]
                </span>
                <span className="hs-tracking text-sm text-amber-100">{b.name}</span>
                <span className="text-[11px] leading-4 text-amber-100/60">{b.desc}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => getEngine()?.chooseHeal()}
            disabled={embers >= 3}
            className="hs-tracking border border-amber-200/40 px-6 py-2.5 text-xs text-amber-100/90 transition-all hover:border-amber-200 hover:bg-amber-200/10 disabled:opacity-30"
          >
            MEND AN EMBER · [H]
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'paused') {
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
        <div className="flex flex-col items-center gap-3 text-center">
          <h2 className="hs-tracking text-2xl text-amber-50 sm:text-3xl" style={{ textShadow: '0 0 24px rgba(255,190,90,0.4)' }}>
            THE EMBER RESTS
          </h2>
          <button
            type="button"
            onClick={() => getEngine()?.resume()}
            className="hs-tracking w-56 border border-amber-200/50 px-6 py-3 text-sm text-amber-100 transition-all hover:border-amber-200 hover:bg-amber-200/10"
          >
            RESUME
          </button>
          <button
            type="button"
            onClick={() => getEngine()?.restart()}
            className="hs-tracking w-56 border border-amber-200/25 px-6 py-3 text-sm text-amber-100/80 transition-all hover:border-amber-200/60 hover:bg-amber-200/5"
          >
            RESTART RUN
          </button>
          <button
            type="button"
            onClick={() => getEngine()?.toggleMute()}
            className="hs-tracking w-56 border border-amber-200/25 px-6 py-3 text-sm text-amber-100/80 transition-all hover:border-amber-200/60 hover:bg-amber-200/5"
          >
            SOUND — {muted ? 'OFF' : 'ON'}
          </button>
          <button
            type="button"
            onClick={() => getEngine()?.abandon()}
            className="hs-tracking w-56 border border-red-400/25 px-6 py-3 text-xs text-red-200/80 transition-all hover:border-red-400/60 hover:bg-red-400/5"
          >
            ABANDON TO TITLE
          </button>
          <p className="hs-tracking mt-2 text-[10px] text-white/30">ESC — RESUME</p>
        </div>
      </div>
    );
  }

  if (phase === 'dead') {
    const isBest = score >= best && score > 0;
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-[2px]">
        <div className="flex flex-col items-center gap-4 text-center">
          <h2
            className={`hs-tracking text-3xl font-bold sm:text-4xl ${won ? 'text-amber-100' : 'text-red-200'}`}
            style={{ textShadow: won ? '0 0 40px rgba(255,210,120,0.7)' : '0 0 30px rgba(255,60,60,0.5)' }}
          >
            {won ? 'THE SUN REKINDLES' : 'THE EMBER FADES'}
          </h2>
          <div className="hs-tracking flex flex-col gap-1 text-sm text-amber-100/85">
            <span className="text-3xl font-bold tabular-nums text-amber-100 sm:text-4xl">{score.toLocaleString()}</span>
            <span className="text-[10px] text-amber-200/60">
              WAVE {wave} · BEST {best.toLocaleString()} · WAVE {bestWave}
            </span>
            <span className="mt-1 text-xs text-amber-300">
              +{dawnEarned} DAWN EMBERS · {dawn.toLocaleString()} BANKED
            </span>
            {isBest && !won && <span className="hs-pulse mt-1 text-xs text-amber-300">★ BRIGHTEST EMBER YET ★</span>}
          </div>
          <button
            type="button"
            onClick={() => getEngine()?.restart()}
            className="hs-tracking mt-2 border border-amber-200/60 bg-black/40 px-10 py-4 text-sm text-amber-100 transition-all hover:border-amber-200 hover:bg-amber-200/10 hover:shadow-[0_0_30px_rgba(255,190,90,0.35)]"
          >
            {won ? 'REKINDLE AGAIN' : 'REKINDLE'}
          </button>
          <p className="hs-tracking text-[10px] text-white/30">ENTER — REKINDLE · SPEND DAWN AT THE SHRINE</p>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black p-6 text-center">
        <div className="flex max-w-md flex-col gap-3">
          <h2 className="hs-tracking text-xl text-red-300">THE DARK CONSUMES ALL LIGHT</h2>
          <p className="text-sm text-white/60">
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
