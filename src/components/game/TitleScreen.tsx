'use client';

import { useEffect, useState } from 'react';
import { getEngine } from '@/game/engine';
import { SHRINE_UPGRADES } from '@/game/run';
import { useGameStore } from '@/game/store';

export default function TitleScreen() {
  const phase = useGameStore((s) => s.phase);
  const best = useGameStore((s) => s.best);
  const bestWave = useGameStore((s) => s.bestWave);
  const touch = useGameStore((s) => s.touch);
  const dawn = useGameStore((s) => s.dawn);
  const unlocked = useGameStore((s) => s.unlocked);
  const [shrineOpen, setShrineOpen] = useState(false);

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
      <div className="pointer-events-auto relative flex max-h-full flex-col items-center gap-4 overflow-y-auto px-6 py-6 text-center">
        <p className="hs-tracking text-[10px] text-amber-200/60 sm:text-xs">A DESCENT INTO THE DEAD STAR</p>
        <h1
          className="hs-flicker text-5xl font-bold text-amber-50 sm:text-7xl md:text-8xl"
          style={{ textShadow: '0 0 34px rgba(255,190,90,0.55), 0 0 90px rgba(255,120,40,0.25)' }}
        >
          HOLLOW SUN
        </h1>
        <p className="hs-tracking max-w-xl text-xs leading-6 text-amber-100/75 sm:text-sm">
          THREE BIOMES. NINE ROOMS. THROW SHARDS OF LIGHT THAT RICOCHET BETWEEN
          ENEMIES AND RETURN — GRAZE FIRE TO CHARGE OVERDRIVE — EVERY POINT
          REKINDLES THE CRACKED STAR.
        </p>

        <div className="hs-tracking grid grid-cols-2 gap-x-8 gap-y-2 text-[10px] text-amber-100/60 sm:text-xs">
          <span className="rounded border border-amber-200/25 px-2 py-1">WASD · DRIFT</span>
          <span className="rounded border border-amber-200/25 px-2 py-1">MOUSE · AIM</span>
          <span className="rounded border border-amber-200/25 px-2 py-1">CLICK / F · THROW</span>
          <span className="rounded border border-amber-200/25 px-2 py-1">SHIFT · DASH + RECALL</span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => getEngine()?.begin()}
            className="hs-tracking border border-amber-200/60 bg-black/40 px-10 py-4 text-sm text-amber-100 transition-all hover:border-amber-200 hover:bg-amber-200/10 hover:shadow-[0_0_30px_rgba(255,190,90,0.35)] sm:text-base"
          >
            BEGIN THE REKINDLING
          </button>
          <button
            type="button"
            onClick={() => setShrineOpen((v) => !v)}
            className="hs-tracking border border-amber-200/25 bg-black/30 px-5 py-4 text-xs text-amber-100/80 transition-all hover:border-amber-200/60 hover:bg-amber-200/5"
          >
            SHRINE OF DAWN — ✦ {dawn.toLocaleString()}
          </button>
        </div>

        {shrineOpen && (
          <div className="w-full max-w-md rounded border border-amber-200/20 bg-black/60 p-4">
            <p className="hs-tracking mb-3 text-[10px] text-amber-200/60">
              DAWN EMBERS PERSIST BETWEEN RUNS — SPEND THEM ON PERMANENT POWER
            </p>
            <div className="flex flex-col gap-2">
              {SHRINE_UPGRADES.map((u) => {
                const owned = !!unlocked[u.id];
                const afford = dawn >= u.cost;
                return (
                  <button
                    key={u.id}
                    type="button"
                    disabled={owned || !afford}
                    onClick={() => getEngine()?.buyUpgrade(u.id)}
                    className={`flex items-center justify-between gap-3 rounded border px-3 py-2 text-left transition-all ${
                      owned
                        ? 'border-amber-300/40 bg-amber-300/10'
                        : afford
                          ? 'border-amber-200/30 hover:border-amber-200/70 hover:bg-amber-200/10'
                          : 'border-white/10 opacity-40'
                    }`}
                  >
                    <span className="flex flex-col">
                      <span className="hs-tracking text-[11px] text-amber-100">{u.name}</span>
                      <span className="text-[10px] text-amber-100/50">{u.desc}</span>
                    </span>
                    <span className="hs-tracking whitespace-nowrap text-[10px] text-amber-300">
                      {owned ? '✦ KEPT' : `✦ ${u.cost}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
