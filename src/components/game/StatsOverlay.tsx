'use client'

// NEXUS ARMOR — performance stats overlay (F3). Research-backed budgets:
// <100 draw calls, 16.6ms frame (docs/research/tech.md §2).
import { useEffect, useState } from 'react'
import { useGameStore } from '@/store/gameStore'
import { gameRefHolder } from './gameRefHolder'

export default function StatsOverlay() {
  const show = useGameStore((s) => s.showStats)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!show) return
    const iv = setInterval(() => setTick((t) => t + 1), 250)
    return () => clearInterval(iv)
  }, [show])

  if (!show) return null
  void tick
  const stats = gameRefHolder.game?.getStats()
  if (!stats) return null

  const okCalls = stats.calls < 100
  const okMs = stats.ms < 16.6

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/10 bg-black/80 p-3 font-mono text-[11px] leading-relaxed text-emerald-300">
      <p>FPS {stats.fps} · {stats.ms}ms {okMs ? '✓' : '⚠'}</p>
      <p>draw calls {stats.calls} {okCalls ? '✓' : '⚠ (budget <100)'}</p>
      <p>tris {(stats.tris / 1000).toFixed(1)}k · particles {stats.particles}</p>
      <p>enemies {stats.enemies} · shells {stats.shells}</p>
      <p>quality {stats.tier}</p>
    </div>
  )
}
