'use client';

import { create } from 'zustand';

/**
 * AFTERGLOW view-model store. The engine pushes sim state here at ~10Hz
 * (or on-change for events); React reads selectors — never the sim directly.
 */

export type AfterglowPhase = 'title' | 'playing' | 'draft' | 'dead';

export interface AfterglowToast {
  id: number;
  text: string;
  kind: 'info' | 'gold' | 'red';
}

export interface AfterglowBanner {
  id: number;
  text: string;
  sub: string;
}

export interface AfterglowRunStats {
  wave: number;
  kills: number;
  light: number;
  /** run duration in seconds */
  time: number;
}

interface AfterglowState {
  phase: AfterglowPhase;
  webglError: boolean;

  wave: number;
  wavePhase: string;
  foesLeft: number;

  hp: number;
  maxHp: number;
  shield: number;
  wardMax: number;

  light: number;
  kills: number;
  dashReady: number;
  volleys: number;
  time: number;

  offers: string[];
  lastPick: string | null;
  runStats: AfterglowRunStats;

  muted: boolean;
  touch: boolean;

  banner: AfterglowBanner | null;
  toasts: AfterglowToast[];

  set: (p: Partial<AfterglowState>) => void;
  pushToast: (text: string, kind?: AfterglowToast['kind']) => void;
  dropToast: (id: number) => void;
  showBanner: (text: string, sub: string) => void;
}

let toastId = 0;
let bannerId = 0;

export const useAfterglowStore = create<AfterglowState>()((set) => ({
  phase: 'title',
  webglError: false,

  wave: 0,
  wavePhase: 'idle',
  foesLeft: 0,

  hp: 100,
  maxHp: 100,
  shield: 0,
  wardMax: 0,

  light: 0,
  kills: 0,
  dashReady: 1,
  volleys: 1,
  time: 0,

  offers: [],
  lastPick: null,
  runStats: { wave: 0, kills: 0, light: 0, time: 0 },

  muted: false,
  touch: false,

  banner: null,
  toasts: [],

  set: (p) => set(p),
  pushToast: (text, kind = 'info') =>
    set((s) => {
      const id = ++toastId;
      const toasts = [...s.toasts.slice(-3), { id, text, kind }];
      window.setTimeout(() => useAfterglowStore.getState().dropToast(id), 2600);
      return { toasts };
    }),
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  showBanner: (text, sub) => {
    const id = ++bannerId;
    set({ banner: { id, text, sub } });
    window.setTimeout(() => {
      const cur = useAfterglowStore.getState().banner;
      if (cur && cur.id === id) set({ banner: null });
    }, 2200);
  },
}));
