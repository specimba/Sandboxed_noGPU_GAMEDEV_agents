'use client'

// NEXUS ARMOR — Garage: hull selection/purchase + 3-track upgrade tree per hull.
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { ArrowLeft, Check, Coins, Crosshair, Gauge, Heart, ShieldCheck, Sparkles, Wrench } from 'lucide-react'
import { useGameStore } from '@/store/gameStore'
import { TANKS, ABILITIES, TANK_BY_ID } from '@/game/config/tanks'
import { WEAPONS } from '@/game/config/weapons'
import { UPGRADE_TRACKS, MAX_UPGRADE_TIER } from '@/game/config/upgrades'
import { purchaseTank, purchaseUpgrade, upgradesFor } from '@/game/systems/profile'
import type { TankDef, UpgradeLevels } from '@/game/core/types'

function StatBar({ icon, label, value, max, hint }: { icon: React.ReactNode; label: string; value: number; max: number; hint?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        <span>{hint ?? Math.round((value / max) * 100) + '%'}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
    </div>
  )
}

export default function Garage({ onBack }: { onBack: () => void }) {
  const profile = useGameStore((s) => s.profile)
  const commit = useGameStore((s) => s.commit)
  const pushToast = useGameStore((s) => s.pushToast)
  const [viewTank, setViewTank] = useState<string>(profile.selectedTank)
  const def: TankDef = TANK_BY_ID[viewTank] ?? TANK_BY_ID.scout
  const owned = profile.ownedTanks.includes(def.id)
  const lv: UpgradeLevels = upgradesFor(profile, def.id)
  const weapon = WEAPONS[def.weaponId]
  const ability = ABILITIES[def.abilityId]
  const uiClick = () => click()

  const eff = {
    hp: Math.round(def.hp * (1 + lv.protection * 0.1)),
    speed: Math.round(def.speed * (1 + lv.mobility * 0.07) * 10) / 10,
    dmg: Math.round(weapon.damage * (1 + lv.firepower * 0.08) * 10) / 10,
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-black/70 backdrop-blur-[3px]">
      <header className="flex items-center justify-between p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => { uiClick(); onBack() }} aria-label="Back to menu" className="border-white/15 bg-black/40">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl font-bold uppercase tracking-widest text-amber-200">Garage</h2>
            <p className="text-xs text-muted-foreground">Every hull and upgrade is earned in battle. No premium ammo. Ever.</p>
          </div>
        </div>
        <Badge variant="outline" className="gap-1.5 border-amber-500/40 py-1.5 text-amber-300">
          <Coins className="h-3.5 w-3.5" aria-hidden />
          {profile.credits.toLocaleString()}
        </Badge>
      </header>

      <main className="flex flex-1 flex-col gap-4 overflow-hidden px-4 pb-4 sm:px-6 lg:flex-row lg:pb-6">
        {/* hull list */}
        <section aria-label="Hulls" className="flex shrink-0 flex-col gap-2 lg:w-80">
          <ScrollArea className="lg:h-full">
            <div className="flex gap-2 lg:flex-col">
              {TANKS.map((t) => {
                const isOwned = profile.ownedTanks.includes(t.id)
                const isSelected = profile.selectedTank === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      uiClick()
                      setViewTank(t.id)
                    }}
                    className={`flex-1 rounded-lg border p-3 text-left transition-colors lg:flex-none ${
                      viewTank === t.id ? 'border-amber-500/60 bg-amber-500/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]'
                    }`}
                    aria-pressed={viewTank === t.id}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{t.name}</span>
                      {isSelected && isOwned ? (
                        <Badge className="border-0 bg-amber-500/20 text-[10px] text-amber-300">ACTIVE</Badge>
                      ) : isOwned ? (
                        <Badge variant="outline" className="border-white/15 text-[10px] text-muted-foreground">OWNED</Badge>
                      ) : (
                        <Badge variant="outline" className="border-white/15 text-[10px] text-muted-foreground">{t.price.toLocaleString()} cr</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">{t.role}</p>
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        </section>

        {/* details */}
        <section className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.03] p-4 sm:p-6" aria-label="Hull details">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-2xl font-black uppercase tracking-wide">{def.name}</h3>
              <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80">{def.role}</p>
            </div>
            {owned ? (
              profile.selectedTank === def.id ? (
                <Badge className="border-0 bg-amber-500/20 text-amber-300">
                  <Check className="mr-1 h-3.5 w-3.5" aria-hidden /> Deployed
                </Badge>
              ) : (
                <Button
                  onClick={() => {
                    uiClick()
                    commit((p) => {
                      p.selectedTank = def.id
                    })
                  }}
                  className="border border-amber-500/40 bg-amber-500/15 font-bold uppercase tracking-wider text-amber-200 hover:bg-amber-500/25"
                >
                  Select hull
                </Button>
              )
            ) : (
              <Button
                disabled={profile.credits < def.price}
                onClick={() => {
                  uiClick()
                  const st = useGameStore.getState()
                  let ok = false
                  st.commit((p) => {
                    ok = purchaseTank(p, def.id)
                  })
                  pushToast(ok ? `${def.name} delivered to your hangar` : 'Not enough credits', ok ? 'good' : 'bad')
                }}
                className="border border-amber-500/40 bg-amber-500/15 font-bold uppercase tracking-wider text-amber-200 hover:bg-amber-500/25"
              >
                Purchase — {def.price.toLocaleString()} cr
              </Button>
            )}
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{def.description}</p>

          <div className="mt-5 grid max-w-2xl grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            <StatBar icon={<Heart className="h-3.5 w-3.5" />} label="Hit points" value={eff.hp} max={300} hint={String(eff.hp)} />
            <StatBar icon={<Gauge className="h-3.5 w-3.5" />} label="Top speed" value={eff.speed} max={26} hint={eff.speed + ' u/s'} />
            <StatBar icon={<Crosshair className="h-3.5 w-3.5" />} label="Shell damage" value={eff.dmg} max={200} hint={String(eff.dmg)} />
            <StatBar icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Front armor" value={1 - def.armor.front} max={0.65} hint={`${Math.round((1 - def.armor.front) * 100)}% block`} />
          </div>

          <div className="mt-5 grid max-w-2xl gap-3 sm:grid-cols-2">
            <Card className="border-white/10 bg-black/30">
              <CardContent className="p-4">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Weapon</p>
                <p className="mt-1 font-bold">{weapon.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {eff.dmg} dmg · {weapon.reloadTime.toFixed(2)}s reload · {weapon.projectileSpeed} u/s
                  {weapon.splashRadius > 0 ? ` · ${weapon.splashRadius}m splash` : ''}
                  {weapon.pierce > 0 ? ' · pierces' : ''}
                </p>
              </CardContent>
            </Card>
            <Card className="border-white/10 bg-black/30">
              <CardContent className="p-4">
                <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" aria-hidden /> Ability — <kbd className="rounded bg-white/10 px-1">E</kbd>
                </p>
                <p className="mt-1 font-bold">{ability.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{ability.description} ({ability.cooldown}s cooldown)</p>
              </CardContent>
            </Card>
          </div>

          <Separator className="my-6 bg-white/10" />

          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-foreground/90">
            <Wrench className="h-4 w-4 text-amber-400" aria-hidden /> Upgrade tracks
          </h4>
          <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
            {UPGRADE_TRACKS.map((track) => {
              const tier = lv[track.id]
              const maxed = tier >= MAX_UPGRADE_TIER
              const cost = maxed ? null : track.tierCosts[tier]
              return (
                <Card key={track.id} className="border-white/10 bg-black/30">
                  <CardContent className="flex h-full flex-col gap-2 p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-bold">{track.name}</p>
                      <div className="flex gap-1" aria-label={`Tier ${tier} of ${MAX_UPGRADE_TIER}`}>
                        {[0, 1, 2].map((i) => (
                          <span key={i} className={`h-2 w-2 rounded-full ${i < tier ? 'bg-amber-400' : 'bg-white/15'}`} />
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{track.description}</p>
                    {owned ? (
                      maxed ? (
                        <Badge variant="outline" className="mt-auto w-fit border-amber-500/40 text-amber-300">MAXED</Badge>
                      ) : (
                        <Button
                          size="sm"
                          disabled={cost === null || profile.credits < cost}
                          onClick={() => {
                            uiClick()
                            const st = useGameStore.getState()
                            let ok = false
                            st.commit((p) => {
                              ok = purchaseUpgrade(p, def.id, track.id)
                            })
                            pushToast(ok ? `${track.name} upgraded to tier ${tier + 1}` : 'Not enough credits', ok ? 'good' : 'bad')
                          }}
                          className="mt-auto w-fit border border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
                        >
                          Upgrade — {cost?.toLocaleString()} cr
                        </Button>
                      )
                    ) : (
                      <p className="mt-auto text-xs italic text-muted-foreground">Purchase hull first</p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 px-6 py-3 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>Upgrades deepen each hull&apos;s identity — they never gate content.</span>
          <span className="text-muted-foreground/50">NEXUS ARMOR v1.0</span>
        </div>
      </footer>
    </div>
  )
}

function click(): void {
  import('./gameRefHolder').then(({ gameRefHolder }) => gameRefHolder.game?.audio.uiClick())
}
