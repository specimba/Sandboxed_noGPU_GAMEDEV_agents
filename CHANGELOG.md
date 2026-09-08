# CHANGELOG — every build states what improved, with evidence

Rule R2 (docs/QUALITY_AUDIT.md): each entry lists objective improvements over the previous build in graphics, mechanics, or architecture — with screenshot paths and gate receipts. No entry, no ship.

# CHANGELOG — every build states what improved, with evidence

Rule R2 (docs/QUALITY_AUDIT.md): each entry lists objective improvements over the previous build in graphics, mechanics, or architecture — with screenshot paths and gate receipts. No entry, no ship.

---

## SPRINT 16 · BUILD 1 — "IRONHOLD" (controls can no longer dead-lock; CC is ON SCREEN with counterplay; enemy fire is legible)

**Previous state:** Sprint 15 shipped the cinder hound + arrival beats + edge pips, but the owner directive ruled three things blocking: (P0-1) controls could dead-lock with zero diagnostics — the pause overlay literally printed "ESC — RESUME" with **no handler wired anywhere** (the dead panel's "ENTER — REKINDLE" was backed by a `consumeBegin()` with zero call sites repo-wide); (P0-2) crowd control did not exist on screen at all; (P0-3) player life loss was still projectile-attributed — additive bullets washed out near bright biome palettes, heavy lances arrived unannounced, and the sprint-15 threat pips rendered **with no CSS rule at all** (unstyled invisible squares). Mechanically the weaver was just another bullet hose.

### Fixed — control integrity (P0-1: diagnose first, then harden)
- **`?debug=1` forensics black box** (owner-directive order: instrumentation BEFORE behavior changes): `window.__hollowsun.forensics()` returns live `rt / acc / steps / fps / frameMs / phase / hitstop / hitstopCd / slowT / dashBufT / input{mx,my,touch,edges} / sim{dashCd,dashT,invuln,throwCd,pRootT} / reduceFx` plus a preallocated **120-sample suppress-state ring**; `[HS:CTRL]` transition-only console logging (phase changes, hitstop enter/exit with real durations, hex/root events) — zero cost without the flag. Evidence: `.qa/sprint16/16-title-debug.png`, forensics snapshot with 120 samples captured live.
- **Escape now RESUMES** (the advertised key was dead): the paused/dead/reward render-return branch in `engine.ts` gained a gated consume — **Escape pauses AND unpauses** (verified live: phase paused → playing), **Enter rekindles at death** (verified live: forced dead → Enter → playing), and every overlay frame discards stale throw/dash edges so a phantom dash/pause can never fire on re-entry (proven phantom chains: Escape-during-shrine → instant re-pause at room start; Space-at-title → spawn dash).
- **Stuck-key hardening** (`input.ts`): `visibilitychange` now clears keys + edges (OS overlays can swallow a keyup without a blur → permanent strafe); blur clears edges too, not just held keys; edges are force-cleared at `startRun/resume/advanceRoom`.
- **Hitstop drains on WALL CLOCK** + a per-frame watchdog clamps it at `FEEL.hitstopMax` (a stutter frame can no longer extend a freeze; a runaway can never exceed the ceiling — logged if it ever trips). Edge hygiene: input edges reach only the FIRST accumulator step (a stutter frame cannot double-fire).
- **0.12s dash buffer** (`src/game/control.ts`, pure + headless-tested): a dash pressed just before ready fires the frame it readies instead of being silently eaten. **Touch stick safety net**: pointer capture moves to the stick CONTAINER + window-level pointerup/cancel resets the stick — a finger lifting outside the stick can no longer leave the ember drifting on a frozen value.
- **CC failsafe law** (the directive's hard timeout): `ccFailsafe()` clamps any CC timer above `max × 2` with a toast + log — the player is never locked longer than 1.6s, ever, regardless of upstream defects. Gated by the new `scripts/simdrive-controls.ts` (wired into `make qa`).

### Improved — crowd control is now ON SCREEN (P0-2) + the mechanical pivot (P2)
- **HEX LOOM — the weaver rework** (the game's first real CC, with counterplay): a weaver within 22u periodically **names a patch of floor at your feet** — a pink hexagonal zone telegraphs for 0.9s (slowed by Overdrive), then detonates: caught inside 2.6u = **ROOTED 0.8s** (movement zeroed, dash blocked, **throwing stays free**). Counterplay ladder: leave the zone during the telegraph (walking covers ~4.5u), kill the weaver (hp 3, the cheapest 3-pt foe), or keep fighting while rooted. Zero rng consumed — harness-proven seed-deterministic.
- **Integration defect caught by harness block G1 before it ever reached a player**: the spec'd `castRange` 20 sat below the weaver hold band's outer edge (pd ≈ 21.1) — the hex could **never fire**. `HEX.castRange` = 22 with the law documented in `constants.ts`.
- **The full feedback kit — "if it's not on screen, it didn't happen"**: merged 6-spoke **entangle geometry** swirls at the dart's feet (+0 persistent draws), the hull **desaturates to warm ash** (uniform-only rim/emis lerp, restored the frame the bind breaks), a **movement-attempt rattle** + tiny rig shake while fighting the bind (both gated by the newly wired `prefers-reduced-motion` — which also finally reaches all three `rig.update` shake sites that were hard-coded `false`), one-shot audio cues (`hexAnchor` dread tick, `hexDetonate` thump/hiss, `rootBind` thunk+crackle, `rootBreak` snap), and a **ROOTED chip** in the HUD sun column (pink pip + live countdown, hs-panel language, boss-bar collision impossible by the escort law). Dormant stun/slow kit ships ready (+0 draws). Evidence: `.qa/sprint16/16-hex-zone.png` (hex telegraph live on the floor + ROOTED chip), `.qa/sprint16/16-rooted.png` (entangle + ash hull + chip at 0.7s), engine log receipts (`hex detonate hit=true → player root dur=0.80`).
- **Harness block G** (simdrive-forge): anchoring laws (cast range, global cap ≤2, ≤1 zone per weaver), escape law (walk out → `hit=false`, no root), catch law (detonate under the ember → root exactly 0.8s), root semantics (dash blocked with zero events while rooted; **throwing fires** — counterplay law), and same-seed digest determinism.

### Improved — projectile readability (P0-3)
- **Light bullets rebuilt**: normal-blended **hot-core diamond with a near-opaque obsidian edge** (`makeDiamondTextureDark`) — the additive ember-on-warm washout against bright biome grids + bloom is gone by construction; the silhouette survives every biome. Evidence: `.qa/sprint16/16-biome2-bullets.png` (16 staged bullets in GLASS HOLLOW: every white-hot diamond and acid-green lance reads crisply against the pink palette).
- **Per-foe hit-flash**: the shared-per-kind shell materials are now **per-pool-entry**, built through the `stylizedMaterial()` factory (a raw `.clone()` would have bypassed the uTime registry and frozen the hound/warden pulse — caught in proposal 16-b). Every landed hit flashes the struck foe's shell (emissive + rim wash, 0.09s). +0 draw calls (calls are per mesh, not per material).
- **Heavy-volley direction lines**: a caster lance now names its line — one free telegraph-pool line from muzzle to locked target (`onHeavyShot` gained optional `tx/tz`), readable at 21 u/s, capped to pool contention (aiming foes win).
- **Red heavy-bullet pips + the invisible-pip defect repair**: `.hs-threat-pip` finally has its authored CSS (amber diamond, dark fill, glow) — sprint 15 shipped the className with **no rule anywhere** — plus a `--red` variant: up to 3 off-screen heavy lances clamp to the screen edge (foes own the pool first). Computed-style verified live: 10px, red border, dark fill.

### Improved — 3-stack asset pipeline (P1)
- **`hex_weaver.glb`** (16th library asset): Blender 4.2 headless forge (`scripts/blender/forge_weaver.py`) — hexagonal lattice loom (outer hex ring, 6 radiating spokes, crowned hub, hanging needle), **572 tris ≤ 600 budget** (first build was 644 — trimmed before it could land), seeded + deterministic. Gates: `optimize` quant applied=16 skipped=0, `verify-assets` **pass=16 fail=0** (15→16), Cycles preview `.qa/sprint16/hex_weaver.png`, runtime swap-in slot live in `view.ts` (footprint-normalized 1.5u, re-seats pooled weavers).

### Perf + gates
- Persistent draw calls **+0** (per-entry materials share one program; zones/entangle are transient pools; pips/chip are DOM). Fresh-run `perf()` **81 calls** (ceiling 100); staged worst-corner (root + zone + full wave in one frame) peaked 108 transiently — documented lever: `HEX.maxZones 2→1` if a real device ever trips it. 0 console errors, 0 page errors.
- Gates: `bunx tsc --noEmit` PASS, `bun run lint` PASS, `make qa` PASS (**now 4 harnesses**: simdrive won dawn 636 · afterglow 9/9 · forge incl. HEX blocks G1–G5 · controls harness new).
- Live-verified in a real tab (`?debug=1`): Escape pause/resume cycle, Enter rekindle, hex telegraph → detonation → root → expiry (engine `[HS:CTRL]` log receipts), ROOTED chip, threat-pip CSS, mobile 390px HUD hold, forensics ring (120 samples).
- **Determinism note**: the hex path consumes zero rng — same-seed digests stay byte-identical (block G5); gameplay receipts re-recorded (dawn 636 vs 647) because weaver behavior intentionally changed trajectories. No golden values were broken.

### Known issues / debts
- The headless tab runs at ~10fps (SwiftShader) — per the QA-validity law, freeze/lag reports from it are inadmissible; all timing laws were proven headless-seeded (`simdrive-*`) + the forensics ring now gives the owner's real device a voice (`?debug=1`).
- `FEEL.hitstopWarden 0.22 > hitstopMax 0.16` — the warden stop is silently clamped (pre-existing; left untouched this sprint — no feel changes without an owner playtest).
- Stun/slow CC states ship as dormant kit placeholders (+0 draws) awaiting a mechanic that applies them (Sprint 17 candidate: a stun-applying variant or mutator).
- `onHeavyShot`'s volley line and the light-bullet rebuild should get a real-device playtest pass for bloom feel; the bullet core can brighten to `0xfff0d8` in one constant if washed.

### Next-iteration plan (Sprint 17 candidates)
- Payout count-up (deferred twice — lowest info gain, still queued), longer music forms, dedicated zap sfx (spark still borrows shield-crackle), first-60s scripted onboarding.
- A second CC carrier (stun) to activate the dormant kit + a cleanse/dodge boon ("HEXWARD: hexes detonate early under you").
- Real-device perf receipt from the owner (GPU browser) against the ≤100 law.

---

## SPRINT 15 · BUILD 1 — "WILDFANG" (a new predator; biomes become places; off-screen is no longer blind)

**Previous state:** Sprint 14 fixed the rising-drone music bug and recomposed the HUD/death panel, but all six foe kinds date to the roguelite expansion, the three biomes announce themselves with a bare text banner (the first biome with nothing at all), and threats outside the viewport are invisible until they hit you.

### Improved — mechanics (SEVENTH foe kind: the CINDER HOUND, forged through the 3-stack)
- **New charger AI** (`src/game/sim.ts` + `HOUND` table in `constants.ts`): the hound lurks the 12–18u band, locks its facing through a **0.7s burn-line telegraph** (the dash line is named at wind-up entry and never re-aims — sidestep it), then dashes the line at **30u/s** (striker: 27), and pays for a miss with a **0.8s recovery that takes ×1.5 damage** — the punish window is the mechanic. Wind-up is uninterruptible by damage (proven headless).
- **Wave integration**: hounds enter at wave 5 (GLASS HOLLOW room 2) via budget band + deterministic floor; 3 budget pts, 160 score, hp 3, r 0.85. Fully compatible with EMBER ROT stacks and CHAINSPARK arcs (kind-agnostic laws asserted in harness block F).
- **Blender 4.2 forge** (`scripts/blender/forge_hound.py`, new): lean crouched quadruped wedge — snout toward Blender −Y → glTF +Z = three.js forward, so the mesh charges snout-first; buried legs, blade tail, spine ember-crack plates, swept ears. **576 tris ≤ 600 budget**, gate: `optimize` quant applied=15 skipped=0, `verify-assets` **pass=15 fail=0** (count 14→15), runtime GLB swap verified live in-engine (posCount 1242 ≫ fallback). Pipeline note: the sandbox lost `/home/z/tools` — Blender 4.2 was re-downloaded and restored to `/home/z/tools/blender-4.2.0-linux-x64` this sprint.
- Evidence: `.qa/sprint15/15-hound-windup.png` (telegraph + hound mid-wind-up), harness block F1–F7 PASS.

### Improved — graphics/UX (biome arrival beat: the run now reads as a descent)
- **Arrival beat at every biome boundary** (and run start): a 1.5s gold biome banner (`ASHFALL VESTIBULE — THE DESCENT BEGINS` / `DEEPER INTO THE DEAD STAR`) + a **fog swell** (density 0.016→0.028→0.016 over 1.4s, uniform-only) + a **floor pulse ring** from the ember. Keyed at the only two `setBiome` sites, so room 2/3/boss can never double-fire by construction.
- **Double-banner defect fixed**: the biome banner replaced the redundant `ROOM 1` banner (arrivalHold consumes it exactly once); also fixed `startRun`'s store reset wiping the fresh banner synchronously.
- Mobile fit: biome banner drops to `text-2xl` and wraps inside `max-w-[86vw]` (was clipping past both screen edges at 390px). Evidence: `.qa/sprint15/15-mobile-arrival.png` (banner + fog swell + pulse ring in one frame), `.qa/sprint15/15-arrival-biome0.png` (pulse ring + veil mid-swell).

### Improved — UX fairness (off-screen threat pips)
- **`src/game/foePips.ts`** (new): pooled DOM edge pips (pool 8, warm amber `#ffc766`, z-9 under the HUD) — off-screen foes clamp to the screen edge as outward-pointing diamonds, **nearest threat = loudest** (opacity 1.1 − d/44, clamped 0.3–0.95), behind-camera NDC mirrored so behind foes clamp sensibly, hidden in boss rooms, transform-only per frame (reduced-motion compliant, +0 draw calls). Evidence: `.qa/sprint15/15-threat-pips.png` (3 pips edge-clamped at y=880/900, distance-scaled opacities).

### Improved — architecture / QA
- **The sim is now fully deterministic under a fixed seed**: the hound's determinism digest (harness F6) exposed a latent defect — weaver burst spread consumed `Math.random()` (the only unseeded rng in the sim). Now `this.rng()`. Two same-seed runs produce byte-identical score/kill/foe digests (asserted).
- **`scripts/simdrive-forge.ts` block F** (new): wind-up uninterruptibility + no re-aim under damage, dead-straight dash (perp deviation < 0.01u, speed ≈ 30), recovery ×1.5 readback (staged hp 4 → strike 2 → hp 1), hound burn stack law, spark-from-hound-kill arc targeting (exact origin/target/dmg), seeded-run digest determinism. Wired into `make qa`.
- Perf law held: fresh-run `perf()` 71 calls / peak 80 (ceiling 100, sprint-14 envelope 70/72–86); hound rides the existing 40-seat pool + shared geo/mat (+0 persistent calls); pips and arrival beat are DOM/uniform-only. 0 console errors, 0 page errors.
- Gates: `bunx tsc --noEmit` PASS, `bun run lint` PASS, `make qa` PASS (simdrive won dawn 647 + afterglow 9/9 + forge incl. hound law).

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
