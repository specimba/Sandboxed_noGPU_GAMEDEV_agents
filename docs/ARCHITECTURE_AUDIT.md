# HOLLOW SUN — Architecture Audit (Step 0, Tech Lead)

## Current system map (verified against working tree @ 97a94d4)

| Layer | File | Owns | Purity |
|---|---|---|---|
| constants | `src/game/constants.ts` | every binding number, palette, starEnergy() | pure |
| **sim** | `src/game/sim.ts` | ember physics, shard state machine (orbit/fly/chain/return), foe FSMs (drifter/striker/weaver/warden), bullets, graze, waves, overdrive, score/chain | **pure TS, headless-runnable, zero three/DOM** |
| fx | `src/game/fx.ts` | 4096-particle pool (spiral kill bursts), shockwave rings, glow textures | three |
| scene | `src/game/scene.ts` | renderer, hex-floor shader (uIgnite/uPlayer/uRings), cracked sun + god-rays, shells, dust, bloom stack | three |
| view | `src/game/view.ts` | pooled sim→scene sync: foes, shard blades, bullet Points, telegraphs, marks, reticle | three |
| camera | `src/game/cameraRig.ts` | title orbit → fly → follow mode machine, trauma², FOV kicks | three |
| audio | `src/game/audio.ts` | all-synth WebAudio: pentatonic ladder, OD pad, drone, heartbeat | WebAudio only |
| input | `src/game/input.ts` | keyboard/mouse/touch edges | DOM |
| engine | `src/game/engine.ts` | fixed 60 Hz loop, hitstop, time-split, phase machine, sim-event routing, getEngine() | orchestrator |
| store | `src/game/store.ts` | zustand: phase, HUD mirror, banner/toasts, best persistence | client |
| UI | `src/components/game/*` | TitleScreen, Hud, Overlays, TouchControls, GameCanvas | React |

## Where roguelite systems will live (boundary ruling)

- **Pure sim (headless-testable):** run/room progression state, boon catalog + Mods
  stacking, elite variants, boss phases, dash-recall, knockback, splash, revive,
  dawn-currency formula, shrine upgrade defs. → new `src/game/run.ts` + extensions
  in `sim.ts`. Both import only `constants`/`rng`.
- **Engine (orchestration):** reward phase between rooms, biome/room sequencing,
  meta persistence wiring, boss-bar HUD emit, debug hooks for QA.
- **View/scene:** elite halos, boss bar is DOM (HUD), biome palette uniforms, boon
  card UI is React. No game logic here.
- **Audio:** biome drone param, boss-phase stingers.
- **Store:** meta profile `{dawn, unlocked[]}` persisted at `hollowsun.meta`.

## Risks

1. `sim.ts` is already ~700 lines — adding run logic inline would blur the sim/run
   boundary. **Mitigation: separate `run.ts` module, sim consumes a `Mods` struct.**
2. Reward overlay pauses the loop — pause/resume bugs would soft-lock runs.
   **Mitigation: reward reuses the existing paused-render path; single transition fn.**
3. New visuals (elite halos, biome tints) can break the light budget that caused
   the washout incident. **Mitigation: every palette lands with a screenshot pass
   and the floor `min(col, 1.15)` cap stays sacred.**
4. Biome tint = shader uniform changes — must not recompile shaders per room.

## Success metrics for this cycle

- Headless: a bot clears 3 biomes × 3 rooms (2 combat + boss) picking boons,
  under bun, zero NaN/exceptions, deterministic-enough logs.
- Browser: full golden path incl. reward shrine + shrine purchase + boss bar,
  0 console errors, tsc + eslint clean.
- Feel: dash-recall works and is discoverable; elites readable at a glance.
