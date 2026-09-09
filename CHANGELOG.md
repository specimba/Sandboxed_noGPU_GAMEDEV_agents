# CHANGELOG — every build states what improved, with evidence

Rule R2 (docs/QUALITY_AUDIT.md): each entry lists objective improvements over the previous build in graphics, mechanics, or architecture — with screenshot paths and gate receipts. No entry, no ship.

---

## SPRINT 17 · BUILD 1 — "PROOF OF LIFE" (base `52f67c0`, stamped 2026-09-09T05:52Z)

**Owner verdict that drove this sprint:** *"I played and nothing big changes done actually, music or whatever that hell it is sound persistent on increasing over time came back and also near everything is same… you are doing nothing at all and taking fixed bug back like a dumb?"* — every section below answers that, in the plan's own Phase 0–3 order.

### (0) DECLARED AT THE TOP — the lost-work ledger (R3 honesty law)
The sprint 14–16 reports cited commit `e7e5822` — **that commit does not exist** (`git cat-file` fatal). Everything since Sprint 13 lived uncommitted in the working tree; the "fixed" audio bug's fix was never committed, so later sessions could (and did) overwrite it back. The "stun/slow dormant kit" the Sprint 16 report claimed to ship **does not exist in the code at all** (`src/game/sim.ts` had zero CC state). Weaver burst aim consumed `Math.random()` inside the sim (determinism violation at sim.ts:995). Full receipts with file:line: **`docs/SPRINT17_FORENSICS.md`**. The inherited tree is now baseline commit `52f67c0`, so every future claim is diffable against a hash that resolves.

### (a) Bug fixes — root causes, not patches
- **The audio escalation is dead by construction** (`src/game/audio.ts` + `engine.ts`): root cause was `setDanger()` — danger tracks nearest-foe distance (engine.ts:645), waves thicken → drone gain doubled, and the value was *never reset* on death/pause/title, so the drone kept its escalated level forever. Three independent kills: (1) engine writes `setDanger(0)` on every phase entry — startRun/pause/abandon/onDeath; (2) `AudioEngine.tick(dt)` runs **every frame in every phase** and force-decays any layer not refreshed within 0.6 s (watchdog failsafe — no ambience state can outlive its driver); (3) danger no longer scales raw gain at all — it opens a filter and adds arp density under a hard `DRONE_MAX` ceiling. Verified live: drone gain read back at 0.05 base, danger 0, after multiple deaths mid-session.
- **`setOverdrive` no longer clobbers biome identity** — it restored hardcoded drone frequencies (the old audio.ts:182), erasing the biome root until the next `setBiome`. Now both read the same `BIOME_TONE` table.
- **Sim determinism restored**: weaver burst spread now consumes the seeded `this.rng()` instead of `Math.random()` (sim.ts:995 was a latent violation of the determinism law).
- **`hitstopWarden 0.22` dead config fixed to 0.16** — it was silently clamped by `hitstopMax 0.16`, so warden kills never felt heavier than normal kills.
- **Harness stall fixed** (scripts/simdrive.ts): the QA bot could park forever in front of a bulwark's armor plate (shards block, room never clears, frame-cap FAIL at ~1-in-10 odds). The bot now commits to a flank on plate clangs. 15/15 clean full-runs after.

### (b) Pipeline: new asset family + visual leap (things you SEE in 30 seconds)
- **GLASS HOLLOW monolith set** — three new named, seeded, reproducible GLB generators in `scripts/assetgen.ts`: `glass_monolith` (faceted hex needle with molten collar, 162 verts), `vesica_arch` (crossing ruin gate), `prism_cluster` (tilted triple prism). Full gate: optimize quant applied=17 skipped=0, verify **17/17 PASS**. Wired into biome 2 (`scene.ts`): 4 monoliths + 2 arches + 2 clusters join the spires — GLASS HOLLOW now has a real skyline (evidence: `.qa/sprint17/13-glass-hollow-set.png`). Note: Blender is absent in this rebuilt sandbox (`/home/z/tools/` gone — Makefile target skips gracefully), so the set was forged through the tier-1 pure-TS generator through the same quantization+GLTFLoader gates; Blender returns to the pipeline the moment the toolchain is restored.
- **CC/veil readability kit** (`view.ts`): stun = spinning gold hex-ring above the body · root = clamping ground ring · chill = icy ground ring · herald veil chimes = big cold cyan diamonds on their own Points layer. Idle pools cost zero draw calls.
- **Bullets got a visibility budget**: normal shots 0.9→1.2 with a hotter core color, heavy lances 2.0→2.5, veil chimes 1.7 cold-cyan — checked against all three biome fogs (evidence: `.qa/sprint17/09-veil-chimes-flight.png`, `12-herald-volley.png`).
- **Damage-direction indicator**: every hit now reports its source — a directional wedge flashes at screen edge toward the attacker (`onHurt(x,z,sx,sz)` → HUD wedge, `.qa/sprint17/` death-path shots), plus a frost vignette while veiled (`.qa/sprint17/10-veil-frost.png`).

