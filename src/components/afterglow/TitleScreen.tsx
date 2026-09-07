'use client';

import { useEffect } from 'react';
import { getAfterglowEngine } from '@/game/afterglow/engine';
import { useAfterglowStore } from '@/game/afterglow/store';

export default function TitleScreen() {
  const phase = useAfterglowStore((s) => s.phase);
  const muted = useAfterglowStore((s) => s.muted);
  const webglError = useAfterglowStore((s) => s.webglError);
  const runStats = useAfterglowStore((s) => s.runStats);

  useEffect(() => {
    if (phase !== 'title') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        getAfterglowEngine()?.begin();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  if (phase !== 'title') return null;

  const hasRun = runStats.wave > 0;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/80" />
      <div className="ag-safe pointer-events-auto relative flex max-h-full w-full max-w-2xl flex-col items-center gap-5 overflow-y-auto px-6 py-8 text-center">

        {/* kicker between hairlines */}
        <div className="flex w-full max-w-xs items-center gap-3 sm:max-w-sm">
          <span aria-hidden="true" className="hs-hairline flex-1" />
          <p className="hs-tracking whitespace-nowrap text-[9px] text-[#f2e6cf]/55 sm:text-[10px]">
            A DEAD SUN&rsquo;S LAST ARENA
          </p>
          <span aria-hidden="true" className="hs-hairline flex-1" />
        </div>

        {/* wordmark — the one sanctioned halo */}
        <h1
          className="hs-flicker text-6xl leading-none font-bold text-[#f2e6cf] sm:text-7xl md:text-8xl"
          style={{ textShadow: '0 0 8px rgba(255,190,90,0.35)' }}
        >
          AFTERGLOW
        </h1>

        {/* subtitle */}
        <p className="hs-tracking text-[11px] text-[#ffc766]/85 sm:text-xs">
          THE LAST LIGHT AFTER A DEAD SUN
        </p>

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
          Every wave survived is borrowed time, every choice is light spent.
          Position well — GLIMMER fires itself — and spend what the dark drops.
        </p>

        {/* one engraved control strip */}
        <div className="hs-panel hs-tracking flex max-w-full flex-wrap items-center justify-center gap-x-2.5 gap-y-1 px-4 py-2 text-[9px] text-[#f2e6cf]/60 sm:text-[10px]">
          <span>WASD — MOVE</span>
          <span aria-hidden="true" className="text-[#ffc766]/40">·</span>
          <span>SPACE / SHIFT — DASH</span>
          <span aria-hidden="true" className="text-[#ffc766]/40">·</span>
          <span>GLIMMER FIRES ITSELF</span>
        </div>

        {/* CTA row */}
        <div className="mt-1 flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => getAfterglowEngine()?.begin()}
            className="hs-frame hs-btn hs-tracking relative px-10 py-3.5 text-sm sm:text-base"
          >
            <span aria-hidden="true" className="hs-c" />
            {hasRun ? 'BURN AGAIN' : 'BEGIN'}
          </button>
          <button
            type="button"
            onClick={() => getAfterglowEngine()?.toggleMute()}
            aria-pressed={muted}
            className="hs-btn hs-btn--quiet hs-tracking min-w-[44px] px-5 py-3 text-[11px] sm:text-xs"
          >
            {muted ? 'SOUND — OFF' : 'SOUND — ON'}
          </button>
        </div>

        {webglError && (
          <p className="hs-tracking text-[10px] text-[#ff8a75]">WEBGL UNAVAILABLE — THE LIGHT CANNOT BURN HERE</p>
        )}

        {/* last run footnote */}
        {hasRun && (
          <p className="hs-tracking text-[9px] text-[#f2e6cf]/45 sm:text-[10px]">
            <span className="text-[#ffc766]/70">LAST LIGHT</span> — WAVE {runStats.wave} · {runStats.kills} KILLS · ✦{runStats.light}
          </p>
        )}

        {/* the 3D descent — the main product */}
        <a
          href="/"
          className="hs-tracking text-[9px] text-[#f2e6cf]/35 underline decoration-[rgba(255,196,120,0.25)] underline-offset-4 transition-colors hover:text-[#f2e6cf]/60 sm:text-[10px]"
        >
          EMBER RITE — THE 3D DESCENT
        </a>
      </div>
    </div>
  );
}
