# HOLLOW SUN — Game Design & Engineering Record

## 1. Product Vision

**HOLLOW SUN** is a browser-native arena shooter built around one image:
**the world is made of light, not geometry.** You are the last ember inside a
dead star. Your weapons are **living shards of light** that ricochet between
enemies and return like boomerangs. Enemies fire red light you must **graze**
to charge **Overdrive**. Every point you score **visibly rekindles the cracked
star** at the arena's heart — cracks widen, god-rays grow, the hex floor grid
ignites outward. Every 5th wave a **Warden** arrives; killing it permanently
grows your shard count for the run.

Direction: Geometry Wars / Nex Machina — readable, kinetic, light-driven —
reached with zero asset files (all geometry, materials, and audio procedural).

## 2. Core Loop

```
drift (WASD) → throw shards (click/F) → ricochet chains (auto-seek next foe)
     ↑                                        │
     │                                        ├─ chain multiplier climbs
     │                                        │   (pentatonic pitch climbs too)
graze red fire ──→ Overdrive ──→ world 0.55×, damage ×2
     │
score ──→ sun energy ──→ cracks / god-rays / floor ignition (visible power)
wave clear ──→ harder wave … every 5th: WARDEN ──→ kill = +1 permanent shard
```

Session shape: die in 2–6 minutes early on; a good run reaches Warden II/III
with 4–5 shards and a visibly burning sun. One more run.

## 3. The Numbers (binding)

| Domain | Value | Why |
|---|---|---|
| Arena radius | 34 u | fits the 55° camera at h=24; wall ring readable |
| Ember accel / max speed | 130 / 17 u·s⁻¹ | drag 7.5 → responsive, drift-y stop |
| Dash | 36 u·s⁻¹ × 0.14 s, cd 1.05 s | escapes striker dash (27) with margin |
| Embers (HP) | 3, invuln 1.2 s | three mistakes; graze gives agency back |
| Shard speed / turn | 47 u·s⁻¹ / 26 rad·s⁻¹ | homing feel; turn circle ≈ 1.8 u |
| Shard damage | 1 (2 in Overdrive) | drifter 2 hp = two-tap, weaver 3 |
| Bounces per throw | ≤ 5, chain seek radius 27 | chains feel earned, not automatic |
| Throw cooldown | 0.5 s | all-shard volleys, 1.5 s full recycle |
| Chain multiplier | 1 + 0.5 × bounces (cap ×5.5), decays 3.2 s | rewards planning the ricochet route |
| Graze radius | 2.3 u, +8 OD per bullet | safe-ish; contact is 1.05 u |
| Overdrive | 100 charge → 5 s, world 0.55×, dmg ×2, +0.35 s per graze | the moment the screen belongs to you |
| Bullet speed | 11.5 u·s⁻¹ (weaver burst 3 × 0.13 s) | dodgeable at 17 u·s⁻¹ |
| Warden | 34 + 13×kills hp, r 2.2, 14-bullet ring / 2.6 s | bullet-hell punctuation |
| Waves | budget 4 + 2.6·N pts (drifter 1 / striker 2 / weaver 3) | linear ramp, ~15 s early waves |
| Scores | drifter 50 / striker 80 / weaver 120 / warden 500, ×mult | chain-first scoring |
| Sun energy | √(score / 5200), capped 1 | early wins visible, late game still moves |
| Juice | hitstop 55 ms kill / 220 ms warden, trauma² shake, FOV kick 2.2° | per the feel bible |

## 4. Signature Systems

- **Boomerang shards** (`sim.ts`): orbit → fly (aim-magnet 9 u) → chain
  (seek next foe) → return (homing) → orbit. Per-foe re-hit cooldown 0.2 s.
  Wall impact reflects the shard inward — light bounces.
- **Sun rekindling** (`scene.ts`): one `uIgnite` uniform drives floor heat
  radius, crack opacity, god-ray brightness, star scale, ring opacity.
  Score is literally light.
- **Kill bursts** (`fx.ts`): 170–900 additive particles spawned per kill,
  pulled into a spiral toward the star (tangential + radial force), dying at
  its surface — the arena visibly *feeds* the sun.
- **Pentatonic ricochets** (`audio.ts`): every bounce plays the next note of a
  pentatonic ladder (C4→A5); a good chain plays a melody and stacks ×0.5.
- **Overdrive**: sim splits time into player-dt and enemy-dt; enemies and
  bullets run at 0.55× while you stay at 1.0. Ambience pitches down, bloom
  lifts, camera pulls back.

## 5. Architecture

```
src/game/
  constants.ts   every binding number above
  sim.ts         pure 2D simulation — zero rendering imports
  engine.ts      fixed 60 Hz timestep, hitstop, time-split, phases, events
  scene.ts       renderer, hex-grid floor shader, cracked sun, shells, bloom
  view.ts        pooled sim→scene sync (foes, shards, bullets, telegraphs)
  fx.ts          4096-particle pool (spiral bursts), shockwave rings
  cameraRig.ts   follow + trauma² shake + FOV kicks + title dive
  audio.ts       all-synth WebAudio (drone, pads, ladder, heartbeat)
  input.ts / store.ts / rng.ts
src/components/game/  GameCanvas, TitleScreen, Hud, Overlays, TouchControls
```

Fixed-timestep loop: accumulator + 5-step panic clamp. Sim emits 15 typed
events; engine routes them to fx/audio/store. React reads a zustand store at
~12 Hz for HUD; banners/toasts are event-driven.

## 6. QA Record (agent-browser, this build)

- Title → BEGIN → camera dive → wave 1 banner → spawn telegraphs → foes. ✅
- Throw → bounce → kill → spiral burst → floor pulse → score ×chain. ✅
  (Found & fixed: magnetized shards launched with zero velocity → miss;
   dead-target shards never returned home.)
- Death (3 embers) → slow-mo → "THE EMBER FADES" → REKINDLE restart. ✅
- Overdrive trigger → banner + world-slow + bloom lift. ✅
- Pause (Esc) freezes sim; resume/restart/sound/abandon all wired. ✅
- Best score/wave persisted (localStorage `hollowsun.best`). ✅
- 0 console errors on fresh load; `tsc` + `eslint` clean. ✅

## 7. Backlog (next candidates)

- Warden spiral pattern + escort spawns (data exists in constants)
- Second sun stage: rekindled sun starts burning foes near center
- Chain-route preview line (ghost arc of the planned ricochet)
- Biome palettes per 5 waves; endless mode leaderboards
