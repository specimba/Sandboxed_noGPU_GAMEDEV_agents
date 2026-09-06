# HOLLOW SUN — one-command pipeline ("Prompt → Code → Asset → Build → Play")
# Everything here runs headless inside the sandbox. No studio, no GUI.

BLENDER ?= $(wildcard /home/z/tools/blender-4.2.0-linux-x64/blender)

.PHONY: assets assets-blender textures check qa dev verify help

help:
	@echo "make assets        - regenerate procedural .glb meshes (tier 1, pure TS)"
	@echo "make assets-blender- regenerate + Blender-tier obelisk (tier 2, if present)"
	@echo "make textures      - regenerate AI textures via SDK CLI (tier 3)"
	@echo "make check         - tsc + eslint"
	@echo "make qa            - headless full-run simulation"
	@echo "make dev           - run the dev server (assumes already running in sandbox)"
	@echo "make verify        - bun-verify every generated .glb parses via GLTFLoader"

assets:
	bun scripts/assetgen.ts

assets-blender:
	bun scripts/assetgen.ts --blender

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

dev:
	bun run dev
