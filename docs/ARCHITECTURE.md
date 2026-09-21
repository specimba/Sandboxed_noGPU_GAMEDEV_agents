# NEXUS ARMOR — Technical Architecture (v1)

**Stack:** TypeScript 5 · Next.js 16 App Router (single `/` route + `/api/profile`) · Three.js (WebGL) · Tailwind 4 + shadcn/ui (menus/HUD chrome) · Zustand (UI state bridge) · Prisma/SQLite (optional profile sync).

---

## 1. Module Map

```
src/game/
  core/
    types.ts        — shared types (inputs, configs, entity shapes, events)
    rng.ts          — mulberry32 seeded RNG (sim determinism; FX uses Math.random)
    events.ts       — typed EventBus (sim/render → UI, zero React coupling)
    pool.ts         — generic object pool
  config/           — DATA-DRIVEN TUNABLES (no magic numbers in systems)
    balance.ts      — global: frame step, economy, armor multipliers, difficulty table
    tanks.ts        — player hulls (stats, weapons, abilities, prices, colors)
    weapons.ts      — weapon defs (damage, reload, speed, splash, pierce, spread)
    enemies.ts      — enemy archetypes (stats, AI params, rewards, telegraphs)
    maps.ts         — map defs (size, theme, fog, light, cover budget, seed)
    missions.ts     — mission defs (map, objective, waves, rewards, unlock chain)
    upgrades.ts     — upgrade tracks/tiers/effect formulas
  sim/              — PURE simulation: no THREE.*, no DOM (deterministic, testable)
    vec.ts          — 2D vector/angle math
    world.ts        — collision world: AABB props, circle bodies, LOS raycast
    combat.ts       — armor-zone resolution, ricochet, splash falloff (pure fns)
    ai.ts           — enemy FSM: HUNT/COMBAT/FLANK/REPOSITION/RETREAT + telegraphs
    battle.ts       — BattleSim: fixed-step update, spawner, objectives, rewards
  render/           — Three.js layer (reads sim snapshots; never mutates sim)
    textures.ts     — procedural canvas textures (ground, sky, decals, particles)
    tankModel.ts    — procedural hull/turret/barrel builders (per config)
    scene.ts        — renderer, lights, fog, sky dome, ground, instanced props
    effects.ts      — pooled particles (2 Points systems), tracers (InstancedMesh),
                      explosions, scorch/tread decals, muzzle flashes, shockwaves
    battleView.ts   — sim ↔ scene sync w/ interpolation, health bars, floating dmg
    minimap.ts      — 2D canvas minimap (prerendered statics + dynamic dots)
  systems/
    input.ts        — keyboard/mouse/touch → PlayerInput (rebindable map later)
    cameraRig.ts    — chase camera, aim offset, shake (spring-damped)
    audio.ts        — procedural WebAudio SFX + engine loop + gesture unlock
    quality.ts      — adaptive quality tiers (DPR, shadows, particle caps)
    profile.ts      — XP curve, costs, star ratings (pure logic)
    save.ts         — versioned localStorage save/load + migrations + backup
  game.ts           — Game orchestrator: rAF loop, fixed-step accumulator (clamped),
                      pause/resume, visibility auto-pause, dispose
src/store/gameStore.ts — Zustand: screen state, profile (auto-persist), HUD snapshot
src/components/game/  — React overlays: MainMenu, MissionSelect, Garage, HUD,
                        PauseMenu, ResultsScreen, SettingsPanel, TouchControls,
                        StatsOverlay, GameShell (canvas + wiring)
src/app/api/profile/route.ts — GET/POST profile sync (Prisma, optional/offline-safe)
```

**Dependency rule:** `sim/` imports nothing from `render/` or React. `render/` reads sim state only. UI talks to the game exclusively through `game.ts` methods + EventBus callbacks. This keeps PvP/porting feasible: the same sim runs headless given an input stream.

## 2. Game Loop (evidence: `docs/research/tech.md` §3)

- Fixed step `dt = 1/60 s`; accumulator consumes up to `MAX_STEPS = 5` substeps/frame (spiral-of-death clamp; panic-resync after tab restore).
- Render interpolates tank transforms between previous/current sim state by accumulator alpha (no jitter at any refresh rate).
- `visibilitychange` → auto-pause battle (sim, timers, particles, audio all frozen).
- Per-frame budget target: **< 16.6 ms**, draw calls **< 100** (measured via `renderer.info`, visible in StatsOverlay F3).

