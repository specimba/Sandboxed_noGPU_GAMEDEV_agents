'use client';

import { useEffect, useRef, useState } from 'react';
import { getEngine } from '@/game/engine';
import { useGameStore } from '@/game/store';

/** touch: left virtual stick + THROW / DASH buttons */
export default function TouchControls() {
  const touch = useGameStore((s) => s.touch);
  const phase = useGameStore((s) => s.phase);
  const stickRef = useRef<HTMLDivElement | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0, active: false });
  const stickId = useRef<number>(-1);

  useEffect(() => {
    if (!touch || phase !== 'playing') {
      getEngine()?.setTouchMove(0, 0);
    }
  }, [touch, phase]);

  // safety net: if the finger lifts OUTSIDE the stick (capture dropped, knob
  // unmounted mid-drag), the ember must never keep drifting on a frozen value
  useEffect(() => {
    if (!touch) return;
    const release = () => {
      if (stickId.current === -1) return;
      stickId.current = -1;
      setKnob({ x: 0, y: 0, active: false });
      getEngine()?.setTouchMove(0, 0);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [touch]);

  if (!touch || (phase !== 'playing' && phase !== 'paused')) return null;

  const startStick = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (stickId.current !== -1) return; // second finger never steals the stick
    stickId.current = e.pointerId;
    // capture the CONTAINER (not e.target — a pointerdown on the knob child
    // must still drag the stick when the pointer leaves the knob)
    stickRef.current?.setPointerCapture?.(e.pointerId);
    moveStick(e);
  };

  const moveStick = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stickId.current !== e.pointerId || !stickRef.current) return;
    const rect = stickRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = (e.clientX - cx) / (rect.width / 2);
    let dy = (e.clientY - cy) / (rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    setKnob({ x: dx * 34, y: dy * 34, active: true });
    const dead = 0.16;
    const mag = Math.hypot(dx, dy);
    if (mag < dead) {
      getEngine()?.setTouchMove(0, 0);
    } else {
      const k = Math.min(1, (mag - dead) / (1 - dead)) / mag;
      getEngine()?.setTouchMove(dx * k, -dy * k);
    }
  };

  const endStick = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stickId.current !== e.pointerId) return;
    stickId.current = -1;
    // drop the capture explicitly so the next touch starts clean
    try {
      stickRef.current?.releasePointerCapture?.(e.pointerId);
    } catch {
      // capture already released — nothing to do
    }
    setKnob({ x: 0, y: 0, active: false });
    getEngine()?.setTouchMove(0, 0);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none">
      {/* joystick */}
      <div
        ref={stickRef}
        className="pointer-events-auto absolute bottom-20 left-6 h-28 w-28 touch-none rounded-full border border-amber-200/25 bg-black/30 backdrop-blur-[2px]"
        onPointerDown={startStick}
        onPointerMove={moveStick}
        onPointerUp={endStick}
        onPointerCancel={endStick}
        aria-label="Movement stick"
      >
        <div
          className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-200/50 bg-amber-200/15 transition-transform"
          style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`, opacity: knob.active ? 0.95 : 0.6 }}
        />
      </div>

      {/* action buttons */}
      <div className="pointer-events-auto absolute bottom-24 right-6 flex flex-col items-center gap-3">
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            getEngine()?.queueDash();
          }}
          className="h-16 w-16 touch-none rounded-full border border-sky-300/40 bg-sky-950/40 text-[10px] tracking-widest text-sky-100/90 backdrop-blur-[2px] active:bg-sky-400/20"
          aria-label="Dash"
        >
          DASH
        </button>
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            getEngine()?.queueThrow();
          }}
          className="h-20 w-20 touch-none rounded-full border border-amber-200/50 bg-amber-950/40 text-xs tracking-widest text-amber-100 backdrop-blur-[2px] active:bg-amber-300/25"
          aria-label="Throw shards"
        >
          THROW
        </button>
      </div>
    </div>
  );
}
