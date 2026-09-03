# HOLLOW SUN — Combat Expansion Spec (Step 3, Combat Engineer)

## Player states (interaction rules)
- **i-frames:** dash 0.14 s + hurt invuln 1.2 s (unchanged). i-frames beat ALL
  damage sources. Dash through bullets is always safe — teach via graze text.
- **Dash-recall (NEW):** dashing while shards are airborne recalls them at
  1.5× return speed and re-arms throw cooldown by 50%. Skill verb: the shard
  return path is a weapon route — recall through a swarm to re-hit on the way
  home. Costs the dash (risk/reward), never free.
- **Dash strike (NEW):** dashing through a foe deals 1 dmg (knockback) —
  dash becomes offense when cornered; per-foe per-dash hit set prevents doubles.
- **Knockback (NEW):** shard hits push foes 6 u·s⁻¹ impulse along shard travel
  (bosses 10%); dash strike pushes 14. Knockback separates clumps WITHOUT
  removing the separation system (readability under burst).
- **Hitstop:** kill 55 ms / warden 220 ms (unchanged); chains > 3 add +15 ms —
  music-note pacing as chains climb.

## Shard lifecycle (authoritative)
`orbit → fly (aim magnet 9 u) → chain (≤ base 5 + mods) → return → orbit`.
Wall impact reflects inward (geometry honesty — Noita rule). Chain target =
nearest other foe within 27 u. Boons modify every stage:
throw (Twin Cadence −30% cd), flight (Swift Return +20% speed, Prism Memory
+1 bounce), chain (Searing Chain splash 1 dmg / 3.5 u), return (Comet Catch:
catch grants +6 OD), orbit (Kindled Pace: +12% move speed while all shards
orbit — repositioning window).

## Boon catalog v1 (12, all stack-checked)
| Boon | Tier | Effect |
|---|---|---|
| Sharpened Light | common | shard damage +1 |
| Split Prism | common | +1 ricochet bounce |
| Swift Return | common | shard speed +20% |
| Wide Graze | common | graze radius +25% |
| Twin Cadence | common | throw cooldown −30% |
| Kindled Pace | common | move speed +12% |
| Searing Chain | rare | chain bounces splash 1 dmg in 3.5 u |
| Comet Catch | rare | shard catch +6 Overdrive |
| Heat Shell | rare | dash strike dmg +2, knockback ×1.5 |
| Ember Ward | rare | +1 max ember, heal 1 |
| Dawning Wrath | rare | kills charge +5 Overdrive |
| Sun's Patience | sun | Overdrive duration +2 s |

Rarity weights: common 60 / rare 33 / sun 7. No duplicate stacks in one offer;
`Ember Ward` stops offering at +2 taken.

## Tuning targets (verify headless)
- First chain (3+ bounces) achievable within 20 s of room 1 by a new player
  using aim magnetism alone.
- Dash-recall saves: simulate striker dash + recall; ember survives 100% when
  recalled within 0.2 s of telegraph end.
- Room clear time ≤ 75 s at depth 1 with base kit.
