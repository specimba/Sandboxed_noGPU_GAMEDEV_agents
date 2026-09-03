# HOLLOW SUN — Visual & Audio Expansion (Step 5, Art Director)

## Color law (sacred, from Ghostrunner study)
- **Gold/white = light that belongs to you** (ember, shards, boons, shrine).
- **Red family = hostile** (drifter/striker/weaver/bullets/elites' affix never
  changes body color — affixes add a *ring/trail*, keeping silhouette law).
- **White flash = overdrive/truth.**
- New: **violet = biome 1 grid**, **pale gold-white = biome 2 grid**. The floor
  may change temperature; the player and enemies never do.

## Light budget discipline (post-washout law)
1. Floor shader keeps `min(col, vec3(1.15))` cap — grids glow, never burn.
2. Per-frame additive budget: particles ≤ 900 alive in steady state, bursts
   170–900 by kind; particles die at the star surface.
3. Bloom strength window [1.0, 1.32]; overdrive +0.22, sun energy +0.1.
4. New emissive elements (elite halos, boss bar, boon cards) are UI/DOM or
   thin rings ≤ 0.85 opacity — no new bloom contributors.
5. Every biome lands with a title + mid-combat screenshot before merge.

## Biome language (uniform-driven, zero shader recompiles)
- Floor uniforms `uCold`/`uHot` + fog color per biome (lerp over 1.2 s on
  room transitions): 0 teal→gold (ash), 1 deep-violet→rose (glass), 2
  silver→white-gold (heart). Sun tint follows the same ramp.
- Elite halos: SWIFT = small white ring; SHIELDED = steady gold ring; SPLITTER
  = two mini-rings orbiting. Boss: large floor sigil ring + name banner.

## Audio expansion (procedural only)
- Biome drone root: A1 (ash) → C#2 (glass, glassier detune) → E2 (heart, near-
  consonant). Overdrive pad follows biome root.
- Boss phase stinger: rising fifth + noise swell (once per phase).
- Shrine (hub): slow major-third pad + soft chime on purchase.
- Chain ladder unchanged (pentatonic) — it is the game's signature.

## Readability checks (blockers, not suggestions)
- 20 entities on screen: player, shards, nearest 3 foes, bullets readable in
  a 300 ms frame.
- Elite affix identifiable from silhouette + ring alone (no HUD lookup).
- Reward cards: icon + one-line effect, 3-card row fits mobile width.
