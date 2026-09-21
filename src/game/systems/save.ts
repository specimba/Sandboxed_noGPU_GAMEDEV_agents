// NEXUS ARMOR — versioned localStorage persistence with migrations + corrupt safety,
// plus optional silent server sync (offline-first; server never required to play).
import { defaultProfile, type PlayerProfile } from './profile'

const SAVE_KEY = 'nexus-armor-save-v1'
const BACKUP_KEY = 'nexus-armor-save-v1-bak'
export const SCHEMA_VERSION = 1

interface SaveEnvelope {
  schemaVersion: number
  profile: PlayerProfile
  savedAt: number
}

function validate(p: unknown): p is PlayerProfile {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  return typeof o.credits === 'number' && typeof o.xp === 'number' && Array.isArray(o.ownedTanks)
}

function migrate(env: SaveEnvelope): PlayerProfile {
  // future migrations switch on env.schemaVersion sequentially
  return env.profile
}

export function loadProfile(): { profile: PlayerProfile; corrupted: boolean } {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (raw) {
      const env = JSON.parse(raw) as SaveEnvelope
      if (env.profile && validate(env.profile)) {
        return { profile: migrate(env), corrupted: false }
      }
    }
    // try backup
    const bak = localStorage.getItem(BACKUP_KEY)
    if (bak) {
      const env = JSON.parse(bak) as SaveEnvelope
      if (env.profile && validate(env.profile)) {
        return { profile: migrate(env), corrupted: true }
      }
    }
  } catch {
    /* fall through to fresh */
  }
  return { profile: defaultProfile(), corrupted: true }
}

export function saveProfile(profile: PlayerProfile): void {
  try {
    // rotate previous good save into backup
    const cur = localStorage.getItem(SAVE_KEY)
    if (cur) localStorage.setItem(BACKUP_KEY, cur)
    const env: SaveEnvelope = { schemaVersion: SCHEMA_VERSION, profile, savedAt: Date.now() }
    localStorage.setItem(SAVE_KEY, JSON.stringify(env))
  } catch {
    // storage full/blocked — game continues, progress just won't persist
  }
}

export function resetProfile(): PlayerProfile {
  try {
    localStorage.removeItem(SAVE_KEY)
    localStorage.removeItem(BACKUP_KEY)
  } catch {
    /* noop */
  }
  return defaultProfile()
}

// ---------------- optional server sync (progressive enhancement) ----------------

export async function serverPull(clientId: string): Promise<PlayerProfile | null> {
  try {
    const res = await fetch(`/api/profile?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { profile?: PlayerProfile }
    if (data.profile && validate(data.profile)) return data.profile
    return null
  } catch {
    return null
  }
}

export async function serverPush(profile: PlayerProfile): Promise<boolean> {
  try {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: profile.clientId, profile }),
    })
    return res.ok
  } catch {
    return false
  }
}
