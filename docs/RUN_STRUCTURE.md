# HOLLOW SUN — Run Structure Spec (Step 2, Game Designer)

## Run shape
A run = **3 biomes × 3 rooms** (2 combat rooms + 1 boss room) = 9 encounters.
Target 10–14 min; abort death ≈ 4–7 min. Each room is one arena wave encounter
(scaled per depth), keeping restarts instant and rooms legible.

| Biome | Name | Identity | Enemy mix |
|---|---|---|---|
| 0 | ASHFALL VESTIBULE | teal grid, gold sun (current look) | drifters → strikers (room 2) |
| 1 | GLASS HOLLOW | warm-violet grid, rose sun | + weavers, elite rolls open (25%) |
| 2 | THE HEART | pale white-gold grid | all types, elites 35%, denser |

Room pacing: combat room ≈ 45–75 s (budget = base × depth), boss room ≈ 90 s.
Between rooms: **Reward Shrine** — choose 1 of 3 boons, or heal 1 ember.
Biome boss occupies room 3 of each biome (see ENEMIES_BOSSES.md).

## Economy
- **Score** (in-run, feeds the sun + chain mult) — unchanged.
- **Dawn Embers** (meta, persists): `dawn = 8×rooms + 30×bosses + score/100
  + 100 win bonus`. A death at biome 1 yields ~40–70; a win ~250+.
- Spend at the **Shrine of Dawn** (hub = title screen, sun visible behind it).

## Shrine of Dawn (meta ladder, one-time unlocks)
| Unlock | Cost | Effect |
|---|---|---|
| Warm Ember | 40 | +1 starting max ember |
| Starting Spark | 60 | begin runs with 4 shards |
| Kin Sight | 30 | +15% graze radius |
| Ash Walk | 50 | −20% dash cooldown |
| Prism Memory | 80 | +1 shard bounce |
| Second Dawn | 150 | revive once per run at 1 ember |

Cost curve: ~1 death per early unlock, ~3–4 deaths later — Hades mirror pacing.

## Hub interactions
Title screen shows the sun at `starEnergy(bestScoreRecentRun)` + shrine panel +
run stats. Shrine purchases re-stoke the hub sun (diegetic feedback). BEGIN is
always one key/click away — the hub never blocks (Katana-ZERO rule).

## Choice design rules
1. Boons touch the shard lifecycle (throw / ricochet / return) or the risk dial
   (graze/dash/embers) — nothing else.
2. Always offer one *vertical* (power) and one *horizontal* (behavior change)
   option plus heal — readers parse 3 cards, not 5.
3. Heals are a choice, not charity: heal vs power is the run's pulse decision.
