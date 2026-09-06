'use client';

import { useEffect, useRef, useState } from 'react';
import { getAfterglowEngine } from '@/game/afterglow/engine';
import { useAfterglowStore } from '@/game/afterglow/store';

/** touch: left virtual stick + DASH button (adapted house pattern, ember skin) */
export default function TouchControls() {
  const touch = useAfterglowStore((s) => s.touch);
  const phase = useAfterglowStore((s) => s.phase);
  const stickRef = useRef<HTMLDivElement | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0, active: false });
  const stickId = useRef<number>(-1);

  useEffect(() => {
    if (!touch || (phase !== 'playing' && phase !== 'draft')) {
      getAfterglowEngine()?.setTouchMove(0, 0);
    }
  }, [touch, phase]);

  if (!touch || (phase !== 'playing' && phase !== 'draft')) return null;

  const startStick = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    stickId.current = e.pointerId;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
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
      getAfterglowEngine()?.setTouchMove(0, 0);
    } else {
      const k = Math.min(1, (mag - dead) / (1 - dead)) / mag;
      getAfterglowEngine()?.setTouchMove(dx * k, -dy * k);
    }
  };

  const endStick = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stickId.current !== e.pointerId) return;
    stickId.current = -1;
    setKnob({ x: 0, y: 0, active: false });
    getAfterglowEngine()?.setTouchMove(0, 0);
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

      {/* dash button — 64px, ember ink */}
      <div className="pointer-events-auto absolute bottom-24 right-6 flex flex-col items-center gap-3">
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            getAfterglowEngine()?.requestDash();
          }}
          className="h-16 w-16 touch-none rounded-full border border-amber-200/50 bg-amber-950/40 text-[10px] tracking-widest text-amber-100 backdrop-blur-[2px] active:bg-amber-400/25"
          aria-label="Dash"
        >
          DASH
        </button>
      </div>
    </div>
  );
}
