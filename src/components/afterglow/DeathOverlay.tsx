'use client';

import { useEffect } from 'react';
import { getAfterglowEngine } from '@/game/afterglow/engine';
import { useAfterglowStore } from '@/game/afterglow/store';

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Death overlay — THE LIGHT FADES. Run stats + one way back. */
export default function DeathOverlay() {
  const phase = useAfterglowStore((s) => s.phase);
  const runStats = useAfterglowStore((s) => s.runStats);

  useEffect(() => {
    if (phase !== 'dead') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        getAfterglowEngine()?.begin();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  if (phase !== 'dead') return null;

  return (
    <div className="ag-safe pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/72 backdrop-blur-[2px]">
      <div className="ag-fade flex w-full max-w-md flex-col items-center gap-5 px-6 py-8 text-center">
        <div aria-hidden="true" className="flex items-center gap-2.5">
          <span className="h-px w-14 bg-[rgba(255,90,74,0.4)] sm:w-20" />
          <span className="h-[6px] w-[6px] rotate-45 bg-[rgba(255,90,74,0.7)]" />
          <span className="h-px w-14 bg-[rgba(255,90,74,0.4)] sm:w-20" />
        </div>

        <h2
          className="hs-tracking text-3xl font-bold text-[#ffb1a6] sm:text-4xl"
          style={{ textShadow: '0 0 10px rgba(255,90,60,0.3)' }}
        >
          THE LIGHT FADES
        </h2>

        <p className="hs-tracking text-[10px] text-[#f2e6cf]/55 sm:text-xs">
          THE DARK KEEPS WHAT IT TAKES
        </p>

        <div className="hs-panel hs-frame w-full px-5 py-4">
          <span aria-hidden="true" className="hs-c" />
          <div className="flex flex-col divide-y divide-[rgba(255,196,120,0.1)]">
            {[
              ['WAVES SURVIVED', `WAVE ${runStats.wave}`],
              ['EMBER KILLS', `${runStats.kills}`],
              ['LIGHT GATHERED', `✦ ${runStats.light}`],
              ['BORROWED TIME', fmtTime(runStats.time)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 py-2.5">
                <span className="hs-tracking text-[9px] text-[#f2e6cf]/50 sm:text-[10px]">{label}</span>
                <span className="hs-tracking text-sm font-bold tabular-nums text-[#ffd98f] sm:text-base">{value}</span>
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => getAfterglowEngine()?.begin()}
          className="hs-frame hs-btn hs-tracking relative px-10 py-3.5 text-sm sm:text-base"
        >
          <span aria-hidden="true" className="hs-c" />
          KINDLE AGAIN
        </button>
      </div>
    </div>
  );
}
