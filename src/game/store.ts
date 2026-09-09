'use client';

import { create } from 'zustand';
import type { Tier } from './run';

export type Phase = 'loading' | 'error' | 'title' | 'playing' | 'paused' | 'reward' | 'dead';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'gold' | 'red';
}

export interface Banner {
  id: number;
  text: string;
  sub: string;
  kind: 'wave' | 'warden' | 'overdrive' | 'room' | 'boss' | 'biome';
}

export interface BoonChoice {
  id: string;
  name: string;
  desc: string;
  tier: Tier;
}

export interface MetaState {
  dawn: number;
  unlocked: Record<string, boolean>;
  /** first-60s onboarding shown once ever */
  onboarded?: boolean;
}

interface GameState {
  phase: Phase;
  webglError: boolean;

  score: number;
  best: number;
  bestWave: number;
  wave: number;
  enemiesLeft: number;
  mult: number;

  shards: number;
  shardsMax: number;
  embers: number;
  embersMax: number;

  dashReady: number;
  overdrive: number;
  overdriveActive: boolean;
  sun: number;

  /** run structure */
  roomLabel: string;
  mutatorLabel: string;
  seed: number;
  boonsTaken: string[];
  boonChoices: BoonChoice[];
  bossBar: { name: string; frac: number } | null;
  /** CC status — the ROOTED chip's state (the bind is ALWAYS on screen) */
  rooted: boolean;
  rootT: number;
  won: boolean;
  dawnEarned: number;

  /** meta (persists) */
  dawn: number;
  unlocked: Record<string, boolean>;

  banner: Banner | null;
  muted: boolean;
  touch: boolean;

  toasts: Toast[];

  /** sprint-17 feel layer */
  hint: string | null; // first-60s onboarding chip
  hitFrom: number | null; // degrees — damage-direction wedge
  playerSlow: number; // 0..1 remaining veil fraction (HUD status)

  set: (p: Partial<GameState>) => void;
  pushToast: (text: string, kind?: Toast['kind']) => void;
  dropToast: (id: number) => void;
  showBanner: (text: string, sub: string, kind: Banner['kind']) => void;
}

let toastId = 0;
let bannerId = 0;

export const useGameStore = create<GameState>()((set) => ({
  phase: 'loading',
  webglError: false,

  score: 0,
  best: 0,
  bestWave: 1,
  wave: 0,
  enemiesLeft: 0,
  mult: 1,

  shards: 3,
  shardsMax: 6,
  embers: 3,
  embersMax: 3,

  dashReady: 1,
  overdrive: 0,
  overdriveActive: false,
  sun: 0,
  rooted: false,
  rootT: 0,

  roomLabel: '',
  mutatorLabel: '',
  seed: 0,
  boonsTaken: [],
  boonChoices: [],
  bossBar: null,
  won: false,
  dawnEarned: 0,

  dawn: 0,
  unlocked: {},

  banner: null,
  muted: false,
  touch: false,

  toasts: [],

  hint: null,
  hitFrom: null,
  playerSlow: 0,

  set: (p) => set(p),
  pushToast: (text, kind = 'info') =>
    set((s) => {
      const id = ++toastId;
      const toasts = [...s.toasts.slice(-3), { id, text, kind }];
      window.setTimeout(() => useGameStore.getState().dropToast(id), 2600);
      return { toasts };
    }),
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  showBanner: (text, sub, kind) => {
    const id = ++bannerId;
    set({ banner: { id, text, sub, kind } });
    // biome arrival holds shorter (1.5s beat) — the ROOM banner it replaces
    // used to follow 2.6s later and double-banner the moment
    const dur = kind === 'biome' ? 1500 : 2200;
    window.setTimeout(() => {
      const cur = useGameStore.getState().banner;
      if (cur && cur.id === id) set({ banner: null });
    }, dur);
  },
}));

export interface BestRecord {
  score: number;
  wave: number;
}

export function loadBest(): BestRecord {
  try {
    const raw = window.localStorage.getItem('hollowsun.best');
    if (raw) {
      const o = JSON.parse(raw) as Partial<BestRecord>;
      return { score: o.score ?? 0, wave: o.wave ?? 1 };
    }
  } catch {
    /* storage unavailable */
  }
  return { score: 0, wave: 1 };
}

export function saveBest(rec: BestRecord): void {
  try {
    window.localStorage.setItem('hollowsun.best', JSON.stringify(rec));
  } catch {
    /* storage unavailable */
  }
}

const META_KEY = 'hollowsun.meta';

export function loadMeta(): MetaState {
  try {
    const raw = window.localStorage.getItem(META_KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<MetaState>;
      return { dawn: o.dawn ?? 0, unlocked: o.unlocked ?? {} };
    }
  } catch {
    /* storage unavailable */
  }
  return { dawn: 0, unlocked: {} };
}

export function saveMeta(m: MetaState): void {
  try {
    window.localStorage.setItem(META_KEY, JSON.stringify(m));
  } catch {
    /* storage unavailable */
  }
}