### (c) Mechanics vs. pivot — the CC kit is real and the moment-to-moment changed
- **The dormant kit exists now** (it previously did not exist at all — see section 0). Deterministic triggers only, zero rng: **every 3rd direct shard hit STUNS** (0.7 s, FSM skipped entirely; bosses ×0.4), **every 5th CHILLS** (×0.45 speed), **dash-strike ROOTS** (1.2 s, movement canceled, attacks still run). Every CC state is hard-capped at assignment — the failsafe law from the standing directive.
- **NEW FOE — the HERALD OF CHIMES** (`sim.ts`, `view.ts`, `audio.ts`): a cold bell that drifts in GLASS HOLLOW+ rooms, RINGS a 0.75 s trembling telegraph (chime audio + cyan ring), then fans 5 slow veil chimes. The veil **never wounds — it saps your speed to ×0.55** for a hard-capped 1.4 s. Counterplay law: **dash cleanses the veil** and dash-immunity shrugs chimes off. The whole threat is readable: cold color voice, sound telegraph, HUD status meter with remaining time, screen-edge frost (evidence: `.qa/sprint17/11-herald-live.png`, `10-veil-frost.png`).
- **Per-CC audio + per-biome musical identity** (`audio.ts`): stun/root/chill each have their own cue (crystal crack / ash clamp / cold drag), the herald's ring is a glassy double-chime, the veil hit is an icy thud, cleanse is a recovery blip. Each biome now owns a drone ROOT + pad chord + filter color (A dusty / F# cold / C open) instead of one drone for everything, and danger plays a fixed 8-step pentatonic arp that brightens with pressure — pressure is music now, not a swelling hum.
- **Payout count-up** (`Overlays.tsx`): the death screen's score and dawn TICK up with an eased count instead of teleporting (evidence: `.qa/sprint17/06-death-countup.png`).
- **First-60s onboarding**: timed hint chips (MOVE → THROW → DASH+CLEANSE → GRAZE → CC rules), once ever, graduating at the first room clear (evidence: `.qa/sprint17/02-run-hint-move.png`).
- **Deployment trust chain** (`version.ts` + HUD/Overlays/Title): the build tag + base hash is printed in-game on the title screen, the death panel, and the HUD footer — you can always tell which build you are playing (evidence: death panel shows `SPRINT 17 — PROOF OF LIFE · BASE 52f67c0`).

### (d) Known issues (declared)
- Headless-tab FPS reads ~10 — per our own QA law this is NOT evidence (rAF throttle); perf verdict comes from `__hollowsun.perf()` draw calls: **85 live / 105 transient peak** against the 100 ceiling (peak is the all-biome-props-visible case; declared, not hidden). 25 shader programs.
- Blender toolchain absent in the rebuilt sandbox — the forge-library Makefile target now skips gracefully; tier-1 covered the sprint (see (b)).
- `Enter` on the death screen does nothing (stale hint line) — rekindle is click/button-only this build.
- <420px HUD bottom-strip crowding persists (Sprint-13 debt, untouched).
- Transient draw-call peak 105 exceeds the ≤100 ceiling by 5 in the worst biome-2 frame; the persistent mid-combat number is 85.

