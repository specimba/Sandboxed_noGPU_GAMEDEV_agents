# NEXUS ARMOR — Game Design Document (v1)

**Working title:** NEXUS ARMOR · **Genre:** top-down/isometric tactical tank action (PvE-first) · **Platform:** modern browsers (WebGL via Three.js), desktop-first, touch-supported
**Engine:** Three.js + TypeScript + Next.js (static-friendly) · **Session target:** 3–8 minutes per battle

---

## 1. Product Vision

> **"In one click you are in a tank. In thirty seconds you are good at it. In eight minutes you earned something."**

NEXUS ARMOR is an original-IP, browser-native tank combat game. It distills what makes big vehicle-combat games compelling (armor angles, positioning, loadout identity, visible progression) into instant-play, 3–8 minute PvE missions that run on a Chromebook. No downloads, no accounts, no pay-to-win.

**Design pillars** (every feature must serve at least one):

1. **Instant play** — URL → firing your cannon in under 30 seconds, including first load.
2. **Readable combat** — every death is explainable: telegraphs, armor-zone feedback, clean silhouettes, honest collision.
3. **Positioning is the skill** — cover, line-of-sight and armor angles make movement matter more than twitch aim.
4. **Session-sized progression** — every battle visibly moves XP/credits bars; unlocks are earned, never sold.
5. **Runs everywhere** — 60 FPS desktop, playable low tier on integrated GPUs; adaptive quality is default-on.

## 2. Market Analysis (summary — full evidence in `docs/research/market.md`)

| Finding (evidence) | Design response |
|---|---|
| War Thunder sustains ~50K avg Steam CCU; no established browser 3D tank game holds that space (SteamCharts) | The "instant-play tank game" slot is open; target it deliberately |
| Shell Shockers: low-7-figures/yr, 39% Chromebook users, DAU 300–350K (GameDiscoverCo) | Instant play + low-spec performance is the moat; quality tiers from day one |
| Genre's loudest criticisms: P2W (WoT premium ammo), grind revolt (War Thunder 4.1/10, 2023 economy review bombing), Crossout "vile grind" → CCU collapse | Never sell power; respectful economy; losses still pay ~40%; horizontal unlocks fast, vertical mastery slower |
| Retention playbook: 5–15 min sessions, session-sized dailies, battle pass as retention tool (Deconstructor of Fun) | 3–8 min missions, daily-style bonus contract (later), progression visible every run |
| Steel Hunters shutdown (~6 months, low retention); Tanki X rewrite failure | PvE-first, cheap live-ops scope; progression is web-native + exportable (server-sync API) |
| Browser audiences skew young/low-power; portals = distribution (CrazyGames 50M+/mo) | Static-friendly build, embeddable, no backend required to play |

## 3. Core Gameplay Loop

**Micro (seconds):** reposition → angle armor → read telegraph → fire when reload ready → confirm damage feedback (sparks/numbers/hitmarker).
**Battle (3–8 min):** deploy with one tank → complete mission objective across waves → extraction (victory) or destruction (defeat) → debrief.
**Meta (sessions):** spend credits in Garage (new hulls, 3-track upgrades) → unlock next campaign mission → chase stars (clear time + damage-taken bonus) → harder compositions of the same readable threats.

```
[Boot] → [Menu] → [Mission Select] → [BATTLE] → [Debrief/Rewards]
             ↑            ↓               ↓
             └── [Garage: tanks & upgrades] ← credits/XP ──┘
```

**Failure design:** defeat still awards 40% of battle earnings and full XP — every run returns something (evidence: punishing losses are a top genre complaint).

## 4. Player Tanks (roles — meaningful trade-offs, no strict hierarchy)

| Hull | Role | Identity | Ability (E, cooldown) |
|---|---|---|---|
| **VX-1 "Jackal"** (Light/Scout, free) | Flanker | Fast, fragile, fast-reloading autocannon; strafes enemies to death | **Overdrive** — +60% speed, +50% reload for 4s (18s CD) |
| **VX-4 "Bulwark"** (Medium, 1,200 cr) | Frontline brawler | Balanced armor/gun; the reliable all-rounder | **Field Repair** — restore 30% HP over 2s (25s CD) |
| **VX-7 "Longbow"** (Tank Destroyer, 2,800 cr) | Ambusher | Massive single-shot railgun that pierces; thin armor, slow turret | **Focus Shot** — next shot within 5s: ×2.2 damage, pierces all (20s CD) |
| **VX-9 "Mammoth"** (Heavy, 5,200 cr) | Breaker | Slow, huge HP, splash howitzer; soaks fire, clears cover clusters | **Aegis** — take 50% less damage for 4s (22s CD) |

