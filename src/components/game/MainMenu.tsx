'use client'

// NEXUS ARMOR — main menu. The 3D showcase tank orbits behind this overlay.
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Coins, Crosshair, Gamepad2, Settings, Shield, Swords } from 'lucide-react'
import { useGameStore, levelFromXp } from '@/store/gameStore'
import { accuracyOf } from '@/game/systems/profile'

export default function MainMenu({ onSettings }: { onSettings: () => void }) {
  const profile = useGameStore((s) => s.profile)
  const setScreen = useGameStore((s) => s.setScreen)
  const lvl = levelFromXp(profile.xp)
  const uiClick = () => gameClick()

  return (
    <div className="absolute inset-0 flex flex-col bg-gradient-to-r from-black/85 via-black/45 to-transparent">
      {/* top profile strip */}
      <header className="flex items-center justify-between p-4 sm:p-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Shield className="h-4 w-4 text-amber-400" aria-hidden />
          <span>Armor Division Command</span>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="gap-1.5 border-amber-500/40 py-1.5 text-amber-300">
            <Coins className="h-3.5 w-3.5" aria-hidden />
            {profile.credits.toLocaleString()}
          </Badge>
          <Badge variant="outline" className="py-1.5 text-muted-foreground">
            Lv {lvl.level}
          </Badge>
        </div>
      </header>

      {/* main block */}
      <main className="flex flex-1 flex-col justify-center px-6 sm:px-14 lg:px-24">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.5em] text-amber-400/80">Original IP · Browser tank combat</p>
        <h1 className="max-w-xl bg-gradient-to-b from-amber-100 via-amber-300 to-amber-600 bg-clip-text text-5xl font-black uppercase leading-[0.95] tracking-tight text-transparent sm:text-7xl">
          Nexus<br />Armor
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
          Angle your armor. Hold the line. Every credit is earned in battle — never bought.
        </p>

        <nav className="mt-8 flex max-w-xs flex-col gap-3" aria-label="Main menu">
          <Button
            size="lg"
            onClick={() => {
              uiClick()
              setScreen('missions')
            }}
            className="h-13 justify-between border border-amber-500/40 bg-amber-500/10 px-6 text-base font-bold uppercase tracking-[0.2em] text-amber-200 hover:bg-amber-500/20"
          >
            <span className="flex items-center gap-3">
              <Swords className="h-5 w-5" aria-hidden /> Deploy
            </span>
            <span className="text-xs text-amber-500/70">campaign</span>
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => {
              uiClick()
              setScreen('garage')
            }}
            className="justify-between border-white/15 bg-black/40 px-6 text-base font-semibold uppercase tracking-[0.2em] hover:bg-white/10"
          >
            <span className="flex items-center gap-3">
              <Crosshair className="h-5 w-5" aria-hidden /> Garage
            </span>
            <span className="text-xs text-muted-foreground">{profile.ownedTanks.length}/4 hulls</span>
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => {
              uiClick()
              onSettings()
            }}
            className="justify-between border-white/15 bg-black/40 px-6 text-base font-semibold uppercase tracking-[0.2em] hover:bg-white/10"
          >
            <span className="flex items-center gap-3">
              <Settings className="h-5 w-5" aria-hidden /> Settings
            </span>
          </Button>
        </nav>

        <div className="mt-8 max-w-xs">
          <div className="mb-1.5 flex justify-between text-[11px] uppercase tracking-widest text-muted-foreground">
            <span>Level {lvl.level}</span>
            <span>
              {lvl.into}/{lvl.need} XP
            </span>
          </div>
          <Progress value={(lvl.into / lvl.need) * 100} className="h-1.5 bg-white/10" aria-label="Experience progress" />
        </div>
      </main>

      {/* controls card + sticky footer */}
      <div className="px-6 sm:px-14 lg:px-24">
        <Separator className="bg-white/10" />
        <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 py-4 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5">
              <Gamepad2 className="h-3.5 w-3.5" aria-hidden />
              <kbd className="rounded bg-white/10 px-1.5 py-0.5">WASD</kbd> drive
            </span>
            <span>
              <kbd className="rounded bg-white/10 px-1.5 py-0.5">Mouse</kbd> aim ·{' '}
              <kbd className="rounded bg-white/10 px-1.5 py-0.5">LMB</kbd> fire
            </span>
            <span>
              <kbd className="rounded bg-white/10 px-1.5 py-0.5">E</kbd> ability ·{' '}
              <kbd className="rounded bg-white/10 px-1.5 py-0.5">Space</kbd> brake ·{' '}
              <kbd className="rounded bg-white/10 px-1.5 py-0.5">Esc</kbd> pause
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span>
              {profile.stats.battles} battles · {profile.stats.wins} wins · {accuracyOf(profile.stats)}% accuracy
            </span>
            <span className="text-muted-foreground/50">v1.0 · Three.js</span>
          </div>
        </footer>
      </div>
    </div>
  )
}

function gameClick(): void {
  import('@/components/game/gameRefHolder').then(({ gameRefHolder }) => {
    gameRefHolder.game?.audio.uiClick()
  })
}
