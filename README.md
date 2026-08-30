# NEXUS ARMOR — Original Browser Tank Combat

> **Instant-play, original-IP tactical tank combat for modern browsers.** Angle your armor, hold the line, and earn every unlock — no downloads, no accounts, no pay-to-win.

NEXUS ARMOR distills what makes big vehicle-combat games compelling (armor angles, positioning, loadout identity, visible progression) into 3–8 minute PvE missions that run on Chromebook-class hardware. Built with **TypeScript + Three.js (WebGL)** on Next.js, with 100% procedural assets (models, textures, and audio are synthesized in-browser — nothing to download).

---

## Play (development)

```bash
bun install
bun run dev        # http://localhost:3000
```

Production-friendly: the game itself needs **no backend**. The optional `/api/profile` route (Prisma/SQLite) syncs your profile across reloads/devices when available; the game is fully playable offline from localStorage.

## Controls

| Input | Action |
|---|---|
| `W` `S` / `↑` `↓` | Drive forward / reverse |
| `A` `D` / `←` `→` | Steer hull |
| **Mouse** | Aim turret (ground-plane raycast) |
| **Left click** (hold) | Fire |
| `E` | Hull ability (Overdrive / Field Repair / Focus Shot / Aegis) |
| `Space` | Brake |
| `Esc` | Pause (fully freezes the simulation) |
| `F3` | Performance overlay (FPS, draw calls, entities, quality tier) |

**Touch devices:** left half = drive stick, right half = aim drag, on-screen FIRE / ABILITY buttons.

## What's in the slice

- **4 original hulls** with distinct roles, weapons and abilities (Scout → Heavy)
- **10-mission campaign** across 3 themed maps: eliminate / survive / demolish / boss objectives, star ratings, linear unlock chain
- **Readable combat model**: front/side/rear armor zones, frontal ricochets, splash falloff, real line-of-sight cover
- **Telegraphed AI**: grunts, flanking rushers, snipers with red aim-lines, brutes, and the GOLIATH boss — difficulty scales aim error, reaction time and composition, never readability
- **Session-sized progression**: credits + XP every battle (losses pay participation XP), hull purchases, 3×3-tier upgrade tracks per hull
- **Versioned localStorage saves** (corrupt-safe, reset behind confirmation) + optional server sync
- **Adaptive quality** (auto DPR / shadow / particle tiers), object pooling, instancing — budget: <100 draw calls, 16.6 ms frames (verify with `F3`)
- **100% procedural audio** via WebAudio (weapons, impacts, ricochet ping, engine, stingers); unlocks on first gesture, fails silent

## Debug / procedural notes

- Maps and cover layouts are **seeded** (`config/maps.ts` → `seed`); battles are deterministic given the same seed + inputs (sim uses `mulberry32`; FX randomness is deliberately unseeded so it can't desync gameplay).
- Performance overlay: `F3` or check `window.__naGame.getStats()` in the console.
- Quality tier can be forced in Settings (Auto/Low/Medium/High).

## Documentation

| Doc | Contents |
|---|---|
| `docs/DESIGN.md` | Product vision, market analysis summary, core loop, combat/economy design |
| `docs/ARCHITECTURE.md` | Module map, fixed-timestep loop, performance budgets, extension recipes |
| `docs/ROADMAP.md` | Vertical-slice roadmap + prioritized backlog (Critical → Experimental) |
| `docs/DECISIONS.md` | Decision records (problem → evidence → implementation → risks) |
| `docs/QA.md` | Manual + automated-assist test checklist |
| `docs/research/` | Market research (SteamCharts/Metacritic/GameDiscoverCo) + WebGL tech research, with sources |

## Intentionally cut (v1 scope guardrails)

Multiplayer/PvP (architecture ready via input-stream sim), destructible cover, key rebinding, cosmetics, localization, boss weak-point parts. See `docs/ROADMAP.md` backlog.
