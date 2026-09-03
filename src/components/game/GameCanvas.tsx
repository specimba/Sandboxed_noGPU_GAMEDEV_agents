'use client';

import { useEffect, useRef } from 'react';
import { Engine } from '@/game/engine';
import { useGameStore } from '@/game/store';

export default function GameCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let engine: Engine | null = null;
    try {
      engine = new Engine(canvas);
    } catch (err) {
      console.error('[HOLLOW SUN] WebGL init failed:', err);
      useGameStore.getState().set({ phase: 'error', webglError: true });
    }
    return () => engine?.dispose();
  }, []);

  return (
    <canvas
      ref={ref}
      className="absolute inset-0 block h-full w-full"
      aria-label="HOLLOW SUN — 3D game viewport"
    />
  );
}
