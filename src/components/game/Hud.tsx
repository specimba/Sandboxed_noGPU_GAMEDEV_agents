'use client';

import { useGameStore } from '@/game/store';
import { depthRoman, depthMeters } from '@/game/constants';

function PulseRing({ ready }: { ready: number }) {
  const R = 24;
  const C = 2 * Math.PI * R;
  const isReady = ready >= 0.999;
  return (
    <div className="relative h-16 w-16" aria-label={`Echo pulse ${isReady ? 'ready' : 'charging'}`}>
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke={isReady ? '#ffd27a' : 'rgba(111,242,223,0.75)'}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - ready)}
          style={{ transition: 'stroke 0.3s', filter: isReady ? 'drop-shadow(0 0 6px rgba(255,210,122,0.8))' : undefined }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div
          className="h-2 w-2 rotate-45"
          style={{
            background: isReady ? '#ffd27a' : 'rgba(255,255,255,0.4)',
            boxShadow: isReady ? '0 0 10px rgba(255,210,122,0.9)' : undefined,
          }}
        />
        <span className="mt-0.5 text-[8px] tracking-[0.2em] text-white/50">ECHO</span>
      </div>
    </div>
  );
}

export default function Hud() {
  const phase = useGameStore((s) => s.phase);
  const depth = useGameStore((s) => s.depth);
  const shards = useGameStore((s) => s.shards);
  const hearts = useGameStore((s) => s.hearts);
  const pulseReady = useGameStore((s) => s.pulseReady);
  const dashReady = useGameStore((s) => s.dashReady);
  const alert = useGameStore((s) => s.alert);
  const gateActive = useGameStore((s) => s.gateActive);
  const gateDir = useGameStore((s) => s.gateDir);
  const toasts = useGameStore((s) => s.toasts);
  const touch = useGameStore((s) => s.touch);

  const visible = phase === 'playing' || phase === 'paused' || phase === 'dead' || phase === 'cleared' || phase === 'flying';
  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 font-mono">
      {/* top-left: depth + shards */}
      <div className="absolute left-4 top-4 flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-lg tracking-[0.35em] text-white/90">DEPTH {depthRoman(depth)}</span>
          <span className="text-[10px] tracking-[0.2em] text-white/40">— {depthMeters(depth)}M</span>
        </div>
        <div className="flex items-center gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-2.5 w-2.5 rotate-45 border"
              style={
                i < shards
                  ? { background: '#ffb85c', borderColor: '#ffb85c', boxShadow: '0 0 8px rgba(255,184,92,0.8)' }
                  : { borderColor: 'rgba(255,255,255,0.3)' }
              }
              aria-label={i < shards ? 'shard collected' : 'shard missing'}
            />
          ))}
          <span className="ml-1 text-[9px] tracking-[0.25em] text-white/40">ECHO SHARDS</span>
        </div>
      </div>

      {/* top-right: hearts */}
      <div className="absolute right-4 top-4 flex items-center gap-2" aria-label={`light ${hearts} of 3`}>
        <span className="text-[9px] tracking-[0.25em] text-white/40">LIGHT</span>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-3 w-3"
            style={
              i < hearts
                ? {
                    clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                    background: '#cffff4',
                    boxShadow: '0 0 8px rgba(207,255,244,0.8)',
                  }
                : {
                    clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                    background: 'rgba(255,255,255,0.15)',
                  }
            }
          />
        ))}
      </div>

      {/* listener threat */}
      {alert > 0.02 && (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 text-center">
          <div
            className="text-[10px] tracking-[0.35em] text-red-400"
            style={{ animation: 'evPulse 0.9s ease-in-out infinite', opacity: 0.4 + alert * 0.6 }}
          >
            ◈ LISTENERS STIR ◈
          </div>
        </div>
      )}

      {/* gate compass */}
      {gateActive && gateDir !== null && (
        <div className="absolute left-1/2 top-12 -translate-x-1/2">
          <div
            className="flex h-6 w-6 items-center justify-center"
            style={{ transform: `rotate(${gateDir}rad)` }}
            aria-label="direction to gate"
          >
            <div
              className="h-0 w-0"
              style={{
                borderLeft: '6px solid transparent',
                borderRight: '6px solid transparent',
                borderBottom: '10px solid #ffd27a',
                filter: 'drop-shadow(0 0 6px rgba(255,210,122,0.9))',
              }}
            />
          </div>
          <div className="mt-0.5 text-center text-[8px] tracking-[0.3em] text-amber-200/70">GATE</div>
        </div>
      )}

      {/* bottom-center: pulse + dash (desktop only — touch uses the on-screen buttons) */}
      {!touch && (
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-end gap-4">
          <PulseRing ready={pulseReady} />
          <div className="mb-2 flex flex-col items-center gap-1">
            <div
              className="h-3 w-8 border"
              style={
                dashReady >= 1
                  ? { background: 'rgba(207,255,244,0.85)', borderColor: '#cffff4', boxShadow: '0 0 8px rgba(207,255,244,0.7)' }
                  : { borderColor: 'rgba(255,255,255,0.25)' }
              }
              aria-label={dashReady >= 1 ? 'dash ready' : 'dash recharging'}
            />
            <span className="text-[8px] tracking-[0.25em] text-white/50">DASH</span>
          </div>
        </div>
      )}

      {/* controls hint (desktop only) */}
      {phase === 'playing' && !touch && (
        <div className="absolute bottom-6 right-4 text-right text-[9px] leading-relaxed tracking-[0.2em] text-white/30">
          <div>WASD MOVE · SPACE JUMP/HOVER</div>
          <div>DRAG LOOK · SHIFT DASH · ESC PAUSE</div>
        </div>
      )}

      {/* toasts */}
      <div className="absolute bottom-24 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="ev-toast border bg-black/60 px-4 py-1.5 text-[10px] tracking-[0.3em] backdrop-blur-sm"
            style={{
              animation: 'evToastIn 0.25s ease-out',
              borderColor:
                t.kind === 'gold' ? 'rgba(255,210,122,0.5)' : t.kind === 'red' ? 'rgba(255,59,78,0.5)' : 'rgba(255,255,255,0.2)',
              color: t.kind === 'gold' ? '#ffd27a' : t.kind === 'red' ? '#ff8a94' : 'rgba(255,255,255,0.85)',
            }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