### (e) Next
- Real-device playtest receipt (the trust chain stamp tells you it's this build), then the maxZones-style perf lever if YOUR device receipt shows strain.
- Herald joins boss escort tables + a stun/slow-reactive boon tier; dedicated zap sfx (spark still borrows the shield crackle); <420px HUD fix; 3D simdrive seed pinning (the full-run harness is still `Math.random`-seeded per invocation — the forge/afterglow harnesses pin seeds).

### Gate receipts
- `bunx tsc --noEmit` PASS · `bun run lint` PASS · `make qa`: simdrive **9/9 rooms, 3/3 bosses** (with heralds+CC live) + afterglow **9/9 assertions** + forge **PASS** · `verify-assets` **17/17**
- Browser-verified golden path (agent-browser, live build): begin → onboarding chips → hint ladder → stun ring → veil volley → frost + HUD meter + toast → **dash cleanse** (veilT 0.92→0) → herald ring+volley → death payout count-up → build stamp on title/death/HUD → rekindle button restarts. Receipts: `.qa/sprint17/01…14-*.png`

---

## SPRINT 13 · BUILD 1 — "SUNFORGE" (the 3-stack ships new content)

**Previous state:** Sprint 12 restored the 3D line but replayed the existing 11-GLB library; the title screen covered the live renderer with an AI-generated texture image; no new combat content since the roguelite expansion; the pipeline Makefile could not even run (`make` failed: space-indented recipes).

### Improved — Blender pipeline produces NEW game content (3-stack: Blender → glTF → Three.js)
- **`scripts/blender/forge_library.py`** (new, bpy): headless Blender 4.2 forges three brand-new assets that did not exist in any library — `husk_drifter.glb` (666 verts; the most common foe's body), `glass_spire.glb` (1110 verts; biome-2 crystal cluster), `heart_root.glb` (1536 verts; biome-3 root pillar). Gate: `optimize` quant applied=14 skipped=0, `verify-assets` **pass=14 fail=0**, previews+VLM inspect run. Evidence: `.qa/asset-inspect.json`, screenshots below.
- **`husk_drifter` is live in combat** (`src/game/view.ts`): every drifter spawns as the forged ash-husk shell (footprint-matched 2.2u) — the most-seen silhouette in the game upgraded from a plain octahedron. Evidence: `.qa/sprint13-run-shadows-burn.png`, `.qa/sprint13-spark-moment.png` (spike-shouldered husks around the Lantern).
- **Biome dressing ships**: `glass_spire` ×6 stands in GLASS HOLLOW, `heart_root` ×5 in THE HEART, visibility toggled per biome in `Scene.setBiome()` (`src/game/scene.ts`). Evidence: `.qa/sprint13-biome2-spires.png` (magenta-rimmed spire cluster live, palette shifted).
- **Fixed a latent pipeline defect**: the Makefile's recipes were space-indented since creation — `make` itself failed with "missing separator". All recipes fixed to tabs; `make qa`, `make forge-library`, `make check` now actually run. `textures` target + orphaned `obsidian_ember.png` removed (unreferenced).

### Improved — graphics (the title is the engine now, and the world is grounded)
- **Title screen AI texture killed** (owner directive): `.hs-title-tex` (pasted `obsidian_ember.png` over the renderer) deleted from `TitleScreen.tsx` + `globals.css`; replaced by a pure-CSS 4-layer scrim that darkens only the kicker/CTA bands and leaves the live Hollow Lantern orbit fully visible between them. Also purged the dead class from the afterglow title. Evidence: `.qa/sprint13-title-live3d.png` (lantern ring, hex floor, boundary arc, fog monoliths — all real-time), `.qa/13b/13b-title-desktop.png`, `.qa/13b/13b-title-mobile.png`.
- **Living attract mode** (`src/game/engine.ts`): the title now idles the sim forward (shards orbit the ember, `Scene.setEnergy` breathes 0.16–0.25) under the orbiting rig — the backdrop is a running world, not a still.
- **Contact shadows** (designer-bar item from the Sprint-12 audit): pooled soft blob shadows under the dart + all 40 foe seats, spawn-fade aware, dash-dimmed (`src/game/view.ts`) — kills the "everything floats" defect.

### Improved — mechanics (two new rare boons, fully headless-verified)
- **EMBER ROT** (rare, 3 stacks): direct hits ignite foes — each 0.75s beat deals the stack count as damage and consumes one stack (3 stacks → 6 dmg over 2.25s). Burns live on enemy time (Overdrive slows the fire), never consume rng.
- **CHAINSPARK** (rare, 2 stacks): slain foes arc 2 dmg of death-light to the nearest kindred (9u first arc, 7u chained); nearest-first targeting is pure geometry — sparks never re-spark.
- New digest-safe events `onBurnTick` / `onSpark`; view reads burning foes (heart-glow flicker) and draws jagged additive arc lines; burn beats shed ember particles (no hitstop, no sfx spam — the feel law holds).

### Improved — architecture / QA
- **`scripts/simdrive-forge.ts`** (new): headless harness asserting the burn stack law, the 3→2→1 beat ladder, spark nearest-first targeting + no-respark, seed determinism of the whole burn/spark story, and full-run compatibility (burn+spark build clears 9/9 rooms, 3/3 bosses). Wired into `make qa`.
- QA seam `Sim.debugStrikeNearest()` (pattern of `debugClearRoom`).

### Gate receipts
- `bunx tsc --noEmit` — PASS · `bun run lint` — PASS · `make qa` — **simdrive PASS (run won, dawn 592) + afterglow 9/9 + forge PASS**
- `bun scripts/verify-assets.ts` — pass=14 fail=0 · `__hollowsun.perf()` mid-combat: **77 draw calls / 86 peak** (ceiling 100), 0 page errors
- Browser-verified golden path: begin → combat → burn ignition → spark kill → biome advance (GLASS HOLLOW) — `.qa/sprint13-title-live3d.png`, `.qa/sprint13-run-shadows-burn.png`, `.qa/sprint13-spark-moment.png` (score 50 payout + kill ring), `.qa/sprint13-biome2-spires.png` (CHAINSPARK in HUD boon strip), `.qa/sprint13-mobile-run.png` (390×844)

### Known debt (declared, R3)
- Spark arc reuses the shield-break crackle sfx (dedicated zap pending in `audio.ts`)
- Mobile <420px: bottom HUD strip crowds (EMBERS/SHARDS overlap at 390px) — P2 polish
- First-60s scripted onboarding + determinism digests for the 3D simdrive remain from the Sprint-12 debt list
- Godot 4.3 stays a hedge, not the product engine — the shipping 3-stack is Three.js (runtime) + Blender 4.2 headless (assets) + the grade/fog/bloom chain (rendering); re-evaluated and confirmed this sprint

---

## SPRINT 12 · BUILD 1 — "RETURN TO 3D"

**Previous state:** AFTERGLOW top-down auto-firer was the default face of `/`; the 3D shooter roguelike was demoted behind `/?legacy=1`.

### Improved — product & routing (architecture)
- `/` now serves the **3D shooter roguelike** (HOLLOW SUN / EMBER RITE line). Evidence: page title `HOLLOW SUN — The Last Ember`, `.qa/sprint12-ember-title.png`.
- AFTERGLOW demoted to a clearly-labeled **systems lab** at `/?lab=afterglow`; cross-links renamed on both title screens. Evidence: `.qa/sprint12-lab-afterglow.png` (link reads "EMBER RITE — THE 3D DESCENT", no more "LEGACY STORYBOARD" leakage).
- `src/app/page.tsx` stack type renamed `legacy → ember`; product is never framed as deprecated again (R5).

### Improved — game feel (mechanics)
- **Damage numbers live in the 3D view**: new `src/game/damageNumbers.ts` (pooled DOM, world→screen projection, distance-scale clamp, chain styling), fed by a new **optional, digest-safe** `SimEvents.onFoeHurt` in `src/game/sim.ts` (pure notify, zero rng — run digests unchanged). Evidence: floating numbers mid-combat in `.qa/sprint12-ember-hit-a.png`.
- **Hit-stop retrigger cooldown law** (150ms wall-clock, from the AFTERGLOW kit) in `src/game/engine.ts` via `tryHitstop()` — kill spam can no longer stack-stutter; triggers remain kill + boss phase. Sim truth untouched.

### Improved — graphics (Blender pipeline reaches the game: 11/11 GLBs deployed)
- Was 7/11 assets live. Added in this build:
  - `warden_slab` → the warden titan's body (`src/game/view.ts`, footprint-matched 5.2u)
  - `monolith_cracked` → two broken titan landmarks guarding the rim approaches (`src/game/scene.ts`)
  - `shard_cluster` → five ember-rimmed crystal growths between the lanes
  - `inlay_hex` → three engraved hex floor inlays
- **Grade retune**: film grain 0.045 → 0.025 (VLM audit: overcooked grain was muddying mid-tones).

### Gate receipts
- `bunx tsc --noEmit` — PASS · `bun run lint` — PASS
- `bun scripts/simdrive.ts` — PASS (full run won: 3 bosses, elites, boons, dawn 670)
- `bun scripts/simdrive-afterglow.ts` — 9/9 PASS
- `__hollowsun.perf()` mid-run: **81 draw calls live / 94 peak** (ceiling 100), geometries 31→38 (the 4 new GLBs), 0 console errors
- Screenshots: `.qa/sprint12-ember-title.png`, `.qa/sprint12-ember-run.png`, `.qa/sprint12-ember-hit-a.png` (damage numbers + kill ring), `.qa/sprint12-ember-hit-b.png` (×2.0 CHAIN, score 175), `.qa/sprint12-lab-afterglow.png`

### Known debt (declared, R3 — not silently deferred)
- No contact shadows yet — grounded entities still hover (designer bar item 2, next build)
- Score numeral still unmoored (should live in an hs-panel)
- First-60s onboarding storyboard (scripted first ricochet-kill) not yet built
- Determinism hash assertions for the 3D simdrive (dev agent 12-a, "do first") not yet ported
