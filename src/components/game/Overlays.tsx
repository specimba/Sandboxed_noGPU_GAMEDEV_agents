'use client';

import { getEngine } from '@/game/engine';
import { useGameStore } from '@/game/store';
import { depthRoman } from '@/game/constants';

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-[3px]">
      <div className="relative w-[min(92vw,420px)] border border-white/15 bg-black/70 p-8 font-mono">
        {children}
      </div>
    </div>
  );
}

function Btn({
  label,
  onClick,
  accent,
}: {
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full border px-4 py-2.5 text-[11px] tracking-[0.35em] transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50"
      style={{
        borderColor: accent ? 'rgba(255,210,122,0.6)' : 'rgba(255,255,255,0.2)',
        color: accent ? '#ffd27a' : 'rgba(255,255,255,0.8)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = accent ? 'rgba(255,210,122,0.08)' : 'rgba(255,255,255,0.06)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
    </button>
  );
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

export default function Overlays() {
  const phase = useGameStore((s) => s.phase);
  const depth = useGameStore((s) => s.depth);
  const shards = useGameStore((s) => s.shards);
  const deaths = useGameStore((s) => s.deaths);
  const lastRunTime = useGameStore((s) => s.lastRunTime);
  const muted = useGameStore((s) => s.muted);
  const reduceFx = useGameStore((s) => s.reduceFx);

  if (phase === 'paused') {
    return (
      <Panel>
        <div className="mb-6 text-center text-lg tracking-[0.5em] text-white/90">SUSPENDED</div>
        <div className="flex flex-col gap-2.5">
          <Btn label="RESUME" onClick={() => getEngine()?.resume()} accent />
          <Btn label="RESTART DEPTH" onClick={() => getEngine()?.restartDepth()} />
          <Btn label={muted ? 'SOUND — OFF' : 'SOUND — ON'} onClick={() => getEngine()?.toggleMute()} />
          <Btn label={reduceFx ? 'REDUCED FX — ON' : 'REDUCED FX — OFF'} onClick={() => getEngine()?.toggleReduceFx()} />
          <Btn label="ABANDON TO SURFACE" onClick={() => getEngine()?.quitToTitle()} />
        </div>
        <div className="mt-6 text-center text-[9px] tracking-[0.3em] text-white/35">ESC TO RESUME</div>
      </Panel>
    );
  }

  if (phase === 'dead') {
    return (
      <Panel>
        <div className="mb-2 text-center text-lg tracking-[0.45em] text-red-300/90" style={{ textShadow: '0 0 20px rgba(255,59,78,0.4)' }}>
          CONSUMED
        </div>
        <div className="mb-6 text-center text-[10px] leading-relaxed tracking-[0.25em] text-white/50">
          THE VOID TOOK YOUR LIGHT AT DEPTH {depthRoman(depth)}
        </div>
        <div className="mb-6 flex justify-around border-y border-white/10 py-4 text-center">
          <div>
            <div className="text-xl text-white/90">{depthRoman(depth)}</div>
            <div className="mt-1 text-[8px] tracking-[0.3em] text-white/40">DEPTH</div>
          </div>
          <div>
            <div className="text-xl text-amber-200/90">{shards}/3</div>
            <div className="mt-1 text-[8px] tracking-[0.3em] text-white/40">SHARDS</div>
          </div>
          <div>
            <div className="text-xl text-white/90">{deaths}</div>
            <div className="mt-1 text-[8px] tracking-[0.3em] text-white/40">DEATHS</div>
          </div>
        </div>
        <Btn label="RETURN TO THE DARK" onClick={() => getEngine()?.respawn()} accent />
      </Panel>
    );
  }

  if (phase === 'cleared') {
    return (
      <Panel>
        <div
          className="mb-2 text-center text-lg tracking-[0.45em] text-amber-200"
          style={{ textShadow: '0 0 25px rgba(255,210,122,0.5)' }}
        >
          DEPTH {depthRoman(depth)} CLEARED
        </div>
        <div className="mb-6 text-center text-[10px] tracking-[0.3em] text-white/50">
          THE GATE SWALLOWS YOU — DEEPER STILL
        </div>
        <div className="mb-6 flex justify-around border-y border-white/10 py-4 text-center">
          <div>
            <div className="text-xl text-white/90">{fmtTime(lastRunTime)}</div>
            <div className="mt-1 text-[8px] tracking-[0.3em] text-white/40">TIME</div>
          </div>
          <div>
            <div className="text-xl text-amber-200/90">{shards}/3</div>
            <div className="mt-1 text-[8px] tracking-[0.3em] text-white/40">SHARDS</div>
          </div>
        </div>
        <Btn label="DESCEND ▼" onClick={() => getEngine()?.descend()} accent />
      </Panel>
    );
  }

  return null;
}
