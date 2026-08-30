# ECHOVOID — Game Design & Engineering Record

## 1. Product Vision

**ECHOVOID** is a browser-native 3D descent where **seeing costs being heard**.
You are a wisp of light falling into a bottomless abyss. The world is pitch
black; every *echo pulse* you sing expands as a visible shockwave that paints
the cavern for a few heartbeats — but the **Listeners** hunt by sound: a pulse
emitted very close stuns them, a pulse emitted near summons them to its origin.
Collect three Echo Shards to wake the golden Gate and descend deeper, forever.

One-line pitch: **"See with sound. Survive what listens. Descend forever."**

Original IP. No tanks, no shooting, no driving, no combat-as-usual — the core
mechanic *is* perception itself.

## 2. Why this concept (capability-benchmark alignment)

The brief asked for a concept that showcases what Three.js + the environment
can do, with a memorable core mechanic rather than generic action. Echolocation
was chosen because it makes every showcase requirement *diegetic* — the tech
serves the fantasy instead of decorating it:

| Requirement | How ECHOVOID showcases it |
| --- | --- |
| Immersive 3D environments | Seeded procedural abyss: winding hex-pillar paths, stalactites, drifting rocks, monolith ring, the far-off Heart |
| Lighting & shaders | Custom GLSL multi-pulse wavefront reveal (ring-buffer of 8 pulses shared across materials), fresnel rim materials, HDR bloom via `UnrealBloomPass`, ACES tone mapping, vignette/dread/fade post pass |
| Physics | Momentum movement, gravity, hover, coyote time, jump buffering, dash, sphere-vs-AABB collision, knockback |
| Animation | Bobbing shards, spinning gate, drifting listeners, camera damping, FOV kick, shake, particle trails/bursts |
| Particles | 3,200-mote reactive dust field (pushed by the wavefront in the vertex shader), pooled 700-particle CPU system |
| Camera work | Damped orbit follow, velocity auto-align, segment-vs-AABB camera collision, title attract orbit, cinematic fly-in |
| Audio | 100% synthesized WebAudio: sonar ping through a feedback-delay "cave echo" bus, chimes scheduled at physical wavefront-arrival delay, threat heartbeat, depth-mood drone, wind, distant void-calls |
| Interaction & UI | Zustand-bridged HUD (depth, shards, light, pulse/dash cooldowns, threat readout, gate compass), title/pause/death/clear overlays, toasts, touch joystick + buttons |

## 3. Core loop

```
PULSE to see (risk: listeners hear)
  → REVEAL the world for a breath
    → NAVIGATE pillars, avoid spikes & listeners
      → COLLECT 3 echo shards (amber breadcrumbs)
        → GATE awakens (gold wave reveals the way)
          → DESCEND → deeper, darker, more listeners → repeat
```

Risk/reward kernel: **every pulse is information and danger at once.**
Close pulse (<11u) = stun. Near pulse (<30u) = they come. Silence = safety =
blindness. The player composes their own tension.

## 4. Technical architecture

- **Next.js 16 + TypeScript**, single user-visible route `/`; game mounts as a
  client component (`GameCanvas`) with `ssr: false`.
- **Engine** (`src/game/`): `engine.ts` orchestrator owns renderer, composer,
  phase machine (`title → flying → playing ⇄ paused`, `dead`, `cleared`),
  pulse scheduling (wavefront hits fire at `t + distance/waveSpeed`), level
  lifecycle, adaptive device-pixel-ratio (EMA frame-time hysteresis).
- **Levels** (`level.ts`): mulberry32-seeded random-walk path + branch stubs;
  all static geometry merged into ONE draw call with per-vertex `color` +
  `aGlow` attributes; colliders (AABBs), spike zones, shard/gate/spawn/hunter
  anchors derived from the same data.
- **React bridge**: `store.ts` (zustand) — engine pushes throttled vitals
  (~11 Hz) + discrete events; UI components read selectors; UI calls engine
  via `getEngine()` singleton.
- **Persistence**: `localStorage` best-depth (versioned key `echovoid.best`).
- **Graceful degradation**: WebGL init failure → in-UI "SILENCE" message;
  WebAudio failure → silent play; `prefers-reduced-motion` CSS guard +
  in-game Reduced FX toggle; adaptive DPR keeps frame times in budget.

## 5. Difficulty & progression

- Depth N: `13 + min(2N, 9)` path nodes, `2 + N` listeners (cap 6), listener
  speed `5.6 + 0.45·(N−1)`, spike chance `0.18 + 0.035·N`, darker drone mood.
- +1 light (max 3) per successful descent; death restores light but keeps you
  in the depth; shards persist through death; best depth persisted locally.
- Endless structure: no final level — the score *is* depth.

## 6. Acceptance criteria for the vertical slice — all verified in-browser

- [x] Title screen with live attract mode (auto-pulses reveal the world)
- [x] Begin → camera fly-in → playable in under 3s (real hardware)
- [x] Pulse reveals world with physical wavefront timing + echo audio
- [x] Movement: WASD drift, jump/hover, dash, camera orbit/zoom, collision
- [x] 3 shards → gate awakens (gold pulse + compass) → enter → depth cleared
- [x] Descend → regenerated harder level (hunters 3→4 verified)
- [x] Void-fall & spike & listener damage; death overlay; respawn
- [x] Pause (Esc), sound toggle, reduced-FX toggle, abandon to title
- [x] Best-depth persistence across reloads
- [x] Touch controls (joystick + ECHO/JUMP/DASH) on touch devices
- [x] Responsive from 390px portrait to desktop; no console errors

## 7. Backlog (prioritized)

**Critical (next build)**
- Listener damage telegraph (brief wind-up flash before contact)
- Options: mouse sensitivity & invert Y
- Gamepad support

**High**
- Second enemy archetype (blind but sound-immune "Crawler" that forces dash use)
- Moving/rotating platforms; crumbling pillars
- Depth-based biome palettes (teal → violet → crimson abyss)
- Ghost-run leaderboard (local, seed-fixed daily depth)

**Medium**
- Speedrun timer + splits overlay
- Screenshot mode (hide HUD, free camera)
- Web Audio optional master-volume slider

**Experimental**
- Microphone mode: your real voice is the pulse (WebAudio analyser gate)
- PvP "duet": two wisps share one abyss; your pulses reveal the world to
  each other — and attract listeners to each other
