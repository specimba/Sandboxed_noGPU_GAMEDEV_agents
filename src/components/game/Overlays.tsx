'use client';

import { getEngine } from '@/game/engine';
import { useGameStore } from '@/game/store';

export default function Overlays() {
  const phase = useGameStore((s) => s.phase);
  const webglError = useGameStore((s) => s.webglError);
  const score = useGameStore((s) => s.score);
  const best = useGameStore((s) => s.best);
  const bestWave = useGameStore((s) => s.bestWave);
  const wave = useGameStore((s) => s.wave);
  const muted = useGameStore((s) => s.muted);

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
            className="hs-tracking text-3xl font-bold text-red-200 sm:text-4xl"
            style={{ textShadow: '0 0 30px rgba(255,60,60,0.5)' }}
          >
            THE EMBER FADES
          </h2>
          <div className="hs-tracking flex flex-col gap-1 text-sm text-amber-100/85">
            <span className="text-3xl font-bold tabular-nums text-amber-100 sm:text-4xl">{score.toLocaleString()}</span>
            <span className="text-[10px] text-amber-200/60">
              WAVE {wave} · BEST {best.toLocaleString()} · WAVE {bestWave}
            </span>
            {isBest && <span className="hs-pulse mt-1 text-xs text-amber-300">★ BRIGHTEST EMBER YET ★</span>}
          </div>
          <button
            type="button"
            onClick={() => getEngine()?.restart()}
            className="hs-tracking mt-2 border border-amber-200/60 bg-black/40 px-10 py-4 text-sm text-amber-100 transition-all hover:border-amber-200 hover:bg-amber-200/10 hover:shadow-[0_0_30px_rgba(255,190,90,0.35)]"
          >
            REKINDLE
          </button>
          <p className="hs-tracking text-[10px] text-white/30">ENTER — REKINDLE</p>
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
