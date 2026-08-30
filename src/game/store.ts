'use client';

import { create } from 'zustand';

export type Phase =
  | 'loading'
  | 'error'
  | 'title'
  | 'flying'
  | 'playing'
  | 'paused'
  | 'dead'
  | 'cleared';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'gold' | 'red';
}

interface GameState {
  phase: Phase;
  webglError: boolean;

  depth: number;
  shards: number;
  hearts: number;
  deaths: number;

  /** 0..1 — 1 means echo pulse ready */
  pulseReady: number;
  /** 0..1 — 1 means dash ready */
  dashReady: number;
  /** 0..1 — listener threat intensity */
  alert: number;
  gateActive: boolean;
  /** screen-space angle (radians) pointing toward the active gate, null when inactive */
  gateDir: number | null;

  runTime: number;
  lastRunTime: number;
  bestDepth: number;

  muted: boolean;
  reduceFx: boolean;
  touch: boolean;

  toasts: Toast[];

  set: (p: Partial<GameState>) => void;
  pushToast: (text: string, kind?: Toast['kind']) => void;
  dropToast: (id: number) => void;
}

let toastId = 0;

export const useGameStore = create<GameState>()((set) => ({
  phase: 'loading',
  webglError: false,

  depth: 1,
  shards: 0,
  hearts: 3,
  deaths: 0,

  pulseReady: 1,
  dashReady: 1,
  alert: 0,
  gateActive: false,
  gateDir: null,

  runTime: 0,
  lastRunTime: 0,
  bestDepth: 1,

  muted: false,
  reduceFx: false,
  touch: false,

  toasts: [],

  set: (p) => set(p),
  pushToast: (text, kind = 'info') =>
    set((s) => {
      const id = ++toastId;
      const toasts = [...s.toasts.slice(-3), { id, text, kind }];
      window.setTimeout(() => useGameStore.getState().dropToast(id), 3000);
      return { toasts };
    }),
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function loadBestDepth(): number {
  try {
    const v = window.localStorage.getItem('echovoid.best');
    const n = v ? parseInt(v, 10) : 1;
    return Number.isFinite(n) && n >= 1 ? n : 1;
  } catch {
    return 1;
  }
}

export function saveBestDepth(depth: number): void {
  try {
    window.localStorage.setItem('echovoid.best', String(depth));
  } catch {
    /* storage unavailable — best-depth is a nicety, not a requirement */
  }
}
