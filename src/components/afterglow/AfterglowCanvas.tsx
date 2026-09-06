'use client';

import { useEffect, useRef } from 'react';
import { AfterglowEngine } from '@/game/afterglow/engine';
import { useAfterglowStore } from '@/game/afterglow/store';

export default function AfterglowCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let engine: AfterglowEngine | null = null;
    try {
      engine = new AfterglowEngine(canvas);
    } catch (err) {
      console.error('[AFTERGLOW] WebGL init failed:', err);
      useAfterglowStore.getState().set({ webglError: true });
    }
    return () => engine?.dispose();
  }, []);

  return (
    <canvas
      ref={ref}
      className="absolute inset-0 block h-full w-full"
      aria-label="AFTERGLOW — 3D game viewport"
    />
  );
}
