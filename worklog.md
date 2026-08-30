# Worklog

---
Task ID: 1-a
Agent: market-research (general-purpose)
Task: Market/competitive research for browser tank combat game

Work Log:
- Checked for existing worklog.md (none found; this file created).
- Loaded Skill instructions for web-search and web-reader (z-ai CLI: `z-ai function -n web_search` / `-n page_reader`).
- Ran 18 distinct web searches covering: WoT monetization/P2W, War Thunder Steam player counts, Gunner HEAT PC reception, Steel Hunters shutdown, Crossout grind/monetization, MWT: Tank Battles, Shell Shockers, Krunker.io, F2P retention/battle-pass design, War Thunder Metacritic/economy revolt, Enlisted, diep.io/Tanki Online, War Thunder May-2023 review bombing, browser-game market (CrazyGames), WoT Blitz milestones, session/retention benchmarks, Tanki Online/X history, GHPC commercial data.
- Fetched 8 full pages via page_reader: steamcharts.com for War Thunder / WoT Blitz / Crossout (live CCU + 30-day averages), GameDiscoverCo Shell Shockers deep dive, Deconstructor of Fun battle-pass analysis, Metacritic user reviews for War Thunder / Crossout / Enlisted (scores + negative-review themes). Extracted key figures from JSON with python3.
- Wrote findings to /home/z/my-project/docs/research/market.md: per-game breakdown table (12 games), 15 evidence-backed design principles, recurring-criticisms list with sources, browser-specific considerations, full source URL list. Unverified/estimate items explicitly flagged.

Stage Summary:
- War Thunder sustains ~50K average Steam CCU over 30 days (24h peak 85,653; all-time 125,317) — durable demand for persistent-progression vehicle combat; no established browser 3D tank game occupies this space at scale.
- Browser tank action is commercially proven at small scale: Shell Shockers earns low-seven-figures/yr, ~80–90% ad-driven, 39% Chromebook users, DAU peaks 300–350K — instant play + low-spec performance is the whole moat.
- #1 avoidable failure mode is monetization/grind resentment: WoT premium-ammo P2W claims, War Thunder's 2023 economy review bombing (~50K negative reviews, forced revert), Crossout's "deliberately crazy slow" grind (Steam CCU now ~1K avg and falling).
- Metacritic user scores for the genre leaders are poor (War Thunder 4.1/10, Crossout 5.9, Enlisted 5.9) with recurring themes: grind, predatory economy, matchmaking imbalance, P2W perception, optimization.
- Retention playbook applicable to a PvE-first browser tank game: session-sized daily missions, short battle-pass seasons (retention tool first, revenue second), visible progression every session, social/party virality built into the product.
- Distribution lesson: web games can't rely on press/ads; portals matter (CrazyGames 50M+ monthly players) and face-to-face virality (school/friend groups) drives growth — plan portal embeds, party links, mirror URLs.
- Cautionary tales: Steel Hunters (Wargaming) shut down ~6 months after EA launch on "unsustainable costs and low player retention"; Tanki X (client rewrite) failed and closed in 2020 — keep the core loop cheap, and keep player progression web-native and portable.
- Next actions: translate principles into a design brief (session length 5–15 min, PvE-first campaign, cosmetics+ads+pass monetization, Chromebook-class perf budget), then technical research for Three.js/WebGL performance targets.
---
Task ID: 1-b
Agent: tech-research (general-purpose)
Task: WebGL/Three.js technology research for browser tank game

