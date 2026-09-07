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
      {/* AI-generated obsidian texture (assetgen SDK tier) — subtle stone wash */}
      <div aria-hidden="true" className="hs-title-tex absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/80" />
      <div className="pointer-events-auto relative flex max-h-full w-full max-w-2xl flex-col items-center gap-5 overflow-y-auto px-6 py-8 text-center">

        {/* kicker between hairlines */}
        <div className="flex w-full max-w-xs items-center gap-3 sm:max-w-sm">
          <span aria-hidden="true" className="hs-hairline flex-1" />
          <p className="hs-tracking whitespace-nowrap text-[9px] text-[#f2e6cf]/55 sm:text-[10px]">
            A DESCENT INTO THE DEAD STAR
          </p>
          <span aria-hidden="true" className="hs-hairline flex-1" />
        </div>

        {/* wordmark — the one sanctioned halo */}
        <h1
          className="hs-flicker text-6xl leading-none font-bold text-[#f2e6cf] sm:text-7xl md:text-8xl"
          style={{ textShadow: '0 0 8px rgba(255,190,90,0.35)' }}
        >
          HOLLOW SUN
        </h1>

        {/* engraved rule + diamond glyph row */}
        <div aria-hidden="true" className="flex items-center gap-2.5">
          <span className="h-px w-14 bg-[rgba(255,196,120,0.3)] sm:w-20" />
          <span className="h-[5px] w-[5px] rotate-45 bg-[rgba(255,199,102,0.45)]" />
          <span className="h-[7px] w-[7px] rotate-45 bg-[rgba(255,199,102,0.8)]" />
          <span className="h-[5px] w-[5px] rotate-45 bg-[rgba(255,199,102,0.45)]" />
          <span className="h-px w-14 bg-[rgba(255,196,120,0.3)] sm:w-20" />
        </div>

        {/* pitch */}
        <p className="max-w-md text-[11px] leading-5 text-[#f2e6cf]/70 sm:text-xs">
          Three biomes. Nine rooms. Throw shards of light that ricochet between
          enemies and return — graze fire to charge Overdrive — every point
          rekindles the cracked star.
        </p>

        {/* one engraved control strip */}
        <div className="hs-panel hs-tracking flex max-w-full flex-wrap items-center justify-center gap-x-2.5 gap-y-1 px-4 py-2 text-[9px] text-[#f2e6cf]/60 sm:text-[10px]">
          <span>WASD — DRIFT</span>
          <span aria-hidden="true" className="text-[#ffc766]/40">·</span>
          <span>MOUSE — AIM</span>
          <span aria-hidden="true" className="text-[#ffc766]/40">·</span>
          <span>CLICK / F — THROW</span>
          <span aria-hidden="true" className="text-[#ffc766]/40">·</span>
          <span>SHIFT — DASH + RECALL</span>
        </div>

        {/* CTA row */}
        <div className="mt-1 flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => getEngine()?.begin()}
            className="hs-frame hs-btn hs-tracking relative px-10 py-3.5 text-sm sm:text-base"
          >
            <span aria-hidden="true" className="hs-c" />
            BEGIN THE REKINDLING
          </button>
          <button
            type="button"
            onClick={() => setShrineOpen((v) => !v)}
            aria-expanded={shrineOpen}
            className="hs-btn hs-btn--quiet hs-tracking px-5 py-3 text-[11px] sm:text-xs"
          >
            SHRINE OF DAWN — ✦ {dawn.toLocaleString()}
          </button>
        </div>

        {/* shrine ledger */}
        {shrineOpen && (
          <div className="hs-panel w-full max-w-md p-4 text-left sm:p-5">
            <p className="hs-tracking text-[9px] leading-4 text-[#f2e6cf]/50 sm:text-[10px]">
              DAWN EMBERS PERSIST BETWEEN RUNS — SPEND THEM ON PERMANENT POWER
            </p>
            <div className="mt-2 flex flex-col">
              {SHRINE_UPGRADES.map((u) => {
                const owned = !!unlocked[u.id];
                const afford = dawn >= u.cost;
                return (
                  <button
                    key={u.id}
                    type="button"
                    disabled={owned || !afford}
                    onClick={() => getEngine()?.buyUpgrade(u.id)}
                    className={`flex items-center justify-between gap-3 border-b border-[rgba(255,196,120,0.12)] px-1 py-2.5 text-left last:border-b-0 ${
                      owned
                        ? 'cursor-default bg-[rgba(255,199,102,0.05)]'
                        : afford
                          ? 'transition-colors hover:bg-[rgba(255,199,102,0.06)]'
                          : 'cursor-not-allowed opacity-40'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={`h-[6px] w-[6px] shrink-0 rotate-45 ${
                          owned
                            ? 'bg-[#ffc766]'
                            : afford
                              ? 'border border-[rgba(255,199,102,0.55)]'
                              : 'border border-[rgba(242,230,207,0.25)]'
                        }`}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="hs-tracking text-[11px] text-[#f2e6cf]">{u.name}</span>
                        <span className="text-[10px] leading-4 text-[#f2e6cf]/50">{u.desc}</span>
                      </span>
                    </span>
                    <span
                      className={`hs-tracking whitespace-nowrap text-[10px] ${
                        owned ? 'text-[#ffc766]' : 'text-[#ffc766]/70'
                      }`}
                    >
                      {owned ? '✦ KEPT' : `✦ ${u.cost}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* footer */}
        {(best > 0 || bestWave > 1) && (
          <p className="hs-tracking text-[9px] text-[#f2e6cf]/45 sm:text-[10px]">
            <span className="text-[#ffc766]/70">BRIGHTEST EMBER</span> —{' '}
            {best.toLocaleString()} PTS · WAVE {bestWave}
          </p>
        )}
        <p className="hs-tracking text-[9px] text-[#f2e6cf]/35 sm:text-[10px]">
          {touch
            ? 'TOUCH: STICK TO DRIFT · BUTTONS TO THROW & DASH'
            : 'HEADPHONES RECOMMENDED — THE SUN SINGS BACK'}
        </p>

        {/* systems lab — the top-down survivor experiment */}
        <a
          href="/?lab=afterglow"
          className="hs-tracking text-[9px] text-[#f2e6cf]/35 underline decoration-[rgba(255,196,120,0.25)] underline-offset-4 transition-colors hover:text-[#f2e6cf]/60 sm:text-[10px]"
        >
          AFTERGLOW — SYSTEMS LAB
        </a>
      </div>
    </div>
  );
}
