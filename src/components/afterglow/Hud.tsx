'use client';

import { useEffect, useState } from 'react';
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

const HP_CELLS = 10;

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

  // hurt vignette: a hp DROP flashes the frame edge red (view-side only).
  // Store subscription (not render-phase effect) — lint-clean cascading.
  const [hurt, setHurt] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useAfterglowStore.subscribe((s, prev) => {
      if (s.hp < prev.hp - 0.01) {
        setHurt(true);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setHurt(false), 350);
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (phase === 'title') return null;

  const hpFrac = Math.max(0, Math.min(1, hp / maxHp));
  const low = hpFrac <= 0.3;
  const lowVig = low ? Math.min(1, (0.3 - hpFrac) / 0.3) : 0;
  const litCells = Math.round(hpFrac * HP_CELLS);
  // dash radial cooldown: conic sweep, full circle = ready
  const dashDeg = Math.round(Math.max(0, Math.min(1, dashReady)) * 360);
  const volleyPips = Math.min(5, volleys);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      {/* cinematic frame vignette — CSS, zero render cost */}
      <div className="ag-vignette absolute inset-0" />
      {/* hurt flash + low-hp dread vignette */}
      <div className={`absolute inset-0 ${hurt ? 'ag-hurt' : ''}`} />
      {lowVig > 0 && (
        <div
          className="ag-lowhp absolute inset-0 hs-pulse"
          style={{ opacity: 0.35 + lowVig * 0.65 }}
        />
      )}

      {/* top left — the light's hp cells + ward pips */}
      <div className="hs-panel absolute left-3 top-3 flex flex-col gap-1.5 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="hs-tracking text-[10px] text-[#f2e6cf]/55 sm:text-[11px]">THE LIGHT</span>
          <span className="hs-tracking text-[13px] font-bold tabular-nums text-[#ffc766]/90 sm:text-[14px]">
            {Math.ceil(hp)}
            <span className="text-[#f2e6cf]/40">/{maxHp}</span>
          </span>
        </div>
        <div className="flex gap-[3px]" role="progressbar" aria-valuemin={0} aria-valuemax={maxHp} aria-valuenow={Math.ceil(hp)} aria-label="the light">
          {Array.from({ length: HP_CELLS }).map((_, i) => {
            const cellOn = i < litCells;
            const edge = i === litCells - 1;
            return (
              <span
                key={i}
                className={`hs-seg h-[9px] w-[9px] sm:w-[13px] ${cellOn ? (low ? 'hs-seg--hot' : 'hs-seg--on') : ''} ${cellOn && edge ? 'ag-seg-edge' : ''}`}
              />
            );
          })}
        </div>
        {shield > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="hs-tracking text-[9px] text-[#ffe9a0]/80 sm:text-[10px]">WARD</span>
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
          <span
            className={`hs-tracking mt-1 text-[9px] sm:text-[10px] ${
              foesLeft > 0 && foesLeft <= 3 ? 'hs-pulse text-[#ffb454]' : 'text-[#f2e6cf]/55'
            }`}
          >
            {foesLeft > 0 ? `${foesLeft} REMAIN` : PHASE_LABEL[wavePhase]}
          </span>
        )}
      </div>

      {/* top right — light gathered + kills */}
      <div className="hs-panel absolute right-3 top-3 flex items-center gap-3 px-3 py-2">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="hs-pip hs-pip--on !h-[10px] !w-[10px]" />
          <span className="hs-tracking text-base font-bold tabular-nums text-[#ffd98f] sm:text-lg">{light}</span>
          <span className="hs-tracking sr-only">light gathered</span>
        </span>
        <span aria-hidden="true" className="h-px w-3 bg-[rgba(255,196,120,0.25)]" />
        <span className="hs-tracking text-[9px] tabular-nums text-[#f2e6cf]/60 sm:text-[10px]">
          {kills} KILLS
        </span>
      </div>

      {/* bottom left — the weapon: GLIMMER with volley pips */}
      <div className="hs-panel absolute bottom-4 left-3 flex items-center gap-2.5 px-3 py-2">
        <span className="hs-tracking text-[11px] font-bold text-[#ffd98f] sm:text-[12px]">GLIMMER</span>
        <span aria-hidden="true" className="h-px w-3 bg-[rgba(255,196,120,0.25)]" />
        <span className="flex items-center gap-1.5">
          {Array.from({ length: volleyPips }).map((_, i) => (
            <span key={i} className="hs-pip hs-pip--on" />
          ))}
          {volleys > 5 && (
            <span className="hs-tracking text-[9px] text-[#ffd98f]/80">×{volleys}</span>
          )}
          <span className="hs-tracking sr-only">volleys {volleys}</span>
        </span>
      </div>

      {/* bottom right — dash with radial cooldown pip */}
      <div className="absolute bottom-4 right-3 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="hs-dashpip"
          style={{
            background: `conic-gradient(rgba(255,199,102,0.85) ${dashDeg}deg, rgba(242,230,207,0.12) ${dashDeg}deg)`,
          }}
        />
        <span
          className="hs-panel hs-tracking inline-block px-3 py-2 text-[10px] transition-all sm:text-[11px]"
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
          <span aria-hidden="true" className="hs-hairline ag-drawline w-40 sm:w-60" />
          <span
            className="hs-tracking ag-banner-word px-4 text-center text-3xl font-bold text-[#f2e6cf] sm:text-5xl"
            style={{ textShadow: '0 0 8px rgba(255,190,90,0.35)' }}
          >
            {banner.text}
          </span>
          <span className="hs-tracking text-[10px] text-[#f2e6cf]/60 sm:text-xs">{banner.sub}</span>
          <span aria-hidden="true" className="hs-hairline ag-drawline w-40 sm:w-60" />
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
