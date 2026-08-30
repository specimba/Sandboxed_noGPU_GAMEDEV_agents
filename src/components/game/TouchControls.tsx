'use client'

// NEXUS ARMOR — touch controls: FIRE / ABILITY buttons (movement & aim sticks are
// handled directly on the canvas by InputSystem's touch zones).
import { useEffect, useState } from 'react'
import { Crosshair, Zap } from 'lucide-react'
import { gameRefHolder } from './gameRefHolder'

export default function TouchControls() {
  const [isTouch, setIsTouch] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    // defer the read out of the effect body (avoids sync-setState lint error)
    const raf = requestAnimationFrame(() => {
      setIsTouch(mq.matches || 'ontouchstart' in window)
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  if (!isTouch) return null

  const press = (which: 'fire' | 'ability', down: boolean) => {
    const game = gameRefHolder.game
    if (!game) return
    if (which === 'fire') game.input.fireBtn = down
    else game.input.abilityBtn = down
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="absolute bottom-6 right-4 flex flex-col items-center gap-3 sm:bottom-10 sm:right-8">
        <button
          aria-label="Ability button"
          className="pointer-events-auto flex h-14 w-14 touch-none items-center justify-center rounded-full border border-amber-400/50 bg-black/60 text-amber-300 active:bg-amber-500/30"
          onPointerDown={(e) => {
            e.preventDefault()
            press('ability', true)
          }}
          onPointerUp={() => press('ability', false)}
          onPointerLeave={() => press('ability', false)}
          onPointerCancel={() => press('ability', false)}
        >
          <Zap className="h-6 w-6" aria-hidden />
        </button>
        <button
          aria-label="Fire button"
          className="pointer-events-auto flex h-20 w-20 touch-none items-center justify-center rounded-full border-2 border-amber-400/60 bg-amber-500/20 text-amber-200 active:bg-amber-500/40"
          onPointerDown={(e) => {
            e.preventDefault()
            press('fire', true)
          }}
          onPointerUp={() => press('fire', false)}
          onPointerLeave={() => press('fire', false)}
          onPointerCancel={() => press('fire', false)}
        >
          <Crosshair className="h-9 w-9" aria-hidden />
        </button>
        <p className="rounded bg-black/50 px-2 py-1 text-center text-[10px] leading-tight text-muted-foreground">
          Left: drive stick
          <br />
          Right: aim drag
        </p>
      </div>
    </div>
  )
}
