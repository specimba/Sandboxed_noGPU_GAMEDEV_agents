'use client'

// NEXUS ARMOR — pause menu. Pausing freezes the sim entirely (kernel requirement).
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Home, Play, RotateCcw, Settings } from 'lucide-react'
import { useGameStore } from '@/store/gameStore'

export default function PauseMenu({ onResume, onRestart, onQuit }: { onResume: () => void; onRestart: () => void; onQuit: () => void }) {
  const setScreen = useGameStore((s) => s.setScreen)
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/65 p-4 backdrop-blur-[3px]">
      <Card className="w-full max-w-xs border-white/10 bg-zinc-950/90">
        <CardContent className="flex flex-col gap-2.5 p-6">
          <h2 className="mb-2 text-center text-2xl font-black uppercase tracking-[0.3em] text-amber-200">Paused</h2>
          <Button onClick={onResume} className="border border-amber-500/40 bg-amber-500/15 font-bold uppercase tracking-wider text-amber-200 hover:bg-amber-500/25">
            <Play className="mr-1.5 h-4 w-4" aria-hidden /> Resume
          </Button>
          <Button variant="outline" onClick={onRestart} className="border-white/15">
            <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden /> Restart mission
          </Button>
          <Button variant="outline" onClick={() => setScreen('settings')} className="border-white/15">
            <Settings className="mr-1.5 h-4 w-4" aria-hidden /> Settings
          </Button>
          <Button variant="outline" onClick={onQuit} className="border-red-500/30 text-red-300 hover:bg-red-500/10">
            <Home className="mr-1.5 h-4 w-4" aria-hidden /> Abandon mission
          </Button>
          <p className="mt-2 text-center text-[10px] uppercase tracking-widest text-muted-foreground/60">
            Simulation frozen · Esc resumes
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
