// NEXUS ARMOR — Zustand store bridging the game engine and React UI.
import { create } from 'zustand'
import type { GameEvent, HudSnapshot, MissionResult } from '@/game/core/types'
import type { PlayerProfile, ApplyResultOutcome } from '@/game/systems/profile'
import { applyResult, levelFromXp, defaultProfile } from '@/game/systems/profile'
import { loadProfile, saveProfile, resetProfile, serverPull, serverPush } from '@/game/systems/save'
import { MISSION_BY_ID } from '@/game/config/missions'
import type { GameStats } from '@/game/game'

export type Screen = 'boot' | 'menu' | 'missions' | 'garage' | 'settings' | 'battle'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'good' | 'bad'
}

interface GameStore {
  booted: boolean
  screen: Screen
  profile: PlayerProfile
  saveCorrupted: boolean
  hud: HudSnapshot | null
  result: MissionResult | null
  paused: boolean
  toasts: Toast[]
  hint: { id: number; text: string } | null
  missionId: string | null
  stats: GameStats | null
  showStats: boolean
  syncing: boolean

  boot: () => void
  setScreen: (s: Screen) => void
  setHud: (h: HudSnapshot | null) => void
  setPaused: (p: boolean) => void
  clearResult: () => void
  pushToast: (text: string, kind?: Toast['kind']) => void
  setHint: (text: string) => void
  clearHint: (id: number) => void
  commit: (mutator: (p: PlayerProfile) => void) => void
  commitWithOutcome: (mutator: (p: PlayerProfile) => void) => ApplyResultOutcome | null
  handleEvent: (e: GameEvent) => void
  resetProgress: () => void
  setStats: (s: GameStats) => void
  toggleStats: () => void
}

let toastId = 1
let pushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleServerSync(profile: PlayerProfile): void {
  if (typeof window === 'undefined') return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    void serverPush(profile)
  }, 4000)
}

function clone(p: PlayerProfile): PlayerProfile {
  return JSON.parse(JSON.stringify(p)) as PlayerProfile
}

export const useGameStore = create<GameStore>((set, get) => ({
  booted: false,
  screen: 'boot',
  profile: defaultProfile(),
  saveCorrupted: false,
  hud: null,
  result: null,
  paused: false,
  toasts: [],
  hint: null,
  missionId: null,
  stats: null,
  showStats: false,
  syncing: false,

  boot: () => {
    const { profile, corrupted } = loadProfile()
    set({ profile, saveCorrupted: corrupted, booted: true })
    // offline-first: server copy only wins if strictly newer; failures are silent
    void serverPull(profile.clientId).then((remote) => {
      if (remote && remote.updatedAt > profile.updatedAt) {
        set({ profile: remote, syncing: true })
        saveProfile(remote)
      }
    })
  },

  setScreen: (s) => set({ screen: s }),

  setHud: (h) => set({ hud: h }),
  setPaused: (p) => set({ paused: p }),

  clearResult: () => set({ result: null }),

  pushToast: (text, kind = 'info') => {
    const id = toastId++
    set((st) => ({ toasts: [...st.toasts.slice(-4), { id, text, kind }] }))
    setTimeout(() => {
      set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }))
    }, 2600)
  },

  setHint: (text) => set({ hint: { id: toastId++, text } }),

  clearHint: (id) =>
    set((st) => (st.hint?.id === id ? { hint: null } : {})),

  commit: (mutator) => {
    const p = clone(get().profile)
    mutator(p)
    saveProfile(p)
    scheduleServerSync(p)
    set({ profile: p })
  },

  commitWithOutcome: (mutator) => {
    const p = clone(get().profile)
    mutator(p)
    saveProfile(p)
    scheduleServerSync(p)
    set({ profile: p })
    return null
  },

  handleEvent: (e) => {
    const st = get()
    switch (e.type) {
      case 'hud':
        st.setHud(e.snapshot)
        break
      case 'battleEnd': {
        const result = e.payload
        let outcome: ApplyResultOutcome | null = null
        const p = clone(st.profile)
        outcome = applyResult(p, result)
        saveProfile(p)
        scheduleServerSync(p)
        set({ profile: p, result, missionId: result.missionId })
        if (outcome.leveledUp) {
          st.pushToast(`LEVEL UP — Commander Level ${outcome.newLevel}`, 'good')
        }
        if (outcome.unlockedMission) {
          const m = MISSION_BY_ID[outcome.unlockedMission]
          if (m) st.pushToast(`Mission unlocked: ${m.name}`, 'good')
        }
        break
      }
      case 'kill':
        st.pushToast(`+${e.credits} cr — ${e.archetype === 'boss' ? 'GOLIATH DESTROYED' : 'raider destroyed'}`, e.archetype === 'boss' ? 'good' : 'info')
        break
      case 'playerHit':
        break // HUD reads via DOM vignette (GameShell)
      case 'ricochet':
        st.pushToast('Ricochet! Their armor bounced your shell', 'bad')
        break
      case 'hint':
        st.setHint(e.text)
        break
      case 'waveIncoming':
        if (e.wave > 1) st.pushToast(`Wave ${e.wave} incoming`, 'bad')
        break
      case 'toast':
        st.pushToast(e.text, e.kind)
        break
    }
  },

  resetProgress: () => {
    const p = resetProfile()
    set({ profile: p, result: null, missionId: null })
  },

  setStats: (s) => set({ stats: s }),

  toggleStats: () => set((st) => ({ showStats: !st.showStats })),
}))

export { levelFromXp }
