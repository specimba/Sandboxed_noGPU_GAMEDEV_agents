# Technology Research — GPU-accelerated browser tank game

Task ID: 1-b · Agent: tech-research · Date: 2026 session
Scope: research + documentation only (no game code written). Target stack: TypeScript + Next.js 16 + Three.js, PvE tank combat, must run well on low-end hardware. All claims carry a source URL or are explicitly tagged **[unverified]** (knowledge fallback after a failed fetch, or widely-repeated community practice without a fetched authority).

---

## 1. Engine choice: evidence

**Decision context:** the benchmark mandates Three.js. The evidence below justifies it and records what we consciously give up vs Babylon.js.

| Dimension | Three.js | Babylon.js | Source |
|---|---|---|---|
| Bundle size (min+gzip, rendering core) | ~168.4 kB (v0.175.0, per Bundlephobia) | ~1.4 MB (v8.1.1), modular imports reduce it | https://blog.logrocket.com/three-js-vs-babylon-js |
| Independent 2025-26 comparison | "significantly smaller (under 200 kB minified+gzipped) as a rendering core, faster initial load" | ships more built-in features | https://dev.to/devin-rosario/babylonjs-vs-threejs-the-360deg-technical-comparison-for-production-workloads-2fn6 |
| Ecosystem positioning | flexible rendering library — you own the game loop | full engine: physics, node material editor, particles editor built in | https://generalistprogrammer.com/tutorials/best-html5-game-frameworks-2025 ; https://forum.babylonjs.com/t/performance-compared-to-godot-and-other-engines/59731 |
| Community sentiment | "preferred for rendering graphics"; engine features must be built/chosen | "better performing one, covers game relevant functions" (per some devs) | https://www.reddit.com/r/webdev/comments/564v94/threejs_vs_babylonjs_performance |

