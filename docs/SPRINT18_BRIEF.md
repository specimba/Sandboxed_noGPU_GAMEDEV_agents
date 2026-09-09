# SPRINT 18 BRIEF — "PALE CHOIR" (orchestrator brief, pre-agreement)

## Owner verdict driving this sprint
"Someday simple small improvements... I finished all the levels this time, which is
not bad, not great. Continue developing deep search and try to use that asset
creation or libraries with Blender advantages and Godot Engine advantages. Be more
experimental and creative."
→ The 9-encounter run is CLEARED. The ceiling is content + mechanical novelty.
This sprint must produce content and mechanics a player can SEE within 30 seconds
of a new run, and a reason to keep playing after the current final boss.

## Standing law (unchanged)
- Three.js + TS is the runtime. Godot 4.3 is a hedge. We PORT Godot's patterns,
  we do not reopen the engine debate.
- Determinism: seeded rng only, baseline 372f8121; CC/visual = view+audio only or
  optional `?.` notify, zero state writes from view.
- Perf: persistent draw calls ≤ +2 per iteration; `__hollowsun.perf()` ≤ 100.
- No half-landed tracks. Harness ladder must pass (simdrive 9/9 rooms 3/3 bosses,
  afterglow 9/9, forge, simdrive-controls).
- Ship = version.ts stamp bump + 5-part CHANGELOG report + browser-verified
  evidence + push. The player must be able to SEE which build they hold.

## Deep-search digest (2026-09, z-ai web_search; receipts: /tmp/research/*.json)
1. **Risk of Rain 2 elite law** (parryeverything.com breakdown): elites are
   "stat boost + passive archetype", each archetype *forces repositioning*; the
   affix is visible from spawn. Elites in groups are the danger. Design rule for
   us: an affix that only changes numbers is REJECTED; it must change where the
   player is allowed to stand or how they move.
2. **Godot patterns worth porting** (gdquest patterns series, event-bus guides):
   - Resource data-driven design → our constants tables become explicit data
     records for affixes/props (typed, one source of truth, zero scatter).
   - State design pattern (per-state objects) for new foe FSMs, not more inline
     flag soup.
   - Tween choreography for arrival beats (we have the sprint-15 pattern).
   - MultiMesh/InstancedMesh: thousands of props = ONE draw call
     (three.js InstancedMesh equivalent, confirmed by tobias-weiss perf guide +
     simplified.media WebGL writeup). This is HOW a new biome decorates within
     the ≤+2 draw-call law.
3. **Blender geometry-nodes lesson** (blender.stackexchange, blenderartists):
   procedural prefabs must be APPLY/baked before glTF export. Our headless bpy
   forge must apply modifiers before export — bake, then quantize, then verify.
4. **Hades boon law** (kokutech design lessons + daarongames): the best boons
   "drastically change how the weapon works, always adding a new effect" — not
   +10% stat. Our Reward Shrine boons should be audited against this law when
   touched.

## Candidate pillars (proposals may amend; gate decides)
- **A. Biome 4 "THE PALE CHOIR"** — run extends 3×3 → 4×3 (12 encounters). New
  Blender-forged asset family (bone-glass reliquary: arches, pipe organs,
  lantern slabs), per-biome palette row + fog + BIOME_TONE music row + arrival
  beat (Godot-tween style, existing sprint-15 pattern).
- **B. Elite affixes (RoR2 law)** — ≥2 affixes, deterministic from run seed,
  visible crown/marker from spawn, each forcing repositioning, payout bump,
  join from biome 2.
- **C. Endgame** — post-win "DEEP CYCLE" (rekindled run with elite density) or
  new boss 4 composed from existing telegraph primitives (hex rings, veil
  chimes, heavies). Gate picks ONE.
- **D. Godot-pattern infra** — InstancedMesh prop scatter (single-digit draw
  cost), data-driven affix/prop tables, formal per-state object FSM for any new
  foe.
- **E. Debt** — Enter-to-rekindle dead key (sprint-17 declared), ≤420px HUD
  crowding, draw-call peak 105>100 lever, simdrive harness time-seed defect.

## Non-negotiables for proposals
- Every claim grounded with file:line receipts read from the CURRENT tree.
- Read-only phase: no code changes until the agreement gate.
- Worklog law: read /home/z/my-project/worklog.md first; append entry with your
  Task ID when done.
- Determinism: any new rng must come from the existing seeded stream; no
  Math.random in sim.
