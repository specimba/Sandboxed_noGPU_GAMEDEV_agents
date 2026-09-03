# HOLLOW SUN — Enemy & Boss Design (Step 4, AI Engineer)

## Taxonomy (existing 3 + variants, zero new base kits)
| Kind | Role | HP | Threat grammar |
|---|---|---|---|
| drifter | space denial, swarm | 2 | slow converge, contact |
| striker | punish positioning | 2 | telegraph line → dash (locked at fire) |
| weaver | zone + grazed resource | 3 | band-keeper, 3-burst aimed shots |
| warden | boss chassis | scaled | radial rings, escort spawns |

## Elite affixes (biome 1+: 25% / biome 2: 35% roll, max 1 elite per spawn)
| Affix | Stat delta | Readability | Counterplay |
|---|---|---|---|
| SWIFT | speed ×1.55, scale ×0.85, hp −1 (min 1) | white-hot trail | keep moving; dash-strike |
| SHIELDED | +2 hp; first hit breaks shield (0 dmg) | gold halo ring | any hit strips it — then chain as normal |
| SPLITTER | on death splits into 2 minis (hp 1, r 0.5, speed ×1.2) | pulsing twin-core | kill in open space, not on you |

Affix + kind = 9 readable behaviors from 3 kits (Megabonk scope rule).
Elites award ×1.5 score and drop +3 Overdrive.

## Boss design — one chassis, three temperaments
WARDEN chassis (radial rings, slow menace) gains per-biome script:
| Biome | Name | HP | Escalation |
|---|---|---|---|
| 0 | Warden of Ash | 34 | current behavior (baseline learn) |
| 1 | Warden of Glass | 47 | rings tighten (interval 2.6→2.0 s) at phase 2 |
| 2 | The Hollow Choir | 60 | phase 2: double rings offset; phase 3: striker escorts every 8 s |

**Phases (all bosses):** 100–66% pattern P1; 66–33% P2 (interval ×0.75, ring
+4 bullets, tint brightens, one-shot horn); 33–0% P3 (interval ×0.55, spiral
offset ±0.37 rad, enrage tint, escort spawn once). Phase change = hitstop 0.2
+ shockwave ring + audio stinger — a *breathing* checkpoint (learning curve).

**Boss rules:** spawn telegraph 1.5 s; contact radius 2.4; slow drift toward
ember (1.7 u·s⁻¹); shards knock back bosses ×0.1 (no cheese-stunlock); killing
burst 900 particles + floor pulse; +1 permanent shard & 30 dawn on death.

## Sim-validation hooks (headless)
- `sim.startRoom(biome, room)` must produce: correct queue composition, boss
  rooms exactly 1 warden + P1 pattern timers, elites rolled per biome rate.
- Phase transitions assertable: damage boss to 60% → `phase === 2`, interval
  timer scaled, event fired once.
- Splitter death → exactly 2 minis; Shielded first hit → hp unchanged + shield
  cleared; SWIFT speed ×1.55 verifiable from velocity after 1 s of seek.
