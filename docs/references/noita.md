# Noita — tear-down

**What it is:** Every-pixel-simulated roguelite where wand *editing* (combine
spells, modifiers, triggers) makes builds emergent and clip-generating. Depth
comes from systems that compose, not from content count.

**Why it works:** Players discover tech the developers didn't plan — the
community markets the game for free. Simulation honesty: if it looks like it
should burn, it burns.

**Implementation likelihood:** modifier stacks on a projectile pipeline; world
rules that never special-case the player.

**In HOLLOW SUN terms:** our honesty rule: **shards obey the same physics for
enemies as for walls** — they reflect, chain, and (with boons) splash by
geometry alone. "Searing Chain" splash, "Heat Shell" dash-damage, "Split Prism"
bounces are Noita-style *system* unlocks, not scripted moments. Long-term: let
shards ignite the floor they arc over (sun rules apply to everyone).

**We deliberately differ:** no per-pixel sim (cost) — our "pixels" are the hex
grid ignition, a cheap authored approximation of the same fantasy.
