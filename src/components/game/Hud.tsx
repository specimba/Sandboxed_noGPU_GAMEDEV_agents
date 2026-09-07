'use client';

import { useGameStore } from '@/game/store';

const TOAST_CLS: Record<'gold' | 'red' | 'info', string> = {
  gold: 'border-[rgba(255,199,102,0.4)] bg-[rgba(46,32,12,0.72)] text-[#ffd98f]',
  red: 'border-[rgba(255,90,74,0.4)] bg-[rgba(46,12,9,0.72)] text-[#ffb1a6]',
  info: 'border-[rgba(255,196,120,0.22)] bg-[rgba(12,9,7,0.78)] text-[#f2e6cf]/80',
};

const BANNER_CLS: Record<string, string> = {
  boss: 'text-[#ff5a4a]',
  overdrive: 'text-[#ffc766]',
  room: 'text-[#f2e6cf]',
  wave: 'text-[#f2e6cf]',
  warden: 'text-[#f2e6cf]',
};

export default function Hud() {
  const phase = useGameStore((s) => s.phase);
  const score = useGameStore((s) => s.score);
  const best = useGameStore((s) => s.best);
  const enemiesLeft = useGameStore((s) => s.enemiesLeft);
  const mult = useGameStore((s) => s.mult);
  const shards = useGameStore((s) => s.shards);
  const shardsMax = useGameStore((s) => s.shardsMax);
  const embers = useGameStore((s) => s.embers);
  const embersMax = useGameStore((s) => s.embersMax);
  const dashReady = useGameStore((s) => s.dashReady);
  const overdrive = useGameStore((s) => s.overdrive);
  const overdriveActive = useGameStore((s) => s.overdriveActive);
  const sun = useGameStore((s) => s.sun);
  const banner = useGameStore((s) => s.banner);
  const toasts = useGameStore((s) => s.toasts);
  const roomLabel = useGameStore((s) => s.roomLabel);
  const mutatorLabel = useGameStore((s) => s.mutatorLabel);
  const bossBar = useGameStore((s) => s.bossBar);
  const boonsTaken = useGameStore((s) => s.boonsTaken);

  if (phase === 'loading' || phase === 'error' || phase === 'title') return null;

  const playing = phase === 'playing';

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      {/* top center — score in an engraved panel (hidden on death/shrine
          panels so the big score is never duplicated behind them) */}
      {phase !== 'dead' && phase !== 'reward' && (
        <div className="absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center">
          <div className="hs-panel flex items-center gap-3 px-4 py-1.5">
            <span aria-hidden="true" className="hs-hairline hs-hairline--bare w-6 sm:w-10" />
            <span className="sr-only">Score</span>
            <div
              className="hs-tracking text-xl font-bold tabular-nums text-[#f2e6cf] sm:text-2xl"
              style={{ textShadow: '0 0 8px rgba(255,190,90,0.35)' }}
            >
              {score.toLocaleString()}
            </div>
            <span aria-hidden="true" className="hs-hairline hs-hairline--bare w-6 sm:w-10" />
          </div>
          {mult > 1.01 && (
            <div className="hs-tracking mt-1.5 rounded-[2px] border border-[rgba(255,199,102,0.45)] bg-[rgba(46,32,12,0.72)] px-2 py-0.5 text-[9px] text-[#ffc766] sm:text-[10px]">
              ×{mult.toFixed(1)} CHAIN
            </div>
          )}
        </div>
      )}

      {/* top left — room strip, instrument micro-rows (drops below the
          centered score chip on narrow screens so the two never collide) */}
      <div className="hs-panel absolute left-3 top-14 flex max-w-40 flex-col divide-y divide-[rgba(255,196,120,0.1)] px-3 py-1.5 sm:top-3 sm:max-w-56">
        <span className="hs-tracking py-1 text-[10px] text-[#f2e6cf]/85 sm:text-[11px]">{roomLabel}</span>
        {mutatorLabel && playing && (
          <span className="hs-tracking py-1 text-[9px] text-[#ff5a4a] sm:text-[10px]">◆ {mutatorLabel}</span>
        )}
        {playing && enemiesLeft > 0 && (
          <span className="hs-tracking py-1 text-[9px] text-[#f2e6cf]/60 sm:text-[10px]">{enemiesLeft} REMAIN</span>
        )}
        <span className="hs-tracking py-1 text-[9px] text-[#f2e6cf]/40 sm:text-[10px]">
          BEST {best.toLocaleString()}
        </span>
        {boonsTaken.length > 0 && (
          <span className="hs-tracking max-w-36 py-1 text-[9px] leading-4 text-[#ffc766]/60 sm:max-w-48 sm:text-[10px]">
            {boonsTaken.join(' · ')}
          </span>
        )}
      </div>

      {/* boss bar — framed warden plate */}
      {bossBar && (
        <div className="absolute left-1/2 top-16 w-72 -translate-x-1/2 sm:w-96">
          <div className="hs-frame hs-panel px-3 pb-3 pt-2">
            <span aria-hidden="true" className="hs-c" />
            <div className="hs-tracking mb-2 text-center text-[10px] text-[#f2e6cf]/90">{bossBar.name}</div>
            <div className="relative h-[3px] w-full bg-[rgba(242,230,207,0.12)]">
              <div
                className="h-full bg-gradient-to-r from-[#ff5a4a] via-[#ff8a50] to-[#ffc766] transition-all duration-150"
                style={{ width: `${Math.round(bossBar.frac * 100)}%` }}
              />
              <span
                aria-hidden="true"
                className="absolute -left-[4px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 rotate-45 border border-[rgba(255,90,74,0.7)] bg-[rgba(12,9,7,0.9)]"
              />
              <span
                aria-hidden="true"
                className="absolute -right-[4px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 rotate-45 border border-[rgba(255,199,102,0.7)] bg-[rgba(12,9,7,0.9)]"
              />
            </div>
          </div>
        </div>
      )}

      {/* top right — the sun, notched rekindle meter */}
      <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
        <span className="hs-tracking text-[9px] text-[#f2e6cf]/60 sm:text-[10px]">THE SUN</span>
        <div className="hs-panel relative h-3 w-28 overflow-hidden sm:w-36">
          <span className="sr-only">Sun rekindled {Math.round(sun * 100)}%</span>
          <div
            className="h-full bg-gradient-to-r from-[#c9862f] to-[#ffc766] transition-all duration-500"
            style={{ width: `${Math.round(sun * 100)}%` }}
          />
          <span aria-hidden="true" className="hs-ticks pointer-events-none absolute inset-0" />
        </div>
        <span className="hs-tracking text-[9px] tabular-nums text-[#ffc766]/80">{Math.round(sun * 100)}%</span>
      </div>

      {/* bottom row — embers | shards as one flex row: overlap is impossible
          by construction (was two absolute panels colliding at ≤420px) */}
      <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
        <div className="hs-panel flex items-center gap-2 px-2.5 py-2 sm:gap-2.5 sm:px-3">
          <span className="hs-tracking text-[9px] text-[#f2e6cf]/55 sm:text-[10px]">EMBERS</span>
          <span aria-hidden="true" className="h-px w-3 bg-[rgba(255,196,120,0.25)]" />
          {Array.from({ length: embersMax }).map((_, i) => (
            <span key={i} className={`hs-pip ${i < embers ? 'hs-pip--on' : ''}`} />
          ))}
        </div>
        <div className="hs-panel flex items-center gap-2 px-2.5 py-2 sm:gap-2.5 sm:px-3">
          <span className="hs-tracking text-[9px] text-[#f2e6cf]/55 sm:text-[10px]">SHARDS</span>
          <span aria-hidden="true" className="h-px w-3 bg-[rgba(255,196,120,0.25)]" />
          {Array.from({ length: shardsMax }).map((_, i) => (
            <span key={i} className={`hs-pip hs-pip--sm ${i < shards ? 'hs-pip--on' : ''}`} />
          ))}
          <span
            className="hs-tracking ml-1 rounded-[2px] border px-2 py-0.5 text-[9px] transition-all sm:text-[10px]"
            style={
              dashReady >= 1
                ? { borderColor: 'rgba(255,199,102,0.6)', color: '#ffd98f', background: 'rgba(255,199,102,0.07)' }
                : { borderColor: 'rgba(255,196,120,0.18)', color: 'rgba(242,230,207,0.35)' }
            }
          >
            DASH
          </span>
        </div>
      </div>

      {/* bottom center — overdrive, 12-segment meter (lifted above the row
          on narrow screens, centered between the panels on wide ones) */}
      <div className="absolute bottom-16 left-1/2 flex w-44 -translate-x-1/2 flex-col items-center gap-1.5 sm:bottom-4 sm:w-64">
        <span
          className={`hs-tracking text-[9px] sm:text-[10px] ${
            overdriveActive
              ? 'hs-pulse text-[#fff3d6]'
              : overdrive >= 0.999
                ? 'text-[#ffc766]'
                : 'text-[#f2e6cf]/45'
          }`}
        >
          {overdriveActive
            ? 'OVERDRIVE — THE WORLD SLOWS'
            : overdrive >= 0.999
              ? 'OVERDRIVE READY'
              : 'GRAZE TO CHARGE'}
        </span>
        <div className="flex h-2 w-full gap-[2px]">
          {Array.from({ length: 12 }).map((_, i) => {
            const lit = overdrive * 12 >= i + 1;
            return (
              <span
                key={i}
                className={`hs-seg ${overdriveActive ? 'hs-seg--hot' : lit ? 'hs-seg--on' : ''}`}
              />
            );
          })}
        </div>
      </div>

      {/* room / boss banner — engraved caps between hairlines */}
      {banner && (
        <div
          key={banner.id}
          className="hs-banner absolute left-1/2 top-1/3 flex -translate-x-1/2 flex-col items-center gap-2.5"
        >
          <span aria-hidden="true" className="hs-hairline w-40 sm:w-60" />
          <span className={`hs-tracking px-4 text-center text-3xl font-bold sm:text-5xl ${BANNER_CLS[banner.kind]}`}>
            {banner.text}
          </span>
          <span className="hs-tracking text-[10px] text-[#f2e6cf]/60 sm:text-xs">{banner.sub}</span>
          <span aria-hidden="true" className="hs-hairline w-40 sm:w-60" />
        </div>
      )}

      {/* toasts — hairline chips */}
      <div className="absolute bottom-28 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5 sm:bottom-24">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`hs-toast hs-tracking rounded-[2px] border px-3 py-1.5 text-[10px] backdrop-blur-sm sm:text-xs ${TOAST_CLS[t.kind]}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
