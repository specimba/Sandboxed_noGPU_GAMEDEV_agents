'use client'

// NEXUS ARMOR — mission select: data-driven campaign cards with unlock chain.
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ArrowLeft, Coins, Clock, Flame, Lock, Play, Star, Target } from 'lucide-react'
import { useGameStore } from '@/store/gameStore'
import { MISSIONS, MISSION_BY_ID } from '@/game/config/missions'
import { isMissionUnlocked } from '@/game/systems/profile'
import type { MissionDef } from '@/game/core/types'

function objectiveLabel(m: MissionDef): string {
  switch (m.objective.type) {
    case 'eliminate':
      return 'Eliminate all waves'
    case 'survive':
      return `Survive ${m.objective.duration ?? 60}s`
    case 'destroy':
      return `Demolish ${m.objective.count ?? 3} bunkers`
    case 'boss':
      return 'Destroy GOLIATH'
  }
}

export default function MissionSelect({ onDeploy, onBack }: { onDeploy: (id: string) => void; onBack: () => void }) {
  const profile = useGameStore((s) => s.profile)
  const uiClick = () => click()

  return (
    <div className="absolute inset-0 flex flex-col bg-black/70 backdrop-blur-[3px]">
      <header className="flex items-center justify-between p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => { uiClick(); onBack() }} aria-label="Back to menu" className="border-white/15 bg-black/40">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl font-bold uppercase tracking-widest text-amber-200">Campaign</h2>
            <p className="text-xs text-muted-foreground">Clear missions to unlock the next. Stars: clear · beat par · finish above 35% HP.</p>
          </div>
        </div>
        <Badge variant="outline" className="gap-1.5 border-amber-500/40 py-1.5 text-amber-300">
          <Coins className="h-3.5 w-3.5" aria-hidden />
          {profile.credits.toLocaleString()}
        </Badge>
      </header>

      <main className="flex-1 overflow-hidden px-4 pb-4 sm:px-6 sm:pb-6">
        <ScrollArea className="h-full pr-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {MISSIONS.map((m, i) => {
              const unlocked = isMissionUnlocked(profile, m.id)
              const rec = profile.missionProgress[m.id]
              const prev = m.unlockAfter ? MISSION_BY_ID[m.unlockAfter] : null
              return (
                <Card
                  key={m.id}
                  className={`border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] ${unlocked ? '' : 'opacity-60'}`}
                >
                  <CardContent className="flex h-full flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Mission {String(i + 1).padStart(2, '0')} · {m.mapId.replace('_', ' ')}</p>
                        <h3 className="text-lg font-bold leading-tight text-foreground">{m.name}</h3>
                      </div>
                      <div className="flex gap-0.5" aria-label={`${rec?.stars ?? 0} of 3 stars`}>
                        {[1, 2, 3].map((s) => (
                          <Star key={s} className={`h-4 w-4 ${(rec?.stars ?? 0) >= s ? 'fill-amber-400 text-amber-400' : 'text-white/20'}`} aria-hidden />
                        ))}
                      </div>
                    </div>
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{m.briefing}</p>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <Badge variant="outline" className="gap-1 border-white/15 text-foreground/80">
                        <Target className="h-3 w-3" aria-hidden /> {objectiveLabel(m)}
                      </Badge>
                      <Badge variant="outline" className="gap-1 border-red-500/30 text-red-300/90">
                        <Flame className="h-3 w-3" aria-hidden /> difficulty {m.difficulty}
                      </Badge>
                      <Badge variant="outline" className="gap-1 border-white/15 text-foreground/80">
                        <Clock className="h-3 w-3" aria-hidden /> {m.waves.length} waves
                      </Badge>
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                      <span className="text-xs font-semibold text-amber-300">
                        +{m.rewards.credits} cr · +{m.rewards.xp} XP
                        {!rec?.cleared && <span className="ml-1 text-[10px] uppercase text-amber-500/80">first clear ×2</span>}
                      </span>
                      {unlocked ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            uiClick()
                            onDeploy(m.id)
                          }}
                          className="gap-1.5 border border-amber-500/40 bg-amber-500/15 font-bold uppercase tracking-wider text-amber-200 hover:bg-amber-500/25"
                        >
                          <Play className="h-3.5 w-3.5" aria-hidden /> {rec?.cleared ? 'Replay' : 'Deploy'}
                        </Button>
                      ) : (
                        <Badge variant="outline" className="gap-1.5 border-white/10 py-1.5 text-muted-foreground">
                          <Lock className="h-3 w-3" aria-hidden /> Clear {prev?.name ?? '???'}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </ScrollArea>
      </main>

      {/* sticky footer */}
      <footer className="border-t border-white/10 px-6 py-3 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>PvE campaign · losses still pay 40% of salvage — every run earns something.</span>
          <span className="text-muted-foreground/50">NEXUS ARMOR v1.0</span>
        </div>
      </footer>
    </div>
  )
}

function click(): void {
  import('./gameRefHolder').then(({ gameRefHolder }) => gameRefHolder.game?.audio.uiClick())
}
