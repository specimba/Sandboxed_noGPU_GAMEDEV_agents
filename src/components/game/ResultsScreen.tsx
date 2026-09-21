'use client'

// NEXUS ARMOR — results/debrief screen with animated reward tally.
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Coins, Flag, Home, RotateCcw, Star, Swords, TrendingUp, Wrench } from 'lucide-react'
import { useGameStore } from '@/store/gameStore'
import { MISSION_BY_ID } from '@/game/config/missions'
import { levelFromXp } from '@/store/gameStore'
import { nextMissionAfter } from '@/game/systems/profile'
import type { MissionResult } from '@/game/core/types'

function useCountUp(target: number, ms = 900): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

export default function ResultsScreen(props: { onRetry: () => void; onNext?: (id: string) => void; onQuit: () => void }) {
  const result = useGameStore((s) => s.result)
  if (!result) return null
  return <ResultsInner {...props} result={result} />
}

function ResultsInner({
  result,
  onRetry,
  onNext,
  onQuit,
}: {
  result: MissionResult
  onRetry: () => void
  onNext?: (id: string) => void
  onQuit: () => void
}) {
  const profile = useGameStore((s) => s.profile)
  const mission = MISSION_BY_ID[result.missionId]
  const nextId = result.victory ? nextMissionAfter(result.missionId) : null
  const nextMission = nextId ? MISSION_BY_ID[nextId] : null
  const accuracy = result.shotsFired > 0 ? Math.round((result.shotsHit / result.shotsFired) * 100) : 0
  const credits = useCountUp(result.creditsEarned)
  const lvl = levelFromXp(profile.xp)

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[3px]">
      <Card className="w-full max-w-lg border-white/10 bg-zinc-950/90">
        <CardContent className="p-6">
          <div className="text-center">
            <p className={`text-[11px] font-bold uppercase tracking-[0.5em] ${result.victory ? 'text-emerald-400' : 'text-red-400'}`}>
              {result.victory ? 'Mission accomplished' : 'Hull destroyed'}
            </p>
            <h2 className={`mt-1 text-4xl font-black uppercase tracking-wide ${result.victory ? 'text-amber-300' : 'text-red-300'}`}>
              {result.victory ? 'Victory' : 'Failed'}
            </h2>
            <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{mission?.name}</p>
            <div className="mt-3 flex justify-center gap-1.5" aria-label={`${result.stars} of 3 stars`}>
              {[1, 2, 3].map((s) => (
                <Star
                  key={s}
                  className={`h-7 w-7 transition-all ${result.stars >= s ? 'scale-100 fill-amber-400 text-amber-400' : 'scale-90 text-white/15'}`}
                  aria-hidden
                />
              ))}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 text-sm">
            <Row icon={<Flag className="h-3.5 w-3.5" />} label="Time" value={`${Math.floor(result.timeSec / 60)}:${String(result.timeSec % 60).padStart(2, '0')}`} />
            <Row icon={<Swords className="h-3.5 w-3.5" />} label="Kills" value={String(result.kills)} />
            <Row icon={<TrendingUp className="h-3.5 w-3.5" />} label="Accuracy" value={`${accuracy}%`} />
            <Row icon={<Wrench className="h-3.5 w-3.5" />} label="Damage dealt" value={result.damageDealt.toLocaleString()} />
          </div>

          <div className="mt-4 flex items-center justify-between rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-bold text-amber-200">
              <Coins className="h-4 w-4" aria-hidden />
              <span className="tabular-nums">+{credits.toLocaleString()}</span>
              <span className="text-muted-foreground">credits</span>
            </span>
            <span className="text-sm font-bold text-amber-200">+{result.xpEarned} XP</span>
          </div>
          {result.firstClear && result.victory && (
            <Badge className="mt-2 border-0 bg-amber-500/20 text-amber-300">First-clear bonus ×2 applied</Badge>
          )}
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Balance: {profile.credits.toLocaleString()} cr · Level {lvl.level} ({lvl.into}/{lvl.need} XP)
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button onClick={onRetry} className="border border-amber-500/40 bg-amber-500/15 font-bold uppercase tracking-wider text-amber-200 hover:bg-amber-500/25">
              <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden /> Retry
            </Button>
            {nextMission && result.victory && onNext ? (
              <Button
                onClick={() => onNext(nextId as string)}
                className="border border-emerald-500/40 bg-emerald-500/15 font-bold uppercase tracking-wider text-emerald-200 hover:bg-emerald-500/25"
              >
                Next: {nextMission.name}
              </Button>
            ) : (
              <Button variant="outline" onClick={onQuit} className="border-white/15">
                <Home className="mr-1.5 h-4 w-4" aria-hidden /> Menu
              </Button>
            )}
          </div>
          <button onClick={onQuit} className="mt-3 w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline">
            Back to command menu
          </button>
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  )
}
