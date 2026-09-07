# CHANGELOG — every build states what improved, with evidence

Rule R2 (docs/QUALITY_AUDIT.md): each entry lists objective improvements over the previous build in graphics, mechanics, or architecture — with screenshot paths and gate receipts. No entry, no ship.

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

---

## SPRINT 14 · BUILD 1 — "RESONANCE" (the drone dies; music begins)

**Previous state:** the game's only sustained "music" was a 55 Hz triple-sawtooth drone whose gain was swollen per-frame by `setDanger` (pinned loud for minutes at late waves) and whose pitch was tugged between `setBiome` (τ0.6) and a per-frame `setOverdrive` reset (τ0.15) — the owner's verdict: "music is like a single frequency persistently increasing and getting irritating I finally muted it." Death panel hierarchy was inverted (giant score shouting down the title, REKINDLE buried under a stat wall — owner's screenshot), top score floated bare over the brightest band, bottom HUD physically overlapped at ≤420px (measured 71px at 390px).

### Improved — audio: real adaptive music replaces the buzzing drone (owner's #1 complaint)
- **`src/game/audio.ts` rewritten (music half):** lookahead scheduler (100ms tick, 400ms horizon, AudioContext-clock) composes three wave-gated layers — sub pulse (A1 root + fifth, beats 1&3) → 4-voice triangle pad chords every 2 bars → pentatonic arp plucks (same PENTATONIC pool as the ricochet ladder, so one-shots always harmonize). `setMusicLevel` builds the arrangement with wave depth (waves 1-2 sub / 3-4 +pad / 5+ +arp, wired in `engine.onWaveStart`).
- **Danger no longer swells a tone** — it DUCKS the music bus (floor 0.65×) and raises a hard-capped low tension bed (≤0.026, bandpassed noise). `setDanger` keeps its per-frame call site but quantizes+state-diffs internally (no-op unless the ¼-step changes).
- **The biome/overdrive frequency tug-of-war is dead:** `setOverdrive(active)` no longer touches any oscillator frequency — it opens the music lowpass (800→2400 Hz) and lifts the arp an octave; only `setBiome` writes frequency (event-driven, one glide per change).
- **Hygiene:** the silent zombie overdrive pad (4 saws at gain 0) deleted; every scheduled note auto-stops (zero accumulation); scheduler resyncs after tab-hidden throttling (no pileup/burst); music pauses on death/pause/abandon/tab-hide (`setMusicPaused`), cleared before `ctx.close()` in `dispose()`.
- **Dead `waveStart` stinger wired in** — the ember route never called it; now each wave opens with a two-note triad that fits the arrangement.
- **Verification receipts:** real-click begin → `ctx.state=running`, scheduler step advancing (8→14 in ~1.5s = 8ths @120BPM); live danger duck observed (`musicGain 0.800→0.734`, tension bed 0→0.0059 under a q=0.25 threat); forced `setOverdrive(true)` correctly reverts next frame (engine owns state, diffed setters hold).

### Improved — graphics/UI: the death screen and HUD read like a shipped game
- **Death panel recomposed** (`Overlays.tsx`) to the hierarchy law title > score > CTA > stats: THE EMBER FADES leads, FINAL SCORE captioned beneath, REKINDLE promoted above a tightened stat grid — was: 5xl score dwarfing the title with the CTA last. Evidence: `.qa/sprint14/14-death-panel.png` vs owner's screenshot.
- **Duplicate score killed:** the top-center HUD score now hides on dead/reward (it used to peek from behind the death panel — visible in the owner's screenshot).
- **Score lives in an engraved `.hs-panel` chip** (was bare text over the scene's brightest band — the Sprint-13 declared debt).
- **Bottom HUD cannot overlap anymore:** EMBERS and SHARDS+DASH are one flex row (`inset-x-3 justify-between` — overlap impossible by construction, was 71px collision at 390px); overdrive meter lifts above the row on narrow screens (`bottom-16 sm:bottom-4`); room strip drops below the score chip on mobile (`top-14 sm:top-3`); pips shrink ≤420px. Evidence: `.qa/sprint14/14-mobile-run-v2.png` (390×844, zero collisions).
- **Overlay scrim:** death/pause/shrine share `.hs-overlay-scrim` (warm obsidian radial wash + blur) so the world recedes instead of competing — replaces flat `bg-black/70` + weak blur.
- **Damage numbers get obsidian backing plates** (`.hs-dmg-plate`) — digits no longer camouflage into sparks/projectiles (designer P2 item).

### Improved — palette law (no blue/indigo residue)
- `gridCold` 0x123236 ("cold teal") → 0x241a12 obsidian umber; GLASS HOLLOW grid 0x2a1236 (indigo-leaning) → 0x2a1612 warm; fog retinted to match. The whole grade now sits in the ember/obsidian family. Evidence: warm floor hexes across all `.qa/sprint14/` shots.

### Gate receipts
- `bunx tsc --noEmit` — PASS · `bun run lint` — PASS · `make qa` — simdrive PASS + afterglow 9/9 + forge PASS (audio changes are browser-only; headless harnesses untouched by design)
- `__hollowsun.perf()` mid-run @390px: **70 draw calls / 72 peak** (ceiling 100) · 0 console errors, 0 page errors across title/run/death/mobile passes
- Browser-verified: begin (real click → audio running) → combat HUD → forced layer/duck probes → death panel → mobile 390×844 — `.qa/sprint14/14-title.png`, `14-run-hud.png`, `14-combat-plates.png`, `14-death-panel.png`, `14-mobile-run.png`, `14-mobile-run-v2.png`

### Known debt (declared, R3)
- Off-screen foe pips + chain-payout count-up (designer P2 remainder) — Sprint 15
- Biome arrival beat + per-biome music roots beyond the ratio glide (designer P3) — Sprint 15
- Music arrangement is one fixed 2-bar loop per depth tier; longer forms (8-bar phrases, per-biome motifs) pending
- First-60s scripted onboarding + 3D simdrive determinism digests remain from the Sprint-12 debt list
