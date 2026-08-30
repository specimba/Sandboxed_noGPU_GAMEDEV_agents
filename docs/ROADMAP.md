# NEXUS ARMOR — Vertical-Slice Roadmap & Backlog (v1)

## Roadmap (each phase ends playable)

| Phase | Goal | Exit criteria |
|---|---|---|
| **P0 Design** | Research + docs (this set) | Vision, architecture, backlog approved-by-self; decisions recorded |
| **P1 Core slice** | Drive, aim, shoot, die, restart | Tank moves/turns smoothly; 2 enemy types; damage/armor/ricochet; 1 map; HUD skeleton; pause/restart; 60 FPS desktop |
| **P2 Loop closure** | Missions + rewards + persistence | Objective types (eliminate/survive/destroy); results screen; credits/XP; localStorage save; mission unlock chain |
| **P3 Meta & content** | Garage, 4 hulls, 10 missions, 3 maps, abilities, sniper telegraph | Full campaign playable; upgrades purchasable; balance pass |
| **P4 Feel & polish** | Game-feel pass | Hit-stop, shake, decals, tread marks, damage numbers, kill toasts, procedural audio mix, stars, tutorial hints |
| **P5 Robustness** | Kernel compliance | Adaptive quality, touch controls, resize/orientation, corrupt-save safety, visibility pause, reduced motion, QA checklist pass |
| **P6 Verify & docs** | Evidence | Agent-browser end-to-end run, lint clean, README, decision log updated |

## Backlog

### Critical (must ship in slice)
- **C-1** Core driving/aiming/shooting with game feel (accel, turret traverse, recoil)
- **C-2** Combat model: armor zones, ricochet, splash, LOS raycast cover
- **C-3** Enemy AI FSM (hunt/combat/flank/reposition/retreat) + difficulty scaling
- **C-4** Mission system: waves, 3 objective types, victory/defeat, restart
- **C-5** HUD: HP, reload, minimap, objective tracker, ability cooldown
- **C-6** Persistence: versioned save, profile reset behind confirm
- **C-7** Performance: pooling, instancing, adaptive quality, stats overlay
- **C-8** Menu → battle → results flow, pause/resume, visibility auto-pause

### High
- **H-1** Garage UI (hull select/purchase, upgrade tracks)
- **H-2** 4 player hulls with distinct weapons + abilities
- **H-3** 10-mission campaign, 3 themed maps, star ratings
- **H-4** Game-feel pack: hit-stop, shake, decals, tread marks, kill toasts, floating damage
- **H-5** Procedural audio: weapons/impacts/engine/ambient + gesture unlock
- **H-6** Tutorial hints in mission 1; controls reference card
- **H-7** Touch controls (sticks + fire/ability buttons)
- **H-8** Optional server profile sync API (offline-first)

### Medium
- **M-1** Daily-style bonus contract (rotating modifier mission)
- **M-2** Boss archetype with destructible parts
- **M-3** Key rebinding UI
- **M-4** Cosmetic paint schemes for hulls (earnable only)
- **M-5** Localization-ready strings
- **M-6** Replay share (seed + inputs export)

### Experimental
- **E-1** PvP duel mode via input-stream transport (architecture ready)
- **E-2** Destructible cover (crates break, LOS changes)
- **E-3** WebGPU renderer path (Three.js WebGPURenderer behind flag)
- **E-4** Squad command (order AI ally)
- **E-5** Procedural mission generator (seeded compositions)

## First Implementation Task (P1) — Acceptance Criteria
- [x] Tank accelerates/brakes/turns within tuned config values; turret tracks mouse with capped traverse speed
- [x] Firing spawns pooled projectiles; reload bar honest; muzzle flash + recoil visible
- [x] Enemies spawn from wave table, seek/engage/strafe; die with explosion; player death → defeat overlay → instant restart
- [x] Armor zones + ricochet verified by reading combat log in dev overlay
- [x] Stable 60 FPS desktop mid-range GPU with ≥8 enemies live (StatsOverlay)

## Status (end of first development session)
- P0–P5 complete and browser-verified end-to-end (see worklog Task 6); P6 complete (README + docs + lint + tsc clean).
- Measured: 37 draw calls in battle (budget <100), 0.7 ms frame work on headless GL — large headroom for real GPUs.
- Verified flows: boot→menu→campaign→battle→defeat/victory→rewards→garage→upgrades→persist across reload→pause freeze→unlock chain→mission 2.
- Next up (High backlog): H-1 polish pass on balance data, M-2 boss destructible parts, M-1 daily contracts.