Work Log:
- Checked /home/z/my-project/worklog.md (did not exist yet — proceeded fresh)
- Loaded Skill tool docs for web-search and web-reader; used `z-ai function -n web_search` / `-n page_reader` CLI
- Ran 19 distinct web searches: Three.js vs Babylon.js comparison, InstancedMesh/draw-call batching, fixed-timestep loops, mulberry32 seeded RNG, WebAudio procedural SFX, engine-sound synthesis, Tanki Online WebGL/Unity migration, Krunker optimization, Shell Shockers, localStorage vs IndexedDB, save schema migration, adaptive resolution/pixel ratio, shadow strategies for weak GPUs, AudioContext autoplay policy, THREE.Points particles, GC spikes/background-tab throttling, triangle budgets, MDN storage limits, Tanki Flash→Unity refinement
- Ran 11 page fetches (page_reader): utsubo 100 three.js tips, Isaac Sukin game loops, Chrome autoplay policy, LogRocket Three-vs-Babylon, Gaffer "Fix Your Timestep", Construct low-garbage (Cloudflare-blocked; retried once, fell back), three.js r152 color-management thread, MDN Web Storage, Tanki FPS wiki, Dexie Version docs, MDN Page Visibility API
- Verified key facts against fetched text (draw-call budget <100, 16.667ms timestep + spiral of death + panic clamp, Chrome 71 Web Audio suspended-state/resume(), r152 outputColorSpace/texture.colorSpace renames and defaults, localStorage synchronous vs IndexedDB async, visibilitychange semantics, Dexie version().upgrade() migrations)
- Wrote /home/z/my-project/docs/research/tech.md (engine-choice evidence, performance budget & techniques with per-claim source URLs or [unverified] tags, simulation architecture patterns, audio without assets, persistence & save versioning, game teardowns, full source list)
- Appended this entry to /home/z/my-project/worklog.md; no other files modified; no game code written

Stage Summary:
- Three.js confirmed as right fit: ~168.4 kB min+gzip core vs ~1.4 MB Babylon.js (Bundlephobia via LogRocket); unopinionated renderer lets us own a deterministic fixed-timestep loop; r152+ mandates outputColorSpace=SRGBColorSpace (default), texture.colorSpace per texture type, OutputPass for post-processing
- Performance budget: <100 draw calls/frame for 60fps, >500 struggles even on strong GPUs (utsubo); 16.6ms total frame budget; InstancedMesh/BatchedMesh/material sharing/static merging; Draco 90-95% + KTX2 ~10x GPU memory savings; ≤50-80 draw calls / ≤100-200k tris proposed low-end tier [unverified]
- Shadows: one directional light; low tier blob shadows only; disable shadow.autoUpdate when static; PCF < PCFSoft cost ladder (1024² vs 2048² maps)
- Game loop: accumulator + fixed dt (16.667ms) + alpha interpolation; clamp steps/frame (spiral of death) + panic branch after background tabs; auto-pause on visibilitychange; mulberry32 (32-bit seed/state) for all sim randomness
- GC: pool everything (shells/explosions/decals/nodes), preallocate typed arrays/ring buffers, scratch vectors outside loop, dispose() on teardown; 5ms pause already visible at 60fps
- Audio: zero-asset plan works — oscillators+ADSR, filtered noise buffers, RPM-pitched engine layer (redblobgames/Imphenzia precedents); AudioContext suspended until user gesture (Chrome 71+) → resume() on Start click
- Persistence: localStorage (sync, small JSON, schemaVersion field + sequential migrations) for profile; IndexedDB only if large data appears; offline-first dirty-flag + updatedAt for future server sync
- Teardowns: Tanki Online Flash→Unity after Flash EOL (Jan 1 2021), ships graphics-effects off-switch as #1 FPS lever; Krunker/Shell Shockers evidence thin (marked [unverified]); no published per-hardware frame budgets found — our low-end tier targets must be set by our own benchmarking
---
Task ID: 2
Agent: lead (Z.ai Code)
Task: Design docs — GDD, architecture, roadmap/backlog, decision records, QA plan

Work Log:
- Read both research docs (docs/research/market.md, tech.md) produced by agents 1-a/1-b
- Wrote docs/DESIGN.md (vision, pillars, market-informed analysis table, core loop, 4 hulls, 5 enemy archetypes, combat model, anti-P2W economy, audiovisual direction, accessibility, scope guardrails)
- Wrote docs/ARCHITECTURE.md (module map with dependency rule sim/render/UI isolation, fixed-timestep loop, perf budgets, persistence, fallbacks, extension recipes, risk table)
- Wrote docs/ROADMAP.md (P0–P6 phases with exit criteria + backlog: 8 Critical / 8 High / 6 Medium / 5 Experimental + first-task acceptance criteria)
- Wrote docs/DECISIONS.md (12 decision records: genre, Three.js, custom physics, fixed timestep, procedural assets, never-sell-power, offline-first persistence, React overlay UI, armor zones, adaptive quality, camera, single-route)
- Wrote docs/QA.md (kernel gates, combat/AI, economy, performance, accessibility checklists)

