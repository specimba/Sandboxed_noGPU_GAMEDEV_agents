# Dead Cells — tear-down

**What it is:** Run-based metroidvania-action. Rooms are hand-authored templates
stitched procedurally; a run crosses biomes with a guaranteed boss at each gate.
Kills drop cells; cells are spent between biomes to unlock permanent item pools.
Combat is dodge/crit/affix-driven: status effects (bleed, freeze, burn) stack on
the same few verbs.

**Why it works:** The promise "I'll see the next biome today" outruns failure.
Cells make every bad run pay into tomorrow's build. Biome gates create ritual
pacing (safe transition + shop + choice), which converts stress into anticipation.

**Implementation likelihood:** biome table + door transitions; elite affixes;
persistent unlock-currency gated by progress depth (must *reach* the boss to bank).

**In HOLLOW SUN terms:** biome gate = the sun re-brightening between rooms; cells
→ **dawn embers** banked at the shrine; affixes → elite variants (swift/shield/
split). Rooms stay single-arena but change palette + enemy mix.

**We deliberately differ:** no traversal/movement tech tree — our movement is
drift+dash and stays lean; no weapon swapping — one weapon (shards) deepened by
boons instead, so mastery compounds instead of resetting per run.
