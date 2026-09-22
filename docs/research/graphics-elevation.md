# Graphics Elevation Research — EMBER RITE / HOLLOW SUN

Task ID: 2-a · researcher · sources: 22 web searches (`/tmp/research-gfx/s01..s22.json`) + 4 full page reads.
Scope law respected: **view-layer only**; every technique below is presentation-side, zero `sim.ts` surface.

---

## Verified facts (hard evidence, read from source / registry)

1. **three r185 `UnrealBloomPass` internals** (source: [r185 UnrealBloomPass.js](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/postprocessing/UnrealBloomPass.js), read):
   - Bright-pass render target is created at **half resolution** (`resx = round(resolution.x/2)`, line ~102).
   - Blur chain = **5 mip pairs (H+V)**, each level half of the previous → 1/2 → 1/32 res, `HalfFloatType`.
   - Kernels `[6,10,14,18,22]` (changed by PR #31528 to kill blockiness).
   - Cost model: ~1 full-res bright draw + ~10 descending-res blur draws + 1 composite + 1 full-res additive blend. The dominant variable is **canvas pixel count** → the real lever is DPR / composer size, not the pass itself. Passing an explicit `resolution: Vector2` decouples internal RTs from canvas size.
2. **`postprocessing` (pmndrs) v6.39.5** (source: npm registry, read): peerDependencies `"three": ">= 0.168.0 < 0.187.0"` → **r185 is inside the supported range**. `EffectPass` merges N effects into one fullscreen pass (their stated perf pitch vs EffectComposer pass-chaining); all fullscreen ops use a single triangle. Ships Bloom/SelectiveBloom, GodRays, Vignette, Noise, ChromaticAberration, ToneMapping, Outline, SSAO, DOF. Actively maintained (217 releases).
3. **Selective bloom is the expensive variant**: both ecosystems implement it via an extra render-target pass (render scene again on a layer). The cheap variant is **threshold bloom** — keep emissives above ~1.0 luminance and tune `threshold`. Selective = ~2× scene render cost; do not adopt.
4. **Tone mapping** (source: [three.js forum "Tone Mapping Overview"](https://discourse.threejs.org/t/tone-mapping-overview/75204), read): ACES-filmic = filmic contrast, slightly desaturates brights; AgX = most neutral; three r152+ also ships Khronos **PBR-Neutral** (`NeutralToneMapping`). For a stylized ember look, ACES or Neutral + manual grade are both defensible; AgX *punchy* variant exists in r3f ecosystem (unverified in vanilla three docs — flag).
5. **Fake god rays** (source: [Cyanilux "Sun Beams / God Rays Shader Breakdown"](https://www.cyanilux.com/tutorials/god-rays-shader-breakdown/), read): billboarded quads with **top vertices displaced along the light direction**, unlit transparent (additive or alpha), optionally shadow-map-masked. Radial-blur post-process god rays only work looking *toward* the light; volumetric raymarching is expensive. Quads = the cheap path.

Claims below not marked verified are synthesis from search snippets + domain knowledge, and are **flagged** inline.

---

## Ranked technique table (≤14)

| # | Technique | Visual gain | GPU/CPU cost | Effort | Label | r185 / stack compat notes |
|---|-----------|-------------|--------------|--------|-------|---------------------------|
| 1 | **DPR cap + adaptive composer resolution** — cap `setPixelRatio` ≤1.5 (laptops), scale composer size 1.0→0.85→0.72 on frame-time hysteresis | Near-free +30–50% fill-rate headroom; unlocks every other technique; bloom follows automatically (its RTs derive from `resolution`) | SAVES GPU; ~40 LOC CPU | **S** | **QUICK WIN** | `composer.setSize(w*s, h*s)`; keep canvas CSS size unchanged (upscale bilinear). View-only, no sim risk. *Cost math from verified bloom internals; DRS pattern is standard (Unity WebGL dynamic-res discussions, konradzaba DRS writeup — snippets, unverified links)* |
| 2 | **Single merged grade pass: film grain + vignette + chromatic aberration + 8-bit dither** — replace current vignette-only pass with one ShaderPass | " AAA skin" instantly; grain hides banding on dark obsidian gradients (the #1 flat-color killer) | +1 fragment pass (cheap ALU, one hash-noise fetch) | **S** | **QUICK WIN** | Replaces existing pass → **net DC ±0**. Grain needs a per-frame seed uniform (view-layer time is fine). Keep CA radius tiny (1–2px) — misalignment reads as bug past that |
| 3 | **Retuned threshold bloom + explicit internal resolution** — emissives pushed >1.0, threshold ~0.85, strength ~0.6–0.9, pass `resolution` Vector2 (e.g. 1280×720) so bloom cost stops tracking DPR | Bloom reads as "alive ember light", not uniform fog | −20–40% vs full-res internals | **S** | **QUICK WIN** | Verified: constructor takes `resolution`. Emissive values >1.0 need the material to output HDR — composer input is HalfFloat in r185 (verified in source) |
| 4 | **Fake volumetric light shafts** — 2–4 additive billboard quads/cones from the skylight + lanterns, top-vertex displaced along light dir, soft radial canvas texture, slow shimmer | The single biggest "atmosphere" multiplier for an underground temple; sells god-light without any post pass | +1–2 InstancedMesh draws (≤ +2 DC) | **S** | **QUICK WIN** (HIGH impact/cost ratio) | Cyanilux-verified technique; additive blending matches existing Points stack; instanced = 1 draw for all shafts; fades under FogExp2 if needed |
| 5 | **Emissive flow-map veins** (heart + hex floor cracks) — two scrolling canvas-noise textures at opposing speeds/directions, sine intensity pulse, masked by existing hex UVs | The heart/floor stops being static; classic lava-vein read (UV panning + sine — standard VFX recipe) | +0 DC, ~10 extra ALU lines | **S–M** | **QUICK WIN / MEDIUM** | We already canvas-generate textures — extend generator with a vein/FBM texture. Two `uniform time` offsets; view-layer time only |
| 6 | **Gradient sky/backdrop dome** — one `BackSide` icosphere, vertex-height 3-stop gradient (ember horizon → deep ash), soft sun/heart disc, matched to FogExp2 color so walls fade into it | Kills the "empty black void" read; gives silhouettes something to separate from | +1 DC | **S** | **QUICK WIN** (scene-dependent — enclosed temple may want a "chasm glow" floor dome instead; same shader) | Unlit shader, fog-excluded; ~30 LOC. Common pattern (skydome tutorials, gradient-dome threads — snippets) |
| 7 | **Blob/gradient ground shadows** — one InstancedMesh of floor-clamped quads with radial-gradient canvas texture under every foe + player | Grounds every actor; the missing "weight" read on a no-shadow-map scene | +1 DC total (all blobs instanced) | **S** | **QUICK WIN** | Classic blob-shadow quad (simonschreibt breakdown — snippet, flagged). View-layer: reads existing seat positions, no sim write |
| 8 | **Banded/gradient-ramp lighting + baked vertex AO in stylized material** — N·L lookup into a 4–5 step ramp texture; multiply vertex-color AO (COLOR_0) forged per prop | Removes "flat plastic" facet read; consistent stylized shading language | +0 DC; 1 texture fetch | **M** | **MEDIUM EFFORT** | Builds directly on the sprint-19 vertex-AO proposal (worklog). Ramp texture = 1×5 canvas px. Must keep SSS/heart emissive path untouched |
| 9 | **Directional rim light upgrade** — replace pure fresnel rim with fixed-world-dir rim (fake key/rim light) + colored rim band (ember orange / rime blue per biome) | Foes read as lit *by the scene*, not self-glowing | +0 DC, few ALU lines | **S** | **MEDIUM** | Fragment-side dot(viewDir, lightDir) fresnel variant; per-biome rim color already exists as palette data |
| 10 | **Triplanar/FBM detail noise on floor + monolith shaders** — 2–3 octave value noise in fragment shader breaks flat obsidian planes; subtle height darkening in crevices | The "designed surface" read; hides texture-less low-poly tiling | +0 DC; ~3–5% fragment ALU on those meshes | **M** | **MEDIUM EFFORT** | Pure shader edit in existing floor/prop material; no new textures needed (procedural ALU noise) or reuse #5's FBM canvas texture |
| 11 | **Adopt pmndrs `postprocessing`** — migration justified ONLY if stacking ≥3 new effects (its EffectPass merges them into 1 pass); otherwise stay on EffectComposer | Architecture-level; enables cheap GodRays/DOF/Outline effects later | ~equal; fewer passes when merged | **M** (migration risk) | **MEDIUM / DEFER** | **Verified r185-compatible** (peerDeps). Migration touches all existing passes; do it only as a dedicated sprint with screenshot-diff QA. Selective bloom via `SelectiveBloomEffect` = still extra scene render — do NOT use |
| 12 | **Texture atlas + shared materials across prop-scatter families** — one atlas canvas, per-instance UV-offset attribute | Fewer program/material switches (27 programs today); margin for new props | DC −0–4; CPU draw-prep ↓ | **M** | **MEDIUM EFFORT** | Per-instance UV offset attribute pattern documented (discourse thread — snippet, flagged). Fits PROP_SCATTER law; static = deterministic |
| 13 | **Soft particles (depth-fade) for additive motes** — fade alpha via scene depth texture near geometry intersections | Kills hard-clip artifacts where motes cross floor/walls | +1 depth texture fetch/fragment | **M** | **EXPERIMENTAL** | WebGL2 supports depth textures; must wire `depthTexture` on composer input RT; adds coupling between particle shader and composer — spike first |
| 14 | **DOF / SSAO / radial-blur god rays post / selective bloom** | Real but expensive atmosphere | +1–2 full-res passes each; SSAO ~2× scene cost | **L** | **DEFER** | All read the depth buffer heavily; conflicts with the locked-60fps law until #1's headroom is banked. Revisit only after 1–10 prove headroom |

**Net draw-call math if 1–10 land:** +1 (dome) +2 (shafts) +1 (blobs) = **+4 DC**, offset by atlas (−0–4) and biome-1 instancing gains → inside the ≤ +2..+4 budget, with #1 buying the fill-rate headroom back.

---

## What attractive browser games actually do

Synthesis across the search corpus (snippets; domain-level URLs — the search API returns host-only URLs, so several are flagged as not deep-read):

1. **Lightweight low-poly + full post stack**: browser FPS shells (Shell Shockers / RIVALS-class) stay lightweight via low-poly flat-color worlds, then spend their entire remaining GPU budget on lighting, bloom and sky — the shapes are simple, the *lighting is not*. ([hstoday.us article on browser FPS](https://www.hstoday.us) — snippet, flagged)
2. **Low-poly ≠ lazy**: the low-poly "stand out" recipe is smooth-shaded forms + deliberate texture/detail work + strong palette — exactly the "simple geometrical shapes rather than designs" gap the owner named. ([3d-ace.com low-poly art breakdown](https://3d-ace.com) — snippet, flagged; [retrostylegames.com low-poly guide](https://retrostylegames.com) — snippet, flagged)
3. **Stylized post-processing IS the style**: bloom + outlines + AO "highlight the atmosphere" and carry the look of stylized games more than geometry does. ([retrostylegames.com stylized PP section](https://retrostylegames.com) — snippet, flagged)
4. **Case-study practice**: production stylized web essays (e.g. Maxime Heckel's Méca-Flamme breakdown of post-processing a stylized scene) build the look almost entirely in shader + post layers over simple geometry. ([blog.maximeheckel.com](https://blog.maximeheckel.com) — snippet, flagged)
5. **Cheap set-dressing beats expensive rendering**: billboarded light shafts, gradient domes, blob shadows — all present in shipped stylized games, all "one instanced draw" techniques. ([Cyanilux god rays](https://www.cyanilux.com/tutorials/god-rays-shader-breakdown/) — **verified read**; [simonschreibt.de blob shadow](https://simonschreibt.de) — snippet, flagged)
6. **Fill-rate discipline**: rendering post at half-res and upscaling can roughly double frame rate in fill-rate-bound scenes — the standard professional trick that makes heavy-looking games hit 60. ([utsubo.com "100 Three.js Tips"](https://www.utsubo.com) — snippet, flagged; corroborated by the verified r185 bloom half-res internals)

---

## Post stack recommendation

**Verdict: KEEP `EffectComposer` + `UnrealBloomPass` for now; adopt pmndrs `postprocessing` only as its own sprint if ≥3 new effects are wanted.**

- r185 `UnrealBloomPass` is already internally half-res down a 5-mip chain (verified above); its cost is proportional to canvas pixels → **the fix is resolution policy, not library swap**.
- pmndrs `postprocessing` v6.39.5 **is** r185-compatible (peerDeps `>=0.168.0 <0.187.0`, verified via npm registry) and would merge our ~4 effects into 1 EffectPass — but migration rewrites the post layer and risks regressions for near-zero visual gain by itself. Land the cheap wins (#2, #3) first.
- **Avoid `SelectiveBloomEffect` / layer-selective bloom**: extra scene render pass ≈ doubling scene cost. Threshold + HDR emissives achieves the same look.
- **Recommended bloom internal resolution**: pass an explicit `resolution` Vector2 ≈ **1280×720** (or `canvasSize × 0.5`, whichever is smaller). Below 1280 wide, bloom softness starts reading as blur on 1080p+ screens.
- **DPR policy for laptops**: cap `renderer.setPixelRatio` at **1.5** (1.0 floor on integrated GPUs); add a 3-step adaptive scale (1.0 / 0.85 / 0.72) driven by a rolling 30-frame average, ±500ms hysteresis, never downscales during hit-stops/slow-mo (visible). Never exceed DPR 2 — bloom + grade are pure fill-rate.
- **Grade order** (cheapest→final): scene → bloom → **merged grade pass** (vignette + grain + CA + dither) → tone map. Keep ACES; A/B-test `NeutralToneMapping` (ships in r185) — its less-filmy rolloff can make ember oranges read hotter; AgX is the wrong direction for a stylized punchy look (verified sentiment from the tone-mapping thread).

**Unverified / flagged claims:** utsubo "100 tips" specifics (half-res post ≈ 2×; material-sharing batching), per-instance UV-atlas attribute recipe, simonschreibt blob-shadow placement details, AgX-punchy availability in vanilla three, browser-FPS technique attributions (krunker/venge/shell-shockers render internals are not public — the "what they do" synthesis is from secondary sources only). All cost estimates are theoretical; measure with `renderer.info` before/after (baseline: 89 peak DC / 27 programs).
