'use client';

import { useGameStore } from '@/game/store';

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
      {/* top center — score */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center">
        <div
          className="hs-tracking text-2xl font-bold tabular-nums text-amber-50 sm:text-3xl"
          style={{ textShadow: '0 0 18px rgba(255,190,90,0.45)' }}
        >
          {score.toLocaleString()}
        </div>
        <div className={`hs-tracking text-[10px] sm:text-xs ${mult > 1.01 ? 'text-amber-300' : 'text-amber-100/40'}`}>
          ×{mult.toFixed(1)} CHAIN
        </div>
      </div>

      {/* top left — room strip */}
      <div className="absolute left-4 top-4 flex flex-col gap-1">
        <span className="hs-tracking text-[10px] text-amber-200/70 sm:text-xs">{roomLabel}</span>
        {mutatorLabel && playing && (
          <span className="hs-tracking text-[10px] text-red-300/90 sm:text-xs">◆ {mutatorLabel}</span>
        )}
        {playing && enemiesLeft > 0 && (
          <span className="hs-tracking text-[10px] text-red-300/80 sm:text-xs">{enemiesLeft} REMAIN</span>
        )}
        <span className="hs-tracking text-[10px] text-amber-100/35">BEST {best.toLocaleString()}</span>
        {boonsTaken.length > 0 && (
          <span className="hs-tracking max-w-40 text-[9px] leading-4 text-amber-300/60 sm:max-w-52 sm:text-[10px]">
            {boonsTaken.join(' · ')}
          </span>
        )}
      </div>

      {/* boss bar */}
      {bossBar && (
        <div className="absolute left-1/2 top-16 w-72 -translate-x-1/2 sm:w-96">
          <div className="hs-tracking mb-1 text-center text-[10px] text-orange-200/90">{bossBar.name}</div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-red-700 via-orange-500 to-amber-300 transition-all duration-150"
              style={{ width: `${Math.round(bossBar.frac * 100)}%`, boxShadow: '0 0 14px rgba(255,120,50,0.8)' }}
            />
          </div>
        </div>
      )}

      {/* top right — sun rekindle */}
      <div className="absolute right-4 top-4 flex flex-col items-end gap-1">
        <span className="hs-tracking text-[10px] text-amber-200/70 sm:text-xs">THE SUN</span>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10 sm:w-32">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-200 transition-all duration-500"
            style={{ width: `${Math.round(sun * 100)}%`, boxShadow: '0 0 12px rgba(255,190,90,0.8)' }}
          />
        </div>
        <span className="hs-tracking text-[10px] tabular-nums text-amber-200/60">{Math.round(sun * 100)}%</span>
      </div>

      {/* bottom left — embers (hp) */}
      <div className="absolute bottom-5 left-4 flex items-center gap-2">
        <span className="hs-tracking mr-1 text-[10px] text-amber-100/50">EMBERS</span>
        {Array.from({ length: embersMax }).map((_, i) => (
          <span
            key={i}
            className="inline-block h-3 w-3 rotate-45 rounded-[2px] transition-all"
            style={
              i < embers
                ? { background: '#ffd27a', boxShadow: '0 0 12px rgba(255,190,90,0.9)' }
                : { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,210,122,0.25)' }
            }
          />
        ))}
      </div>

      {/* bottom right — shards + dash */}
      <div className="absolute bottom-5 right-4 flex items-center gap-2">
        <span className="hs-tracking mr-1 text-[10px] text-amber-100/50">SHARDS</span>
        {Array.from({ length: shardsMax }).map((_, i) => (
          <span
            key={i}
            className="inline-block h-2.5 w-2.5 rotate-45 rounded-[1px] transition-all"
            style={
              i < shards
                ? { background: '#ffe9bd', boxShadow: '0 0 10px rgba(255,220,150,0.9)' }
                : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,220,150,0.2)' }
            }
          />
        ))}
        <span
          className="hs-tracking ml-2 rounded border px-2 py-0.5 text-[10px] transition-all"
          style={
            dashReady >= 1
              ? { borderColor: 'rgba(255,220,150,0.6)', color: 'rgba(255,233,189,0.9)' }
              : { borderColor: 'rgba(255,220,150,0.18)', color: 'rgba(255,233,189,0.35)' }
          }
        >
          DASH
        </span>
      </div>

      {/* bottom center — overdrive meter */}
      <div className="absolute bottom-5 left-1/2 flex w-44 -translate-x-1/2 flex-col items-center gap-1 sm:w-56">
        <span
          className={`hs-tracking text-[10px] ${overdriveActive ? 'hs-pulse text-amber-200' : 'text-amber-100/40'}`}
        >
          {overdriveActive ? 'OVERDRIVE — THE WORLD SLOWS' : overdrive >= 0.999 ? 'OVERDRIVE READY' : 'GRAZE TO CHARGE'}
        </span>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full transition-all duration-150 ${overdriveActive ? 'bg-gradient-to-r from-amber-300 to-white' : 'bg-gradient-to-r from-orange-600 to-amber-300'}`}
            style={{
              width: `${Math.min(100, Math.round(overdrive * 100))}%`,
              boxShadow: overdrive >= 0.999 || overdriveActive ? '0 0 16px rgba(255,220,150,0.95)' : 'none',
            }}
          />
        </div>
      </div>

      {/* room / boss banner */}
      {banner && (
        <div key={banner.id} className="hs-banner absolute left-1/2 top-1/3 flex -translate-x-1/2 flex-col items-center gap-2">
          <span
            className={`hs-tracking text-3xl font-bold sm:text-5xl ${
              banner.kind === 'boss'
                ? 'text-orange-300'
                : banner.kind === 'overdrive'
                  ? 'text-amber-100'
                  : banner.kind === 'room'
                    ? 'text-amber-50'
                    : 'text-amber-50'
            }`}
            style={{ textShadow: '0 0 30px rgba(255,150,60,0.6)' }}
          >
            {banner.text}
          </span>
          <span className="hs-tracking text-[10px] text-amber-100/60 sm:text-xs">{banner.sub}</span>
        </div>
      )}

      {/* toasts */}
      <div className="absolute bottom-24 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`hs-toast hs-tracking rounded border px-3 py-1 text-[10px] backdrop-blur-sm sm:text-xs ${
              t.kind === 'gold'
                ? 'border-amber-300/40 bg-amber-950/60 text-amber-200'
                : t.kind === 'red'
                  ? 'border-red-400/40 bg-red-950/60 text-red-200'
                  : 'border-white/20 bg-black/50 text-white/80'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
