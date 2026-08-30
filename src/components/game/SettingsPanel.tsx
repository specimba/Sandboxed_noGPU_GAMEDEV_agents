'use client'

// NEXUS ARMOR — settings: audio, quality, accessibility, reset (behind confirmation).
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { ArrowLeft, Volume2, Monitor, Camera, Eye, Accessibility, Trash2 } from 'lucide-react'
import { useGameStore } from '@/store/gameStore'
import type { AutoQuality } from '@/game/core/types'

export default function SettingsPanel({ onBack }: { onBack: () => void }) {
  const profile = useGameStore((s) => s.profile)
  const commit = useGameStore((s) => s.commit)
  const resetProgress = useGameStore((s) => s.resetProgress)
  const pushToast = useGameStore((s) => s.pushToast)
  const s = profile.settings
  const [confirmOpen, setConfirmOpen] = useState(false)

  const apply = (patch: Partial<typeof s>) => {
    commit((p) => {
      Object.assign(p.settings, patch)
    })
    const st = useGameStore.getState()
    import('@/components/game/gameRefHolder').then(({ gameRefHolder }) => {
      gameRefHolder.game?.applySettings({
        shake: st.profile.settings.shake,
        damageNumbers: st.profile.settings.damageNumbers,
        reducedMotion: st.profile.settings.reducedMotion,
        volume: st.profile.settings.volume,
        quality: st.profile.settings.quality,
      })
    })
  }

  return (
    <div className="absolute inset-0 flex flex-col items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-[3px] sm:p-8">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={onBack} aria-label="Back" className="border-white/15 bg-black/40">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-xl font-bold uppercase tracking-widest text-amber-200">Settings</h2>
        </div>

        <div className="flex flex-col gap-3">
          <Card className="border-white/10 bg-white/[0.04]">
            <CardContent className="flex items-center gap-4 p-4">
              <Volume2 className="h-5 w-5 shrink-0 text-amber-400" aria-hidden />
              <div className="flex-1">
                <p className="text-sm font-semibold">Master volume</p>
                <p className="text-xs text-muted-foreground">All audio is synthesized in-browser — nothing to download.</p>
              </div>
              <Slider
                className="w-32"
                value={[s.volume]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={([v]) => apply({ volume: v })}
                aria-label="Master volume"
              />
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.04]">
            <CardContent className="flex items-center gap-4 p-4">
              <Monitor className="h-5 w-5 shrink-0 text-amber-400" aria-hidden />
              <div className="flex-1">
                <p className="text-sm font-semibold">Graphics quality</p>
                <p className="text-xs text-muted-foreground">Auto monitors frame time and adapts resolution, shadows and particles.</p>
              </div>
              <Select value={s.quality} onValueChange={(v) => apply({ quality: v as AutoQuality })}>
                <SelectTrigger className="w-28" aria-label="Graphics quality">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.04]">
            <CardContent className="flex items-center gap-4 p-4">
              <Camera className="h-5 w-5 shrink-0 text-amber-400" aria-hidden />
              <div className="flex-1">
                <p className="text-sm font-semibold">Camera shake</p>
                <p className="text-xs text-muted-foreground">Impact kick and explosion rumble.</p>
              </div>
              <Switch checked={s.shake} onCheckedChange={(v) => apply({ shake: v })} aria-label="Camera shake" />
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.04]">
            <CardContent className="flex items-center gap-4 p-4">
              <Eye className="h-5 w-5 shrink-0 text-amber-400" aria-hidden />
              <div className="flex-1">
                <p className="text-sm font-semibold">Damage numbers</p>
                <p className="text-xs text-muted-foreground">Floating combat feedback for every shell.</p>
              </div>
              <Switch checked={s.damageNumbers} onCheckedChange={(v) => apply({ damageNumbers: v })} aria-label="Damage numbers" />
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.04]">
            <CardContent className="flex items-center gap-4 p-4">
              <Accessibility className="h-5 w-5 shrink-0 text-amber-400" aria-hidden />
              <div className="flex-1">
                <p className="text-sm font-semibold">Reduced motion</p>
                <p className="text-xs text-muted-foreground">Disables hit-stop, camera shake and heavy screen effects.</p>
              </div>
              <Switch checked={s.reducedMotion} onCheckedChange={(v) => apply({ reducedMotion: v })} aria-label="Reduced motion" />
            </CardContent>
          </Card>

          <Card className="border-red-500/20 bg-red-500/[0.04]">
            <CardContent className="flex items-center gap-4 p-4">
              <Trash2 className="h-5 w-5 shrink-0 text-red-400" aria-hidden />
              <div className="flex-1">
                <p className="text-sm font-semibold">Reset progress</p>
                <p className="text-xs text-muted-foreground">Deletes local credits, XP, hulls and mission stars. Cannot be undone.</p>
              </div>
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="border-red-500/40 text-red-300 hover:bg-red-500/10">
                    Reset
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="border-white/10 bg-zinc-950">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset all progress?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This wipes your credits, XP, hulls, upgrades and mission stars from this device.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 text-white hover:bg-red-700"
                      onClick={() => {
                        resetProgress()
                        setConfirmOpen(false)
                        pushToast('Progress reset', 'bad')
                      }}
                    >
                      Reset everything
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 flex justify-center">
          <Button onClick={onBack} className="border border-amber-500/40 bg-amber-500/15 px-8 font-bold uppercase tracking-widest text-amber-200 hover:bg-amber-500/25">
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
