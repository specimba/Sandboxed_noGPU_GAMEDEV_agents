# HOLLOW SUN — one-command pipeline ("Prompt → Code → Asset → Build → Play")
# Everything here runs headless inside the sandbox. No studio, no GUI.
#
# Pipeline v2 (PLAYBOOK §6): tier-2 library batch-export, render→VLM-inspect
# loop, and a gltf-transform optimization gate, all wired below.

BLENDER ?= $(wildcard /home/z/tools/blender-4.2.0-linux-x64/blender)
XVFB_DISPLAY ?= 77

.PHONY: assets assets-blender assets-library previews inspect optimize textures check qa dev verify pipeline help

help:
	@echo "make assets          - regenerate procedural .glb meshes (tier 1, pure TS)"
	@echo "make assets-blender  - legacy single obelisk via Blender (tier 2, superseded)"
	@echo "make assets-library  - tier-2 library: one bpy pass builds + batch-exports all collections (obelisk, monolith_cracked, inlay_hex, warden_slab, shard_cluster)"
	@echo "make previews        - render one preview PNG per .glb to .qa/assets (Workbench under Xvfb, Cycles CPU fallback)"
	@echo "make inspect         - VLM visual verdicts for the previews (ADVISORY gate; never blocks) -> .qa/asset-inspect.json"
	@echo "make optimize        - gltf-transform gate: weld+dedup+prune+KHR_mesh_quantization on every .glb (decoder-free in three.js)"
	@echo "make textures        - regenerate AI textures via SDK CLI (tier 3)"
	@echo "make check           - tsc + eslint"
	@echo "make qa              - headless full-run simulation"
	@echo "make verify          - bun-verify every generated .glb parses via GLTFLoader"
	@echo "make pipeline        - aggregate: assets + assets-library + optimize + verify + qa"
	@echo "make dev             - run the dev server (assumes already running in sandbox)"

assets:
	bun scripts/assetgen.ts

assets-blender:
	bun scripts/assetgen.ts --blender

# pipeline v2: single bpy script -> whole tier-2 .glb library (batch collection
# export). WIRED DIRECTLY to blender (documented choice): one make line, full
# bpy output visible in the log — no marker-filtering wrapper in between.
# (Alias kept: `bun scripts/assetgen.ts --blender-library [--only a,b]` does
# the same thing with graceful skip when blender is absent.)
assets-library:
	@test -x "$(BLENDER)" || { echo "assets-library: blender not found at $(BLENDER) — SKIP"; exit 0; }
	$(BLENDER) -b -P scripts/blender/asset_library.py -- out public/assets/meshes

# pipeline v2 step 1 of the render->inspect loop: Blender previews under raw Xvfb
previews:
	mkdir -p .qa/assets
	BLENDER="$(BLENDER)" XVFB_DISPLAY="$(XVFB_DISPLAY)" bash scripts/render_previews.sh .qa/assets public/assets/meshes

# pipeline v2 step 2: VLM visual QA over the previews (advisory — skips on failure)
inspect: previews
	bun scripts/inspect-assets.ts

# pipeline v2: gltf-transform optimization gate (weld+dedup+prune+quantization)
optimize:
	bun scripts/optimize-assets.ts

textures:
	mkdir -p public/assets/textures
	z-ai image -p "seamless dark obsidian stone texture, near-black charcoal volcanic rock, faint warm ember cracks glowing deep amber in crevices, flat top-down texture, subtle chiseled facets, dark moody game material, high quality, detailed" -o public/assets/textures/obsidian_ember.png -s 1024x1024

check:
	bunx tsc --noEmit
	bun run lint

qa:
	bun scripts/simdrive.ts

verify:
	bun scripts/verify-assets.ts

# aggregate v2 pipeline — prerequisites run left-to-right without -j; assets
# first (tier-1 regen), then the Blender library, then optimize, then verify
# the optimized bytes, then qa.
pipeline: assets assets-library optimize verify qa

dev:
	bun run dev