## 3. Performance Strategy

| Technique | Where |
|---|---|
| InstancedMesh | props (crates/walls/rocks), border, decals, shells, tread marks |
| Pooled objects | projectiles (sim), particle indices, damage numbers (DOM), health bars |
| 2× THREE.Points | additive sparks/fire + normal-blend smoke (typed arrays, zero per-frame alloc) |
| Merged tank meshes | 4 draw calls per tank (hull+treads, turret, barrel, hatch merged into hull/turret) |
| Shared materials | team-colored materials cached; per-instance color via InstancedMesh.setColorAt |
| Fog + arena bounds | culls perception of draw distance; no per-object frustum work needed at this scale |
| Quality tiers | Low: DPR 1.0, shadows off, 300 particles · Med: DPR ≤1.5, 1024 PCF, 700 · High: DPR ≤2, 2048 PCFSoft, 1200. **Auto** monitors EMA frame time and steps up/down (hysteresis 3s/10s) |
| GC discipline | scratch vectors module-level; no per-frame object literals in hot paths |
| Budgets | sim: 11 tanks + 80 shells max; particles ≤1200; decals ring buffer 90; DOM floats ≤24 |

## 4. Determinism & Data-Driven Design

- Battle RNG: `mulberry32(mission.seed)`; only sim decisions use it. FX randomness uses `Math.random` (cannot desync gameplay).
- All tunables (damage, economy, difficulty, spawn tables, map layout budgets) live in `src/game/config/*` — systems read config, never hard-code.
- Difficulty multiplier table maps mission difficulty 1–10 → enemy HP/damage/aim-error/reaction.
- Adding content = adding config + zero system edits (recipes in §7).

## 5. Persistence (offline-first)

- `localStorage["nexus-armor-save-v1"]`: `{ schemaVersion, clientId, profile, settings, stats, updatedAt }`; migrations run sequentially; corrupt JSON → try backup key → fall back to fresh profile (never crash).
- Settings: volume, quality (auto/low/med/high), sensitivity, camera shake, damage numbers, reduced motion.
- **Server sync (optional):** debounced `POST /api/profile` on profile changes; on boot `GET` — newest `updatedAt` wins; any failure is silent (game is fully playable offline; benchmark kernel compliant: no backend required).
- Reset profile: Settings → "Reset progress" behind confirm dialog.

## 6. Error Handling & Fallbacks

- WebGL unavailable → full-screen friendly message with guidance (no white screen).
- AudioContext blocked/failed → game continues silently; UI shows muted state; retry on next gesture.
- Save corrupted → fresh profile + toast notice.
- Tab hidden mid-battle → auto-pause; resize/orientation → renderer + camera re-fit; touch detected → touch controls enabled automatically.

## 7. Extension Recipes

- **New tank:** add entry in `config/tanks.ts` (+ optional weapon in `weapons.ts`) → appears in Garage.
- **New map:** add `config/maps.ts` def (theme colors, cover budget, seed) → usable by any mission.
- **New mission:** add `config/missions.ts` def (map, objective, waves, rewards) → auto-appears in Mission Select with unlock chain.
- **New enemy archetype:** add `config/enemies.ts` def + pick FSM params → spawner/AI handle the rest.
- **New objective type:** implement one handler in `sim/battle.ts` (`updateObjective`) + config enum.
- **PvP later:** BattleSim already consumes an `InputProvider`; a network provider (socket.io mini-service) replaces the local one — render/UI untouched.

## 8. Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Shadow cost on weak GPUs | Follow-cam 70 m ortho shadow box, 1024 map on Med, off on Low; never per-object lights (1 shared flash light) |
| DOM damage numbers jank | Pooled 24 divs, project only visible, `transform` updates only |
| Three.js color management drift (r152+) | Explicit `outputColorSpace = SRGBColorSpace`, textures created with correct colorSpace |
| Determinism drift after edits | Seeds pinned in config; sim has zero wall-clock/float-external inputs |
| Scope creep vs polish | Roadmap gate: systems ship only after core loop verified (docs/ROADMAP.md) |
