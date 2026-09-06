'use client';

import { useAfterglowStore } from '@/game/afterglow/store';

const TOAST_CLS: Record<'gold' | 'red' | 'info', string> = {
  gold: 'border-[rgba(255,199,102,0.4)] bg-[rgba(46,32,12,0.72)] text-[#ffd98f]',
  red: 'border-[rgba(255,90,74,0.4)] bg-[rgba(46,12,9,0.72)] text-[#ffb1a6]',
  info: 'border-[rgba(255,196,120,0.22)] bg-[rgba(12,9,7,0.78)] text-[#f2e6cf]/80',
};

const PHASE_LABEL: Record<string, string> = {
  intro: 'THEY GATHER',
  combat: '',
  draft: 'CHOOSE THE LIGHT',
  breather: 'BREATHE',
  idle: '',
};

/** AFTERGLOW HUD — engraved obsidian panels, ember ink, bone type. */
export default function Hud() {
  const phase = useAfterglowStore((s) => s.phase);
  const wave = useAfterglowStore((s) => s.wave);
  const wavePhase = useAfterglowStore((s) => s.wavePhase);
  const foesLeft = useAfterglowStore((s) => s.foesLeft);
  const hp = useAfterglowStore((s) => s.hp);
  const maxHp = useAfterglowStore((s) => s.maxHp);
  const shield = useAfterglowStore((s) => s.shield);
  const light = useAfterglowStore((s) => s.light);
  const kills = useAfterglowStore((s) => s.kills);
  const dashReady = useAfterglowStore((s) => s.dashReady);
  const volleys = useAfterglowStore((s) => s.volleys);
  const banner = useAfterglowStore((s) => s.banner);
  const toasts = useAfterglowStore((s) => s.toasts);

  if (phase === 'title') return null;

  const hpFrac = Math.max(0, Math.min(1, hp / maxHp));
  const low = hpFrac <= 0.3;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      {/* top left — the light's hp bar + ward pips */}
      <div className="hs-panel absolute left-3 top-3 flex flex-col gap-1.5 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="hs-tracking text-[9px] text-[#f2e6cf]/55 sm:text-[10px]">THE LIGHT</span>
          <span className="hs-tracking text-[9px] tabular-nums text-[#ffc766]/80 sm:text-[10px]">
            {Math.ceil(hp)}/{maxHp}
          </span>
        </div>
        <div className="relative h-[5px] w-32 bg-[rgba(242,230,207,0.1)] sm:w-40">
          <div
            className={`h-full transition-all duration-150 ${
              low
                ? 'bg-gradient-to-r from-[#ff5a4a] to-[#ff8a50] hs-pulse'
                : 'bg-gradient-to-r from-[#c9862f] via-[#ffb454] to-[#ffd98f]'
            }`}
            style={{ width: `${Math.round(hpFrac * 100)}%` }}
          />
        </div>
        {shield > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="hs-tracking text-[8px] text-[#ffe9a0]/80 sm:text-[9px]">WARD</span>
            {Array.from({ length: Math.max(1, shield) }).map((_, i) => (
              <span key={i} className="hs-pip hs-pip--sm hs-pip--on" />
            ))}
          </div>
        )}
      </div>

      {/* top center — wave banner */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="hs-hairline hs-hairline--bare w-8 sm:w-12" />
          <span
            className="hs-tracking text-xl font-bold tabular-nums text-[#f2e6cf] sm:text-2xl"
            style={{ textShadow: '0 0 8px rgba(255,190,90,0.35)' }}
          >
            WAVE {wave}
          </span>
          <span aria-hidden="true" className="hs-hairline hs-hairline--bare w-8 sm:w-12" />
        </div>
        {(foesLeft > 0 || PHASE_LABEL[wavePhase]) && (
          <span className="hs-tracking mt-1 text-[9px] text-[#f2e6cf]/55 sm:text-[10px]">
            {foesLeft > 0 ? `${foesLeft} REMAIN` : PHASE_LABEL[wavePhase]}
          </span>
        )}
      </div>

      {/* top right — light gathered + kills */}
      <div className="hs-panel absolute right-3 top-3 flex items-center gap-3 px-3 py-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="text-[11px] text-[#ffc766]">✦</span>
          <span className="hs-tracking text-sm font-bold tabular-nums text-[#ffd98f] sm:text-base">{light}</span>
          <span className="hs-tracking sr-only">light gathered</span>
        </span>
        <span aria-hidden="true" className="h-px w-3 bg-[rgba(255,196,120,0.25)]" />
        <span className="hs-tracking text-[9px] tabular-nums text-[#f2e6cf]/60 sm:text-[10px]">
          {kills} KILLS
        </span>
      </div>

      {/* bottom left — the weapon: GLIMMER */}
      <div className="hs-panel absolute bottom-4 left-3 flex items-center gap-2.5 px-3 py-2">
        <span className="hs-tracking text-[10px] font-bold text-[#ffd98f] sm:text-[11px]">GLIMMER</span>
        <span aria-hidden="true" className="h-px w-3 bg-[rgba(255,196,120,0.25)]" />
        <span className="hs-tracking text-[9px] text-[#f2e6cf]/60 sm:text-[10px]">
          VOLLEYS ×{volleys}
        </span>
      </div>

      {/* bottom right — dash */}
      <div className="absolute bottom-4 right-3">
        <span
          className="hs-panel hs-tracking inline-block px-3 py-2 text-[9px] transition-all sm:text-[10px]"
          style={
            dashReady >= 1
              ? { borderColor: 'rgba(255,199,102,0.6)', color: '#ffd98f', background: 'rgba(255,199,102,0.07)' }
              : { color: 'rgba(242,230,207,0.35)' }
          }
        >
          DASH{dashReady < 1 ? ` ${Math.round(dashReady * 100)}%` : ''}
        </span>
      </div>

      {/* wave banner — engraved caps between hairlines */}
      {banner && (
        <div
          key={banner.id}
          className="hs-banner absolute left-1/2 top-1/3 flex -translate-x-1/2 flex-col items-center gap-2.5"
        >
          <span aria-hidden="true" className="hs-hairline w-40 sm:w-60" />
          <span
            className="hs-tracking px-4 text-center text-3xl font-bold text-[#f2e6cf] sm:text-5xl"
            style={{ textShadow: '0 0 8px rgba(255,190,90,0.35)' }}
          >
            {banner.text}
          </span>
          <span className="hs-tracking text-[10px] text-[#f2e6cf]/60 sm:text-xs">{banner.sub}</span>
          <span aria-hidden="true" className="hs-hairline w-40 sm:w-60" />
        </div>
      )}

      {/* toasts — hairline chips */}
      <div className="absolute bottom-24 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
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
