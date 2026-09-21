'use client'

// NEXUS ARMOR — GameShell: owns the WebGL canvas, the engine instance, and all UI overlays.
import { useEffect, useRef, useCallback } from 'react'
import { Game } from '@/game/game'
import { useGameStore } from '@/store/gameStore'
import { isMissionFirstClear, upgradesFor } from '@/game/systems/profile'
import { Button } from '@/components/ui/button'
import MainMenu from './MainMenu'
import MissionSelect from './MissionSelect'
import Garage from './Garage'
import SettingsPanel from './SettingsPanel'
import HUD from './HUD'
import ResultsScreen from './ResultsScreen'
import PauseMenu from './PauseMenu'
import TouchControls from './TouchControls'
import StatsOverlay from './StatsOverlay'
import { gameRefHolder } from './gameRefHolder'

export default function GameShell() {
  const mountRef = useRef<HTMLDivElement>(null)
  const minimapSlotRef = useRef<HTMLDivElement>(null)
  const fxLayerRef = useRef<HTMLDivElement>(null)
  const vignetteRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Game | null>(null)

  const screen = useGameStore((s) => s.screen)
  const booted = useGameStore((s) => s.booted)
  const paused = useGameStore((s) => s.paused)
  const result = useGameStore((s) => s.result)

  const startMission = useCallback((missionId: string) => {
    const game = gameRef.current
    if (!game) return
    const st = useGameStore.getState()
    const ok = game.startMission(missionId, st.profile.selectedTank, upgradesFor(st.profile, st.profile.selectedTank), isMissionFirstClear(st.profile, missionId))
    if (ok) {
      st.clearResult()
      st.setScreen('battle')
      st.setPaused(false)
    }
  }, [])

  const quitToMenu = useCallback(() => {
    const game = gameRef.current
    const st = useGameStore.getState()
    game?.quitToMenu()
    st.clearResult()
    st.setPaused(false)
    st.setHud(null)
    st.setScreen('menu')
  }, [])

  const togglePause = useCallback(() => {
    const game = gameRef.current
    const st = useGameStore.getState()
    if (!game || st.screen !== 'battle' || st.result) return
    if (st.paused) {
      game.resume()
      st.setPaused(false)
    } else {
      game.pause()
      st.setPaused(true)
    }
  }, [])

  // ---------------------------------------------------------------- engine lifecycle
  useEffect(() => {
    const mount = mountRef.current
    const minimapSlot = minimapSlotRef.current
    const fxLayer = fxLayerRef.current
    if (!mount || !minimapSlot || !fxLayer) return

    const canvas = document.createElement('canvas')
    canvas.className = 'block h-full w-full'
    mount.appendChild(canvas)

    const minimapCanvas = document.createElement('canvas')
    minimapCanvas.className = 'block h-full w-full rounded-md'
    minimapSlot.appendChild(minimapCanvas)

    const game = new Game({
      canvas,
      minimapCanvas,
      fxLayer,
      onEvent: (e) => {
        useGameStore.getState().handleEvent(e)
        if (e.type === 'playerHit' && vignetteRef.current && !useGameStore.getState().profile.settings.reducedMotion) {
          const v = vignetteRef.current
          v.classList.remove('na-hit')
          void v.offsetWidth
          v.classList.add('na-hit')
        }
      },
    })
    gameRef.current = game
    gameRefHolder.game = game
    // debug handle (harmless in prod, invaluable for automated QA)
    ;(window as unknown as { __naGame?: Game }).__naGame = game
    useGameStore.getState().boot()
    game.applySettings({
      shake: useGameStore.getState().profile.settings.shake,
      damageNumbers: useGameStore.getState().profile.settings.damageNumbers,
      reducedMotion: useGameStore.getState().profile.settings.reducedMotion,
      volume: useGameStore.getState().profile.settings.volume,
      quality: useGameStore.getState().profile.settings.quality,
    })

    const onVis = () => {
      if (document.hidden && useGameStore.getState().screen === 'battle' && !useGameStore.getState().result) {
        game.pause()
        useGameStore.getState().setPaused(true)
      }
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code === 'Escape') {
        ev.preventDefault()
        togglePause()
      } else if (ev.code === 'F3') {
        ev.preventDefault()
        useGameStore.getState().toggleStats()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('keydown', onKey)
      game.dispose()
      gameRef.current = null
      gameRefHolder.game = null
      canvas.remove()
      minimapCanvas.remove()
    }
  }, [togglePause])

  // keep the idle showcase tank in sync with the selected hull
  useEffect(() => {
    if (screen === 'menu' || screen === 'missions' || screen === 'garage') {
      gameRef.current?.setIdleTank(useGameStore.getState().profile.selectedTank)
    }
  }, [screen, booted])

  const inBattle = screen === 'battle'
  const showChrome = !inBattle

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-background text-foreground">
      {/* WebGL canvas mount */}
      <div ref={mountRef} className={`absolute inset-0 ${inBattle && !paused && !result ? 'cursor-none' : ''}`} />

      {/* floating combat text layer */}
      <div ref={fxLayerRef} className="pointer-events-none absolute inset-0 overflow-hidden" />

      {/* damage vignette */}
      <div
        ref={vignetteRef}
        className="na-vignette pointer-events-none absolute inset-0 opacity-0"
        aria-hidden="true"
      />

      {/* minimap slot (always mounted so the canvas element survives screen switches) */}
      <div
        ref={minimapSlotRef}
        className={`absolute right-3 top-3 h-40 w-40 rounded-md border border-amber-500/30 bg-black/50 p-1 shadow-lg sm:h-48 sm:w-48 ${
          inBattle ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <span className="sr-only">Battle minimap</span>
      </div>

      {/* overlays */}
      {screen === 'boot' && <BootScreen />}
      {showChrome && booted && screen === 'menu' && <MainMenu onSettings={() => useGameStore.getState().setScreen('settings')} />}
      {showChrome && booted && screen === 'missions' && <MissionSelect onDeploy={startMission} onBack={() => useGameStore.getState().setScreen('menu')} />}
      {showChrome && booted && screen === 'garage' && <Garage onBack={() => useGameStore.getState().setScreen('menu')} />}
      {screen === 'settings' && <SettingsPanel onBack={() => useGameStore.getState().setScreen('menu')} />}

      {inBattle && <HUD />}
      {inBattle && <TouchControls />}
      {inBattle && paused && !result && <PauseMenu onResume={togglePause} onRestart={() => { const id = useGameStore.getState().missionId; if (id) startMission(id) }} onQuit={quitToMenu} />}
      {inBattle && result && (
        <ResultsScreen
          onRetry={() => {
            const id = result.missionId
            if (id) startMission(id)
          }}
          onNext={(id) => startMission(id)}
          onQuit={quitToMenu}
        />
      )}

      <StatsOverlay />
    </div>
  )
}

function BootScreen() {
  const start = () => {
    const game = gameRefHolder.game
    game?.audio.unlock()
    game?.audio.uiClick()
    useGameStore.getState().setScreen('menu')
  }
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-b from-black/80 via-black/60 to-black/85 backdrop-blur-[2px]">
      <div className="animate-[naFadeIn_0.8s_ease-out] text-center">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.5em] text-amber-400/80">Original browser tank combat</p>
        <h1 className="bg-gradient-to-b from-amber-200 via-amber-400 to-amber-700 bg-clip-text text-6xl font-black uppercase tracking-tight text-transparent drop-shadow-[0_4px_24px_rgba(245,158,11,0.25)] sm:text-8xl">
          Nexus Armor
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
          Command original VX hulls. Angle your armor, hold the line, and earn every unlock — no downloads, no pay-to-win.
        </p>
      </div>
      <Button
        size="lg"
        onClick={start}
        className="mt-10 h-14 border border-amber-500/40 bg-amber-500/10 px-10 text-base font-bold uppercase tracking-[0.3em] text-amber-300 hover:bg-amber-500/20"
      >
        Deploy
      </Button>
      <p className="mt-6 text-[11px] uppercase tracking-widest text-muted-foreground/60">
        WASD drive · Mouse aim · Click fire · E ability
      </p>
    </div>
  )
}
