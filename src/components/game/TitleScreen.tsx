'use client';

import { getEngine } from '@/game/engine';
import { useGameStore } from '@/game/store';

const CONTROLS: [string, string][] = [
  ['CLICK / F', 'echo pulse — sing to the void'],
  ['W A S D', 'drift'],
  ['SPACE', 'jump · hold to hover'],
  ['SHIFT', 'dash'],
  ['DRAG / Q R', 'look around'],
];

export default function TitleScreen() {
  const phase = useGameStore((s) => s.phase);
  const bestDepth = useGameStore((s) => s.bestDepth);
  const webglError = useGameStore((s) => s.webglError);

  // keep mounted through 'flying' so the fade-out plays, then unmount
  if (phase !== 'title' && phase !== 'flying') return null;
  if (webglError && phase === 'title') {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-black font-mono">
        <div className="max-w-md text-center">
          <div className="mb-3 text-xl tracking-[0.4em] text-red-400">SILENCE</div>
          <p className="text-xs leading-relaxed tracking-widest text-white/60">
            This device could not summon WebGL — the void needs hardware acceleration.
            Try a desktop browser with hardware acceleration enabled.
          </p>
        </div>
      </div>
    );
  }

  const leaving = phase === 'flying';

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center font-mono transition-opacity duration-1000"
      style={{ opacity: leaving ? 0 : 1, pointerEvents: leaving ? 'none' : 'auto' }}
    >
      {/* readability veil */}
      <div className="absolute inset-0 bg-black/45" style={{ maskImage: 'radial-gradient(ellipse at center, transparent 0%, black 75%)', WebkitMaskImage: 'radial-gradient(ellipse at center, transparent 0%, black 75%)' }} />

      {/* expanding echo rings */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="ev-ring absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
            style={{
              width: 120,
              height: 120,
              borderColor: 'rgba(111,242,223,0.35)',
              animation: `evRing 4.2s ease-out ${i * 1.4}s infinite`,
            }}
          />
        ))}
      </div>

      <div className="relative flex w-full max-w-2xl flex-col items-center px-4">
        <div className="mb-2 text-[9px] tracking-[0.5em] text-teal-200/60 sm:text-[10px] sm:tracking-[0.6em]">A DESCENT IN THE DARK</div>
        <h1
          className="text-[min(11vw,4.5rem)] font-light tracking-[0.3em] text-white sm:text-7xl sm:tracking-[0.45em]"
          style={{ textShadow: '0 0 30px rgba(111,242,223,0.45), 0 0 80px rgba(111,242,223,0.2)', marginLeft: '0.3em' }}
        >
          ECHOVOID
        </h1>
        <p className="mt-4 max-w-md text-center text-[10px] leading-relaxed tracking-[0.2em] text-white/60 sm:text-[11px] sm:tracking-[0.25em]">
          THE WORLD IS BLIND. EVERY PULSE OF SOUND PAINTS IT FOR A BREATH —
          BUT THE LISTENERS HUNT BY HEARING.
        </p>

        <button
          onClick={() => getEngine()?.begin()}
          className="mt-8 border border-amber-200/60 px-8 py-3 text-xs tracking-[0.35em] text-amber-100 transition-all hover:bg-amber-200/10 hover:shadow-[0_0_25px_rgba(255,210,122,0.3)] focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-200 sm:mt-10 sm:px-12 sm:py-3.5 sm:text-sm sm:tracking-[0.45em]"
          style={{ marginLeft: '0.35em' }}
        >
          BEGIN THE DESCENT
        </button>

        <div className="mt-10 grid grid-cols-1 gap-x-10 gap-y-1.5 text-[9px] tracking-[0.2em] text-white/45 sm:grid-cols-2">
          {CONTROLS.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="min-w-[72px] border border-white/15 px-1.5 py-0.5 text-center text-white/70">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>

        <div className="mt-8 flex max-w-full flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[8px] tracking-[0.25em] text-white/35 sm:text-[9px]">
          <span>HEADPHONES RECOMMENDED</span>
          <span className="text-white/15">|</span>
          <span>DEEPEST DESCENT — {bestDepth === 1 ? 'NONE YET' : `DEPTH ${bestDepth}`}</span>
        </div>
      </div>
    </div>
  );
}
