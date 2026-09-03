# MEGABONK — mandatory case study

Facts (verified via web, Oct 2025): solo dev (solin), Steam release 18 Sep 2025
at $8, **1.3M copies in two weeks**, 117,336 peak CCU, 94% positive (14.9k
reviews). "3D Vampire Survivors, first to be popular" is the reductive take —
reviewers credit **3D movement and speed** (jumping, grappling, momentum) as
what actually distinguishes it.

## Why it broke out
1. **A known dopamine loop, one honest new axis.** Survivors' auto-battler loop
   needed no teaching; 3D movement added skill expression without adding rules.
2. **Price/scope honesty.** $8, low-poly, runs on anything — impulse buy.
3. **Speed is the fantasy.** The camera, FOV, and physics sell "I am fast" in
   the first 20 seconds.

## Why it's streamable / clip-friendly
- One screen, hundreds of entities, constant pops — screenshots self-compose.
- Movement fails *spectacularly* (yeeting off ledges) — failure is content.
- Build windows: every upgrade visibly changes the swarm density on screen.

## What makes it readable & addictive
- Enemies are silhouette-first blobs with one accent color each.
- XP magnets remove chores; the player only makes *positioning + build* choices.
- Runs are short; the level-up cadence (every ~15–30 s) is the addiction clock.

## Production model lessons for a small team
- One dev, tiny scope, systems-first: content emerges from stacking ~40 items
  over 8 characters — not from authored levels.
- Ship the loop ugly-but-juicy first; charm is cheap, loop is expensive.
- Momentum of a proven genre de-risks marketing: "X but Y" pitch spreads itself.

## What HOLLOW SUN learns (and refuses)
| Take | Apply as |
|---|---|
| One new axis on a proven loop | Survivors' axis = movement; **ours = ricochet geometry** |
| Upgrade cadence every 15–30 s | Boon shrine after every room (~45–75 s) + mid-room level feel via chain multipliers |
| Silhouette-first enemies | keep red-family silhouettes; elites add a *ring*, never a new palette |
| Cheap, restart-fast | browser-first stays; restart < 1 s; Steam later via Tauri |
| Failure is content | dash-recall + wall-ricochet saves create highlight-reel recoveries |
| Refuse: auto-attack power fantasy | shards stay skill-thrown; no idle DPS replaces the player |

## Binding answers
- **One-sentence pitch:** *A fast roguelite shooter where you bend living shards
  of light through ricochet geometry to rekindle a dying star.*
- **Novel twist:** the weapon is a returning projectile that chains between
  enemies — aiming is *route planning*, and grazing is the risk dial.
- **Target run length:** 10–14 min (3 biomes × 3 rooms), death-aborts ~4–7 min.
- **Time-to-fun from restart:** < 5 s to first throw, < 20 s to first ricochet
  chain, < 60 s to first boon choice.
- **The 10-second clip:** throw → shard ricochets through 4 foes (notes climb)
  → dash-recalls through the swarm → Overdrive slow-mo → burst spirals into the
  visibly-rekindled sun. Color law (gold=you, red=them, white=overdrive) makes
  it readable at thumbnail size.
- **Scope-cheap depth:** systems over scripts — 12 boons × 3 elite affixes × 3
  biome enemy mixes × boss phases = build space with authored content kept to
  names, palettes, and one boss kit per biome.
