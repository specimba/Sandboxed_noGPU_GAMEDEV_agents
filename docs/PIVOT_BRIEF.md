# PIVOT BRIEF — AFTERGLOW (working title)
### From storyboard to real game · Sprint 12 foundation document
*EMBER RITE was declared "an interactive storyboard, not an anchor". This brief starts the real thing. Veto any part — especially the title.*

---

## 1. The decision (evidence-based)

Of the three evidence-ranked directions (`docs/PLAYBOOK.md` §6):

| Direction | Verified ceiling | Fit | Verdict |
|---|---|---|---|
| **Deep-sim arena survivor** | Brotato $10.7M est. / Halls of Torment $3.4M — **our genre** | our pure-TS seeded sim is already the hardest 20% | ✅ **SELECTED** |
| Procedural dungeon crawler | proven but heavier content lift | world-gen is our strength, scope risk higher | 🔒 park (biome tech reusable) |
| Portal-first instant arcade | 30M MAU portals | needs platform shim + ad hooks first | 🔒 park (platform.ts later) |

**AFTERGLOW** — you are the last light left after a dead sun; every wave survived is borrowed time, every choice is light spent. Working title; the EMBER RITE visual language (obsidian + ember + engraved UI) carries over as the house style, the game around it is rebuilt for real.

## 2. Three foundations of game knowledge (the design laws)

1. **The sim is the game.** Pure deterministic TypeScript (mulberry32-seeded), zero rendering dependencies, headless-runnable in bun, assertable in CI. If it isn't in the sim, it isn't in the game. (Proven: 106/106 headless pass architecture.)
2. **Readability is a physics law.** Every threat telegraphs in sim state, not just view sugar; the bright thing is always the important thing. Materials live in ONE shared shader system (`materials.ts`).
3. **The loop must hook in 10 seconds and deepen for 100 hours.** Wave combat (60–90s) → draft/build-craft → boss gate → meta currency → permanent unlock. Daily seeded runs make skill comparable.

## 3. Deep-sim content plan (the "100-hour" part)

- **Build-craft web**: ≥60 items at launch, each with a named tag (`projectile`, `chain`, `ember`, `ward`, `dash`…); synergies resolve in the sim as tag intersections — every item combination is headless-testable.
- **Statuses & reactions**: burn, chill, brittle, overcharge — interactions between statuses ARE the depth (brittle + heavy = shatter multiplier, etc.).
- **Elites & mutators**: seeded per run (architecture already shipped: 6 foe kinds, 5 mutators — this is the floor, not the ceiling).
- **3 biomes at launch**, each with a Blender-generated set (library export + VLM gate + quantization — pipeline v2 is the content machine), 1 boss each.

## 4. Pipeline → content (already standing)

`make pipeline` = assets → assets-library (5 bpy assets, deterministic) → optimize (−27% bytes, KHR_mesh_quantization) → verify (GLTFLoader gate) → qa (headless full-run). Previews + VLM verdicts: `.qa/assets/`, `.qa/asset-inspect.json` (11/11 PASS). New content = new generator entry + palette slot, never hand-sculpted.

## 5. Milestones

| M | Deliverable | Gate |
|---|---|---|
| **M0 — foundation** (next sprint) | fresh sim core under `src/game/` (new namespace), arena + 1 weapon archetype + 3 foes + draft slice; page.tsx hosts the new game, storyboard reachable behind a legacy toggle | headless drive green, `make check/qa/verify` green, browser golden path, committed + pushed |
| M1 — depth | build-craft web (≥60 items), statuses, 3 biomes, 2 bosses | synergy matrix headless-tested; perf() draw-calls < 100 |
| M2 — meta | permanent unlocks, daily seeded runs, audio identity | determinism proof: same seed → same star, cross-machine |
| M3 — benchmark | jam-ready vertical slice, itch.io upload (VibeJam-class rules: web-playable, ≥80% AI) | public link + community feedback |

## 6. What carries over / what is rebuilt

- **Carries**: `materials.ts` (design system), `fx.ts`, `assetLib.ts` progressive enhancement, rng, store patterns, sim-drive QA harness, pipeline v2, Playbook workflow, git remote discipline.
- **Rebuilt fresh**: sim design, arena structure, run/economy rules, UI skin, identity. EMBER RITE code stays in git history (and behind the M0 legacy toggle until M1).

## 7. QA contract (unchanged, now with teeth)

headless sim drive → `make pipeline` (assets+verify+qa) → `bunx tsc --noEmit` + eslint → browser golden path with `__hollowsun.perf()` receipts (draw calls, triangles, fps) → 0 console errors → conventional commit → push to origin → worklog.
