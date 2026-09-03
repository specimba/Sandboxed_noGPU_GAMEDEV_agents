'use client';

import { useEffect } from 'react';
import { getEngine } from '@/game/engine';
import { useGameStore } from '@/game/store';

export default function TitleScreen() {
  const phase = useGameStore((s) => s.phase);
  const best = useGameStore((s) => s.best);
  const bestWave = useGameStore((s) => s.bestWave);
  const touch = useGameStore((s) => s.touch);

  useEffect(() => {
    if (phase !== 'title') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        getEngine()?.begin();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  if (phase !== 'title') return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/80" />
      <div className="pointer-events-auto relative flex max-h-full flex-col items-center gap-5 overflow-y-auto px-6 py-8 text-center">
        <p className="hs-tracking text-[10px] text-amber-200/60 sm:text-xs">A DESCENT INTO THE DEAD STAR</p>
        <h1
          className="hs-flicker text-5xl font-bold text-amber-50 sm:text-7xl md:text-8xl"
          style={{ textShadow: '0 0 34px rgba(255,190,90,0.55), 0 0 90px rgba(255,120,40,0.25)' }}
        >
          HOLLOW SUN
        </h1>
        <p className="hs-tracking max-w-xl text-xs leading-6 text-amber-100/75 sm:text-sm">
          YOU ARE THE LAST EMBER. YOUR SHARDS OF LIGHT RICOCHET BETWEEN ENEMIES AND
          RETURN LIKE BOOMERANGS. GRAZE THEIR FIRE TO CHARGE OVERDRIVE — EVERY POINT
          YOU SCORE REKINDLES THE CRACKED STAR.
        </p>

        <div className="hs-tracking grid grid-cols-2 gap-x-8 gap-y-2 text-[10px] text-amber-100/60 sm:text-xs">
          <span className="rounded border border-amber-200/25 px-2 py-1">WASD · DRIFT</span>
          <span className="rounded border border-amber-200/25 px-2 py-1">MOUSE · AIM</span>
          <span className="rounded border border-amber-200/25 px-2 py-1">CLICK / F · THROW</span>
          <span className="rounded border border-amber-200/25 px-2 py-1">SHIFT / SPACE · DASH</span>
        </div>

        <button
          type="button"
          onClick={() => getEngine()?.begin()}
          className="hs-tracking mt-2 border border-amber-200/60 bg-black/40 px-10 py-4 text-sm text-amber-100 transition-all hover:border-amber-200 hover:bg-amber-200/10 hover:shadow-[0_0_30px_rgba(255,190,90,0.35)] sm:text-base"
        >
          BEGIN THE REKINDLING
        </button>

        {(best > 0 || bestWave > 1) && (
          <p className="hs-tracking text-[10px] text-amber-200/50 sm:text-xs">
            BRIGHTEST EMBER — {best.toLocaleString()} PTS · WAVE {bestWave}
          </p>
        )}
        <p className="hs-tracking text-[10px] text-amber-100/35">
          {touch ? 'TOUCH: STICK TO DRIFT · BUTTONS TO THROW & DASH' : 'HEADPHONES RECOMMENDED — THE SUN SINGS BACK'}
        </p>
      </div>
    </div>
  );
}