Stage Summary:
- Working title: NEXUS ARMOR; top-down/isometric chase-cam tank action, PvE-first, 3–8 min missions
- Core loop locked: deploy → battle waves/objectives → debrief rewards → garage upgrades → harder missions; losses pay 40% salvage + participation XP
- Anti-P2W is structural: no premium currency anywhere in code; all content credit-earned
---
Task ID: 3
Agent: lead (Z.ai Code)
Task: Core engine + battle simulation (deterministic, engine-agnostic)

Work Log:
- src/game/core/: types.ts (all config/runtime/event shapes), rng.ts (mulberry32), events.ts (typed EventBus), pool.ts
- src/game/config/: balance.ts (STEP, armor/ricochet consts, difficulty table 1–10, quality tiers, economy, adaptive-quality hysteresis), weapons.ts (8 defs), tanks.ts (4 hulls + abilities), enemies.ts (5 archetypes incl. GOLIATH boss), maps.ts (3 themed maps), missions.ts (10-mission campaign, 4 objective types, wave tables), upgrades.ts (3 tracks × 3 tiers)
- src/game/sim/: vec.ts, world.ts (AABB props, circle resolve, LOS raycast, segment sweeps), combat.ts (armor zones front/side/rear, aspect-based ricochet, splash falloff), entities.ts, ai.ts (hunt/combat/flank/retreat FSM + predictive intercept + reaction delays + sniper telegraphs), battle.ts (~1000 lines: fixed-step update, seeded cover gen with mirror symmetry, wave spawner (eliminate=scheduled-after-clear, others=absolute), 4 objective handlers, abilities, bunkers, shells with pierce/hitIds, HUD assembly, star ratings, rewards)
- Fixed during review: bunker-prop registration order, module augmentation moved to entities.ts, normalizes flag wiring, unused imports, allocation-free hit circle scratch