**Why Three.js fits this project:**
1. **Payload budget.** For a game that must load fast on weak hardware, ~168 kB vs ~1.4 MB initial core payload is a first-order win; LogRocket explicitly attributes the difference to Babylon shipping more built-in features (https://blog.logrocket.com/three-js-vs-babylon-js).
2. **Custom game loop.** Three.js is unopinionated: it renders, it does not own the loop. That is exactly what we need for a fixed-timestep deterministic simulation (§3) where we must separate `update(dt)` from `render(alpha)`. A full engine that owns the loop (Babylon `engine.runRenderLoop`, built-in physics/particles) fights this design. **[unverified — architectural interpretation, consistent with the "rendering library vs full engine" positioning in the sources above]**
3. **Ecosystem mass for our needs.** We need: instancing/batching, THREE.Points particles, shadow maps, WebAudio (separate API anyway), and a renderer we can profile via `renderer.info`. All are native Three.js; nothing we need is Babylon-only. **[unverified — capability judgment]**

**Version / renderer setup practices (r152+ color management is the big one):**
- Since **r152**, `THREE.ColorManagement.enabled` defaults to `true` and `WebGLRenderer.outputColorSpace` defaults to `THREE.SRGBColorSpace`. Legacy names were renamed: `outputEncoding` → `outputColorSpace`, `texture.encoding` → `texture.colorSpace`, `sRGBEncoding` → `SRGBColorSpace`, `LinearEncoding` → `LinearSRGBColorSpace` (source: official r152 discussion/migration notes, https://discourse.threejs.org/t/updates-to-color-management-in-three-js-r152/50791).
- Migration rule from the same thread: color textures (e.g. `material.map`) must get `texture.colorSpace = THREE.SRGBColorSpace`; non-color data textures (normal/roughness maps) keep the default `NoColorSpace`; HDR textures (.hdr/.exr) use `LinearSRGBColorSpace`.
- With three.js-provided post-processing, the sRGB conversion must be handled by a final output pass (`OutputPass`) or by setting `outputColorSpace = LinearSRGBColorSpace` with a GammaCorrectionShader pass — double-converting is the classic washed-out/dark bug (sources: https://discourse.threejs.org/t/updates-to-color-management-in-three-js-r152/50791?page=3 ; https://discourse.threejs.org/t/color-management-and-post-processing-confusion-need-help/76144).
- WebGLRenderer constructor options relevant to low-end targets (option semantics per official docs, https://threejs.org/docs/#api/en/renderers/WebGLRenderer): `antialias` (can be disabled on low tier; resolve via resolution instead), `alpha: false`, `stencil: false`, `powerPreference: 'high-performance'`; clamp `renderer.setPixelRatio()` instead of letting devicePixelRatio run free (see §2.3). **[unverified — API knowledge, docs URL given for verification]**
- Locking the minor version (`three@0.1xx.x`) and reading migration notes per upgrade is standard practice; r152/r155 (light unit changes) are the breaking changes most often cited in help threads. **[unverified]**

---

## 2. Performance budget & techniques

Frame budget: 60 fps ⇒ **16.6 ms total per frame** (1000/60 = 16.667 ms is the canonical timestep value used in game-loop literature: https://isaacsukin.com/news/2015/01/detailed-explanation-javascript-game-loops-and-timing). Simulation + JS must fit alongside the GPU frame; a 5 ms GC pause is already a visible stutter at 60 fps (https://generalistprogrammer.com/tutorials/phaser-performance-optimization-guide).

### 2.1 Draw calls & geometry
- **Target < 100 draw calls per frame**; "Below 100 draw calls, most devices maintain smooth 60fps. Above 500, even powerful GPUs struggle." Measure with `renderer.info.render.calls` (https://www.utsubo.com/blog/threejs-best-practices-100-tips).
- Low-end tier budget: **≤ 50–80 draw calls, ≤ 100–200k triangles in view** **[unverified — derived interpretation of the <100 rule for weak iGPUs; no authority publishes a universal triangle budget: "You can have a scene up to 10 million triangles that runs great at 60fps or a scene with only one tenth of that amount that barely runs at 30fps" — https://www.artstation.com/blogs/daanmeysman/7goy/keeping-your-games-optimized-part-1-triangles ; community datapoint: "100% possible to render 50k cheap triangles at 60 fps on 10-year-old midrange hardware" — https://www.reddit.com/r/gamedev/comments/1lgf071/i_feel_like_im_obsessing_over_poly_count_too_much]**
- Techniques (all from https://www.utsubo.com/blog/threejs-best-practices-100-tips unless noted):
  - `InstancedMesh` for repeated objects (props, debris, foliage, bullet tracers). Practical pattern: allocate a higher instance count than needed, then lower `mesh.count` — avoids re-allocating (https://discourse.threejs.org/t/best-way-to-reduce-draw-calls/25186).
  - `BatchedMesh` for many geometries sharing a material; share materials between meshes; merge static geometry with `BufferGeometryUtils`; use texture atlases.
  - "Draw calls are the silent killer" — same six techniques (instancing, shared materials, static merging, atlases, frustum culling awareness): https://threejsroadmap.com/blog/draw-calls-the-silent-killer
  - Asset compression: Draco (90–95% geometry size reduction) and KTX2/Basis (~10x GPU texture memory reduction) — relevant if we ship GLB tank models.
- Every tank hull/turret → one instanced draw; decals/ground clutter → instanced or merged. Dynamic objects that change material properties per-instance should use instance color attributes rather than separate materials. **[unverified — implementation guidance]**

### 2.2 Particles (THREE.Points)
- `THREE.Points` renders N sprites in a single draw call with per-vertex attributes (position, size, color, alpha) updated in typed arrays; this is the standard approach for large particle counts. **[unverified — API knowledge]**
-datapoint for scale: the gamedev.SE consensus for hundreds of thousands of static particles is exactly this — buffer-backed point/quads, never individual meshes (https://gamedev.stackexchange.com/questions/204998/most-efficient-method-to-render-hundreds-of-thousands-to-millions-of-stationary). GPU Gems ch.23 warns particle systems are "trivial to add lots of particles, leading to a conflict with performance constraints" — hence hard caps (https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-23-high-speed-screen-particles).
- **Proposed caps for this benchmark [unverified]:** ~2,000 live particles on low tier, ~6,000 on high tier; overdraw (big transparent points) is the real cost, so keep point size small and use additive blending; spawn/kill via ring buffer in a preallocated Float32Array — never allocate per particle.
- Unity WebGL devs report the same class of problem cross-engine: transparency kills framerates — prefer additive blending for effects (https://discussions.unity.com/t/performance-issues-in-unity-webgl-build-seeking-optimization-advice/1491585).

### 2.3 Adaptive resolution / quality tiers
- Do **not** render at raw `devicePixelRatio` (a 3x phone DPR triples fragment work). Clamp `setPixelRatio(Math.min(devicePixelRatio, 2))` on high tier and ~1.0–1.5 on low tier. **[unverified — common practice]**
- Adaptive algorithm validated by the three.js community: change pixel ratio in **small increments and evaluate over ≥3 frames before stepping again** — FPS may not actually improve at lower resolution if the bottleneck is CPU-side (https://discourse.threejs.org/t/changing-pixelratio-based-on-fps-good-or-bad-idea/34563).
- Dynamic resolution / render scale is an established WebGL pattern even in Unity (https://discussions.unity.com/t/dynamic-resolution-render-scale-in-webgl-and-urp/808364); canvas backing-store size vs CSS size control per Unity docs (https://docs.unity3d.com/2022.3/Documentation/Manual/webgl-canvas-size.html).
- Quality tiers: low tier = no shadows + lower DPR + no post FX; medium = one directional shadow, PCF; high = soft shadows, higher DPR, FXAA/post FX. Tier chosen once at boot from a quick probe, plus runtime downgrade on sustained frame misses. **[unverified — design synthesis of the above]**

### 2.4 Shadows on weak GPUs
- One directional light with one shadow map is the cheap baseline; per-frame shadow map re-render is a whole extra scene pass, so: tune the shadow camera frustum tightly around the action, size the map appropriately (smaller = cheaper), **disable shadow auto-update (`shadow.autoUpdate = false` / `needsUpdate = true` on demand) when the scene is static**, and use fake/blob shadows for small dynamic objects (https://www.utsubo.com/blog/threejs-best-practices-100-tips, tips 56–62).
- Filter type cost ladder: `BasicShadowMap` (cheapest, hard edges) → `PCFShadowMap` (softer, moderate) → `PCFSoftShadowMap`/VSM (softest, costliest); lower map sizes (e.g. 512/1024) trade sharpness for speed (https://dev.to/outriding/mastering-shadows-in-threejs-setup-configuration-and-optimization-39nn). Three.js shadowmaps on mobile have historically been slow — treat any real-time shadow as a premium feature (https://github.com/mrdoob/three.js/issues/5554).
- The known per-tap cost of PCF variants (e.g. PCFSoft's extra kernel samples) makes it measurably heavier than plain PCF **[unverified — exact tap counts; cite three.js shader source when implementing]**.
- Recommendation for this game: low tier = blob shadows only; medium = 1024² PCF directional; high = 2048² PCFSoft. **[unverified]**

### 2.5 Garbage collection / memory
- Object pooling for every spawned entity (shells, explosions, impact decals, tracer lights) — "At 60 FPS, even a 5ms pause causes a visible stutter. Object pooling eliminates this by reusing objects instead of creating and destroying them." (https://generalistprogrammer.com/tutorials/phaser-performance-optimization-guide; same practice as utsubo tip 39 "Use object pooling for spawned entities").
- Canonical low-garbage rules for realtime JS (Construct's classic blog post — **page now behind Cloudflare; fetched content unavailable, marked [unverified]**, https://www.construct.net/en/blogs/construct-official-blog-1/write-low-garbage-real-time-761): reuse objects instead of `{}`/`new` per frame, avoid per-frame string concat/`split`, avoid closures/variadic calls in hot loops, preallocate typed arrays. Corroborated by rAF-GC profiling threads (https://stackoverflow.com/questions/17382321/requestanimationframe-garbage-collection).
- Dispose everything on teardown: `geometry.dispose()`, `material.dispose()`, `texture.dispose()`; watch `renderer.info.memory` for leaks (https://www.utsubo.com/blog/threejs-best-practices-100-tips).
- Never create Three.js objects (vectors, quaternions, materials) inside the frame loop; keep scratch vectors module-level. **[unverified — standard practice, consistent with the pooling sources]**

---

## 3. Simulation architecture patterns

### 3.1 Fixed timestep + accumulator + render interpolation
Canonical pattern (Gaffer on Games, "Fix Your Timestep", fetched and verified: https://gafferongames.com/post/fix_your_timestep/):
1. Accumulate real elapsed time each frame; consume it in fixed `dt` steps (`while (acc >= dt) { update(dt); acc -= dt; }`).
2. Keep the leftover fraction as `alpha = acc / dt` and **interpolate** the render state between previous and current simulation states (lerp positions; slerp orientations stored as quaternions).
3. **Spiral of death:** if simulating X seconds takes Y > X seconds of real time, the loop falls behind forever. Mitigate by clamping the maximum steps per frame — the game visibly slows down under overload instead of dying (same source).
- The identical pattern with `timestep = 1000/60 = 16.667ms`, a "panic" branch when the accumulator overflows (e.g. > 250 ms — typical after a background tab), FPS monitoring, and interpolated drawing is derived step-by-step for JavaScript in Isaac Sukin's article (fetched and verified: https://isaacsukin.com/news/2015/01/detailed-explanation-javascript-game-loops-and-timing, code: MainLoop.js).
- Browser specifics: `requestAnimationFrame` passes a high-res timestamp; rAF is the right driver for the loop (browser aligns it to vsync and throttles when hidden) (https://isaacsukin.com/news/2015/01/detailed-explanation-javascript-game-loops-and-timing ; https://paths.grasp.study/public-modules/0df892d1-790e-4906-a45b-4449ceae664c/lessons/20dca797-10c3-4a1b-87d6-3a1aacd48009).
- Interpolated physics rendering write-up with working JS: https://kirbysayshi.com/p/interpolated-physics-rendering ; browser-focused guide: https://simplified.media/guides/fixed-timestep-loops ("Rendering needs interpolation because the accumulator leaves a sub-step remainder each frame").
- **Tab-background throttling:** rAF "pauses execution when the tab is switched, when the computer sleeps" (https://www.reddit.com/r/incremental_games/comments/nldx9u/performance_tips_for_javascript_game_developers_2). On return, the rAF timestamp jumps — the accumulator must clamp (panic branch) or the sim fast-forwards. MDN: the Page Visibility API sends `visibilitychange` when the user minimizes/switches tabs; apps "pause the video when the user puts the tab into the background, and resume … when the user returns" — the same hook is our auto-pause trigger (https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API). Design: on `document.hidden` → pause sim + suspend audio; on visible → re-sync `lastTime = performance.now()` before resuming. **[unverified — the clamp/auto-pause wiring is our design; the underlying behaviors are sourced]**

### 3.2 Determinism & seeded RNG
- PvE tank combat wants replay/shareable-seed runs and (later) lockstep-friendly replay; determinism requires (a) fixed timestep, (b) all randomness from a seeded PRNG, (c) no `Math.random()` in sim code, (d) iteration over stable-ordered collections. **[unverified — design requirements]**
- **mulberry32** is the recommended tiny PRNG: 32-bit seed and 32-bit internal state, deterministic sequence from the seed, a handful of lines, fast — "You provide a 32-bit seed, and it produces a deterministic sequence of values" (https://www.4rknova.com/blog/2026/03/01/mulberry32-rng). "Using Mulberry32 inside a game loop allows randomness to become a controlled subsystem rather than an external source of entropy. If the same [seed]… deterministic" (https://emanueleferionato.com/... — canonical URL: https://emanueleferonato.com/2026/01/08/understanding-how-to-use-mulberry32-to-achieve-deterministic-randomness-in-javascript). Reference implementations: https://github.com/cprosche/mulberry32 ; npm `stable-rng` wraps the same algorithm (https://classic.yarnpkg.com/en/package/stable-rng). General seeding background: https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript
- Caveat: JS float math is deterministic per-engine but not across engines/optimization tiers; for this PvE benchmark (replays, not cross-client lockstep) per-run determinism in one browser is sufficient. **[unverified]**

### 3.3 Simulation/render decoupling
- Sim runs at fixed dt (pure TypeScript, zero Three.js imports — testable in Node/vitest, serializable for replays/saves); render layer reads sim snapshots + interpolation alpha only. Web Workers can host the update if needed (Sukin covers "Use Web Workers for updates", same URL as 3.1). **[unverified — our design, built on sourced pattern]**

---

## 4. Audio without assets

**Hard constraint first — autoplay policy (fetched, verified):** Chrome covers the Web Audio API since **Chrome 71**; "If an AudioContext is created before the document receives a user gesture, it will be created in the 'suspended' state, and you will need to call `resume()` after the user gesture." Chrome's own recommended pattern is a one-liner resuming on the first user interaction (pointerdown/keydown); the context may also auto-resume when `start()` is called on an attached node after a gesture (https://developer.chrome.com/blog/autoplay). Practice: create the `AudioContext` lazily or create-then-resume on the first "Start Battle" click; never build sound state that assumes it is running. **[unverified — the UX wiring is our design]**

**Procedural synthesis toolkit (all native Web Audio, zero downloads):**
- Oscillators (sine/square/saw/triangle) + `GainNode` ADSR envelopes = cannons, UI clicks, alarms. Precedent: "tiks" generates 10 UI sounds (click, toggle, success, error…) in 2 KB at runtime using oscillators and gain envelopes (https://www.reddit.com/r/javascript/comments/1smvqvy/tiks_procedural_ui_sounds_in_2kb_zero_audio_files).
- **Noise buffers** (white/pink noise from a pregenerated `AudioBuffer`, looped through `BiquadFilterNode`) = explosions, engine roar, track rattle, wind. "Noise is an essential element" of synthesized SFX, with envelopes applied to filters as well as oscillators/amplifiers (https://designingsound.org/2014/10/02/100-synthesized-sfx-for-stylized-realism-in-games). Practical recipes (noise bursts, filters, envelopes) in https://dev.to/hexshift/how-to-create-procedural-audio-effects-in-javascript-with-web-audio-api-199e and the official MDN tutorial on creating/sequencing audio (sample generation, custom buffers): https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques
- **Engine loop:** two proven approaches — (a) procedural: model ignition/piston frequency + low-pass resonance and modulate with RPM (research write-up with JS demos: https://www.redblobgames.com/x/2147-webaudio-motor); (b) hybrid: a short synthesized loop whose **playbackRate is pitch-shifted to RPM**, plus distortion at high RPM (devlog of a shipped racing game: https://imphenzia.itch.io/thats-racing/devlog/37275/engine-audio). For a tank: low base frequency (large engine), slow LFO wobble on the oscillator detune, filtered noise layer for the tracks; crossfade idle/combat filter settings. **[unverified — tank-specific design; sources cover the car analogues]**
- Fully synthesized SFX for stylized games is an established discipline (https://designingsound.org/2014/10/02/100-synthesized-sfx-for-stylized-realism-in-games); overview of what the API can synthesize: https://teropa.info/blog/2016/08/19/what-is-the-web-audio-api
- Pitfalls besides autoplay: creating many nodes per shot leaks — pool/recycle nodes or keep a per-sound node budget; `AudioContext.currentTime`-based scheduling beats `setTimeout` (MDN advanced techniques, URL above). **[unverified — implementation hygiene]**

---

## 5. Persistence & save versioning

- **localStorage** (Web Storage) is synchronous — "operations are performed synchronously, blocking the execution of other JavaScript code" — fine for small blobs, risky for large/frequent writes; "Asynchronous alternatives, such as IndexedDB, may be more suitable … when dealing with larger datasets" (MDN, fetched: https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API). Quotas/eviction are browser-managed (see MDN "Storage quotas and eviction criteria" linked from the same page).
- **Chosen pattern [unverified — design decision built on sourced facts]:** save the active profile (settings, unlocks, career) as one small JSON blob in `localStorage` keyed by a version field (fast, synchronous, simplest); if replay recordings / large data are ever stored, use IndexedDB (async, structured-clone, transactions) via a tiny wrapper. This matches the community rule of thumb: "LocalStorage is the go-to for simple, quick tasks, while IndexedDB is the powerful choice for complex, data-intensive applications" (https://shiftasia.com — via search result, ShiftASIA blog).
- **Versioned schema migration:** write saves as `{ schemaVersion: N, data }`. On load, run sequential migrations `N → N+1 → … → current`. In IndexedDB this is first-class: "the upgrade callback is your schema migration system — it runs when the version [changes]" (https://stevenpg.com — "Building an Offline-First Web App with IndexedDB"); Dexie formalizes it as `db.version(n).stores(...).upgrade(...)` chains (docs fetched: https://dexie.org/docs/Version/Version). Migration guidance: "Schema changes require careful versioning and migration logic" (https://blog.logrocket.com — offline-first 2025 article). Wrappers compared: Dexie vs localForage vs `idb` (https://www.pkgpulse.com).
- **Offline-first with later server sync [unverified — design]:** treat local save as the source of truth (`dirty` flag + `updatedAt` timestamp); when a sync endpoint exists later, push the blob and reconcile by timestamp — accept that "there can be conflicts" and that "browser storage is not really persistent" (users/eviction can wipe it) per RXDB's local-first downside list (https://rxdb.info). Keep the save schema small and JSON so the future server mirror is trivial. IndexedDB + Workers context for larger offline apps: https://blog.adyog.com (IndexedDB and Web Workers guide).
- Storage-persistence hardening (optional): `navigator.storage.persist()` to opt out of best-effort eviction **[unverified — API knowledge; verify at https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist]**.

---

## 6. Browser tank/action game teardowns (what was findable)

- **Tanki Online:** originally a Flash 3D MMO tank game; browsers ended Flash support on Jan 1 2021, forcing migration — "On January 1st, 2021, all web browsers will stop supporting Flash, and our games will no longer be able to run" (official Tanki communication via https://www.facebook.com/TankiOnline.en/posts/2307785152601094); the successor engine path was Unity (community thread "TO from Flash to Unity engine", https://en.tankiforum.com/topic/347065-to-from-flash-to-unity-engine — notes the scale of converting a large multiplayer Flash title). Tanki's own player-facing FPS guide recommends, in order: disable all graphic effects, update browser, close other tabs (https://en.tankiwiki.com/How_to_raise_FPS) — i.e., a shipped web tank game needed a graphics-effects off-switch for weak machines. **No published per-hardware player counts or frame budgets were found** — treat any specific numbers as **[unverified]**.
- **Krunker.io:** known to be a three.js-based browser FPS with extensive user quality settings (render distance, resolution scaling) per its settings documentation (https://krunkerio.fandom.com/wiki/Settings); three.js usage itself **[unverified — not confirmed from a primary source in this research]**. No public optimization talk was retrievable; community threads document frame-rate regressions and quality-setting sensitivity (https://www.reddit.com/r/KrunkerIO/comments/1ujlaqz/why_am_i_getting_low_frames_at_all_times). Krunker is widely cited as proof a browser shooter can hold high FPS on modest hardware — **[unverified]**.
- **Shell Shockers (shellshock.io):** shipped 2017 browser egg-FPS (https://en.wikipedia.org/wiki/Shell_Shockers); playable as a desktop-only browser title (https://www.crazygames.com/game/shellshockersio). Primary tech-stack write-ups were not retrievable in this pass; commonly reported as three.js-based **[unverified]**.
- **Transferable lesson from Unity WebGL devs** targeting dual-core/IGP machines: minimize overdraw/transparency, prefer additive blending, aggressively reduce per-frame allocations (https://discussions.unity.com/t/pushing-webgl-game-optimizations-further/587541 ; https://discussions.unity.com/t/performance-issues-in-unity-webgl-build-seeking-optimization-advice/1491585).
- Benchmark implication for our game: ship a **graphics-quality tier switch from day one** (effects off = the #1 FPS lever even in shipped tank games), and target the mid-2010s-integrated-GPU class. **[unverified — synthesis]**

---

## 7. Sources

Engine choice:
- https://blog.logrocket.com/three-js-vs-babylon-js
- https://dev.to/devin-rosario/babylonjs-vs-threejs-the-360deg-technical-comparison-for-production-workloads-2fn6
- https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison
- https://www.reddit.com/r/webdev/comments/564v94/threejs_vs_babylonjs_performance
- https://forum.babylonjs.com/t/performance-compared-to-godot-and-other-engines/59731
- https://generalistprogrammer.com/tutorials/best-html5-game-frameworks-2025
- https://threejs.org/docs/#api/en/renderers/WebGLRenderer

Color management / versioning:
- https://discourse.threejs.org/t/updates-to-color-management-in-three-js-r152/50791 (fetched)
- https://discourse.threejs.org/t/updates-to-color-management-in-three-js-r152/50791?page=3
- https://github.com/mrdoob/three.js/issues/30305
- https://discourse.threejs.org/t/color-management-and-post-processing-confusion-need-help/76144

Performance / rendering:
- https://www.utsubo.com/blog/threejs-best-practices-100-tips (fetched)
- https://threejsroadmap.com/blog/draw-calls-the-silent-killer
- https://discourse.threejs.org/t/best-way-to-reduce-draw-calls/25186
- https://discourse.threejs.org/t/how-to-optimize-shadow-rendering-in-three-js-for-better-performance/64681
- https://dev.to/outriding/mastering-shadows-in-threejs-setup-configuration-and-optimization-39nn
- https://github.com/mrdoob/three.js/issues/5554
- https://discourse.threejs.org/t/changing-pixelratio-based-on-fps-good-or-bad-idea/34563
- https://discussions.unity.com/t/dynamic-resolution-render-scale-in-webgl-and-urp/808364
- https://docs.unity3d.com/2022.3/Documentation/Manual/webgl-canvas-size.html
- https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-23-high-speed-screen-particles
- https://gamedev.stackexchange.com/questions/204998/most-efficient-method-to-render-hundreds-of-thousands-to-millions-of-stationary
- https://discussions.unity.com/t/performance-issues-in-unity-webgl-build-seeking-optimization-advice/1491585
- https://www.artstation.com/blogs/daanmeysman/7goy/keeping-your-games-optimized-part-1-triangles
- https://www.reddit.com/r/gamedev/comments/1lgf071/i_feel_like_im_obsessing_over_poly_count_too_much

Game loop / determinism:
- https://gafferongames.com/post/fix_your_timestep/ (fetched)
- https://isaacsukin.com/news/2015/01/detailed-explanation-javascript-game-loops-and-timing (fetched)
- https://kirbysayshi.com/p/interpolated-physics-rendering
- https://simplified.media/guides/fixed-timestep-loops
- https://gamedev.stackexchange.com/questions/187660/fixed-timestep-game-loop-why-interpolation
- https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API (fetched)
- https://www.reddit.com/r/incremental_games/comments/nldx9u/performance_tips_for_javascript_game_developers_2
- https://www.4rknova.com/blog/2026/03/01/mulberry32-rng
- https://emanueleferonato.com/2026/01/08/understanding-how-to-use-mulberry32-to-achieve-deterministic-randomness-in-javascript
- https://github.com/cprosche/mulberry32
- https://classic.yarnpkg.com/en/package/stable-rng
- https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript

GC / pooling:
- https://generalistprogrammer.com/tutorials/phaser-performance-optimization-guide
- https://www.construct.net/en/blogs/construct-official-blog-1/write-low-garbage-real-time-761 (fetch blocked by Cloudflare — snippet only, treat as [unverified])
- https://stackoverflow.com/questions/17382321/requestanimationframe-garbage-collection

Audio:
- https://developer.chrome.com/blog/autoplay (fetched)
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques
- https://www.reddit.com/r/javascript/comments/1smvqvy/tiks_procedural_ui_sounds_in_2kb_zero_audio_files
- https://designingsound.org/2014/10/02/100-synthesized-sfx-for-stylized-realism-in-games
- https://dev.to/hexshift/how-to-create-procedural-audio-effects-in-javascript-with-web-audio-api-199e
- https://www.redblobgames.com/x/2147-webaudio-motor
- https://imphenzia.itch.io/thats-racing/devlog/37275/engine-audio
- https://teropa.info/blog/2016/08/19/what-is-the-web-audio-api

Tank/action games:
- https://en.tankiwiki.com/How_to_raise_FPS (fetched)
- https://www.facebook.com/TankiOnline.en/posts/-what-to-do-when-flash-goes-away-tankersflash-is-being-phased-out-but-you-still-/2307785152601094
- https://en.tankiforum.com/topic/347065-to-from-flash-to-unity-engine
- https://krunkerio.fandom.com/wiki/Settings
- https://www.reddit.com/r/KrunkerIO/comments/1ujlaqz/why_am_i_getting_low_frames_at_all_times
- https://en.wikipedia.org/wiki/Shell_Shockers
- https://www.crazygames.com/game/shellshockersio
- https://discussions.unity.com/t/pushing-webgl-game-optimizations-further/587541

Persistence:
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API (fetched)
- https://stevenpg.com ("Building an Offline-First Web App with IndexedDB")
- https://dexie.org/docs/Version/Version (fetched)
- https://rxdb.info (local-first downsides)
- https://blog.logrocket.com (offline-first 2025)
- https://www.pkgpulse.com (Dexie vs localForage vs idb)
- https://shiftasia.com (localStorage vs IndexedDB)
- https://blog.adyog.com (IndexedDB and Web Workers)

*Fetch failures handled per protocol: construct.net blocked by Cloudflare (retried once, fell back to snippet + [unverified] knowledge); Tanki wiki returned mostly MediaWiki chrome (article body extracted via keyword search); Krunker/Shell Shockers primary tech write-ups not found (marked [unverified] where referenced).*
