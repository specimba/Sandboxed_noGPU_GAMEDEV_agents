'use client'

// NEXUS ARMOR — battle HUD: health, reload, ability, objective, toasts, hints.
// Updates arrive at ~10 Hz via the engine's throttled HUD snapshot (DR-08).
import { useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Crosshair, Heart, Shield, Skull, Timer, Zap } from 'lucide-react'
import { useGameStore } from '@/store/gameStore'
import { TANK_BY_ID } from '@/game/config/tanks'

export default function HUD() {
  const hud = useGameStore((s) => s.hud)
  const toasts = useGameStore((s) => s.toasts)
  const hint = useGameStore((s) => s.hint)
  const profile = useGameStore((s) => s.profile)

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => useGameStore.getState().clearHint(hint.id), 4500)
    return () => clearTimeout(t)
  }, [hint])

  if (!hud) return null
  const hpFrac = Math.max(0, hud.hp / hud.maxHp)
  const low = hpFrac < 0.3
  const tank = TANK_BY_ID[profile.selectedTank]
  const abilityReady = hud.abilityCd <= 0

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* low-HP pulse vignette */}
      {low && !profile.settings.reducedMotion && <div className="na-lowhp pointer-events-none absolute inset-0" aria-hidden />}

      {/* top-left: hull + hp + weapon */}
      <div className="absolute left-3 top-3 flex flex-col gap-2">
        <div className="rounded-md border border-white/10 bg-black/55 p-3 backdrop-blur-sm">
          <div className="mb-1 flex items-center justify-between gap-6">
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              <Heart className="h-3 w-3 text-amber-400" aria-hidden /> {tank?.name ?? 'Hull'}
            </span>
            <span className={`text-sm font-bold tabular-nums ${low ? 'text-red-400' : 'text-foreground'}`}>{hud.hp}</span>
          </div>
          <div className="h-2.5 w-56 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-[width] duration-150 ${hpFrac > 0.55 ? 'bg-emerald-500' : hpFrac > 0.3 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${hpFrac * 100}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-6">
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              <Crosshair className="h-3 w-3 text-amber-400" aria-hidden /> {hud.weapon}
            </span>
            <span className={`text-[10px] font-bold uppercase tracking-widest ${hud.reload >= 1 ? 'text-emerald-400' : 'text-amber-300/80'}`}>
              {hud.reload >= 1 ? 'READY' : 'RELOADING'}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${hud.reload >= 1 ? 'bg-emerald-400' : 'bg-amber-400'}`}
              style={{ width: `${Math.min(100, hud.reload * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* top-center: objective */}
      <div className="absolute left-1/2 top-3 -translate-x-1/2">
        <div className="rounded-md border border-white/10 bg-black/55 px-4 py-2 text-center backdrop-blur-sm">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-200">{hud.objectiveText}</p>
          <div className="mx-auto mt-1.5 h-1 w-52 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-amber-400 transition-[width] duration-300" style={{ width: `${hud.objectiveProgress * 100}%` }} />
          </div>
          <div className="mt-1.5 flex items-center justify-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
            <span className="flex items-center gap-1">
              <Timer className="h-3 w-3" aria-hidden /> {Math.floor(hud.timeSec / 60)}:{String(hud.timeSec % 60).padStart(2, '0')}
            </span>
            <span>Wave {hud.wave}/{hud.waveTotal}</span>
            <span className="flex items-center gap-1">
              <Skull className="h-3 w-3" aria-hidden /> {hud.enemiesLeft}
            </span>
          </div>
        </div>
      </div>

      {/* kill / info toasts */}
      <div className="absolute left-3 top-40 flex w-64 flex-col gap-1.5" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`na-toast rounded border px-3 py-1.5 text-xs backdrop-blur-sm ${
              t.kind === 'good'
                ? 'border-emerald-500/30 bg-emerald-950/60 text-emerald-300'
                : t.kind === 'bad'
                  ? 'border-red-500/30 bg-red-950/60 text-red-300'
                  : 'border-white/15 bg-black/60 text-foreground/90'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>

      {/* bottom-left: ability */}
      <div className="absolute bottom-4 left-3">
        <div
          className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-amber-500/40 bg-black/60 backdrop-blur-sm"
          role="status"
          aria-label={`Ability ${hud.abilityName}${abilityReady ? ' ready' : ' on cooldown'}`}
        >
          <Zap className={`h-6 w-6 ${abilityReady ? 'text-amber-300' : 'text-muted-foreground'}`} aria-hidden />
          {!abilityReady && (
            <div
              className="absolute inset-0 bg-black/70"
              style={{ clipPath: `inset(${(1 - hud.abilityCd) * 100}% 0 0 0)` }}
              aria-hidden
            />
          )}
          {hud.abilityActive && <div className="absolute inset-0 border-2 border-amber-300/80" aria-hidden />}
          <span className="absolute bottom-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{hud.abilityName}</span>
          <kbd className="absolute right-1 top-1 rounded bg-white/10 px-1 text-[9px] text-foreground/70">E</kbd>
        </div>
      </div>

      {/* bottom-center hint */}
      {hint && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-black/70 px-4 py-2 text-xs text-amber-200 backdrop-blur-sm">
            <Shield className="h-3.5 w-3.5" aria-hidden />
            {hint.text}
          </div>
        </div>
      )}

      {/* score chip bottom-right */}
      <div className="absolute bottom-4 right-3 hidden sm:block">
        <Badge variant="outline" className="gap-1.5 border-white/15 bg-black/55 py-1.5 text-foreground/80">
          <Zap className="h-3.5 w-3.5 text-amber-400" aria-hidden /> {hud.kills} {hud.kills === 1 ? 'kill' : 'kills'} · +{hud.credits} cr
        </Badge>
      </div>
    </div>
  )
}
