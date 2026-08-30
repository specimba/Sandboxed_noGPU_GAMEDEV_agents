'use client';

import { useRef } from 'react';
import { getEngine } from '@/game/engine';
import { useGameStore } from '@/game/store';

/**
 * Touch controls: left virtual joystick, right action buttons.
 * Camera look is handled by dragging on the canvas itself (Input class).
 */
export default function TouchControls() {
  const touch = useGameStore((s) => s.touch);
  const phase = useGameStore((s) => s.phase);
  const stickRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const activeId = useRef<number | null>(null);

  if (!touch || phase !== 'playing') return null;

  const setMove = (x: number, y: number) => {
    const engine = getEngine();
    if (!engine) return;
    engine.input.touchMoveX = x;
    engine.input.touchMoveY = y;
  };

  const handleStart = (e: React.TouchEvent) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (!t) return;
    activeId.current = t.identifier;
  };
  const handleMove = (e: React.TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== activeId.current) continue;
      const el = stickRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let dx = (t.clientX - cx) / (r.width / 2);
      let dy = (t.clientY - cy) / (r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      setMove(dx, -dy);
      if (knobRef.current) {
        knobRef.current.style.transform = `translate(${dx * 28}px, ${dy * 28}px)`;
      }
    }
  };
  const handleEnd = () => {
    activeId.current = null;
    setMove(0, 0);
    if (knobRef.current) knobRef.current.style.transform = 'translate(0,0)';
  };

  const pulse = () => getEngine()?.input.queuePulse();
  const dash = () => getEngine()?.input.queueDash();

  return (
    <div className="absolute inset-0 z-20 font-mono" style={{ pointerEvents: 'none' }}>
      {/* joystick */}
      <div
        ref={stickRef}
        className="absolute bottom-8 left-6 flex h-28 w-28 items-center justify-center rounded-full border border-white/20 bg-white/5"
        style={{ pointerEvents: 'auto', touchAction: 'none' }}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
        onTouchCancel={handleEnd}
        aria-label="movement joystick"
      >
        <div
          ref={knobRef}
          className="h-12 w-12 rounded-full border border-white/30 bg-white/15"
          style={{ transition: 'transform 0.05s' }}
        />
      </div>

      {/* action buttons */}
      <div className="absolute bottom-8 right-6 flex items-end gap-3" style={{ pointerEvents: 'auto' }}>
        <button
          className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-white/5 text-[9px] tracking-[0.15em] text-white/80"
          style={{ touchAction: 'none' }}
          onTouchStart={(e) => {
            e.preventDefault();
            dash();
          }}
          aria-label="dash"
        >
          DASH
        </button>
        <button
          className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-white/5 text-[9px] tracking-[0.15em] text-white/80"
          style={{ touchAction: 'none' }}
          onTouchStart={(e) => {
            e.preventDefault();
            const engine = getEngine();
            if (engine) engine.input.touchJumpHeld = true;
          }}
          onTouchEnd={() => {
            const engine = getEngine();
            if (engine) engine.input.touchJumpHeld = false;
          }}
          aria-label="jump and hover"
        >
          JUMP
        </button>
        <button
          className="flex h-20 w-20 items-center justify-center rounded-full border border-amber-200/50 bg-amber-200/10 text-[10px] tracking-[0.2em] text-amber-100"
          style={{ touchAction: 'none', boxShadow: '0 0 18px rgba(255,210,122,0.25)' }}
          onTouchStart={(e) => {
            e.preventDefault();
            pulse();
          }}
          aria-label="echo pulse"
        >
          ECHO
        </button>
      </div>
    </div>
  );
}
