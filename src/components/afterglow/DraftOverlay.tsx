'use client';

import { useEffect } from 'react';
import { DRAFTS } from '@/game/afterglow/draft';
import { getAfterglowEngine } from '@/game/afterglow/engine';
import { useAfterglowStore } from '@/game/afterglow/store';

const BY_ID = new Map(DRAFTS.map((d) => [d.id, d]));

/**
 * Draft overlay — the world keeps breathing behind a dim; three lights are
 * offered. Keyboard 1/2/3 or click. Display data comes from the sim's own
 * DRAFT pool (the sim is the game — the view only names what it offers).
 */
export default function DraftOverlay() {
  const phase = useAfterglowStore((s) => s.phase);
  const offers = useAfterglowStore((s) => s.offers);
  const wave = useAfterglowStore((s) => s.wave);

  useEffect(() => {
    if (phase !== 'draft') return;
    const onKey = (e: KeyboardEvent) => {
      const idx = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      const alt = ['Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code);
      const i = idx >= 0 ? idx : alt;
      if (i >= 0) {
        e.preventDefault();
        const id = offers[i];
        if (id) getAfterglowEngine()?.pickDraft(id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, offers]);

  if (phase !== 'draft') return null;

  return (
    <div className="ag-safe pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-[2px]">
      <div className="flex w-full max-w-3xl flex-col items-center gap-5 px-4 py-8">
        <div className="flex w-full max-w-sm items-center gap-3">
          <span aria-hidden="true" className="hs-hairline flex-1" />
          <p className="hs-tracking whitespace-nowrap text-[10px] text-[#f2e6cf]/70 sm:text-xs">
            WAVE {wave} CLEARED
          </p>
          <span aria-hidden="true" className="hs-hairline flex-1" />
        </div>

        <h2
          className="hs-tracking text-center text-2xl font-bold text-[#f2e6cf] sm:text-3xl"
          style={{ textShadow: '0 0 8px rgba(255,190,90,0.35)' }}
        >
          SPEND THE AFTERGLOW
        </h2>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {offers.map((id, i) => {
            const def = BY_ID.get(id);
            if (!def) return null;
            const rare = def.rarity === 'rare';
            return (
              <button
                key={id}
                type="button"
                onClick={() => getAfterglowEngine()?.pickDraft(id)}
                className={`ag-card hs-panel hs-frame min-h-[44px] flex flex-col items-start gap-2.5 px-4 py-4 text-left ${rare ? 'ag-card--rare' : ''}`}
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <span aria-hidden="true" className="hs-c" />
                <span className="flex w-full items-center justify-between gap-2">
                  <span className={`hs-tracking text-xs font-bold sm:text-sm ${rare ? 'text-[#ffd98f]' : 'text-[#f2e6cf]'}`}>
                    {def.name}
                  </span>
                  <span className="hs-tracking rounded-[2px] border border-[rgba(255,196,120,0.35)] px-1.5 py-0.5 text-[8px] text-[#ffc766]/80 sm:text-[9px]">
                    {i + 1}
                  </span>
                </span>
                <span className="text-[11px] leading-5 text-[#f2e6cf]/70 sm:text-xs">{def.desc}</span>
                <span className="mt-auto flex flex-wrap gap-1.5 pt-1">
                  {def.tags.map((tag) => (
                    <span
                      key={tag}
                      className="hs-tracking rounded-[2px] border border-[rgba(255,196,120,0.22)] bg-[rgba(255,199,102,0.05)] px-1.5 py-0.5 text-[8px] text-[#f2e6cf]/60 sm:text-[9px]"
                    >
                      {tag.toUpperCase()}
                    </span>
                  ))}
                  {rare && (
                    <span className="hs-tracking rounded-[2px] border border-[rgba(255,199,102,0.5)] px-1.5 py-0.5 text-[8px] text-[#ffc766] sm:text-[9px]">
                      RARE
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <p className="hs-tracking text-[9px] text-[#f2e6cf]/40 sm:text-[10px]">
          PRESS 1 / 2 / 3 — OR CHOOSE BY HAND
        </p>
      </div>
    </div>
  );
}