Progression does not make hulls obsolete: upgrades (3 tracks × 3 tiers per hull) deepen identity instead of flattening it.

## 5. Enemy Threats (understandable behavior, varied tactics)

| Archetype | Threat read | Counter-play |
|---|---|---|
| **Grunt** | Standard gunner; closes to mid-range and trades | Angle armor, out-trade |
| **Rusher** | Fast flanker with light autocannon | Track minimap, back against walls |
| **Sniper** | Long-range, **red aim-line telegraph** before firing | Break LOS when the line appears |
| **Brute** | Slow heavy with splash gun | Kite, focus fire, use splash-safe spacing |
| **GOLIATH** (boss, mission 10) | Giant elite Brute, huge HP, slow but devastating | The whole campaign teaches you this fight |

AI principle: enemies announce themselves (movement intent + telegraphs) before they kill you. Difficulty scales via aim error, reaction delay, spawn composition and stat multipliers — never via unreadable attacks.

## 6. Combat Model (readable depth)

- **Armor zones** — shells resolve as FRONT (×0.55 taken), SIDE (×1.0), REAR (×1.45) from impact direction vs hull facing; HUD + debrief reinforce it.
- **Ricochet** — steep front impacts can bounce (no damage, distinctive *ping* + spark) → fast tanks can angle-bounce slow shells; TD/railgun shells normalize (never bounce) → heavy feel.
- **Splash** — howitzer/rocket shells deal falloff damage in a radius; kiting Brutes matters.
- **Cover** — line-of-sight is real (raycast vs props); hull-down blocks shells, not just view.
- **Abilities** — one per hull, honest cooldowns, no consumables → no pay-to-win surface.

## 7. Missions & Objectives (data-driven)

Objective types: **ELIMINATE** (clear all waves), **SURVIVE** (hold for T seconds vs continuous spawns), **DESTROY** (kill N static targets + defenders), **BOSS**. 10-mission launch campaign across 3 maps (Dry Docks → Canyon Outpost → Foundry), linear unlock, difficulty 1→10, star rating (clear / time / damage-taken). Rewards: credits + XP scale with difficulty; first-clear bonus ×2.

## 8. Progression & Economy (anti-P2W by construction)

- **Credits** — per-kill + objective + completion bonus; losses pay 40%. First clear ×2.
- **XP/Level** — curve ~`120·n^1.35`; levels are prestige + stats (no power gates).
- **Unlocks** — hulls at fixed credit prices; upgrade tiers 200/450/900 per track. Everything earnable by play; **nothing is sold** (monetization path documented as ads/cosmetics only).
- **Persistence** — versioned local save (corrupt-safe, reset behind confirmation) + optional server sync API (offline-first, silent failure) → clear path to online features.

## 9. Audiovisual Direction (original, zero external assets)

- **Look:** stylized low-poly military hardware over procedurally textured terrain; warm, sun-baked palettes per map (sand/rust, red rock, dark foundry-teal); hemisphere + single directional light, matched fog, gradient sky dome, real-time shadows (quality-gated), instanced props, tread marks + scorch decals.
- **Feel:** muzzle flash + light, shell tracers, recoil spring, hit-stop on kills, camera kick/shake (toggleable), damage numbers, hit vignette, kill-toasts, star burst on victory.
- **Audio:** 100% procedural WebAudio (oscillators + filtered noise): engine hum tied to throttle, cannon boom w/ low thump, ricochet ping, explosion layers, UI ticks; AudioContext resumes on first user gesture; audio failure can never block gameplay.

## 10. Accessibility & Controls

- **Desktop:** WASD drive (hull), mouse aim turret, LMB fire, Space brake, E ability, Esc pause. Full rebinding deferred (backlog M-3).
- **Touch:** left virtual stick = drive, right drag = aim, FIRE/ABILITY buttons (44px+ targets).
- **Accessibility:** color-blind-safe team encoding (shape+color), damage numbers toggle, reduced-motion mode (disables shake/hit-stop), high-contrast HUD, keyboard menu navigation, focus-visible states.

## 11. What We Are NOT Building (v1 scope guardrails)

No multiplayer, no premium currency, no loot boxes, no realistic mil-sim controls, no asset downloads, no accounts required. Architecture supports later PvP (deterministic sim, input-driven), but v1 is a polished PvE vertical slice.
