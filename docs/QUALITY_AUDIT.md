# QUALITY AUDIT — SPRINT 12 VERDICT

**Date:** Sprint 12, build 1 · **Trigger:** owner memo "Regression in deliverable quality and deviation from project goals"
**Method:** independent diagnosis by two subagents (developer 12-a, designer 12-b) over code + VLM-analyzed screenshots in `.qa/`, reconciled by the orchestrator. All claims below cite a file or a screenshot.

---

## 1. The verdict on the owner's memo: SUBSTANTIALLY CORRECT

The pivot that shipped AFTERGLOW (top-down auto-firing survivor) as the default face of `/` **was a product regression**, even though parts of its engineering were sound.

### Where the memo is right

| Area | 3D shooter line (demoted to `?legacy=1`) | AFTERGLOW (was default) | Delta |
|---|---|---|---|
| Foe roster | 6 kinds (`src/game/sim.ts`): drifter/striker/weaver/caster/bulwark/warden | 3 kinds (`src/game/afterglow/constants.ts`) | −3 |
| Structure | 3 biomes × 3 rooms, 3 named 3-phase warden bosses, victory path (`docs/RUN_STRUCTURE.md`) | endless waves, no victory | structure removed |
| Systems | Overdrive (world-slow ×0.55/dmg ×2), ricochet chain multiplier, elite affixes (3), room mutators (5), dawn meta shrine (6 unlocks) | burn + chain-spark seeds only | −4 systems |
| Draft | 12 boons / 3 tiers / depth-scaled rarity / maxStacks (`src/game/run.ts`) | 12 items / 2 rarities | shallower |
| Scene | hex shader floor, Hollow Lantern sun rig, 16-monolith rim field, biome palette lerp, GradePass (vignette/grain/S-curve) | flat disc + RenderPass/Bloom | identity downgrade |
| Audio | ~20-SFX AudioEngine (ricochet ladders, heartbeat, setDanger, setBiome) | 5 SFX | −15 SFX |
| Framing | the word **"legacy"** in UI and code — the actual product was labeled deprecated | — | self-inflicted wound |

Designer VLM pass on AFTERGLOW screenshots (`afterglow-m0-run-a/b`, `afterglow-final-run`): near-orthographic camera with zero parallax ("sticker on a screen"), brown-on-brown foe camouflage, arena edge hard-cutting into void, player reduced to a glowing speck, title wordmark with no luminosity, dev leakage ("EMBER RITE (LEGACY STORYBOARD)" link).

### Where the memo needs one correction

The 3D line it wants back was **not pixel-perfect either** (VLM audit of `legacy-floor-check.png` / `legacy-regression.png`): no contact shadows (entities "hover"), grain overcooked into mud, thin type, giant unmoored score. "Return to 3D" is therefore tracked as **measured deltas, not a revert** — each delta has a screenshot/sim receipt in `CHANGELOG.md`.

### What AFTERGLOW genuinely contributed (kept, folded into the 3D line)

- QA discipline: `serializeState()` digests, wave-boundary hashes, CAPS leak asserts, death-path coverage
- Pooled DOM damage numbers (`afterglow/damageNumbers.ts`) — camera-agnostic, ported verbatim+
- Hit-stop retrigger cooldown law (150ms) — ported into `engine.ts`
- Wave pacing insight (`spawnWindowFrac`) — becomes a simdrive assertion
- Draft-phase UX pattern + `AfterglowAudio` attach/counts adapter

---

## 2. Root cause (process, not people)

1. **Milestone optics beat product identity.** "M0 shipped" was measured in sim assertions, not in player-facing deltas vs the previous build.
2. **No changelog-with-evidence rule.** Nothing forced the question "what is objectively better than the last build?" — so nothing was.
3. **Silent scope-down.** Dropping Overdrive/bosses/mutators for a simpler loop was never flagged as a regression against the 3-stack acceptance criteria.

## 3. Corrective rules adopted (standing)

- **R1 — The 3D shooter roguelike is the product.** Default route `/`. No 2D-fallback may ship as the default face again.
- **R2 — Changelog with evidence or it didn't happen.** Every build appends to `CHANGELOG.md`: what improved (graphics/mechanics/architecture) + screenshot paths + gate receipts.
- **R3 — Blockers are declared, never silently worked around.** (Known blockers: text-to-3D AI generation needs ≥6GB VRAM — unavailable in this 3GB CPU sandbox; Blender *procedural* bpy is verified working and is the asset route.)
- **R4 — 3-stack acceptance gates, checkable** (from dev agent 12-a):
  - Sim: `bun scripts/simdrive.ts` PASS + `bun scripts/simdrive-afterglow.ts` 9/9
  - Assets: `make verify` → 11/11 GLBs parse; `make optimize` quantization gate
  - Runtime: `make check` (tsc+lint) exit 0 · `__hollowsun.perf().render.calls ≤ 100` · 0 console errors · golden-path screenshot in `.qa/`
- **R5 — Deprecation framing banned.** The product is never labeled "legacy"; experiments get lab routes (`/?lab=afterglow`).

## 4. Build 1 executed against this audit (evidence in CHANGELOG.md)

Routing flip · damage numbers live in the 3D view · hit-stop cooldown law · 11/11 pipeline GLBs deployed (warden body, cracked titans, shard clusters, hex inlays added) · grain retune 0.045→0.025 · all gates green · screenshots `.qa/sprint12-*.png`.
