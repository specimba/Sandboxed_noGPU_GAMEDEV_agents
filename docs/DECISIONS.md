# NEXUS ARMOR — Decision Records

Format: **Problem → Evidence → Implementation → Risks/Reversal**.

---

**DR-01 · Genre: top-down/isometric tank action, PvE-first**
Problem: brief demands tank combat with readable tactical play in a browser.
Evidence: WoT/War Thunder prove armor+positioning demand (SteamCharts ~50K CCU); browser successes (Shell Shockers, diep.io) prove instant-readable action wins on web; genre's worst reviews target matchmaking/PvP friction (Metacritic 4.1 WT).
Implementation: isometric chase camera, mouse-aim turret, PvE missions with telegraphed AI; PvP later via input-stream sim.
Risks: less "immersive" than 3rd/1st-person → mitigated by camera polish + game feel; reversal cheap (camera rig is isolated).

**DR-02 · Engine: Three.js over Babylon.js**
Problem: pick GPU renderer.
Evidence: ~168 kB vs ~1.4 MB core (Bundlephobia via LogRocket); Three's unopinionation suits a custom fixed-step loop (tech.md §1).
Implementation: raw three (no react-three-fiber — we own the rAF loop; React renders only UI chrome).
Risks: must hand-build effects/physics → accepted; reversible but costly after content ships.

**DR-03 · Custom lightweight physics, no physics engine**
Problem: tank combat needs AABB cover collision, circle bodies, LOS raycasts, projectile sweeps.
Evidence: full physics libs (cannon/rapier) add weight and nondeterminism for zero gameplay gain at this entity count (<100).
Implementation: `sim/world.ts` — fixed-axis AABBs + circles + segment sweeps; deterministic seeded RNG.
Risks: no ragdoll/destruction → cover destruction deferred (E-2); swapping in rapier later is isolated to sim/world.

**DR-04 · Fixed timestep + interpolation**
Problem: stable, reproducible sim across refresh rates.
Evidence: Gaffer "Fix Your Timestep"; spiral-of-death clamp; visibility panic branch (tech.md §3).
Implementation: accumulator, dt=1/60, max 5 substeps, render lerp of prev/current transforms.
Risks: none material; alternative (variable dt) rejected — breaks determinism goal.

**DR-05 · Procedural assets (zero downloads)**
Problem: benchmark requires original/licensed assets and instant load; no art pipeline available.
Evidence: WebAudio synth precedents (redblobgames motor, Imphenzia); canvas textures standard practice; Shell Shockers' low-spec audience punishes heavy assets.
Implementation: canvas-generated ground/sky/particle/reticle textures; tank models composed from primitives with merged geometry + vertex-appropriate materials; all SFX synthesized.
Risks: visual ceiling → mitigated by lighting/fog/palette/decals/particles; can drop in GLTF later without touching systems (render/tankModel is the only consumer).

**DR-06 · Never sell power**
Problem: monetization path must not poison trust.
Evidence: P2W is the genre's loudest criticism (WoT premium ammo; Enlisted reviews); Shell Shockers' ads-first model is web-proven.
Implementation: all content earnable; no premium currency in codebase; future revenue = ads/cosmetics only (documented).
Risks: none for slice.

**DR-07 · Offline-first persistence + optional server sync**
Problem: progress must survive reload AND support future online features; benchmark kernel forbids requiring a backend.
Evidence: Tanki X stranding player investment (shutdown); versioned localStorage migration patterns (tech.md §5).
Implementation: versioned localStorage primary; debounced POST/GET `/api/profile` silent best-effort; newest-updatedAt-wins merge.
Risks: merge conflicts multi-device → acceptable v1; server is authoritative-later (flagged in schema via updatedAt).

**DR-08 · UI: React overlays, not in-canvas UI**
Problem: menus/HUD need quality fast; game needs a stable render loop.
Evidence: React re-render cost is fine at menu/HUD cadence (HUD throttled ~15 Hz + event-driven); shadcn/ui available.
Implementation: React overlays for menus/HUD; canvas owns world; damage numbers are pooled DOM (cheap, crisp); minimap is 2D canvas.
Risks: HUD re-render jank → mitigated by throttling + direct-DOM bars; if it slips, HUD goes canvas — isolated component.

**DR-09 · Armor zone model over per-part damage**
Problem: depth vs readability in damage model.
Evidence: WT's part-sim is its hook but also its learning cliff; GHPC (91% positive) shows sim-lite suffices; browser readability favors zones.
Implementation: front/side/rear multipliers + front ricochet chance + splash falloff; damage numbers + debrief reinforce learning.
Risks: depth ceiling → per-part damage possible later via same combat resolver.

**DR-10 · Adaptive quality default-on**
Problem: unknown hardware; benchmark targets Chromebook-class.
Evidence: Krunker/Shell Shockers degradation lessons; no published per-hardware budgets → measure our own.
Implementation: 3 tiers (DPR/shadows/particles) + Auto mode stepping on EMA frame time with hysteresis; stats overlay exposes truth (F3).
Risks: oscillation → hysteresis windows 3s down / 10s up; user override respected.

**DR-11 · Camera: chase-cam follow + ground-plane mouse aim**
Problem: aiming feel.
Evidence: twin-stick readability (diep.io) + slight chase depth (Tanki) hybrid; full RTS click-to-move feels sluggish for action.
Implementation: camera trails hull with velocity lead; turret aims at mouse ray ∩ ground; touch maps right-drag to aim.
Risks: long-range sniping precision → aim assist not needed at these ranges; revisit with PvP data.

**DR-12 · React 19 + Next 16 route structure: single `/` route**
Problem: platform constraint (sandbox exposes one route; gateway single port).
Implementation: all screens are overlay states in one route; `/api/profile` optional; no client navigation.
Risks: deep-linking to missions unavailable → acceptable; could add query-param deep link later.