Stage Summary:
- Sim has ZERO engine/DOM imports — PvP-ready input-stream architecture
- Deterministic: seeded RNG for all sim decisions; FX uses Math.random (can't desync)
- Balance tuned during browser QA: d1 dmgMult 0.7→0.5, aimMult 1.6→1.85, reactMult 1.9→2.3; scout 90→105 HP; +SHELL_HIT_RADIUS 0.55 arcade forgiveness; +DEFEAT_XP 15
---
Task ID: 4
Agent: lead (Z.ai Code)
Task: Three.js rendering, VFX, camera, minimap, procedural audio

Work Log:
- render/textures.ts: procedural canvas textures (ground w/ patches+speckle+panel grid, radial/flash/reticle/scorch/tread/HP-bar)
- render/tankModel.ts: primitive-composed tanks (hull+glacis+treads+turret+barrel+muzzle brake), per-view materials, recoil-ready barrel pivot, muzzle flash sprite, enemy HP bars
- render/scene.ts: renderer (SRGB, ACES, PCF shadows), gradient sky dome shader, FogExp2, hemi+dir lights with follow-cam 70m shadow box, textured ground, instanced props (3 kinds, per-instance color jitter), border walls, 3D aim reticle
- render/effects.ts: 2 custom-shader Points systems (additive sparks 1400 cap / smoke 500 cap, typed arrays, swap-remove), pooled shockwave rings, shared flash light, instanced scorch decals (90 ring) + tread marks (220 ring), telegraph lines, smoke sources for wrecks
- render/battleView.ts: interpolated sim→scene sync (angle shortest-path lerp), view pooling, hit flash, HP bars, structure cores w/ emissive pulsing, pooled DOM floating damage numbers
- render/minimap.ts: prerendered static cover layer + dynamic dots/triangle/aim line
- systems/: input.ts (keyboard/mouse/touch sticks + fire/ability buttons, game-key scroll prevention), audio.ts (fully procedural WebAudio: 7 weapon sounds, explosions, ricochet ping, engine loop w/ throttle pitch, ambient, UI + victory/defeat stingers, gesture unlock), cameraRig.ts (aim-lean chase cam, spring shake, idle orbit), quality.ts (EMA frame monitor, 3s/10s hysteresis)

Stage Summary:
- Zero asset files: all visuals/audio synthesized (DR-05)
- Draw calls measured at 37 in battle — well under the <100 research budget
- Fixed: PCFSoft deprecation (r185) → PCFShadowMap; ParticleSystem private-field access via clear()
---
Task ID: 5
Agent: lead (Z.ai Code)
Task: Game orchestrator + React UI + progression/persistence + backend

Work Log:
- game.ts: Game class — rAF loop, fixed-step accumulator (max 5 substeps + panic resync), render interpolation alpha, hit-stop, fx→effects/audio routing, HUD emit at 10Hz, visibility auto-pause hook, idle showcase mode (orbiting selected hull behind menus), adaptive quality wiring, dispose
- store/gameStore.ts: Zustand bridge (screens, HUD, toasts, hints, profile commit w/ clone+persist+debounced server sync, battleEnd → applyResult + level-up/unlock toasts)
- systems/profile.ts: XP curve (100·n^1.4), unlock chain, first-clear, purchase logic (tanks/upgrades), stats; systems/save.ts: versioned localStorage envelope + backup rotation + validate/migrate + optional serverPull/serverPush (silent)
- components/game/: GameShell (engine lifecycle, StrictMode-safe canvas creation, Esc/F3/visibility handlers, damage vignette retrigger), BootScreen, MainMenu (live 3D showcase, profile strip, sticky footer), MissionSelect (10 cards, locks, stars, rewards), Garage (hull select/purchase, stat bars, weapon/ability cards, 3 upgrade tracks), SettingsPanel (volume/quality/shake/damage-numbers/reduced-motion/reset w/ confirm), HUD (HP/reload/objective/wave/minimap slot/ability cooldown/toasts/hints/low-HP pulse), ResultsScreen (stars, count-up rewards, next-mission), PauseMenu, TouchControls, StatsOverlay (F3)
- app: page.tsx → GameShell; layout metadata + viewport; globals.css game layer (dmg floats, vignettes, toasts, keyframes, reduced-motion media rule)
- Backend: prisma/schema.prisma PlayerSave + db:push; /api/profile GET/POST upsert (offline-safe, newest-updatedAt-wins)
- Fixed lint: missing imports (ScrollArea, Crosshair), conditional hook (results split to inner component), sync-setState-in-effect (rAF-deferred), unused expression
- Fixed tsc: private particle count, CircleBody scratch, profile.ts import paths, AutoQuality narrowing

Stage Summary:
- Full stack complete: 30+ source files, all systems separated per ARCHITECTURE.md
- Lint + tsc clean (project code); prisma synced; API live and serving profile syncs
---
Task ID: 6
Agent: lead (Z.ai Code)
Task: Agent Browser end-to-end verification loop + fixes

Work Log:
- Verified boot screen (WebGL live behind UI), menu (rotating showcase tank), mission select (locks/rewards/stars)
- Battle QA round 1: drive/aim/fire OK, enemy AI engaged + flanked, HP/HELD damage verified, defeat flow + honest stats; found difficulty-1 too lethal → balance fixes (Task 3 summary)
- Verified defeat participation XP (+15), retry, victory run (2 kills, 87 HP left, 12s → 3 stars), first-clear ×2 bonus, credits/XP/level persisted to localStorage (350cr, L2 79/264, m1 cleared 3★ bestTime 12)
- Verified NEXT → Scrap Line deployment, Escape pause (sim time frozen across 1.2s — kernel pass), resume, abandon
- Garage: purchased Bulwark (1200cr, auto-select), bought Firepower T1 (200cr), all persisted; Settings panel renders
- Input investigation: agent-browser keydown tool doesn't deliver key events to page (tool quirk); synthetic KeyboardEvents (same API browsers use) verified working — throttle=1, speed=16, position advancing
- Fast Refresh dev-only state mismatch identified (old UI + new engine after HMR of engine files) — not a production path; clean reload verified fine
- Performance readout: 37 draw calls, 0.7ms frame work, tier=high (headless); F3 overlay functional
- Post-fix reload: campaign shows ★★★ on m1, m2 unlocked, 6600 cr — persistence + unlock chain verified visually

Stage Summary:
- Kernel checklist (docs/QA.md): launch, first-interact, input, core loop, pause freeze, persistence, restart, visibility pause — ALL PASS in browser
- Console clean (only dev-mode HMR notes); lint + tsc clean
- Known dev-only artifact: Fast Refresh of engine modules desyncs UI/engine until reload (does not occur on fresh loads/production)
