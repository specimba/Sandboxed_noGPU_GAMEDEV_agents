# Community Discovery — The Post-Astra Wave
### Deep-dive research sprint · 4 parallel scouts · 78 searches · 30+ pages read · every claim linked
*Companion to `docs/PLAYBOOK.md`. Research only — no source code touched. Worklog: Task 11-a/11-b/11-c/11-d.*

---

## 1. Verification: the wave is real

The user's premise — "after GPT-6 ASTRA they are creating unbelievable things with Blender and simple Three.js works" — **checks out against primary sources, not hype:**

| Fact | Detail | Source |
|---|---|---|
| **GPT-6 Astra exists** | OpenAI frontier model, limited preview **Sep 3 2026**, public Sep 4 2026. $10/M in · $50/M out · 1M context · 128K output. Flagship pitch: "long-horizon agentic tasks involving computer and browser use" | [Wikipedia](https://en.wikipedia.org/wiki/GPT-6_Astra) · [OpenRouter card](https://openrouter.ai/openai/gpt-6-astra) · [Artificial Analysis](https://artificialanalysis.ai/models/releases/gpt-6-astra) |
| **OpenAI's own games showcase** | Dev blog *"Building games with Astra"*: **Void Explorer** — procedural space game, 2,048 star systems / 10,000+ planets, built with Codex+Astra. Companion tutorial: **"4 games with Astra, Blender, and Godot"** (Star Fox shooter, train FPS, RTS level, roguelike deckbuilder) | [developers.openai.com](https://developers.openai.com/blog/how-to-build-games-with-astra) |
| **The community meta** | r/aigamedev: "Astra can now build full worlds in Blender and UE5". Quote from the showcase: *"There are no 3D model files in this demo… entirely code-driven. Runs super smooth inside the browser"* | [r/aigamedev thread](https://www.reddit.com/r/aigamedev/comments/1w6s7j8/gpt6_astra_takes_3d_to_the_next_level_it_can_now/) |
| **The critical insight** | Community consensus: Astra's 3D genius is concentrated in **Three.js + Python** and degrades in C++ custom engines — *"my guess is Astra's 3D capabilities are a function of three.js and Python training data"* | same thread |
| **Scale markers** | fly.pieter.com (Cursor+Three.js flight MMO, "100% made with AI", ~3h first build, reported ~$1M/yr) · VibeJam 2025: 1,000+ entries, $10k to The Great Taxi Assignment · **7% of the entire Steam library discloses gen-AI usage; 1 in 5 of 2025 releases** | [generativeai.pub](https://generativeai.pub/how-pieter-levels-built-a-100k-mrr-flight-simulator-with-ai-be91290419bb) · [jam.pieter.com](https://jam.pieter.com) · [gamesindustry.biz](https://www.gamesindustry.biz/7-of-games-in-the-entire-steam-library-now-disclose-generative-ai-usage-study-says) |

**The punchline for us:** the stack the frontier wave celebrates — **prompt → bpy code → headless Blender → glTF → Three.js at runtime, debug hooks, seeded sims, journey tests** — is *structurally the pipeline we already built in Sprint 10.* Convergent evolution, independently verified.

---

## 2. The community meta, pattern by pattern (vs. our status)

| # | Pattern | Validated by | Our status |
|---|---|---|---|
| 1 | Prompt → generated **bpy script** → headless execute → GLB out | BlenderMCP ([ahujasid](https://github.com/ahujasid/blender-mcp), blender.org Lab page) · OpenAI tutorial | ✅ **HAVE** (`make assets-blender`) |
| 2 | Code-driven geometry at runtime, zero model files | Void Explorer trains ("no 3D model files… code-driven") | ✅ **HAVE** (procedural geometry everywhere) |
| 3 | Agent-facing debug hook + perf counters | Void Explorer's `__VOID_EXPLORER__` | ✅ **HAVE** (`__hollowsun`) — extend with draw calls / tri counts |
| 4 | Seeded deterministic pure sim + unit tests | Void Explorer (Vitest on pure logic, seeded terrain) | ✅ **HAVE** (mulberry32, 106/106 headless) |
| 5 | **Named test scenes + journey tests** (Playwright drives real controls, asserts state, screenshots) | OpenAI's own QA contract | ⚠️ **PARTIAL** — agent-browser drives ad-hoc; formalize replayable journeys |
| 6 | **Render→inspect→refine closed loop** inside Blender (agentic visual iteration) | BlenderMCP pattern | ❌ **GAP** — assetgen is one-shot; add render-screenshot → VLM check → refine |
| 7 | Concept-art gate before assetgen (image-gen sets palette/silhouette as acceptance target) | OpenAI post | ⚠️ **PARTIAL** — SDK texture done once; make it standard per-asset-family |
| 8 | **Batch library export** (per-collection unlink → export → relink; Khronos `blender_gltf_converter.py -- -mp file`) | [Khronos template](https://github.khronos.org/glTF-Tutorials/BlenderGltfConverter/) · [batch exporters](https://robertshenton.co.za/blog/blender-batch-export) | ❌ **GAP** — upgrade assetgen from per-file to whole-library |
| 9 | **Cycles CPU baking** (normal/basecolor → cheap textures; device='CPU', fixed-memory) + decimate + auto-UV before export | [Blender manual](https://docs.blender.org/manual/en/latest/render/cycles/baking.html) | ❌ **GAP** — our sandbox is CPU-only; this is the GPU-free detail path |
| 10 | **GN bake-to-mesh before glTF** — Geometry-Nodes sims/instances do NOT survive glTF | [known trap](https://blender.stackexchange.com/q/310992) | 📋 documented trap — apply modifier before export |
| 11 | **Draco/Meshopt + KTX2** via `gltf-transform` (90–95% geometry savings) | [utsubo 100 tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips) | ❌ **GAP** — add as verify-gate step |
| 12 | **CC0 asset mass** (Kenney, Poly Haven, Poly Pizza, [awesome-cc0](https://github.com/madjin/awesome-cc0)) | tens of thousands of CC0 models/textures/audio | ❌ **GAP** — cheap firehose to blend with procedural set |
| 13 | <100 draw calls; InstancedMesh/BatchedMesh; shared materials; pooling; ≤3 lights; dispose-everything | utsubo + discourse canon | ✅ mostly **HAVE** (shared stylized materials, pools) — add `renderer.info` counter to `make qa` |
| 14 | Platform abstraction for portals (save, leaderboards, rewarded ads, SDK shim) | [CrazyGames requirements](https://docs.crazygames.com/requirements/intro) | ❌ **GAP** — thin `platform.ts` now = drop-in later |

---

## 3. Proof of ceiling — the quality bar is public and reachable

### 3a. Three.js / web games
| Game | Why it matters | Technique to steal |
|---|---|---|
| **Krunker.io** | Solo dev → one of the biggest browser FPS ever → **FRVR acquisition** | Rust→WASM for hot paths; asset subdomains; anti-tamper ([reverse-engineering](https://jakob.space/blog/browser-games-aren-t-an-easy-target.html)) |
| **Narrow One** (Pelican Party) | Studio-grade live multiplayer web game, also on Google Play | frictionless guest onboarding; one mode done perfectly |
| **PolyTrack** (Kodub) | Most popular three.js game on itch; mobile ports | low-poly discipline; speed-feel from camera/FOV |
| **DustSim** (Kodub) | millions of realtime particles in-browser | GPGPU particle buffers |
| **HexGL** | the classic "three.js can be a game" repo — **MIT** | full game anatomy: menu→race→HUD→post chain ([github](https://github.com/BKcore/HexGL)) |
| **stein.world** | full browser MMORPG (quests/inventory/multiplayer) | long-session browser ops |
| **FACEMINER** (Wristwork) | **paid $7.99**, 5.0 rating — web three.js games can charge | diegetic UI-as-gameplay (validates our instrument-panel direction) |

Correction logged: **Shell Shockers is Babylon.js, not three.js** — excluded to keep the table honest.

### 3b. Godot (for the hedge option)
| Game | Est. gross | Reviews | Genre | Lesson |
|---|---|---|---|---|
| Cruelty Squad (2021) | ~$19.7M | IGF finalist | 3D FPS | solo dev from a basic tutorial |
| **Brotato** (2022) | **$10.7M** | 102,051 @ 96.6% | **arena roguelite — our genre** | solo dev |
| Buckshot Roulette | $6.9M | 102,849 @ 95.7% | horror tabletop | itch.io first; tiny scope |
| Dome Keeper | $6.1M | 17,173 @ 92.3% | survival miner | jam → publisher |
| Halls of Torment | $3.4M | 29,767 @ 95.7% | bullet heaven, **hundreds of entities** | studio left Unity for Godot |
| Slay the Spire 2 | in dev | — | deckbuilder roguelite | famous Unity-exit studio |
| Sonic Colors: Ultimate | AAA remaster | — | 3D platformer | contract studios ship in Godot |

*(Estimates third-party, Steam-review-anchored — [analysis](https://alihan98ersoy.medium.com/most-successful-games-made-with-godot-engine-revenue-sales-analysis-2025-9b69af569585) · [official showcase](https://godotengine.org/showcase))*

**Godot headless pipeline is first-class:** `--headless --import` → `--headless --export-release "Web" builds/index.html` → butler push; CI via [Firebelley action](https://github.com/marketplace/actions/godot-export) / godot-ci. Export templates = **1.07 GB one-time (byte-verified via HTTP HEAD)** — feasible here. Web export since 4.3 needs no SharedArrayBuffer; wasm ≈ 7.4MB gzipped + pck + limited WebAudio "Sample" mode → **strictly worse than our instant JS bundle in the browser**. Verdict: **Three.js ships the web game; Godot stays a warm hedge** (one vertical-slice spike reusing our .glb assets, templates downloaded once, desktop door open).

### 3c. Text-to-3D reality check (honest)
**Nothing open-source runs in our 3GB CPU-only sandbox.** All capable open models are CUDA-bound with ≥6GB VRAM floors: TripoSR ~6GB (MIT) · SF3D ~6–7GB · Hunyuan3D-2.1 10–21GB (Tencent Community License, EU/UK/KR carve-outs) · TRELLIS.2 = 4B params (MIT). Paths forward: hosted demos/APIs → GLB → our Blender CLI retopo; hourly GPU rental for batches; **or stay pure-procedural + CC0 — which is exactly what the Astra showcases celebrate** ("worlds in code, no model files").

---

## 4. Quality ceiling — the honest read

- Platform prompt-games (YouTube Playables Builder): *"very simple platformers… hold anyone's attention for more than a few seconds"* ([Creative Bloq](https://www.creativebloq.com/3d/video-game-design/you-can-now-play-ai-generated-games-in-youtube)).
- One-prompt racers (Street Heat-class): impressive 30-second clips; no evidence of balance, difficulty curves, retention.
- **What separates the best (Void Explorer class):** ① human as **game director** — AI never owned taste or "feel"; ② hard systems problems solved over hundreds of targeted prompts (scale, LOD, floating origin, streaming); ③ **verification infrastructure** (test scenes, counters, journey tests); ④ **scope discipline** — one strong mechanic, not breadth.
- Net: `prompt→playable` ceiling = "competent toy". `agent + director + test-harness` ceiling = "genuinely impressive systems game". **We are structurally the second model** — the EMBER RITE revision loop (user rejects → redesign → verify) was the director-taste loop working as intended.

---

## 5. Decisions adopted into the Playbook (Sprint 11)

1. **Runtime:** Three.js ships; WebGL/GLSL today; `materials.ts` stays the single shader source; TSL-shaped organization only (flip to WebGPU later — one-file migration thanks to auto-fallback).
2. **Studio:** Blender-headless stays the asset engine; upgrade assetgen with: batch collection export · Cycles CPU bake · decimate/auto-UV · **render→VLM-inspect→refine loop**.
3. **Compression gate:** `gltf-transform` Draco/Meshopt + KTX2 into `make verify`; `renderer.info` draw-call counter into `make qa`.
4. **CC0 feed:** Kenney/Poly Haven curated into `public/assets` through the verify gate.
5. **Godot = hedge:** one vertical-slice spike (reuse our .glb), 1.07GB templates one-time, never a port target.
6. **QA:** formalize named journey tests + extend `__hollowsun` with perf counters; optional AI-playtester loop.
7. **Desktop:** community evidence favors **Electron over Tauri** for games (consistent GPU rendering) — revisit roadmap note at that time.
8. **Public benchmark:** ship a jam entry (VibeJam / GameDev.js Vibe Coding Jam rules: web-playable, ≥80% AI) — deadline-driven, community-benchmarked.

---

## 6. Where this leaves us

The wave's winning shape is *ours already*: agent-written code, bpy as the studio, glTF as the backbone, Three.js as the stage, headless verification everywhere. The gaps are cheap and concrete (rows 5–8, 11–12, 14 of the pattern table). What the wave cannot give anyone is the director's taste — and that is the part we just proved we can iterate on.

**Next: the pivot sprint.** EMBER RITE was declared a storyboard, not an anchor. Evidence favors the arena-roguelite/survivor genre (proven ceiling on both stacks), but direction is open: deep-sim survivor · procedural dungeon crawler · portal-first instant arcade. The Playbook pipeline generalizes to all three.
